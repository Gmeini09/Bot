'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Store, UserError } = require('./store');
const { Twitch } = require('./twitch');

const sub = (name, description, options = []) => ({ type: 1, name, description, options });
const str = (name, description, required = false, max_length = 200) => ({ type: 3, name, description, required, max_length });
const int = (name, description, min_value, max_value) => ({ type: 4, name, description, required: true, min_value, max_value });
function commands() {
  return [
    { name: 'stream', description: 'UNFUG Twitch und Live-Ankündigungen', default_member_permissions: '32', dm_permission: false, options: [
      sub('einrichten', 'Twitch und Discord-Kanal festlegen', [str('twitch', 'Twitch-Kanalname', true, 25), { type: 7, name: 'kanal', description: 'Live-Ankündigungskanal', required: true, channel_types: [0, 5] }, { type: 8, name: 'pingrolle', description: 'Optionale Pingrolle (weglassen entfernt sie)' }]),
      sub('text', 'Ankündigung bearbeiten: {name}, {title}, {game}, {url}', [str('vorlage', 'Text mit Platzhaltern', true, 1500)]),
      sub('verbinden', 'Twitch sicher im Browser autorisieren'), sub('overlay', 'Private OBS-Adresse anzeigen'),
      sub('overlayneu', 'Overlay-Schlüssel erneuern; alte OBS-Adresse wird ungültig'),
      sub('an', 'Automatische Live-Ankündigungen aktivieren'), sub('aus', 'Automatische Live-Ankündigungen deaktivieren'),
      sub('status', 'Konfiguration und Verbindungsstatus'), sub('test', 'Test-Ankündigung ohne Ping senden'),
    ] },
    { name: 'streamgiveaway', description: 'Giveaway mit Twitch !join und OBS', default_member_permissions: '32', dm_permission: false, options: [
      sub('start', 'Giveaway im Twitch-Chat starten', [str('gewinn', 'Gewinn', true), int('minuten', 'Dauer in Minuten', 1, 1440), int('gewinner', 'Anzahl Gewinner', 1, 20)]),
      sub('status', 'Aktuelles Giveaway anzeigen'), sub('beenden', 'Jetzt zufällig auslosen'),
      sub('neuziehen', 'Andere Teilnehmer ziehen; frühere Gewinner ausgeschlossen'), sub('abbrechen', 'Ohne Gewinner abbrechen'),
      sub('ausblenden', 'Overlay ausblenden; Teilnahme und Gewinner bleiben gespeichert'),
    ] },
  ];
}

function format(template, stream) {
  const values = { name: stream.user_name, title: stream.title, game: stream.game_name || '—', url: 'https://www.twitch.tv/' + stream.user_login };
  return template.replace(/\{(name|title|game|url)\}/g, (_, key) => values[key]).slice(0, 4000);
}

