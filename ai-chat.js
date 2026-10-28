'use strict';
// KI-Chat: in the channels from AI_CHANNEL_IDS the bot answers every message with Claude.
// Variables (Railway): ANTHROPIC_API_KEY, AI_CHANNEL_IDS (comma-separated channel IDs),
// optional AI_MODEL, AI_SYSTEM_PROMPT, AI_HISTORY (messages of context, default 12),
// AI_OWNER_IDS (user IDs allowed to use /ki besides the server owner and MASTER_USER_IDS).
// /ki an|aus|status – owners only. Spammers get a timeout and the KI pauses for 5 minutes with an announcement.
// Self-contained: no extra package (uses fetch), off while key or channels are missing, never throws.
const fs = require('fs');
const path = require('path');

const API_URL = 'https://api.anthropic.com/v1/messages';
const MAX_DISCORD = 2000;
const MAX_INPUT = 1500; // characters per message sent to the API – long pastes must not burn tokens
const COOLDOWN_MS = 3000;
const PAUSE_MS = 5 * 60_000;
const SPAM_TIMEOUT_MS = 10 * 60_000;
const SPAM = { window: 60_000, maxMessages: 6, repeatWindow: 120_000, maxRepeats: 3, longChars: 1200, maxLong: 3 };
const EPHEMERAL = 64;

const ids = (v) => String(v || '').split(/[\s,;]+/).filter(Boolean);
const channelIds = () => new Set(ids(process.env.AI_CHANNEL_IDS));
const configured = () => Boolean(process.env.ANTHROPIC_API_KEY) && channelIds().size > 0;
const lastAsk = new Map(); // userId → timestamp, keeps a single user from spamming the API
const busy = new Set(); // channelIds with a request in flight
const recent = new Map(); // `${guildId}:${userId}` → [{ at, text }] for spam detection
const paused = new Map(); // guildId → { until, reason, timer }

// ── on/off per server, kept on the volume so it survives restarts
const stateFile = () => path.join(process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(process.cwd(), 'data'), 'ai-chat.json');
let state = null;
function loadState() {
  if (state) return state;
  try { state = JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch { state = {}; }
  state.disabled = state.disabled || {};
  return state;
}
function saveState() {
  try {
    fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
    fs.writeFileSync(`${stateFile()}.tmp`, JSON.stringify(state, null, 2));
    fs.renameSync(`${stateFile()}.tmp`, stateFile());
  } catch (e) { console.error('❌ KI-Chat: Status nicht gespeichert:', e.message); }
}
const isOn = (guildId) => !loadState().disabled[guildId];
function setOn(guildId, on) {
  loadState();
  if (on) delete state.disabled[guildId]; else state.disabled[guildId] = true;
  saveState();
}
const pauseLeft = (guildId) => Math.max(0, (paused.get(guildId)?.until || 0) - Date.now());

const isOwner = (member, guild) => member?.id === guild.ownerId
  || new Set([...ids(process.env.AI_OWNER_IDS), ...ids(process.env.MASTER_USER_IDS)]).has(member?.id);

function systemPrompt(guild) {
  if (process.env.AI_SYSTEM_PROMPT) return process.env.AI_SYSTEM_PROMPT.replace(/\{server\}/g, guild.name);
  return `Du bist der KI-Assistent auf dem Discord-Server „${guild.name}“. Antworte auf Deutsch (außer jemand schreibt in einer anderen Sprache), freundlich und eher kurz. `
    + 'Nachrichten von Nutzern beginnen mit „Name: “. Du kannst Discord-Markdown verwenden. Erfinde keine Server-Regeln, Preise oder Fakten über den Server.';
}

/** Discord messages (oldest first) → API messages: alternating roles, starting with "user". */
function toApiMessages(msgs, botId) {
  const out = [];
  for (const m of msgs) {
    let text = String(m.content || '').trim() || (m.attachments?.size ? '[Anhang]' : '');
    if (!text) continue;
    if (text.length > MAX_INPUT) text = `${text.slice(0, MAX_INPUT)} […gekürzt]`;
    const role = m.author.id === botId ? 'assistant' : 'user';
    if (role === 'assistant' && !out.length) continue; // the API wants "user" first
    const line = role === 'user' ? `${m.member?.displayName || m.author.globalName || m.author.username}: ${text}` : text;
    const prev = out[out.length - 1];
    if (prev?.role === role) prev.content += `\n${line}`;
    else out.push({ role, content: line });
  }
  return out;
}

/** Splits a reply into Discord-sized parts, preferring line breaks. */
function splitReply(text, max = MAX_DISCORD) {
  const parts = [];
  let rest = String(text).trim();
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max);
    if (cut < max / 2) cut = rest.lastIndexOf(' ', max);
    if (cut < max / 2) cut = max;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  if (rest) parts.push(rest);
  return parts;
}

