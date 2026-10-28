'use strict';
// KI-Chat: in the channels from AI_CHANNEL_IDS the bot answers every message with Claude.
// Variables (Railway): ANTHROPIC_API_KEY, AI_CHANNEL_IDS (comma-separated channel IDs),
// optional AI_MODEL, AI_SYSTEM_PROMPT, AI_HISTORY (messages of context, default 12),
// AI_OWNER_IDS (user IDs allowed to use /ki besides the server owner and MASTER_USER_IDS).
// /ki an|aus|status|name|limit|stats – owners only (name: what the KI calls someone; limit: answers per person and day,
// default AI_DAILY_LIMIT or 30; stats: messages and tokens today/this month; wissen: facts the owner teaches the KI).
// Spammers get a timeout and the KI pauses for 5 minutes with an announcement.
// When the team is needed, the KI ends its answer with [TICKET: summary] → a "Ticket öffnen" button (see opts.ticket).
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
const KEEP_DAYS = 62; // usage history kept in ai-chat.json
const TZ = 'Europe/Vienna';

const ids = (v) => String(v || '').split(/[\s,;]+/).filter(Boolean);
const channelIds = () => new Set(ids(process.env.AI_CHANNEL_IDS));
const configured = () => Boolean(process.env.ANTHROPIC_API_KEY) && channelIds().size > 0;
const lastAsk = new Map(); // userId → timestamp, keeps a single user from spamming the API
const busy = new Set(); // channelIds with a request in flight
const recent = new Map(); // `${guildId}:${userId}` → [{ at, text }] for spam detection
const paused = new Map(); // guildId → { until, reason, timer }
const limitNoticed = new Set(); // `${day}:${guildId}:${userId}` – told once per day that the limit is reached
const ticketSummaries = new Map(); // userId → { text, at } – the KI's summary for the ticket that user may open
const MAX_FACTS = 50;
const TICKET_TTL_MS = 60 * 60_000;