function initializeIntegration({ client, storageDir, canManage, env = process.env, request = fetch, twitch: injectedTwitch }) {
  // Disabled by default: loading this module never starts a second Discord client.
  if (env.STREAM_ENABLED !== 'true') return { commands: () => [], handleInteraction: async () => false, handleHttp: () => false, start() {}, stop() {} };
  const store = new Store(storageDir);
  const twitch = injectedTwitch || new Twitch(store, env, request);
  const pending = new Map();
  const publicUrl = env.PUBLIC_URL || 'https://bot-production-d58c.up.railway.app';
  const base = new URL(publicUrl);
  if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw new Error('PUBLIC_URL muss eine HTTPS-Origin sein.');
  const redirect = base.origin + '/stream/oauth/callback';
  let timer, expiryTimer, busy = false;
  const overlay = fs.readFileSync(path.join(__dirname, 'overlay.html'), 'utf8');
  const script = fs.readFileSync(path.join(__dirname, 'overlay.js'), 'utf8');
  function status(id) {
    const g = store.guild(id); const a = g.giveaway;
    return `Twitch: ${g.channel || 'nicht eingerichtet'}\nChat: ${twitch.connected(id) ? 'verbunden' : 'nicht verbunden'}\nLive-Ankündigungen: ${g.enabled ? 'an' : 'aus'}\nLetzte Prüfung: ${g.lastPoll ? new Date(g.lastPoll).toISOString() : 'noch keine'}\nLetztes Ergebnis: ${g.lastResult || '—'}\n${a ? `Giveaway: ${a.prize} • ${a.status} • ${Object.keys(a.entrants).length} Teilnehmer\nGewinner: ${a.winners.map(w => w.login).join(', ') || '—'}` : 'Kein Giveaway.'}`;
  }
  async function send(g, stream, test = false) {
    const channel = await client.channels.fetch(g.announcementChannel);
    if (!channel || channel.guildId !== g.guildId || !channel.isTextBased()) throw new Error('DISCORD_CHANNEL_INVALID');
    const channelName = stream.user_name || stream.user_login || g.channel;
    const streamUrl = 'https://www.twitch.tv/' + stream.user_login;
    const embed = {
      title: test ? 'Toomturboo ist live • TEST' : 'Toomturboo ist live',
      color: 0x9147ff,
      description: `${test ? 'Testmeldung – keine echte Live-Ankündigung.\n\n' : ''}Schaut vorbei und seid dabei!\n\n**${stream.title || 'Live auf Twitch'}**`,
      url: streamUrl,
      fields: [
        { name: 'Spiel', value: stream.game_name || '—', inline: true },
        { name: 'Zuschauer', value: Number.isFinite(stream.viewer_count) ? String(stream.viewer_count) : '—', inline: true },
      ],
      thumbnail: { url: `https://static-cdn.jtvnw.net/ttv-boxart/${encodeURIComponent(stream.game_name || 'Just Chatting')}-285x380.jpg` },
      image: stream.thumbnail_url ? { url: stream.thumbnail_url.replace('{width}', '960').replace('{height}', '540') } : undefined,
      footer: { text: `${channelName} • twitch.tv/${stream.user_login}` },
      timestamp: new Date().toISOString(),
    };
    return channel.send({
      content: !test && g.role ? `<@&${g.role}>` : undefined,
      embeds: [embed],
      allowedMentions: { parse: [], roles: !test && g.role ? [g.role] : [] },
    });
  }
  async function poll() {
    if (busy) return;
    busy = true;
    try {
      store.expire();
      for (const [id, g] of Object.entries(store.state.guilds)) {
        if (!client.guilds.cache.has(id) || !g.channel) continue;
        if (g.auth) try { await twitch.ensure(id); } catch { twitch.failures?.add(id); twitch.close(id); }
        if (!g.enabled || !twitch.configured) continue;
        try {
          const channelName = g.channel;
          const live = await twitch.live(channelName);
          if (!g.enabled || g.channel !== channelName) continue;
          g.lastPoll = Date.now();
          if (live && !g.seen.includes(live.id)) {
            // Reserve before sending. A crash cannot trigger a duplicate role ping.
            g.seen.push(live.id); g.seen = g.seen.slice(-200);
            g.lastResult = 'Ankündigung reserviert; bei Abbruch Versand im Discord prüfen.';
            store.save();
            await send(g, live);
            g.lastResult = 'Live-Ankündigung gesendet.';
          } else if (!live) g.lastResult = 'Twitch offline.';
          store.save();
        } catch {
          g.lastResult = 'Prüfung oder Versand fehlgeschlagen. Discord-Kanal und Twitch-Konfiguration prüfen; reservierte Live-Meldung wird nicht erneut gepingt.';
          store.save();
        }
      }
    } finally { busy = false; }
  }
  async function handleInteraction(i) {
    if (!i.isChatInputCommand() || !['stream', 'streamgiveaway'].includes(i.commandName)) return false;
    if (!i.inGuild() || !canManage(i.member)) {
      await i.reply({ content: 'Dafür brauchst du die Berechtigung „Server verwalten“.', ephemeral: true }); return true;
    }
    await i.deferReply({ ephemeral: true });
    try {
      const id = i.guildId; const g = store.guild(id); const o = i.options; const action = o.getSubcommand();
      let reply = 'Gespeichert.';
      if (i.commandName === 'streamgiveaway') {
        if (action === 'start') {
          if (!g.channel || !twitch.connected(id)) throw new UserError('Twitch-Chat ist noch nicht verbunden. /stream verbinden und danach /stream status verwenden.');
          store.create(id, o.getString('gewinn'), o.getInteger('minuten'), o.getInteger('gewinner'));
          reply = 'Giveaway läuft! Zuschauer nehmen im Twitch-Chat mit !join teil. Das OBS-Overlay aktualisiert sich automatisch.';
        } else if (action === 'beenden') store.draw(id);
        else if (action === 'neuziehen') store.draw(id, true);
        else if (action === 'abbrechen') store.cancel(id);
        else if (action === 'ausblenden') { g.overlayHidden = true; store.save(); reply = 'Overlay ausgeblendet. Das nächste neue Giveaway blendet es wieder ein.'; }
        else if (action === 'status') reply = status(id);
      } else if (action === 'einrichten') {
        const name = o.getString('twitch').toLowerCase().trim();
        if (!/^[a-z0-9_]{1,25}$/.test(name)) throw new UserError('Bitte nur den Twitch-Kanalnamen eingeben.');
        const ch = o.getChannel('kanal'); const role = o.getRole('pingrolle');
        if (ch.guildId !== id || (role && (role.id === id || role.managed))) throw new UserError('Ungültiger Kanal oder Pingrolle.');
        if (g.channel !== name && g.giveaway?.status === 'open') throw new UserError('Bitte zuerst das laufende Giveaway beenden.');
        if (g.channel !== name) { delete g.auth; twitch.close(id); g.enabled = false; }
        Object.assign(g, { guildId: id, channel: name, announcementChannel: ch.id, role: role?.id || null }); store.save();
        reply = 'Eingerichtet. Nächster Schritt: /stream verbinden. Live-Meldungen mit /stream an aktivieren.';
      } else if (action === 'text') {
        g.template = o.getString('vorlage'); store.save(); reply = 'Ankündigungstext gespeichert. Vorschau mit /stream test.';
      } else if (action === 'verbinden') {
        if (!g.channel || !twitch.configured) throw new UserError('Erst /stream einrichten ausführen und TWITCH_CLIENT_ID sowie TWITCH_CLIENT_SECRET in Railway setzen.');
        for (const [key, value] of pending) if (value.expires < Date.now() || value.id === id) pending.delete(key);
        const key = crypto.randomBytes(32).toString('hex');
        pending.set(key, { id, channel: g.channel, expires: Date.now() + 10 * 60000 });
        const auth = new URL('https://id.twitch.tv/oauth2/authorize');
        auth.search = new URLSearchParams({ client_id: env.TWITCH_CLIENT_ID, redirect_uri: redirect, response_type: 'code', scope: 'chat:read', state: key, force_verify: 'true' }).toString();
        reply = `Innerhalb von 10 Minuten als **${g.channel}** bei Twitch bestätigen:\n${auth}\nDiesen Link privat halten.`;
      } else if (action === 'overlay' || action === 'overlayneu') {
        if (action === 'overlayneu') { g.overlayKey = crypto.randomBytes(32).toString('hex'); store.save(); }
        reply = `${base.origin}/stream/overlay#${id}.${g.overlayKey}\nAls Browserquelle mit 1920 × 1080 verwenden. URL privat halten.`;
      } else if (action === 'an') {
        if (!g.channel || !g.announcementChannel || !twitch.configured) throw new UserError('Zuerst Twitch und Ankündigungskanal einrichten.');
        g.enabled = true; store.save(); reply = 'Automatik an. Auch ein bereits laufender, noch nicht angekündigter Stream wird beim nächsten Check gemeldet.';
      } else if (action === 'aus') { g.enabled = false; store.save(); }
      else if (action === 'status') reply = status(id);
      else if (action === 'test') {
        if (!g.announcementChannel) throw new UserError('Zuerst /stream einrichten ausführen.');
        await send(g, { user_name: g.channel, user_login: g.channel, title: 'Teststream', game_name: 'FiveM' }, true);
        reply = 'Gekennzeichnete Testmeldung ohne Ping gesendet.';
      }
      await i.editReply({ content: reply, allowedMentions: { parse: [] } });
    } catch (e) {
      const message = e instanceof UserError ? e.message : 'Stream-Funktion fehlgeschlagen. Konfiguration und Berechtigungen prüfen.';
      await i.editReply({ content: message.slice(0, 1900), allowedMentions: { parse: [] } });
    }
    return true;
  }
  function handleHttp(req, res) {
    const url = new URL(req.url || '/', 'http://localhost');
    if (!url.pathname.startsWith('/stream/')) return false;
    const respond = (status, body, type = 'text/plain; charset=utf-8') => {
      res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'" }); res.end(body);
    };
    if (req.method !== 'GET') { respond(405, 'Method not allowed'); return true; }
    if (url.pathname === '/stream/overlay') respond(200, overlay, 'text/html; charset=utf-8');
    else if (url.pathname === '/stream/overlay.js') respond(200, script, 'text/javascript; charset=utf-8');
    else if (url.pathname === '/stream/state') {
      const match = (req.headers.authorization || '').match(/^Bearer (\d+)\.([a-f0-9]{64})$/);
      const g = match && store.state.guilds[match[1]];
      if (!g || !crypto.timingSafeEqual(Buffer.from(g.overlayKey, 'hex'), Buffer.from(match[2], 'hex'))) respond(401, 'Unauthorized');
      else respond(200, JSON.stringify(store.publicState(match[1], twitch.connected(match[1]))), 'application/json; charset=utf-8');
    } else if (url.pathname === '/stream/oauth/callback') {
      const state = url.searchParams.get('state'); const entry = pending.get(state); pending.delete(state);
      if (!entry || entry.expires < Date.now() || !url.searchParams.get('code')) respond(400, 'Autorisierung ungueltig/abgelaufen. /stream verbinden erneut verwenden.');
      else twitch.authorize(entry.id, url.searchParams.get('code'), redirect, entry.channel)
        .then(() => respond(200, 'Twitch verbunden. Dieses Fenster schliessen. Nach spaetestens 60 Sekunden /stream status pruefen.'))
        .catch(() => respond(400, 'Twitch-Verbindung fehlgeschlagen. Richtiges Twitch-Konto und Redirect-URL pruefen. /stream verbinden erneut verwenden.'));
    } else respond(404, 'Not found');
    return true;
  }
  return { commands, handleInteraction, handleHttp, store, poll, send,
    start() {
      if (timer) return;
      poll().catch(() => console.error('UNFUG stream poll failed'));
      timer = setInterval(() => poll().catch(() => console.error('UNFUG stream poll failed')), 60000); timer.unref();
      expiryTimer = setInterval(() => { try { store.expire(); } catch { console.error('UNFUG stream storage failed'); } }, 1000); expiryTimer.unref();
    },
    stop() { clearInterval(timer); clearInterval(expiryTimer); timer = null; twitch.stop(); },
  };
}
function createIntegration(options) {
  try {
    const instance = initializeIntegration(options);
    const handle = instance.handleHttp;
    instance.handleHttp = (req, res) => {
      try { return handle(req, res); } catch {
        if (!res.headersSent) res.writeHead(503, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
        res.end('Stream unavailable'); return true;
      }
    };
    return instance;
  } catch {
    console.error('UNFUG stream initialization failed. Community bot remains active; check stream configuration/storage.');
    return initializeIntegration({ env: {} });
  }
}
module.exports = { createIntegration, commands, format };
