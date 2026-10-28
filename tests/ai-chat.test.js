'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const ai = require('../src/ai-chat');

const BOT = '1';
const msg = (id, author, content, extra = {}) => ({ id, content, author: { id: author, username: `u${author}`, bot: author === BOT }, attachments: new Map(), ...extra });

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
});

test('long replies are split at line breaks into Discord-sized parts', () => {
  const text = `${'a'.repeat(1500)}\n${'b'.repeat(1500)}`;
  const parts = ai.splitReply(text);
  assert.deepEqual(parts.map((p) => p.length), [1500, 1500]);
  assert.ok(ai.splitReply('x'.repeat(4500)).every((p) => p.length <= 2000));
});

function fakeMessage(channelId, content) {
  const sent = [];
  const channel = {
    sendTyping: async () => {},
    send: async (p) => sent.push(p),
    messages: { fetch: async () => new Map([['old', msg('old', '3', 'Vorher')]]) },
  };
  return {
    sent, id: 'm', channelId, content, channel, guild: { name: 'XVY' }, author: { id: '2', username: 'max' },
    attachments: new Map(), client: { user: { id: BOT } },
    reply: async (p) => sent.push(p), react: async () => {},
  };
}

test('answers only in the configured channel, with the channel history as context', async () => {
  const env = { ...process.env };
  const realFetch = global.fetch;
  const calls = [];
  process.env.ANTHROPIC_API_KEY = 'test';
  process.env.AI_CHANNEL_IDS = '100, 200';
  global.fetch = async (url, init) => {
    calls.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ content: [{ type: 'text', text: 'Antwort' }] }) };
  };
  try {
    const other = fakeMessage('999', 'Hallo');
    await ai.onMessage(other);
    assert.equal(calls.length, 0);
    assert.equal(other.sent.length, 0);

    const m = fakeMessage('200', 'Hallo Bot');
    await ai.onMessage(m);
    assert.equal(calls.length, 1);
    assert.match(calls[0].system, /XVY/);
    assert.deepEqual(calls[0].messages, [{ role: 'user', content: 'u3: Vorher\nmax: Hallo Bot' }]);
    assert.equal(m.sent[0].content, 'Antwort');
    assert.deepEqual(m.sent[0].allowedMentions.parse, []);
  } finally {
    process.env = env;
    global.fetch = realFetch;
  }
});