// ── on/off per server, kept on the volume so it survives restarts
const stateFile = () => path.join(process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(process.cwd(), 'data'), 'ai-chat.json');
let state = null;
function loadState() {
  if (state) return state;
  try { state = JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch { state = {}; }
  state.disabled = state.disabled || {};
  state.names = state.names || {};
  state.facts = state.facts || {};
  state.limits = state.limits || {};
  state.usage = state.usage || {};
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
const namesOf = (guildId) => loadState().names[guildId] || {};
function setName(guildId, userId, name) {
  loadState();
  const names = state.names[guildId] = state.names[guildId] || {};
  if (name) names[userId] = name; else delete names[userId];
  if (!Object.keys(names).length) delete state.names[guildId];
  saveState();
}
// ── facts the owner teaches with /ki wissen: facts[guildId] = [{ text, by, at }]
const factsOf = (guildId) => loadState().facts[guildId] || [];
function addFact(guildId, text, by) {
  loadState();
  const list = state.facts[guildId] = state.facts[guildId] || [];
  if (list.length >= MAX_FACTS) return false;
  list.push({ text, by, at: Date.now() });
  saveState();
  return true;
}
function removeFact(guildId, n) {
  const list = factsOf(guildId);
  if (n < 1 || n > list.length) return null;
  const [gone] = list.splice(n - 1, 1);
  if (!list.length) delete state.facts[guildId];
  saveState();
  return gone;
}
// ── daily limit and usage: usage[guildId][YYYY-MM-DD] = { msgs, in, out, users: { userId: answers } }
const dayKey = (now = Date.now()) => new Intl.DateTimeFormat('sv-SE', { timeZone: TZ }).format(new Date(now));
function dailyLimit(guildId) {
  const set = loadState().limits[guildId];
  if (set !== undefined) return set;
  const env = Number(process.env.AI_DAILY_LIMIT);
  return Number.isFinite(env) && env >= 0 ? env : 30;
}
function setLimit(guildId, n) { loadState().limits[guildId] = n; saveState(); }
const usedToday = (guildId, userId, now) => loadState().usage[guildId]?.[dayKey(now)]?.users?.[userId] || 0;
function recordUsage(guildId, userId, usage, now = Date.now()) {
  loadState();
  const days = state.usage[guildId] = state.usage[guildId] || {};
  const d = days[dayKey(now)] = days[dayKey(now)] || { msgs: 0, in: 0, out: 0, users: {} };
  d.msgs += 1;
  d.in += usage?.input_tokens || 0;
  d.out += usage?.output_tokens || 0;
  d.users[userId] = (d.users[userId] || 0) + 1;
  const oldest = dayKey(now - KEEP_DAYS * 86_400_000);
  for (const k of Object.keys(days)) if (k < oldest) delete days[k];
  saveState();
}
/** Sum of all days whose key starts with prefix ("2026-10-28" = one day, "2026-10" = the month). */
function usageSum(guildId, prefix) {
  const sum = { msgs: 0, in: 0, out: 0, users: {} };
  for (const [k, d] of Object.entries(loadState().usage[guildId] || {})) {
    if (!k.startsWith(prefix)) continue;
    sum.msgs += d.msgs; sum.in += d.in; sum.out += d.out;
    for (const [u, n] of Object.entries(d.users)) sum.users[u] = (sum.users[u] || 0) + n;
  }
  return sum;
}

const pauseLeft = (guildId) => Math.max(0, (paused.get(guildId)?.until || 0) - Date.now());

const isOwner = (member, guild) => member?.id === guild.ownerId
  || new Set([...ids(process.env.AI_OWNER_IDS), ...ids(process.env.MASTER_USER_IDS)]).has(member?.id);

// Set by the bot through attach()/install(): persona = who the KI is ({server} = server name),
// knowledge(guild) = current facts (shop, prices, how to order) – read fresh for every answer,
// ticket = how the "Ticket öffnen" button opens the bot's own ticket:
//   { open(interaction, summary) } – the KI's button calls it, or
//   { customId, match(channel, userId) } – the button is the bot's own ticket button; the summary is posted
//   into the next channel match() recognises as that user's new ticket.
const opts = { persona: null, knowledge: null, ticket: null };

function systemPrompt(guild) {
  let prompt = process.env.AI_SYSTEM_PROMPT
    || `${opts.persona || 'Du bist der KI-Assistent auf dem Discord-Server „{server}“, freundlich und eher kurz.'} Antworte auf Deutsch (außer jemand schreibt in einer anderen Sprache). `
      + 'Nachrichten von Nutzern beginnen mit „Name: “ – sprich die Leute mit genau diesem Namen an. Du kannst Discord-Markdown verwenden. '
      + 'Erfinde keine Server-Regeln, Preise oder Fakten über den Server – was du nicht weißt, sagst du ehrlich und verweist auf ein Ticket.';
  prompt = prompt.replace(/\{server\}/g, guild.name);
  let knowledge = '';
  try { knowledge = String(opts.knowledge?.(guild) || '').trim(); } catch (e) { console.error('❌ KI-Chat Wissen:', e.message); }
  const facts = factsOf(guild.id).map((f) => `- ${f.text}`).join('\n');
  if (facts) prompt += `\n\nVom Owner festgelegt (immer richtig, geht allem anderen vor):\n${facts}`;
  if (knowledge) prompt += `\n\nAktuelle Infos über den Server (verlässlich – nutze für Produkte, Preise und Abläufe nur diese):\n${knowledge.slice(0, 6000)}`;
  if (opts.ticket) {
    prompt += '\n\nWenn das Team gebraucht wird – Reklamation, Problem mit Zahlung, Bestellung oder Lieferung, etwas Persönliches zu einem Konto, '
      + 'oder du kannst die Frage nicht sicher beantworten –, sag kurz, dass das Team hilft, und beende deine Antwort mit einer eigenen Zeile '
      + '„[TICKET: Zusammenfassung des Anliegens in 1–3 Sätzen, aus Sicht der Person]“. Dann erscheint ein Button zum Ticket. Sonst nie.';
  }
  return prompt;
}

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGES = 3;
const imageAttachments = (m) => [...(m.attachments?.values?.() || [])]
  .filter((a) => IMAGE_TYPES.has(String(a.contentType || '').split(';')[0]) && (a.size || 0) <= MAX_IMAGE_BYTES).slice(0, MAX_IMAGES);

/** Images of the message as API blocks (downloaded here, so the API never needs Discord's CDN). */
async function imageBlocks(message) {
  const out = [];
  for (const a of imageAttachments(message)) {
    try {
      const res = await fetch(a.url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) continue;
      const data = Buffer.from(await res.arrayBuffer());
      if (data.length > MAX_IMAGE_BYTES) continue;
      out.push({ type: 'image', source: { type: 'base64', media_type: String(a.contentType).split(';')[0], data: data.toString('base64') } });
    } catch { /* image not readable – answer without it */ }
  }
  return out;
}

/** Discord messages (oldest first) → API messages: alternating roles, starting with "user".
 *  names: userId → name set with /ki name (wins over the server nickname). */
function toApiMessages(msgs, botId, names = {}) {
  const out = [];
  for (const m of msgs) {
    let text = String(m.content || '').trim() || (m.attachments?.size ? '[Anhang]' : '');
    if (!text) continue;
    if (text.length > MAX_INPUT) text = `${text.slice(0, MAX_INPUT)} […gekürzt]`;
    const role = m.author.id === botId ? 'assistant' : 'user';
    if (role === 'assistant' && !out.length) continue; // the API wants "user" first
    const line = role === 'user' ? `${names[m.author.id] || m.member?.displayName || m.author.globalName || m.author.username}: ${text}` : text;
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

/** Splits "[TICKET: summary]" off the end of the KI's answer; summary is null when there is none. */
function ticketMarker(answer) {
  const text = String(answer || '');
  const m = text.match(/\s*\[TICKET(?::\s*([^\]]*))?\]\s*$/i);
  if (!m) return { text, summary: null };
  return { text: text.slice(0, m.index).trim(), summary: (m[1] || '').trim() };
}

/** The "Ticket öffnen" button under an answer; remembers the summary for the asker. */
function ticketButton(message, summary) {
  ticketSummaries.set(message.author.id, { text: summary.slice(0, 1000), at: Date.now() });
  const customId = opts.ticket.open ? `ai:ticket:${message.author.id}` : opts.ticket.customId;
  return { type: 1, components: [{ type: 2, style: 1, label: 'Ticket öffnen', emoji: { name: '🎫' }, custom_id: customId }] };
}

function takeSummary(userId) {
  const s = ticketSummaries.get(userId);
  ticketSummaries.delete(userId);
  return s && Date.now() - s.at < TICKET_TTL_MS ? s.text : '';
}

async function onTicketButton(i) {
  const askerId = i.customId.split(':')[2];
  if (i.user.id !== askerId) return i.reply({ content: `🎫 Dieser Button gehört zu <@${askerId}>. Für dein eigenes Anliegen öffne ein Ticket über das Ticket-Panel.`, flags: EPHEMERAL, allowedMentions: { parse: [] } });
  return opts.ticket.open(i, takeSummary(askerId));
}

/** customId mode: the bot's own button made a ticket channel – post the KI's summary there. */
async function onChannelCreate(channel) {
  if (!opts.ticket?.match || !ticketSummaries.size) return;
  for (const userId of ticketSummaries.keys()) {
    let mine = false;
    try { mine = opts.ticket.match(channel, userId); } catch { /* not a ticket */ }
    if (!mine) continue;
    const text = takeSummary(userId);
    if (text) await channel.send({ content: `📝 **Zusammenfassung aus dem KI-Chat** (<@${userId}>):\n> ${text.replace(/\n/g, '\n> ')}`, allowedMentions: { parse: [] } }).catch(() => {});
    return;
  }
}

async function ask(system, messages) { // → { text, usage }
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY.trim(), 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: process.env.AI_MODEL || 'claude-sonnet-5-5', max_tokens: 1024, system, messages }),
    signal: AbortSignal.timeout(60_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${body?.error?.message || res.statusText}`);
  return { text: (body.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim(), usage: body.usage };
}

async function onMessage(message) {
  try {
    if (!message.guild || message.author?.bot || message.webhookId || !configured()) return;
    if (!channelIds().has(message.channelId)) return;
    const content = String(message.content || '').trim();
    if ((!content && !imageAttachments(message).length) || !isOn(message.guild.id) || pauseLeft(message.guild.id)) return;
    if (!isOwner(message.member || message.author, message.guild)) {
      const reason = spamReason(`${message.guild.id}:${message.author.id}`, content || `[Bild ${message.id}]`);
      if (reason) return await punish(message, reason);
      const limit = dailyLimit(message.guild.id);
      if (limit && usedToday(message.guild.id, message.author.id) >= limit) {
        const key = `${dayKey()}:${message.guild.id}:${message.author.id}`;
        if (limitNoticed.has(key)) return;
        limitNoticed.add(key);
        return await message.reply({ content: `📵 Du hast dein Tageslimit von **${limit} KI-Antworten** erreicht. Morgen geht's weiter!`, allowedMentions: { parse: [] } });
      }
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
        const messages = toApiMessages([...history, message], message.client.user.id, namesOf(message.guild.id));
        const images = await imageBlocks(message);
        const last = messages[messages.length - 1];
        if (images.length && last?.role === 'user') last.content = [...images, { type: 'text', text: last.content }];
        const { text: answer, usage } = await ask(systemPrompt(message.guild), messages);
        recordUsage(message.guild.id, message.author.id, usage);
        const { text, summary } = ticketMarker(answer);
        const parts = splitReply(text || '🤔 Dazu fällt mir gerade nichts ein.');
        const ticketRow = summary !== null && opts.ticket ? ticketButton(message, summary || content) : null;
        for (const [n, part] of parts.entries()) {
          const payload = { content: part, allowedMentions: { parse: [], repliedUser: n === 0 } };
          if (ticketRow && n === parts.length - 1) payload.components = [ticketRow];
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
    { type: 1, name: 'status', description: 'Zeigt, ob die KI an ist, und alle festgelegten Namen' },
    { type: 1, name: 'name', description: 'Legt fest, wie die KI jemanden nennt', options: [
      { type: 6, name: 'person', description: 'Wer', required: true },
      { type: 3, name: 'name', description: 'So nennt die KI die Person (leer = wieder den Server-Namen)', max_length: 40 },
    ] },
    { type: 1, name: 'limit', description: 'KI-Antworten pro Person und Tag (0 = unbegrenzt)', options: [
      { type: 4, name: 'anzahl', description: 'z. B. 30', required: true, min_value: 0, max_value: 1000 },
    ] },
    { type: 1, name: 'stats', description: 'Nachrichten und Tokens heute und diesen Monat' },
    { type: 2, name: 'wissen', description: 'Dinge, die die KI über den Server wissen soll', options: [
      { type: 1, name: 'neu', description: 'Der KI etwas beibringen', options: [
        { type: 3, name: 'text', description: 'z. B. Events sind jeden Freitag um 20 Uhr', required: true, max_length: 500 },
      ] },
      { type: 1, name: 'liste', description: 'Alles, was du der KI beigebracht hast' },
      { type: 1, name: 'loeschen', description: 'Einen Eintrag löschen', options: [
        { type: 4, name: 'nummer', description: 'Nummer aus /ki wissen liste', required: true, min_value: 1, max_value: MAX_FACTS },
      ] },
    ] },
  ],
};
const isTicketButton = (i) => Boolean(i?.isButton?.() && String(i.customId || '').startsWith('ai:ticket:'));
const isOurs = (i) => Boolean((i?.isChatInputCommand?.() && i.commandName === COMMAND.name) || isTicketButton(i));

function guildChannels(guild) {
  return [...channelIds()].map((id) => guild.channels.cache.get(id)).filter(Boolean);
}

async function onCommand(i) {
  if (!i.inGuild?.() || !i.guild) return i.reply({ content: '❌ Nur auf einem Server.', flags: EPHEMERAL });
  if (!isOwner(i.member || i.user, i.guild)) return i.reply({ content: '⛔ Nur der Owner darf die KI steuern.', flags: EPHEMERAL });
  const sub = i.options.getSubcommand();
  const g = i.guild;
  if (i.options.getSubcommandGroup?.(false) === 'wissen') {
    if (sub === 'neu') {
      const text = String(i.options.getString('text', true)).replace(/\s+/g, ' ').trim().slice(0, 500);
      if (!addFact(g.id, text, i.user.id)) return i.reply({ content: `❌ Höchstens ${MAX_FACTS} Einträge – lösch erst einen mit \`/ki wissen loeschen\`.`, flags: EPHEMERAL });
      return i.reply({ content: `🧠 Gemerkt (#${factsOf(g.id).length}): ${text}`, flags: EPHEMERAL, allowedMentions: { parse: [] } });
    }
    if (sub === 'loeschen') {
      const gone = removeFact(g.id, i.options.getInteger('nummer', true));
      return i.reply({ content: gone ? `🗑️ Gelöscht: ${gone.text}` : '❌ Diese Nummer gibt es nicht – siehe `/ki wissen liste`.', flags: EPHEMERAL, allowedMentions: { parse: [] } });
    }
    const list = factsOf(g.id).map((f, n) => `**${n + 1}.** ${f.text}`);
    return i.reply({ content: list.length ? `🧠 **Das weiß die KI (${list.length}/${MAX_FACTS}):**\n${list.join('\n')}`.slice(0, 2000) : '🧠 Noch nichts – bring der KI etwas bei mit `/ki wissen neu`.', flags: EPHEMERAL, allowedMentions: { parse: [] } });
  }
  if (sub === 'status') {
    const left = pauseLeft(g.id);
    const lines = [
      `**Status:** ${!configured() ? '⚠️ nicht eingerichtet (ANTHROPIC_API_KEY / AI_CHANNEL_IDS fehlt)' : !isOn(g.id) ? '🔴 aus' : left ? `⏸️ pausiert – noch ${Math.ceil(left / 60_000)} Min. (${paused.get(g.id).reason})` : '🟢 an'}`,
      `**Kanäle:** ${guildChannels(g).map((c) => `<#${c.id}>`).join(', ') || '–'}`,
      `**Modell:** ${process.env.AI_MODEL || 'claude-sonnet-5-5'}`,
      `**Tageslimit:** ${dailyLimit(g.id) ? `${dailyLimit(g.id)} Antworten pro Person` : 'unbegrenzt'} (Owner ausgenommen)`,
      `**Namen:** ${Object.entries(namesOf(g.id)).slice(0, 25).map(([id, n]) => `<@${id}> → ${n}`).join(', ') || '–'}`,
      `**Wissen:** ${factsOf(g.id).length} Einträge (\`/ki wissen liste\`) · **Ticket-Button:** ${opts.ticket ? 'an' : 'aus'}`,
    ];
    return i.reply({ content: lines.join('\n'), flags: EPHEMERAL });
  }
  if (sub === 'limit') {
    const n = i.options.getInteger('anzahl', true);
    setLimit(g.id, n);
    return i.reply({ content: n ? `📵 Tageslimit: **${n} KI-Antworten** pro Person (du bist ausgenommen).` : '📵 Tageslimit aus – unbegrenzt.', flags: EPHEMERAL });
  }
  if (sub === 'stats') {
    const fmt = (n) => n.toLocaleString('de-DE');
    const block = (title, u) => {
      const top = Object.entries(u.users).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, n], k) => `${k + 1}. <@${id}> – ${n}`).join('\n') || '–';
      return `**${title}:** ${fmt(u.msgs)} Antworten · ${fmt(u.in)} Tokens rein · ${fmt(u.out)} Tokens raus · ${Object.keys(u.users).length} Personen\n${top}`;
    };
    const today = dayKey();
    const limit = dailyLimit(g.id);
    const atLimit = limit ? Object.values(usageSum(g.id, today).users).filter((n) => n >= limit).length : 0;
    const lines = [
      '📊 **KI-Statistik**',
      block('Heute', usageSum(g.id, today)),
      block('Dieser Monat', usageSum(g.id, today.slice(0, 7))),
      `**Tageslimit:** ${limit || 'unbegrenzt'}${limit ? ` · heute erreicht von ${atLimit} Person(en)` : ''}`,
      '_Die genauen Kosten siehst du in der Claude Console unter Ausgaben._',
    ];
    return i.reply({ content: lines.join('\n\n').slice(0, 2000), flags: EPHEMERAL, allowedMentions: { parse: [] } });
  }
  if (sub === 'name') {
    const person = i.options.getUser('person', true);
    const name = String(i.options.getString('name') || '').replace(/[\r\n:]+/g, ' ').trim().slice(0, 40);
    setName(g.id, person.id, name);
    return i.reply({ content: name ? `✏️ Die KI nennt <@${person.id}> ab jetzt **${name}**.` : `✏️ Die KI nennt <@${person.id}> wieder beim Server-Namen.`, flags: EPHEMERAL, allowedMentions: { parse: [] } });
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
  try { await (isTicketButton(i) ? onTicketButton(i) : onCommand(i)); } catch (e) {
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

/** Who the KI is and what it knows about the server (see opts). */
function configure({ persona, knowledge, ticket } = {}) {
  if (persona !== undefined) opts.persona = persona;
  if (knowledge !== undefined) opts.knowledge = knowledge;
  if (ticket !== undefined) opts.ticket = ticket;
}

/** Hooks the KI-Chat into a discord.js client (once). options: see configure(). */
function attach(client, options) {
  configure(options);
  if (client.__aiChat) return;
  client.__aiChat = true;
  client.on('messageCreate', onMessage);
  client.on('channelCreate', (ch) => { onChannelCreate(ch).catch(() => {}); });
  require('events').EventEmitter.prototype.prependListener.call(client, 'interactionCreate', onInteraction);
  client.once(require('discord.js').Events.ClientReady, () => { void register(client); });
  if (client.isReady?.()) void register(client);
  const list = [...channelIds()];
  if (configured()) console.log(`🤖 KI-Chat eingerichtet für ${list.length} Kanal/Kanäle: ${list.join(', ')}`);
  else console.log(`🤖 KI-Chat aus – ${process.env.ANTHROPIC_API_KEY ? 'AI_CHANNEL_IDS' : 'ANTHROPIC_API_KEY'} fehlt`);
}

/** For bots that create their client elsewhere: attaches to every client that logs in,
 *  and keeps the bot's other command routers away from /ki. */
function install(options) {
  configure(options);
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

module.exports = { attach, install, configure, systemPrompt, onMessage, onInteraction, onChannelCreate, ticketMarker, toApiMessages, splitReply, spamReason, dayKey, recordUsage, usageSum, COMMAND, _reset: () => { state = null; opts.persona = null; opts.knowledge = null; opts.ticket = null; recent.clear(); lastAsk.clear(); limitNoticed.clear(); ticketSummaries.clear(); for (const p of paused.values()) clearTimeout(p.timer); paused.clear(); } };