/** Records a message and returns why it is spam, or null. */
function spamReason(key, text, now = Date.now()) {
  const list = (recent.get(key) || []).filter((e) => now - e.at < SPAM.repeatWindow);
  list.push({ at: now, text: text.trim().toLowerCase() });
  recent.set(key, list);
  const inWindow = list.filter((e) => now - e.at < SPAM.window);
  if (inWindow.length > SPAM.maxMessages) return `${inWindow.length} Nachrichten in einer Minute`;
  const same = list.filter((e) => e.text === list[list.length - 1].text).length;
  if (same >= SPAM.maxRepeats) return `${same}× dieselbe Nachricht`;
  const long = list.filter((e) => e.text.length >= SPAM.longChars).length;
  if (long >= SPAM.maxLong) return `${long} sehr lange Nachrichten in 2 Minuten`;
  return null;
}

/** Spammer: timeout, KI paused for 5 minutes, announcement in the channel. */
async function punish(message, reason) {
  const guildId = message.guild.id;
  recent.delete(`${guildId}:${message.author.id}`);
  const timedOut = await message.member?.timeout?.(SPAM_TIMEOUT_MS, `KI-Spam: ${reason}`).then(() => true).catch(() => false);
  clearTimeout(paused.get(guildId)?.timer);
  const timer = setTimeout(() => {
    paused.delete(guildId);
    if (isOn(guildId)) message.channel.send({ content: '✅ **Die KI ist wieder aktiv.** Bitte nicht spammen.', allowedMentions: { parse: [] } }).catch(() => {});
  }, PAUSE_MS);
  timer.unref?.();
  paused.set(guildId, { until: Date.now() + PAUSE_MS, reason, timer });
  console.log(`🚫 KI-Chat pausiert auf ${message.guild.name}: ${message.author.tag} – ${reason}`);
  await message.channel.send({
    content: `🚫 **Die KI ist für 5 Minuten deaktiviert.**\n**Grund:** <@${message.author.id}> hat die KI gespammt (${reason}).\n`
      + (timedOut ? '⏱️ Timeout für 10 Minuten.' : '⚠️ Timeout nicht möglich – dem Bot fehlt das Recht „Mitglieder im Timeout“ oder die Rolle steht zu tief.'),
    allowedMentions: { parse: [] },
  }).catch(() => {});
}

