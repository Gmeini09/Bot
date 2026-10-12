'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const TYPES = ['thumbnail','nve','soundpack','grafik','fivem','bot','bundle'];
const REQUEST_TYPES = [...TYPES, 'soundpack-tool', 'partnership'];
const GUILD_ID = '1531989453168578650';
const NVE_PREVIEW_CHANNEL = '1550470513070178374';
const SOUND_PREVIEW_CHANNEL = '1550470565364506694';
const WEBSITE_CALLBACK = 'https://turbodesigns.net/auth/discord/callback';
const TOOL_PLANS = Object.freeze({ week: { label: 'Woche', price: 10 }, month: { label: 'Monat', price: 15 }, lifetime: { label: 'Lifetime', price: 20 } });
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
function extractNvePreviews(messages, guildId, channelId) {
  const items = [], seen = new Set();
  for (const message of messages) {
    const candidates = [...(message.attachments?.values?.() || [])].filter(a => !a.spoiler).map(a => ({ raw: a.url, name: a.name || '', type: a.contentType || '', id: a.id }));
    for (const embed of message.embeds || []) {
      if (embed.image?.url) candidates.push({ raw: embed.image.url, type: 'image/' });
      if (embed.video?.url) candidates.push({ raw: embed.video.url, type: 'video/' });
    }
    for (const candidate of candidates) {
      const kind = candidate.type.startsWith('video/') || /\.(mp4|webm|mov)$/i.test(candidate.name) ? 'video' : candidate.type.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(candidate.name) ? 'image' : null;
      const url = imageUrl(candidate.raw);
      if (!kind || !url || seen.has(new URL(url).pathname)) continue;
      seen.add(new URL(url).pathname);
      items.push({ id: candidate.id || `${message.id}-${items.length}`, kind, ...(kind === 'image' ? { image: url } : { url }), title: 'NVE Preview', messageUrl: `https://discord.com/channels/${guildId}/${channelId}/${message.id}` });
      if (items.length === 24) return items;
    }
  }
  return items;
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
  if(!REQUEST_TYPES.includes(product)||! /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)||contact.length<2)throw new Error('INVALID_REQUEST');
  const reference=text('reference',200),discordUserId=text('discordUserId',20);
  if(reference&&!/^https:\/\/discord\.com\/channels\/1531989453168578650\/(1550470150086729748|1550470513070178374|1550470565364506694)\/\d{17,20}$/.test(reference))throw new Error('INVALID_REQUEST');
  // This identity is supplied only by the signed website server after OAuth.
  if(!/^\d{17,20}$/.test(discordUserId))throw new Error('AUTH_REQUIRED');
  const plan=text('plan',16);
  if(product==='soundpack-tool' ? !Object.hasOwn(TOOL_PLANS,plan) : Boolean(plan))throw new Error('INVALID_REQUEST');
  return {requestId:id,product,contact,project:text('project',1500,true),deadline:text('deadline',100),assets:text('assets',300),reference,discordUserId,...(plan?{plan}: {})};
}
function verifyRequestSignature(req,raw,route='/turbo-website-requests',env=process.env,now=Date.now()) {
  const secret=env.WEBSITE_REQUEST_SECRET,stamp=String(req.headers['x-turbo-timestamp']||''),signature=String(req.headers['x-turbo-signature']||'');
  if(!secret||secret.length<32||!/^\d{13}$/.test(stamp)||Math.abs(now-Number(stamp))>60000||! /^[a-f0-9]{64}$/.test(signature))return false;
  const expected=crypto.createHmac('sha256',secret).update(`${stamp}:${req.method}:${route}:${raw}`).digest();
  return crypto.timingSafeEqual(expected,Buffer.from(signature,'hex'));
}
async function requestBody(req) {
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>8192)throw new Error('BODY_TOO_LARGE');chunks.push(chunk);}
  return Buffer.concat(chunks).toString('utf8');
}

