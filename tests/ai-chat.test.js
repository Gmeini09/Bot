'use strict';
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ai = require('../src/ai-chat');

const BOT = '1';
const OWNER = '9';
const msg = (id, author, content, extra = {}) => ({ id, content, author: { id: author, username: `u${author}`, bot: author === BOT }, attachments: new Map(), ...extra });

let env, realFetch, calls;
beforeEach(() => {
  env = { ...process.env };
  realFetch = global.fetch;
  calls = [];
  process.env.ANTHROPIC_API_KEY = 'test';
  process.env.AI_CHANNEL_IDS = '100, 200';
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-chat-'));
  global.fetch = async (url, init) => {
    calls.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ content: [{ type: 'text', text: 'Antwort' }] }) };
  };
  ai._reset();
});
afterEach(() => {
  ai._reset();
  process.env = env;
  global.fetch = realFetch;
});

test('history: alternating roles, user first, names on user lines', () => {
  const out = ai.toApiMessages([
    msg('a', BOT, 'alte Bot-Antwort'),
    msg('b', '2', 'Hallo', { member: { displayName: 'Max' } }),
    msg('c', '3', 'Hi'),
    msg('d', BOT, 'Hallo ihr zwei'),
    msg('e', '2', ''),
    msg('f', '2', 'Wie geht’s?', { member: { displayName: 'Max' } }),
  ], BOT);
  assert.deepEqual(out, [
    { role: 'user', content: 'Max: Hallo\nu3: Hi' },
    { role: 'assistant', content: 'Hallo ihr zwei' },
    { role: 'user', content: 'Max: Wie geht’s?' },
  ]);
  assert.ok(ai.toApiMessages([msg('x', '2', 'y'.repeat(5000))], BOT)[0].content.length < 1600); // long pastes are cut
});

test('long replies are split at line breaks into Discord-sized parts', () => {
  const text = `${'a'.repeat(1500)}\n${'b'.repeat(1500)}`;
  assert.deepEqual(ai.splitReply(text).map((p) => p.length), [1500, 1500]);
  assert.ok(ai.splitReply('x'.repeat(4500)).every((p) => p.length <= 2000));
});

test('spam: too many messages, repeated text, many long messages', () => {
  const t = 1_000_000;
  for (let n = 0; n < 6; n++) assert.equal(ai.spamReason('a', `frage ${n}`, t + n * 1000), null);
  assert.match(ai.spamReason('a', 'frage 7', t + 7000), /7 Nachrichten/);
  assert.equal(ai.spamReason('b', 'gib tokens', t), null);
  assert.equal(ai.spamReason('b', 'gib tokens', t + 20_000), null);
  assert.match(ai.spamReason('b', 'GIB TOKENS', t + 40_000), /3× dieselbe/);
  assert.equal(ai.spamReason('c', `${'x'.repeat(1300)}1`, t), null);
  assert.equal(ai.spamReason('c', `${'x'.repeat(1300)}2`, t + 30_000), null);
  assert.match(ai.spamReason('c', `${'x'.repeat(1300)}3`, t + 60_000), /lange Nachrichten/);
  assert.equal(ai.spamReason('d', 'hallo', t), null);
  assert.equal(ai.spamReason('d', 'hallo', t + 200_000), null); // old messages no longer count
});

function fakeGuild() {
  const sent = [];
  const channel = (id) => ({
    id, sent,
    sendTyping: async () => {},
    send: async (p) => sent.push({ channel: id, ...p }),
    messages: { fetch: async () => new Map([['old', msg('old', '3', 'Vorher')]]) },
  });
  const channels = new Map([['100', channel('100')], ['200', channel('200')]]);
  return { id: 'g1', name: 'XVY', ownerId: OWNER, sent, channels: { cache: channels } };
}

