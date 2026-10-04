'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
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

function validateRequest(data) {
  const text=(key,max,required=false)=>{const value=typeof data?.[key]==='string'?data[key].trim():'';if(value.length>max||(required&&!value)||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))throw new Error('INVALID_REQUEST');return value;};
  const product=text('product',32,true),id=text('requestId',36,true),contact=text('contact',64,true);
  if(!TYPES.includes(product)||! /^[a-f0-9-]{36}$/i.test(id)||contact.length<2)throw new Error('INVALID_REQUEST');
  const reference=text('reference',200),discordUserId=text('discordUserId',20);
  if(reference&&!/^https:\/\/discord\.com\/channels\/1531989453168578650\/1550470150086729748\/\d{17,20}$/.test(reference))throw new Error('INVALID_REQUEST');
  if(discordUserId&&!/^\d{17,20}$/.test(discordUserId))throw new Error('INVALID_REQUEST');
  return {requestId:id,product,contact,project:text('project',1500,true),deadline:text('deadline',100),assets:text('assets',300),reference,discordUserId};
}
function verifyRequestSignature(req,raw) {
  const secret=process.env.WEBSITE_REQUEST_SECRET,stamp=String(req.headers['x-turbo-timestamp']||''),signature=String(req.headers['x-turbo-signature']||'');
  if(!secret||secret.length<32||!/^\d{13}$/.test(stamp)||Math.abs(Date.now()-Number(stamp))>60000||! /^[a-f0-9]{64}$/.test(signature))return false;
  const expected=crypto.createHmac('sha256',secret).update(`${stamp}:${req.method}:/turbo-website-requests:${raw}`).digest();
  return crypto.timingSafeEqual(expected,Buffer.from(signature,'hex'));
}
async function requestBody(req) {
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>8192)throw new Error('BODY_TOO_LARGE');chunks.push(chunk);}
  return Buffer.concat(chunks).toString('utf8');
}