const normalizeName = name => String(name).replace(/^[^a-z0-9]+/i,'').toLowerCase();
function staffRoles(guild, partnership=false) {
  const names=partnership?['inhaber','management']:['inhaber','management','support','designer','sound designer','developer'];
  return [...guild.roles.cache.values()].filter(role=>names.includes(normalizeName(role.name)));
}
function assertPrivateChannel(channel,guild,permittedRoles,member,me) {
  const {PermissionFlagsBits:P}=require('discord.js');
  if(channel.permissionsFor(guild.roles.everyone)?.has(P.ViewChannel))throw new Error('TICKET_UNAVAILABLE');
  if(member&&!channel.permissionsFor(member)?.has([P.ViewChannel,P.SendMessages]))throw new Error('TICKET_UNAVAILABLE');
  if(me&&!channel.permissionsFor(me)?.has([P.ViewChannel,P.SendMessages,P.EmbedLinks]))throw new Error('BOT_PERMISSION_MISSING');
  const permitted=new Set(permittedRoles.map(role=>role.id));
  for(const role of guild.roles.cache.values())if(!role.permissions.has(P.Administrator)&&!permitted.has(role.id)&&channel.permissionsFor(role)?.has(P.ViewChannel))throw new Error('TICKET_UNAVAILABLE');
  const allowedMembers=new Set([member?.id,me?.id]);
  for(const overwrite of channel.permissionOverwrites?.cache?.values?.()||[])if(overwrite.type===1&&!allowedMembers.has(overwrite.id)&&overwrite.allow.has(P.ViewChannel))throw new Error('TICKET_UNAVAILABLE');
}
function createRequestService(getClient,options={}) {
  const env=options.env||process.env,fetchImpl=options.fetchImpl||fetch;
  const directory=options.directory||env.RAILWAY_VOLUME_MOUNT_PATH||env.DATA_DIR||__dirname;
  const requestPending=new Map(),requestFingerprints=new Map(),userPending=new Map();
  async function requestChannel() {
    const client=getClient();
    if(!client?.isReady())throw new Error('BOT_NOT_READY');
    const guild=await client.guilds.fetch(GUILD_ID);
    const channels=await guild.channels.fetch();await guild.roles.fetch();
    const channel=channels.find(c=>c&&normalizeName(c.name)==='bestellungen'&&c.isTextBased()&&typeof c.send==='function');
    if(!channel)throw new Error('PRIVATE_CHANNEL_UNAVAILABLE');
    const me=guild.members.me || await guild.members.fetchMe();
    assertPrivateChannel(channel,guild,staffRoles(guild),null,me);
    const {ChannelType}=require('discord.js');
    if(!channels.some(c=>c?.type===ChannelType.GuildCategory&&/\btickets\b/i.test(c.name)))throw new Error('TICKET_UNAVAILABLE');
    return channel;
  }
  async function personalChannel(team,data,fingerprint){
    const {PermissionFlagsBits:P,ChannelType}=require('discord.js'),guild=team.guild;
    const member=await guild.members.fetch(data.discordUserId).catch(()=>null);if(!member||member.user?.bot)throw new Error('JOIN_REQUIRED');
    const me=guild.members.me||await guild.members.fetchMe();if(!me.permissions.has(P.ManageChannels))throw new Error('TICKET_UNAVAILABLE');
    const roles=staffRoles(guild,data.product==='partnership');if(!roles.length)throw new Error('TICKET_UNAVAILABLE');
    const channels=await guild.channels.fetch();
    let channel=channels.find(c=>c?.topic?.startsWith(`website-owner:${data.discordUserId}|`)&&c.topic.includes(`|request:${data.requestId}|`)&&c.isTextBased()&&typeof c.send==='function');
    if(channel){
      if(!channel.topic.includes(`|fingerprint:${fingerprint}|`))throw new Error('INVALID_REQUEST');
      assertPrivateChannel(channel,guild,roles,member,me);
      return channel;
    }
    const common=[P.ViewChannel,P.SendMessages,P.ReadMessageHistory,P.AttachFiles,P.EmbedLinks];
    const overwrites=[{id:guild.roles.everyone.id,deny:[P.ViewChannel]},{id:data.discordUserId,allow:common},{id:me.id,allow:[...common,P.ManageChannels,P.ManageMessages]},...roles.map(role=>({id:role.id,allow:common}))];
    const username=member.user.username.toLowerCase().replace(/[^a-z0-9-]/g,'').slice(0,50)||'kunde';
    const category=channels.find(c=>c?.type===ChannelType.GuildCategory&&/\btickets\b/i.test(c.name));
    if(!category)throw new Error('TICKET_UNAVAILABLE');
    const prefix=data.product==='partnership'?'partnerschaft':'bestellung';
    const created=await guild.channels.create({name:`${prefix}-${username}-${data.requestId.slice(0,8)}`,type:ChannelType.GuildText,parent:category.id,topic:`website-owner:${data.discordUserId}|request:${data.requestId}|fingerprint:${fingerprint}|kind:${data.product==='partnership'?'partnership':'order'}|created:${Date.now()}`,permissionOverwrites:overwrites,reason:data.product==='partnership'?'Partnerschaftsanfrage von turbodesigns.net':'Bestellticket von turbodesigns.net'});
    assertPrivateChannel(created,guild,roles,member,me);
    return created;
  }
  async function deliverWebsiteRequest(raw) {
    const data=validateRequest(raw);
    const fingerprint=crypto.createHash('sha256').update(JSON.stringify({...data,contact:undefined})).digest('hex');
    if(requestPending.has(data.requestId)){
      if(requestFingerprints.get(data.requestId)!==fingerprint)throw new Error('INVALID_REQUEST');
      return requestPending.get(data.requestId);
    }
    const previous=data.discordUserId?userPending.get(data.discordUserId):null;
    const task=(async()=>{
      if(previous)await previous.catch(()=>{});
      const team=await requestChannel();
      const file=path.join(directory,'website-request-receipts.json');
      const receipts=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};
      if(receipts[data.requestId]){const saved=receipts[data.requestId];if(saved.ownerId!==data.discordUserId||(saved.fingerprint&&saved.fingerprint!==fingerprint))throw new Error('INVALID_REQUEST');return saved;}
      const channel=await personalChannel(team,data,fingerprint);
      const labels={thumbnail:'Thumbnail',nve:'NVE Preset / Grafik-Setup',soundpack:'Soundpack',grafik:'Grafik / Design',fivem:'FiveM Asset',bot:'Custom Discord Bot',bundle:'Bundle / Komplettpaket','soundpack-tool':'Soundpack Tool',partnership:'Partnerschaft'};
      const reference='WEB-'+data.requestId.slice(0,8).toUpperCase();
      const member=await team.guild.members.fetch(data.discordUserId);
      const plan=data.plan?TOOL_PLANS[data.plan]:null;
      const fields=[{name:data.product==='partnership'?'Anfrage':'Produkt',value:labels[data.product],inline:true},{name:'Kunde',value:`${member.user.username} · ${data.discordUserId}`,inline:true},...(plan?[{name:'Laufzeit',value:plan.label,inline:true},{name:'Preis',value:`${plan.price.toFixed(2).replace('.',',')} €`,inline:true}]:[]),{name:'Wunschtermin',value:data.deadline||'Noch offen'},{name:'Vorhandene Materialien',value:data.assets||'Noch zu besprechen'},...(data.reference?[{name:'Stilreferenz',value:data.reference}]:[]),{name:'Status',value:data.product==='partnership'?'Partnerschaftsanfrage. Vorschlag und gemeinsame Möglichkeiten mit dem Interessenten abstimmen.':'Neue Bestellung. Lieferumfang, Zahlung und Termin mit dem Kunden abstimmen.'}];
      const {ActionRowBuilder,ButtonBuilder,ButtonStyle}=require('discord.js');
      const components=[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('website_request_close').setLabel('Ticket abschließen').setStyle(ButtonStyle.Secondary))];
      // A persisted channel and message also protect a retry after a process restart.
      const messages=await channel.messages.fetch({limit:100,cache:false});
      const footer=reference+' · turbodesigns.net · '+data.requestId+' · '+fingerprint;
      const existing=messages.find(message=>message.author?.id===getClient()?.user?.id&&message.embeds?.some(embed=>embed.footer?.text===footer));
      const message=existing||await channel.send({allowedMentions:{parse:[],users:[],roles:[],repliedUser:false},nonce:crypto.createHash('sha256').update(data.requestId).digest('hex').slice(0,24),enforceNonce:true,embeds:[{title:data.product==='partnership'?'Neue Partnerschaftsanfrage':'Neue Website-Bestellung',color:0x80c2ff,description:data.project,fields,footer:{text:footer},timestamp:new Date().toISOString()}],components});
      const receipt={reference,messageId:message.id,ownerId:data.discordUserId,fingerprint,ticketUrl:`https://discord.com/channels/${channel.guild.id}/${channel.id}`};
      // Serialize receipt writes after the awaited send to avoid losing concurrent entries.
      const latest=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};latest[data.requestId]=receipt;
      const trimmed=Object.fromEntries(Object.entries(latest).slice(-1000));const temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(trimmed),{mode:0o600});fs.renameSync(temp,file);
      return receipt;
    })().finally(()=>{requestPending.delete(data.requestId);requestFingerprints.delete(data.requestId);if(userPending.get(data.discordUserId)===task)userPending.delete(data.discordUserId);});
    requestPending.set(data.requestId,task);requestFingerprints.set(data.requestId,fingerprint);userPending.set(data.discordUserId,task);return task;
  }
  async function handleWebsiteRequest(req,res) {
    const headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
    const reply=(status,data)=>{res.writeHead(status,headers);res.end(JSON.stringify(data));};
    if(!['GET','POST'].includes(req.method))return reply(405,{ok:false});
    try{
      const raw=req.method==='POST'?await requestBody(req):'';
      if(!verifyRequestSignature(req,raw,'/turbo-website-requests',env))return reply(401,{ok:false});
      if(req.method==='GET'){await requestChannel();return reply(200,{ready:true});}
      const receipt=await deliverWebsiteRequest(JSON.parse(raw));return reply(200,{ok:true,reference:receipt.reference,...(receipt.ticketUrl?{ticketUrl:receipt.ticketUrl}:{})});
    }catch(error){const invalid=['INVALID_REQUEST','BODY_TOO_LARGE'].includes(error.message)||error instanceof SyntaxError;console.warn('[website-requests]',invalid?'INVALID_REQUEST':error.code||error.message);return reply(invalid?400:error.message==='AUTH_REQUIRED'?401:['JOIN_REQUIRED','TICKET_UNAVAILABLE'].includes(error.message)?409:503,{ok:false,...(['JOIN_REQUIRED','TICKET_UNAVAILABLE','AUTH_REQUIRED'].includes(error.message)?{error:error.message}:{})});}
  }
  function oauthConfig() {
    const clientId=env.DISCORD_CLIENT_ID||env.CLIENT_ID||getClient()?.application?.id||'';
    const clientSecret=env.DISCORD_CLIENT_SECRET||'';
    return {ready:/^\d{17,20}$/.test(clientId)&&Boolean(clientSecret),clientId,clientSecret,redirectUri:WEBSITE_CALLBACK};
  }
  async function handleWebsiteOAuth(req,res) {
    const reply=(status,data)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(data));};
    if(!['GET','POST'].includes(req.method))return reply(405,{ok:false});
    try {
      const raw=req.method==='POST'?await requestBody(req):'';
      if(!verifyRequestSignature(req,raw,'/turbo-website-oauth',env))return reply(401,{ok:false});
      const cfg=oauthConfig();
      if(req.method==='GET')return reply(200,{ready:cfg.ready,clientId:cfg.clientId,redirectUri:cfg.redirectUri});
      if(!cfg.ready)throw new Error('OAUTH_UNAVAILABLE');
      const data=JSON.parse(raw);
      if(typeof data?.code!=='string'||! /^[A-Za-z0-9_-]{10,256}$/.test(data.code)||data.redirectUri!==cfg.redirectUri)throw new Error('INVALID_REQUEST');
      const tokenResponse=await fetchImpl('https://discord.com/api/v10/oauth2/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:cfg.clientId,client_secret:cfg.clientSecret,grant_type:'authorization_code',code:data.code,redirect_uri:cfg.redirectUri}),redirect:'error',signal:AbortSignal.timeout(12000)});
      if(!tokenResponse.ok)throw new Error('OAUTH_FAILED');
      const token=await tokenResponse.json();
      if(typeof token.access_token!=='string'||token.token_type?.toLowerCase()!=='bearer'||!String(token.scope||'').split(' ').includes('identify'))throw new Error('OAUTH_FAILED');
      const userResponse=await fetchImpl('https://discord.com/api/v10/users/@me',{headers:{Authorization:`Bearer ${token.access_token}`},redirect:'error',signal:AbortSignal.timeout(12000)});
      if(!userResponse.ok)throw new Error('OAUTH_FAILED');
      const user=await userResponse.json();
      if(!/^\d{17,20}$/.test(user?.id)||typeof user.username!=='string'||user.username.length>64||user.bot)throw new Error('OAUTH_FAILED');
      return reply(200,{ok:true,user:{id:user.id,username:user.username,globalName:typeof user.global_name==='string'?user.global_name.slice(0,64):null,avatar:typeof user.avatar==='string'&&/^[a-zA-Z0-9_]+$/.test(user.avatar)?user.avatar:null}});
    } catch(error) {
      const invalid=['INVALID_REQUEST','BODY_TOO_LARGE'].includes(error.message)||error instanceof SyntaxError;
      console.warn('[website-oauth]',invalid?'INVALID_REQUEST':error.name==='TimeoutError'?'TIMEOUT':error.message);
      return reply(invalid?400:error.message==='OAUTH_FAILED'?401:503,{ok:false,error:invalid?'INVALID_REQUEST':error.message==='OAUTH_FAILED'?'AUTH_FAILED':'OAUTH_UNAVAILABLE'});
    }
  }
  return {handleWebsiteRequest,handleWebsiteOAuth};
}