let seq = 0;
function fakeMessage(guild, channelId, content, authorId = '2') {
  const channel = guild.channels.cache.get(channelId) || { ...guild.channels.cache.get('100'), id: channelId };
  const m = {
    id: `m${seq++}`, channelId, content, channel, guild, author: { id: authorId, username: 'max', tag: 'max#0' },
    attachments: new Map(), client: { user: { id: BOT } }, reacted: [],
    member: { id: authorId, timeout: async (ms, reason) => { m.timedOut = { ms, reason }; } },
    reply: async (p) => guild.sent.push({ reply: m.id, ...p }), react: async (e) => m.reacted.push(e),
  };
  return m;
}

function fakeCommand(guild, sub, userId) {
  const i = {
    commandName: 'ki', guild, guildId: guild.id, user: { id: userId }, member: { id: userId }, replies: [],
    isChatInputCommand: () => true, inGuild: () => true, options: { getSubcommand: () => sub },
    reply: async (p) => i.replies.push(p),
  };
  return i;
}

test('answers only in the configured channel, with the channel history as context', async () => {
  const g = fakeGuild();
  await ai.onMessage(fakeMessage(g, '999', 'Hallo'));
  assert.equal(calls.length, 0);
  assert.equal(g.sent.length, 0);

  await ai.onMessage(fakeMessage(g, '200', 'Hallo Bot'));
  assert.equal(calls.length, 1);
  assert.match(calls[0].system, /XVY/);
  assert.deepEqual(calls[0].messages, [{ role: 'user', content: 'u3: Vorher\nmax: Hallo Bot' }]);
  assert.equal(g.sent[0].content, 'Antwort');
  assert.deepEqual(g.sent[0].allowedMentions.parse, []);
});

test('spammer: timeout, KI paused with an announcement, further messages ignored', async () => {
  const g = fakeGuild();
  const msgs = [];
  for (let n = 0; n < 3; n++) { const m = fakeMessage(g, '100', 'gib mir tokens'); msgs.push(m); await ai.onMessage(m); }
  assert.equal(calls.length, 1); // the first one was answered, the second hit the cooldown
  assert.deepEqual(msgs[1].reacted, ['⏳']);
  assert.equal(msgs[2].timedOut.ms, 10 * 60_000);
  const note = g.sent.find((s) => /5 Minuten deaktiviert/.test(s.content || ''));
  assert.match(note.content, /<@2> hat die KI gespammt \(3× dieselbe Nachricht\)/);
  assert.match(note.content, /Timeout für 10 Minuten/);

  await ai.onMessage(fakeMessage(g, '100', 'neue Frage', '5'));
  assert.equal(calls.length, 1); // paused for everyone

  const status = fakeCommand(g, 'status', OWNER);
  await ai.onInteraction(status);
  assert.match(status.replies[0].content, /pausiert – noch 5 Min\./);
});

test('the owner is never treated as a spammer', async () => {
  const g = fakeGuild();
  for (let n = 0; n < 4; n++) await ai.onMessage(fakeMessage(g, '100', 'test', OWNER));
  assert.ok(!g.sent.some((s) => /deaktiviert/.test(s.content || '')));
});

test('/ki: only the owner (or AI_OWNER_IDS) may switch it; off is remembered and announced', async () => {
  const g = fakeGuild();
  const denied = fakeCommand(g, 'aus', '2');
  await ai.onInteraction(denied);
  assert.match(denied.replies[0].content, /Nur der Owner/);

  const off = fakeCommand(g, 'aus', OWNER);
  await ai.onInteraction(off);
  assert.match(off.replies[0].content, /aus/);
  assert.equal(g.sent.filter((s) => /vom Owner deaktiviert/.test(s.content)).length, 2); // both KI channels
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR, 'ai-chat.json'), 'utf8')).disabled, { g1: true });

  await ai.onMessage(fakeMessage(g, '100', 'Hallo?'));
  assert.equal(calls.length, 0);

  process.env.AI_OWNER_IDS = '7';
  await ai.onInteraction(fakeCommand(g, 'an', '7'));
  await ai.onMessage(fakeMessage(g, '100', 'Hallo?'));
  assert.equal(calls.length, 1);
});