function install() {
  const { Client, Events } = require('discord.js');
  const http = require('node:http');
  let client, cache, pending, retryAt = 0;
  const requestPending=new Map(),userPending=new Map();
  async function requestChannel() {
    if(!client?.isReady())throw new Error('BOT_NOT_READY');
    const {PermissionFlagsBits}=require('discord.js');
    const guild=await client.guilds.fetch('1531989453168578650');
    const channels=await guild.channels.fetch();await guild.roles.fetch();
    const normalize=name=>name.replace(/^[^a-z0-9]+/i,'').toLowerCase();
    const channel=channels.find(c=>c&&normalize(c.name)==='bestellungen'&&c.isTextBased()&&typeof c.send==='function');
    if(!channel||channel.permissionsFor(guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel))throw new Error('PRIVATE_CHANNEL_UNAVAILABLE');
    const staff=new Set(['inhaber','management','support','designer','sound designer','developer']);
    for(const role of guild.roles.cache.values()) {
      if(role.managed||role.permissions.has(PermissionFlagsBits.Administrator)||staff.has(normalize(role.name)))continue;
      if(channel.permissionsFor(role)?.has(PermissionFlagsBits.ViewChannel))throw new Error('CHANNEL_NOT_PRIVATE');
    }
    const me=guild.members.me || await guild.members.fetchMe();
    if(!channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.EmbedLinks]))throw new Error('BOT_PERMISSION_MISSING');
    return channel;
  }
  function staffRoles(guild){return [...guild.roles.cache.values()].filter(role=>['inhaber','management','support','designer','sound designer','developer'].includes(role.name.replace(/^[^a-z0-9]+/i,'').toLowerCase()));}
  async function personalChannel(team,data){
    const {PermissionFlagsBits:P,ChannelType}=require('discord.js'),guild=team.guild;
    const member=await guild.members.fetch(data.discordUserId).catch(()=>null);if(!member||member.user?.bot)throw new Error('JOIN_REQUIRED');
    const me=guild.members.me||await guild.members.fetchMe();if(!me.permissions.has(P.ManageChannels))throw new Error('TICKET_UNAVAILABLE');
    const roles=staffRoles(guild);if(!roles.length)throw new Error('TICKET_UNAVAILABLE');
    const channels=await guild.channels.fetch();
    let channel=channels.find(c=>c?.topic?.startsWith(`website-owner:${data.discordUserId}|`)&&c.isTextBased()&&typeof c.send==='function');
    if(channel){
      if(channel.permissionsFor(guild.roles.everyone)?.has(P.ViewChannel)||!channel.permissionsFor(member)?.has([P.ViewChannel,P.SendMessages]))throw new Error('TICKET_UNAVAILABLE');
      const permitted=new Set(roles.map(r=>r.id));for(const role of guild.roles.cache.values())if(!role.managed&&!role.permissions.has(P.Administrator)&&!permitted.has(role.id)&&channel.permissionsFor(role)?.has(P.ViewChannel))throw new Error('TICKET_UNAVAILABLE');
      return channel;
    }
    const common=[P.ViewChannel,P.SendMessages,P.ReadMessageHistory,P.AttachFiles,P.EmbedLinks];
    const overwrites=[{id:guild.roles.everyone.id,deny:[P.ViewChannel]},{id:data.discordUserId,allow:common},{id:me.id,allow:[...common,P.ManageChannels,P.ManageMessages]},...roles.map(role=>({id:role.id,allow:common}))];
    const username=member.user.username.toLowerCase().replace(/[^a-z0-9-]/g,'').slice(0,50)||'kunde';
    return guild.channels.create({name:`anfrage-${username}`,type:ChannelType.GuildText,parent:team.parentId||undefined,topic:`website-owner:${data.discordUserId}|created:${Date.now()}|request:${data.requestId}`,permissionOverwrites:overwrites,reason:'Persönliche Anfrage von turbodesigns.net'});
  }
  async function deliverWebsiteRequest(raw) {
    const data=validateRequest(raw);
    if(requestPending.has(data.requestId))return requestPending.get(data.requestId);
    const previous=data.discordUserId?userPending.get(data.discordUserId):null;
    const task=(async()=>{
      if(previous)await previous.catch(()=>{});
      const team=await requestChannel();
      const directory=process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.DATA_DIR || __dirname;
      const file=path.join(directory,'website-request-receipts.json');
      const receipts=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};
      if(receipts[data.requestId]){const saved=receipts[data.requestId];if(saved.ownerId&&saved.ownerId!==data.discordUserId)throw new Error('INVALID_REQUEST');return saved;}
      const channel=data.discordUserId?await personalChannel(team,data):team;
      const labels={thumbnail:'Thumbnail',nve:'NVE Preset / Grafik-Setup',soundpack:'Soundpack',grafik:'Grafik / Design',fivem:'FiveM Asset',bot:'Custom Discord Bot',bundle:'Bundle / Komplettpaket'};
      const reference='WEB-'+data.requestId.slice(0,8).toUpperCase();
      const fields=[{name:'Produkt',value:labels[data.product],inline:true},{name:data.discordUserId?'Discord-Name (verifiziert)':'Discord-Name (nicht verifiziert)',value:data.discordUserId?`${data.contact} · ${data.discordUserId}`:data.contact,inline:true},{name:'Wunschtermin',value:data.deadline||'Noch offen'},{name:'Vorhandene Materialien',value:data.assets||'Noch zu besprechen'},...(data.reference?[{name:'Thumbnail-Stilreferenz',value:data.reference}]:[]),{name:'Status',value:'Unverbindliche Anfrage. Umfang, Preis, Korrekturen und Liefertermin mit dem Kunden abstimmen.'}];
      const {ActionRowBuilder,ButtonBuilder,ButtonStyle}=require('discord.js');
      const components=data.discordUserId?[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('website_request_close').setLabel('Anfrage abschließen').setStyle(ButtonStyle.Secondary))]:[];
      const message=await channel.send({allowedMentions:{parse:[],users:[],roles:[],repliedUser:false},nonce:crypto.createHash('sha256').update(data.requestId).digest('hex').slice(0,24),enforceNonce:true,embeds:[{title:'Neue Website-Anfrage',color:0x80c2ff,description:data.project,fields,footer:{text:reference+' · turbodesigns.net'},timestamp:new Date().toISOString()}],components});
      const receipt={reference,messageId:message.id,...(data.discordUserId?{ownerId:data.discordUserId,ticketUrl:`https://discord.com/channels/${channel.guild.id}/${channel.id}`}:{})};
      // Serialize receipt writes after the awaited send to avoid losing concurrent entries.
      const latest=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};latest[data.requestId]=receipt;
      const trimmed=Object.fromEntries(Object.entries(latest).slice(-1000));const temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(trimmed),{mode:0o600});fs.renameSync(temp,file);
      return receipt;
    })().finally(()=>{requestPending.delete(data.requestId);if(data.discordUserId&&userPending.get(data.discordUserId)===task)userPending.delete(data.discordUserId);});
    requestPending.set(data.requestId,task);if(data.discordUserId)userPending.set(data.discordUserId,task);return task;
  }
  async function handleWebsiteRequest(req,res) {
    const headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
    const reply=(status,data)=>{res.writeHead(status,headers);res.end(JSON.stringify(data));};
    if(!['GET','POST'].includes(req.method))return reply(405,{ok:false});
    try{
      const raw=req.method==='POST'?await requestBody(req):'';
      if(!verifyRequestSignature(req,raw))return reply(401,{ok:false});
      if(req.method==='GET'){await requestChannel();return reply(200,{ready:true});}
      const receipt=await deliverWebsiteRequest(JSON.parse(raw));return reply(200,{ok:true,reference:receipt.reference,...(receipt.ticketUrl?{ticketUrl:receipt.ticketUrl}:{})});
    }catch(error){const invalid=['INVALID_REQUEST','BODY_TOO_LARGE'].includes(error.message)||error instanceof SyntaxError;console.warn('[website-requests]',invalid?'INVALID_REQUEST':error.code||error.message);return reply(invalid?400:['JOIN_REQUIRED','TICKET_UNAVAILABLE'].includes(error.message)?409:503,{ok:false,...(['JOIN_REQUIRED','TICKET_UNAVAILABLE'].includes(error.message)?{error:error.message}:{})});}
  }
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
      const extras = { samples, samplesAvailable, soundChannelUrl:channelLink('soundpacks-preview'), orderChannelUrl:channelLink('bestellen'),reviewsChannelUrl:channelLink('bewertungen') };
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
      this.on(Events.InteractionCreate,async interaction=>{
        if(!interaction.isButton?.()||interaction.customId!=='website_request_close'||interaction.guildId!=='1531989453168578650')return;
        const owner=interaction.channel?.topic?.match(/^website-owner:(\d{17,20})\|/)?.[1];
        if(!owner)return interaction.reply({content:'Diese Anfrage ist bereits abgeschlossen.',ephemeral:true}).catch(()=>{});
        const {PermissionFlagsBits:P}=require('discord.js');
        const roles=staffRoles(interaction.guild),isStaff=interaction.memberPermissions?.has(P.Administrator)||roles.some(role=>interaction.member?.roles?.cache?.has(role.id));
        if(interaction.user.id!==owner&&!isStaff)return interaction.reply({content:'Nur der Kunde und das Team können diese Anfrage abschließen.',ephemeral:true}).catch(()=>{});
        try{
          await interaction.deferReply({ephemeral:true});
          await interaction.channel.permissionOverwrites.edit(owner,{SendMessages:false,AttachFiles:false});
          await interaction.channel.setTopic(interaction.channel.topic.replace('website-owner:','website-closed:'));
          await interaction.channel.setName('abgeschlossen-'+interaction.channel.name.replace(/^anfrage-/,'').slice(0,70));
          await interaction.editReply('Anfrage abgeschlossen. Der Verlauf bleibt für dich und das Team lesbar.');
        }catch{if(interaction.deferred)await interaction.editReply('Die Anfrage konnte nicht abgeschlossen werden. Bitte wende dich an das Team.').catch(()=>{});}
      });
    }
    return login.apply(this,args);
  };
  const createServer = http.createServer;
  http.createServer = function(...args) {
    const index = args.findIndex(arg => typeof arg === 'function');
    if (index >= 0) {
      const listener = args[index];
      args[index] = async function(req,res) {
        const route=(req.url || '').split('?')[0];
        if(route==='/turbo-website-requests')return handleWebsiteRequest(req,res);
        if (route !== '/turbo-public-feed') return listener(req,res);
        const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
        if (req.method !== 'GET') { res.writeHead(405, {...headers,allow:'GET'}); return res.end('{}'); }
        try { const data = await refresh(); res.writeHead(200,headers); res.end(JSON.stringify(data)); }
        catch { res.writeHead(503,{...headers,'retry-after':'30'}); res.end(JSON.stringify({ connected:false, error:'DISCORD_SYNC_UNAVAILABLE' })); }
      };
    }
    return createServer.apply(this,args);
  };
}
module.exports = { imageUrl, extractImages, readCatalog, extractSamples, validateRequest, verifyRequestSignature, install };