function install() {
  const { Client, Events } = require('discord.js');
  const http = require('node:http');
  let client, cache, pending, retryAt = 0;
  const requests=createRequestService(()=>client);
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
      const soundChannel = channels.get(SOUND_PREVIEW_CHANNEL)||findChannel('soundpacks-preview');
      let samples = [], samplesAvailable = Boolean(soundChannel);
      if (soundChannel) {
        try { const sounds = await soundChannel.messages.fetch({limit:100,cache:false}); samples = extractSamples([...sounds.values()].sort((a,b)=>b.createdTimestamp-a.createdTimestamp),guild.id,soundChannel.id); }
        catch { samplesAvailable = false; }
      }
      const nveChannel=channels.get(NVE_PREVIEW_CHANNEL);
      let nvePreviews=[],nveAvailable=Boolean(nveChannel?.isTextBased());
      if(nveAvailable){
        try {const nveMessages=await nveChannel.messages.fetch({limit:100,cache:false});nvePreviews=extractNvePreviews([...nveMessages.values()].sort((a,b)=>b.createdTimestamp-a.createdTimestamp),guild.id,nveChannel.id);}
        catch{nveAvailable=false;}
      }
      const extras = { samples, samplesAvailable, soundChannelUrl:`https://discord.com/channels/${guild.id}/${SOUND_PREVIEW_CHANNEL}`, nvePreviews,nveAvailable,nveChannelUrl:`https://discord.com/channels/${guild.id}/${NVE_PREVIEW_CHANNEL}`, orderChannelUrl:channelLink('bestellen'),reviewsChannelUrl:channelLink('bewertungen') };
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
          await interaction.channel.setName('abgeschlossen-'+interaction.channel.name.replace(/^(anfrage|bestellung|partnerschaft)-/,'').slice(0,70));
          await interaction.editReply('Ticket abgeschlossen. Der Verlauf bleibt für dich und das Team lesbar.');
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
        if(route==='/turbo-website-requests')return requests.handleWebsiteRequest(req,res);
        if(route==='/turbo-website-oauth')return requests.handleWebsiteOAuth(req,res);
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
module.exports = { imageUrl, extractImages, readCatalog, extractSamples, extractNvePreviews, validateRequest, verifyRequestSignature, createRequestService, assertPrivateChannel, install };