async function ask(system, messages) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY.trim(), 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: process.env.AI_MODEL || 'claude-sonnet-5-5', max_tokens: 1024, system, messages }),
    signal: AbortSignal.timeout(60_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${body?.error?.message || res.statusText}`);
  return (body.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
}

async function onMessage(message) {
  try {
    if (!message.guild || message.author?.bot || message.webhookId || !configured()) return;
    if (!channelIds().has(message.channelId)) return;
    const content = String(message.content || '').trim();
    if (!content || !isOn(message.guild.id) || pauseLeft(message.guild.id)) return;
    if (!isOwner(message.member || message.author, message.guild)) {
      const reason = spamReason(`${message.guild.id}:${message.author.id}`, content);
      if (reason) return await punish(message, reason);
    }
    const now = Date.now();
    if (now - (lastAsk.get(message.author.id) || 0) < COOLDOWN_MS || busy.has(message.channelId)) {
      await message.react('⏳').catch(() => {});
      return;
    }
    lastAsk.set(message.author.id, now);
    busy.add(message.channelId);
    try {
      await message.channel.sendTyping().catch(() => {});
      const typing = setInterval(() => message.channel.sendTyping().catch(() => {}), 8000);
      try {
        const limit = Math.min(Math.max(Number(process.env.AI_HISTORY) || 12, 1), 50);
        const fetched = await message.channel.messages.fetch({ limit, before: message.id }).catch(() => null);
        const history = [...(fetched?.values() || [])].reverse().filter((m) => !m.author.bot || m.author.id === message.client.user.id);
        const answer = await ask(systemPrompt(message.guild), toApiMessages([...history, message], message.client.user.id));
        const parts = splitReply(answer || '🤔 Dazu fällt mir gerade nichts ein.');
        for (const [n, part] of parts.entries()) {
          const payload = { content: part, allowedMentions: { parse: [], repliedUser: n === 0 } };
          await (n === 0 ? message.reply(payload) : message.channel.send(payload));
        }
      } finally { clearInterval(typing); }
    } finally { busy.delete(message.channelId); }
  } catch (e) {
    console.error('❌ KI-Chat:', e.message);
    await message.reply({ content: '⚠️ Die KI konnte gerade nicht antworten. Versuch es gleich nochmal.', allowedMentions: { parse: [] } }).catch(() => {});
  }
}

// ── /ki an | aus | status
const COMMAND = {
  name: 'ki', description: 'KI-Chat steuern (nur Owner)', type: 1, contexts: [0], default_member_permissions: '8',
  options: [
    { type: 1, name: 'an', description: 'KI-Chat einschalten' },
    { type: 1, name: 'aus', description: 'KI-Chat ausschalten' },
    { type: 1, name: 'status', description: 'Zeigt, ob die KI an ist' },
  ],
};
const isOurs = (i) => Boolean(i?.isChatInputCommand?.() && i.commandName === COMMAND.name);

function guildChannels(guild) {
  return [...channelIds()].map((id) => guild.channels.cache.get(id)).filter(Boolean);
}

async function onCommand(i) {
  if (!i.inGuild?.() || !i.guild) return i.reply({ content: '❌ Nur auf einem Server.', flags: EPHEMERAL });
  if (!isOwner(i.member || i.user, i.guild)) return i.reply({ content: '⛔ Nur der Owner darf die KI steuern.', flags: EPHEMERAL });
  const sub = i.options.getSubcommand();
  const g = i.guild;
  if (sub === 'status') {
    const left = pauseLeft(g.id);
    const lines = [
      `**Status:** ${!configured() ? '⚠️ nicht eingerichtet (ANTHROPIC_API_KEY / AI_CHANNEL_IDS fehlt)' : !isOn(g.id) ? '🔴 aus' : left ? `⏸️ pausiert – noch ${Math.ceil(left / 60_000)} Min. (${paused.get(g.id).reason})` : '🟢 an'}`,
      `**Kanäle:** ${guildChannels(g).map((c) => `<#${c.id}>`).join(', ') || '–'}`,
      `**Modell:** ${process.env.AI_MODEL || 'claude-sonnet-5-5'}`,
    ];
    return i.reply({ content: lines.join('\n'), flags: EPHEMERAL });
  }
  const on = sub === 'an';
  setOn(g.id, on);
  if (on) { clearTimeout(paused.get(g.id)?.timer); paused.delete(g.id); }
  await i.reply({ content: on ? '🟢 KI-Chat ist **an**.' : '🔴 KI-Chat ist **aus**.', flags: EPHEMERAL });
  for (const ch of guildChannels(g)) {
    await ch.send({ content: on ? '🟢 **Die KI ist wieder aktiv.**' : '🔴 **Die KI wurde vom Owner deaktiviert.**', allowedMentions: { parse: [] } }).catch(() => {});
  }
}

async function onInteraction(i) {
  if (!isOurs(i)) return;
  try { await onCommand(i); } catch (e) {
    console.error('❌ /ki:', e);
    const p = { content: `❌ Fehler: ${String(e?.message || e).slice(0, 300)}`, flags: EPHEMERAL };
    await (i.deferred || i.replied ? i.followUp(p) : i.reply(p)).catch(() => {});
  }
}

/** /ki as a global command: guild command lists get overwritten by the bots themselves. */
async function register(client) {
  if (client.__aiChatRegistered) return;
  client.__aiChatRegistered = true;
  try {
    await client.application.commands.create(COMMAND);
    console.log('✅ /ki bereit');
  } catch (e) { client.__aiChatRegistered = false; console.error('❌ /ki nicht registriert:', e?.message || e); }
}

/** Hooks the KI-Chat into a discord.js client (once). */
function attach(client) {
  if (client.__aiChat) return;
  client.__aiChat = true;
  client.on('messageCreate', onMessage);
  require('events').EventEmitter.prototype.prependListener.call(client, 'interactionCreate', onInteraction);
  for (const ev of new Set(['clientReady', 'ready'])) client.once(ev, () => { void register(client); });
  if (client.isReady?.()) void register(client);
  const list = [...channelIds()];
  if (configured()) console.log(`🤖 KI-Chat eingerichtet für ${list.length} Kanal/Kanäle: ${list.join(', ')}`);
  else console.log(`🤖 KI-Chat aus – ${process.env.ANTHROPIC_API_KEY ? 'AI_CHANNEL_IDS' : 'ANTHROPIC_API_KEY'} fehlt`);
}

/** For bots that create their client elsewhere: attaches to every client that logs in,
 *  and keeps the bot's other command routers away from /ki. */
function install() {
  const { Client } = require('discord.js');
  if (Client.prototype.__aiChatLogin) return;
  Client.prototype.__aiChatLogin = true;
  for (const m of ['on', 'addListener', 'prependListener']) {
    const real = Client.prototype[m];
    Client.prototype[m] = function aiChatFiltered(ev, listener) {
      if (ev !== 'interactionCreate' || typeof listener !== 'function' || listener === onInteraction) return real.call(this, ev, listener);
      return real.call(this, ev, function aiChatSkip(i, ...a) { return isOurs(i) ? undefined : listener.call(this, i, ...a); });
    };
  }
  const realLogin = Client.prototype.login;
  Client.prototype.login = function aiChatLogin(...args) {
    attach(this);
    return realLogin.apply(this, args);
  };
}

module.exports = { attach, install, onMessage, onInteraction, toApiMessages, splitReply, spamReason, COMMAND, _reset: () => { state = null; recent.clear(); lastAsk.clear(); for (const p of paused.values()) clearTimeout(p.timer); paused.clear(); } };