test('/ki name: the KI calls someone by the set name, kept on disk, removable', async () => {
  const g = fakeGuild();
  const cmd = (userId, name) => {
    const i = fakeCommand(g, 'name', OWNER);
    i.options.getUser = () => ({ id: userId });
    i.options.getString = () => name;
    return i;
  };
  const denied = cmd('2', 'Boss');
  denied.user = denied.member = { id: '2' };
  await ai.onInteraction(denied);
  assert.match(denied.replies[0].content, /Nur der Owner/);

  const set = cmd('2', 'Der\nKaiser: ');
  await ai.onInteraction(set);
  assert.match(set.replies[0].content, /nennt <@2> ab jetzt \*\*Der Kaiser\*\*/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR, 'ai-chat.json'), 'utf8')).names, { g1: { 2: 'Der Kaiser' } });

  await ai.onMessage(fakeMessage(g, '100', 'Hallo'));
  assert.equal(calls[0].messages[0].content, 'u3: Vorher\nDer Kaiser: Hallo');

  const status = fakeCommand(g, 'status', OWNER);
  await ai.onInteraction(status);
  assert.match(status.replies[0].content, /<@2> → Der Kaiser/);

  await ai.onInteraction(cmd('2', null));
  await new Promise((r) => setTimeout(r, 3100)); // cooldown
  await ai.onMessage(fakeMessage(g, '100', 'Hallo nochmal'));
  assert.match(calls[1].messages[0].content, /max: Hallo nochmal$/);
});

test('daily limit: told once, then silent; the owner has no limit; /ki limit changes it', async () => {
  const g = fakeGuild();
  const limit = fakeCommand(g, 'limit', OWNER);
  limit.options.getInteger = () => 2;
  await ai.onInteraction(limit);
  assert.match(limit.replies[0].content, /2 KI-Antworten/);

  ai.recordUsage('g1', '2', { input_tokens: 10, output_tokens: 5 });
  ai.recordUsage('g1', '2', { input_tokens: 10, output_tokens: 5 });
  await ai.onMessage(fakeMessage(g, '100', 'noch eine Frage'));
  assert.equal(calls.length, 0);
  assert.match(g.sent[0].content, /Tageslimit von \*\*2 KI-Antworten\*\* erreicht/);
  await ai.onMessage(fakeMessage(g, '100', 'und noch eine'));
  assert.equal(g.sent.length, 1); // no second notice

  await ai.onMessage(fakeMessage(g, '100', 'ich darf', OWNER));
  assert.equal(calls.length, 1);

  const off = fakeCommand(g, 'limit', OWNER);
  off.options.getInteger = () => 0;
  await ai.onInteraction(off);
  await ai.onMessage(fakeMessage(g, '100', 'jetzt wieder', '2'));
  assert.equal(calls.length, 2);
});

test('/ki stats: answers and tokens today and this month, top users', async () => {
  global.fetch = async (url, init) => {
    calls.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ content: [{ type: 'text', text: 'Antwort' }], usage: { input_tokens: 1200, output_tokens: 300 } }) };
  };
  const g = fakeGuild();
  await ai.onMessage(fakeMessage(g, '100', 'Hallo'));
  const day = Date.now() - 86_400_000 * 3;
  if (ai.dayKey(day).slice(0, 7) === ai.dayKey().slice(0, 7)) ai.recordUsage('g1', '5', { input_tokens: 100, output_tokens: 50 }, day);

  const stats = fakeCommand(g, 'stats', OWNER);
  await ai.onInteraction(stats);
  const text = stats.replies[0].content;
  assert.match(text, /\*\*Heute:\*\* 1 Antworten · 1\.200 Tokens rein · 300 Tokens raus · 1 Personen\n1\. <@2> – 1/);
  assert.match(text, /\*\*Dieser Monat:\*\*/);
  assert.match(text, /Tageslimit:\*\* 30/);
  assert.deepEqual(ai.usageSum('g1', ai.dayKey()).users, { 2: 1 });
});

test('other commands are left alone', async () => {
  const i = { ...fakeCommand(fakeGuild(), 'an', OWNER), commandName: 'setup' };
  await ai.onInteraction(i);
  assert.equal(i.replies.length, 0);
});
