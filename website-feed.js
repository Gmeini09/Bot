'use strict';
const fs = require('node:fs');
const path = require('node:path');
const TYPES = ['thumbnail','nve','soundpack','grafik','fivem','bot','bundle'];
function imageUrl(raw) {
  try { const u = new URL(raw); return u.protocol === 'https:' && ['cdn.discordapp.com','media.discordapp.net'].includes(u.hostname) && u.pathname.startsWith('/attachments/') ? u.href : null; } catch { return null; }
}
function extractImages(messages, guildId, channelId) {
  const items = [], seen = new Set();
  for (const message of messages) {
    const attachments = [...(message.attachments?.values?.() || [])];
    const urls = attachments.filter(a => !a.spoiler && !/turbo.*banner/i.test(a.name || '') && (a.contentType?.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(a.name || ''))).map(a => a.url);
    for (const e of message.embeds || []) if (!/turbo.*(?:portfolio|preview|design)/i.test(e.title || '')) urls.push(e.image?.url);
    for (const raw of urls) {
      const url = imageUrl(raw); if (!url || seen.has(new URL(url).pathname)) continue;
      seen.add(new URL(url).pathname);
      items.push({ id: `${message.id}-${items.length}`, image: url, title: 'Thumbnail Preview', messageUrl: `https://discord.com/channels/${guildId}/${channelId}/${message.id}` });
      if (items.length === 24) return items;
    }
  }
  return items;
}
function extractSamples(messages, guildId, channelId) {
  const samples = [], seen = new Set();
  for (const message of messages) for (const a of message.attachments?.values?.() || []) {
    if (a.spoiler || !/\.(wav|mp3|ogg|m4a|aac|flac|mp4|webm)$/i.test(a.name || '')) continue;
    const url = imageUrl(a.url); if (!url || seen.has(new URL(url).pathname)) continue;
    seen.add(new URL(url).pathname);
    samples.push({ id: a.id || `${message.id}-${samples.length}`, url, title: String(a.name || 'Soundpack').replace(/\.[^.]+$/, '').replace(/[_-]+/g,' ').slice(0,100), kind: /\.(mp4|webm)$/i.test(a.name || '') ? 'video' : 'audio', messageUrl: `https://discord.com/channels/${guildId}/${channelId}/${message.id}` });
    if (samples.length === 12) return samples;
  }
  return samples;
}
function readCatalog(guildId, directory) {
  const raw = JSON.parse(fs.readFileSync(path.join(directory, 'selling-data.json'), 'utf8'));
  const data = raw.guilds?.[guildId]; if (!data?.products) throw new Error('Catalog unavailable');
  return TYPES.filter(key => data.products[key]).map(key => {
    const c = data.products[key], n = c.price === null || c.price === undefined || c.price === '' ? null : Number(c.price);
    return { key, price: Number.isFinite(n) && n >= 0 ? n : null, enabled: c.enabled !== false, etaDays: Number.isFinite(Number(c.etaDays)) ? Number(c.etaDays) : null };
  });
}
function install() {
  const { Client, Events } = require('discord.js');
  const http = require('node:http');
  let client, cache, pending, retryAt = 0;
  async function refresh() {
    if (cache && Date.now() - cache.at < 60000) return cache.data;
    if (Date.now() < retryAt) throw new Error('Retry later');
    if (pending) return pending;
    pending = (async () => {
      if (!client?.isReady()) throw new Error('Bot not ready');
      const invite = await client.fetchInvite('turbodesigns');
      const guild = await client.guilds.fetch(invite.guild.id);
      const channels = await guild.channels.fetch();
      const channel = channels.find(c => c && c.name.replace(/^[^a-z0-9]+/i, '').toLowerCase() === 'thumbnails-preview' && c.isTextBased());
      if (!channel) throw new Error('Preview channel missing');
      const messages = await channel.messages.fetch({ limit: 100, cache: false });
      const previews = extractImages([...messages.values()].sort((a,b) => b.createdTimestamp-a.createdTimestamp), guild.id, channel.id);
      const directory = process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.DATA_DIR || __dirname;
      const products = readCatalog(guild.id, directory);
      const findChannel = name => channels.find(c => c && c.name.replace(/^[^a-z0-9]+/i,'').toLowerCase() === name && c.isTextBased());
      const channelLink = name => { const c = findChannel(name); return c ? `https://discord.com/channels/${guild.id}/${c.id}` : 'https://discord.gg/turbodesigns'; };
      const productChannels = { thumbnail:'thumbnails', nve:'nve-presets', soundpack:'soundpacks', grafik:'grafik-designs', fivem:'fivem-assets', bot:'discord-bots', bundle:'bundles' };
      products.forEach(p => { p.orderUrl = channelLink(productChannels[p.key]); });
      const soundChannel = findChannel('soundpacks-preview');
      let samples = [], samplesAvailable = Boolean(soundChannel);
      if (soundChannel) {
        try { const sounds = await soundChannel.messages.fetch({limit:100,cache:false}); samples = extractSamples([...sounds.values()].sort((a,b)=>b.createdTimestamp-a.createdTimestamp),guild.id,soundChannel.id); }
        catch { samplesAvailable = false; }
      }
      const extras = { samples, samplesAvailable, soundChannelUrl:channelLink('soundpacks-preview'), orderChannelUrl:channelLink('bestellen') };
      const data = { ...extras, connected: true, updatedAt: new Date().toISOString(), previews, products, previewChannelUrl: `https://discord.com/channels/${guild.id}/${channel.id}`, inviteUrl: 'https://discord.gg/turbodesigns' };
      cache = { at: Date.now(), data }; return data;
    })().catch(error => { retryAt = Date.now()+30000; console.warn('[website-feed] Refresh unavailable:', error.code || error.message); throw error; }).finally(() => { pending = null; });
    return pending;
  }
  const login = Client.prototype.login;
  Client.prototype.login = function(...args) {
    client = this;
    if (!this.__websiteFeedInstalled) {
      this.__websiteFeedInstalled = true;
      this.once(Events.ClientReady, () => refresh().catch(() => {}));
    }
    return login.apply(this,args);
  };
  const createServer = http.createServer;
  http.createServer = function(...args) {
    const index = args.findIndex(arg => typeof arg === 'function');
    if (index >= 0) {
      const listener = args[index];
      args[index] = async function(req,res) {
        if ((req.url || '').split('?')[0] !== '/turbo-public-feed') return listener(req,res);
        const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
        if (req.method !== 'GET') { res.writeHead(405, {...headers,allow:'GET'}); return res.end('{}'); }
        try { const data = await refresh(); res.writeHead(200,headers); res.end(JSON.stringify(data)); }
        catch { res.writeHead(503,{...headers,'retry-after':'30'}); res.end(JSON.stringify({ connected:false, error:'DISCORD_SYNC_UNAVAILABLE' })); }
      };
    }
    return createServer.apply(this,args);
  };
}
module.exports = { imageUrl, extractImages, readCatalog, extractSamples, install };
