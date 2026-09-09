'use strict';
const tls = require('node:tls');

function parseLine(line) {
  const match = line.match(/^(?:@([^ ]+) )?:([^ ]+) PRIVMSG #([a-z0-9_]+) :([\s\S]*)$/i);
  if (!match) return null;
  const tags = Object.fromEntries((match[1] || '').split(';').map(t => { const i = t.indexOf('='); return [t.slice(0, i), t.slice(i + 1)]; }));
  return { userId: tags['user-id'], login: match[2].split('!')[0].toLowerCase(), channel: match[3].toLowerCase(), text: match[4] };
}

class Twitch {
  constructor(store, env, request = fetch, connect = tls.connect) {
    this.store = store; this.env = env; this.request = request; this.connect = connect;
    this.sockets = new Map(); this.stopped = false; this.app = null; this.failures = new Set(); this.refreshes = new Map();
    for (const g of Object.values(store.state.guilds)) if (g.auth) g.auth.validatedAt = 0;
  }
  get configured() { return Boolean(this.env.TWITCH_CLIENT_ID && this.env.TWITCH_CLIENT_SECRET); }
  async json(url, init = {}) {
    const r = await this.request(url, { ...init, signal: AbortSignal.timeout(15000) });
    if (!r.ok) { const error = new Error('TWITCH_HTTP_' + r.status); error.status = r.status; throw error; }
    return r.json();
  }
  async token(params) {
    return this.json('https://id.twitch.tv/oauth2/token', { method: 'POST', body: new URLSearchParams({ client_id: this.env.TWITCH_CLIENT_ID, client_secret: this.env.TWITCH_CLIENT_SECRET, ...params }) });
  }
  async validate(access) {
    const v = await this.json('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: 'OAuth ' + access } });
    if (v.client_id !== this.env.TWITCH_CLIENT_ID || !v.scopes?.includes('chat:read')) throw new Error('TWITCH_SCOPE_INVALID');
    return v;
  }
  async authorize(guildId, code, redirect, expectedChannel) {
    const t = await this.token({ grant_type: 'authorization_code', code, redirect_uri: redirect });
    const v = await this.validate(t.access_token);
    const g = this.store.guild(guildId);
    if (g.channel !== expectedChannel || v.login?.toLowerCase() !== expectedChannel) throw new Error('TWITCH_CHANNEL_MISMATCH');
    this.close(guildId);
    g.auth = { access: t.access_token, refresh: t.refresh_token, login: v.login.toLowerCase(), expiresAt: Date.now() + t.expires_in * 1000, validatedAt: Date.now() };
    this.store.save(); this.failures.delete(guildId);
  }
  async access(guildId) {
    if (this.refreshes.has(guildId)) return this.refreshes.get(guildId);
    const task = this.accessInner(guildId);
    this.refreshes.set(guildId, task);
    try { return await task; } finally { this.refreshes.delete(guildId); }
  }
  async accessInner(guildId) {
    const g = this.store.guild(guildId); const a = g.auth;
    if (!a) throw new Error('Twitch zuerst mit /stream verbinden autorisieren.');
    const refresh = async () => {
      const t = await this.token({ grant_type: 'refresh_token', refresh_token: a.refresh });
      a.access = t.access_token; a.refresh = t.refresh_token || a.refresh;
      a.expiresAt = Date.now() + t.expires_in * 1000; a.validatedAt = 0;
      this.store.save(); this.close(guildId);
    };
    if (a.expiresAt < Date.now() + 120000) await refresh();
    if (!a.validatedAt || a.validatedAt < Date.now() - 3600000) {
      let v;
      try { v = await this.validate(a.access); } catch (e) { if (e.status !== 401) throw e; await refresh(); v = await this.validate(a.access); }
      if (v.login?.toLowerCase() !== g.channel) throw new Error('TWITCH_CHANNEL_MISMATCH');
      a.validatedAt = Date.now(); this.store.save();
    }
    return a;
  }
  async live(channel) {
    if (!this.app || this.app.expiresAt < Date.now() + 60000) {
      const t = await this.token({ grant_type: 'client_credentials' });
      this.app = { access: t.access_token, expiresAt: Date.now() + t.expires_in * 1000 };
    }
    try {
      const data = await this.json('https://api.twitch.tv/helix/streams?user_login=' + encodeURIComponent(channel), { headers: { Authorization: 'Bearer ' + this.app.access, 'Client-ID': this.env.TWITCH_CLIENT_ID } });
      return data.data?.find(s => s.type === 'live') || null;
    } catch (e) { if (e.status === 401) this.app = null; throw e; }
  }
  connected(id) { return this.sockets.get(id)?.joined === true; }
  close(id) {
    const current = this.sockets.get(id);
    this.sockets.delete(id);
    current?.socket.destroy();
  }
  async ensure(id) {
    if (this.stopped) return;
    const g = this.store.guild(id);
    const auth = await this.access(id);
    if (this.sockets.has(id) || this.stopped || g.auth !== auth || g.channel !== auth.login) return;
    const entry = { joined: false, socket: null };
    const socket = this.connect({ host: 'irc.chat.twitch.tv', port: 6697, servername: 'irc.chat.twitch.tv', rejectUnauthorized: true }, () => {
      socket.write('PASS oauth:' + auth.access + '\r\nNICK ' + auth.login + '\r\nCAP REQ :twitch.tv/tags twitch.tv/commands\r\nJOIN #' + g.channel + '\r\n');
    });
    entry.socket = socket; this.sockets.set(id, entry);
    let buffer = '';
    socket.setEncoding('utf8'); socket.setTimeout(180000, () => socket.destroy());
    socket.on('data', chunk => {
      buffer += chunk;
      if (buffer.length > 65536) { socket.destroy(); return; }
      let split;
      while ((split = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, split); buffer = buffer.slice(split + 2);
        if (line.startsWith('PING ')) socket.write('PONG ' + line.slice(5) + '\r\n');
        if (line.includes(' RECONNECT')) socket.destroy();
        if (line.includes('Login authentication failed') || line.includes('Improperly formatted auth')) {
          auth.validatedAt = 0; this.failures.add(id); socket.destroy();
        }
        if (line.includes(' ROOMSTATE #' + g.channel)) { entry.joined = true; this.failures.delete(id); }
        const message = parseLine(line);
        if (entry.joined && message?.channel === g.channel && message.text.trim().toLowerCase() === '!join') {
          try { this.store.join(message.channel, message.userId || '', message.login); } catch { this.failures.add(id); socket.destroy(); }
        }
      }
    });
    socket.on('error', error => {   console.error('Twitch IRC Socket-Fehler:', error?.code || error?.message || error);   this.failures.add(id); });
    socket.on('close', () => { if (this.sockets.get(id) === entry) this.sockets.delete(id); });
  }
  stop() { this.stopped = true; for (const id of this.sockets.keys()) this.close(id); }
}
module.exports = { Twitch, parseLine };
