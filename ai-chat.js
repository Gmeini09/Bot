'use strict';
// KI-Chat: in the channels from AI_CHANNEL_IDS the bot answers every message with Claude.
// Variables (Railway): ANTHROPIC_API_KEY, AI_CHANNEL_IDS (comma-separated channel IDs),
// optional AI_MODEL, AI_SYSTEM_PROMPT, AI_HISTORY (messages of context, default 12).
// Self-contained: no extra package (uses fetch), off while key or channels are missing, never throws.

const API_URL = 'https://api.anthropic.com/v1/messages';
const MAX_DISCORD = 2000;
const COOLDOWN_MS = 3000;

const channelIds = () => new Set(String(process.env.AI_CHANNEL_IDS || '').split(/[\s,;]+/).filter(Boolean));
const enabled = () => Boolean(process.env.ANTHROPIC_API_KEY) && channelIds().size > 0;
const lastAsk = new Map(); // userId → timestamp, keeps a single user from spamming the API
const busy = new Set(); // channelIds with a request in flight

function systemPrompt(guild) {
  if (process.env.AI_SYSTEM_PROMPT) return process.env.AI_SYSTEM_PROMPT.replace(/\{server\}/g, guild.name);
  return `Du bist der KI-Assistent auf dem Discord-Server „${guild.name}“. Antworte auf Deutsch (außer jemand schreibt in einer anderen Sprache), freundlich und eher kurz. `
    + 'Nachrichten von Nutzern beginnen mit „Name: “. Du kannst Discord-Markdown verwenden. Erfinde keine Server-Regeln, Preise oder Fakten über den Server.';
}

/** Discord messages (oldest first) → API messages: alternating roles, starting with "user". */
function toApiMessages(msgs, botId) {
  const out = [];
  for (const m of msgs) {
    const text = String(m.content || '').trim() || (m.attachments?.size ? '[Anhang]' : '');
    if (!text) continue;
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

async function ask(system, messages) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: process.env.AI_MODEL || 'claude-sonnet-5-5', max_tokens: 1024, system, messages }),
    signal: AbortSignal.timeout(60_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${body?.error?.message || res.statusText}`);
  return (body.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
}

async function onMessage(message) {
  try {
    if (!message.guild || message.author?.bot || message.webhookId || !enabled()) return;
    if (!channelIds().has(message.channelId)) return;
    if (!String(message.content || '').trim()) return;
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

/** Hooks onMessage into a discord.js client (once). */
function attach(client) {
  if (client.__aiChat) return;
  client.__aiChat = true;
  client.on('messageCreate', onMessage);
  const ids = [...channelIds()];
  if (enabled()) console.log(`🤖 KI-Chat aktiv in ${ids.length} Kanal/Kanälen: ${ids.join(', ')}`);
  else console.log(`🤖 KI-Chat aus – ${process.env.ANTHROPIC_API_KEY ? 'AI_CHANNEL_IDS' : 'ANTHROPIC_API_KEY'} fehlt`);
}

/** For bots that create their client elsewhere: attaches to every client that logs in. */
function install() {
  const { Client } = require('discord.js');
  if (Client.prototype.__aiChatLogin) return;
  Client.prototype.__aiChatLogin = true;
  const realLogin = Client.prototype.login;
  Client.prototype.login = function aiChatLogin(...args) {
    attach(this);
    return realLogin.apply(this, args);
  };
}

module.exports = { attach, install, onMessage, toApiMessages, splitReply };
