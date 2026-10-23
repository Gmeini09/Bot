'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('../src/logic');
const { Store } = require('../src/store');
const { COMMANDS } = require('../src/commands');

test('prices, colors, templates, slugs, emojis', () => {
  assert.equal(L.parsePrice('9,99'), 9.99);
  assert.equal(L.parsePrice('15 €'), 15);
  assert.equal(L.parsePrice('-3'), null);
  assert.equal(L.parsePrice('abc'), null);
  assert.equal(L.parseColor('#C9A227'), 0xc9a227);
  assert.equal(L.parseColor('red'), null);
  assert.equal(L.fillTemplate('Hi {user} auf {server} {x}', { user: '<@1>', server: 'XVY' }), 'Hi <@1> auf XVY {x}');
  assert.equal(L.slug('Max Müller!!'), 'max-muller');
  assert.equal(L.slug('🔥🔥'), 'user');
  assert.ok(L.validEmoji('🔥') && L.validEmoji('❤️') && L.validEmoji('👍🏽') && L.validEmoji('<:xvy:123456789012345678>'));
  assert.ok(!L.validEmoji('abc') && !L.validEmoji('🔥🔥 x'));
  assert.match(L.money(9.5), /9,50/);
});

test('cart: lines, totals, unknown and disabled products are skipped', () => {
  const products = { p1: { name: 'A', price: 9.99, emoji: '' }, p2: { name: 'B', price: 5, enabled: false } };
  const cart = { items: {} };
  L.addToCart(cart, 'p1'); L.addToCart(cart, 'p1'); L.addToCart(cart, 'p2'); cart.items.gone = 1;
  const lines = L.cartLines(cart, products);
  assert.deepEqual(lines.map((l) => [l.id, l.qty, l.sum]), [['p1', 2, 19.98]]);
  assert.equal(L.cartTotal(lines), 19.98);
  for (let i = 0; i < 20; i++) L.addToCart(cart, 'p1');
  assert.equal(cart.items.p1, 10, 'max 10 per product');
});

test('captcha answer is the sum', () => {
  const c = L.makeCaptcha(() => 0.5);
  const [a, b] = c.question.match(/\d+/g).map(Number);
  assert.equal(c.answer, String(a + b));
});

test('invite detection', () => {
  assert.ok(L.hasInvite('komm auf discord.gg/abc123'));
  assert.ok(L.hasInvite('https://discord.com/invite/xyz'));
  assert.ok(!L.hasInvite('discord ist cool'));
});

test('spam tracker: bursts and duplicates', () => {
  const cfg = { spam: true, spamMessages: 6, spamSeconds: 7, duplicates: true };
  const s = new L.SpamTracker();
  let r = null;
  for (let i = 0; i < 6; i++) r = s.check('u', `msg ${i}`, 1000 + i * 100, cfg);
  assert.equal(r, null);
  assert.equal(s.check('u', 'msg 7', 1800, cfg), 'spam');
  const d = new L.SpamTracker();
  for (let i = 0; i < 3; i++) assert.equal(d.check('v', 'Hallo', i * 3000, cfg), null);
  assert.equal(d.check('v', 'hallo ', 9000, cfg), 'duplicate');
  // slow normal chatting is fine
  const n = new L.SpamTracker();
  for (let i = 0; i < 30; i++) assert.equal(n.check('w', `text ${i}`, i * 5000, cfg), null);
});

test('raid tracker starts once and expires', () => {
  const cfg = { raidJoins: 3, raidSeconds: 30 };
  const r = new L.RaidTracker();
  assert.equal(r.join('g', 0, cfg), null);
  assert.equal(r.join('g', 1000, cfg), null);
  assert.equal(r.join('g', 2000, cfg), 'started');
  assert.equal(r.join('g', 3000, cfg), 'active');
  assert.ok(!r.active('g', 2000 + 11 * 60_000));
});

test('transcript format', () => {
  const t = L.transcript('ticket-1', [{ createdTimestamp: Date.UTC(2026, 0, 1, 12), author: 'max', content: 'Hallo', attachments: ['https://x/a.png'], embeds: 1 }]);
  assert.match(t, /\[2026-01-01 12:00:00\] max: Hallo \[Anhänge: https:\/\/x\/a.png\] \[1 Embed\]/);
});

test('store: survives restart, migrates old data, keeps a broken file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xvy-'));
  const s = new Store(dir);
  s.guild('1').config.name = 'Test';
  s.flush();
  const s2 = new Store(dir);
  assert.equal(s2.guild('1').config.name, 'Test');
  assert.equal(s2.guild('1').config.automod.spamMessages, 6);
  fs.writeFileSync(path.join(dir, 'xvy-bot.json'), JSON.stringify({ guilds: { 2: { config: { name: 'Alt', automod: { spam: false } } } } }));
  const s3 = new Store(dir);
  const g = s3.guild('2');
  assert.equal(g.config.name, 'Alt');
  assert.equal(g.config.automod.spam, false);
  assert.equal(g.config.automod.raidJoins, 8);
  assert.deepEqual(g.products, {});
  fs.writeFileSync(path.join(dir, 'xvy-bot.json'), '{kaputt');
  const s4 = new Store(dir);
  assert.deepEqual(s4.data.guilds, {});
  assert.ok(fs.readdirSync(dir).some((f) => f.includes('.broken-')));
});

test('slash commands follow Discord limits', () => {
  const NAME = /^[-_\p{Ll}\p{N}]{1,32}$/u;
  assert.ok(COMMANDS.length <= 100);
  const names = new Set();
  const checkOptions = (opts, where) => {
    assert.ok(opts.length <= 25, `${where}: too many options`);
    let optionalSeen = false;
    const seen = new Set();
    for (const o of opts) {
      assert.match(o.name, NAME, `${where}.${o.name}`);
      assert.ok(!seen.has(o.name), `${where}: duplicate ${o.name}`); seen.add(o.name);
      assert.ok(o.description.length >= 1 && o.description.length <= 100, `${where}.${o.name} description length ${o.description.length}`);
      if (o.type === 1) { checkOptions(o.options || [], `${where} ${o.name}`); continue; }
      if (o.required) assert.ok(!optionalSeen, `${where}: required option ${o.name} after optional`); else optionalSeen = true;
      if (o.choices) { assert.ok(o.choices.length <= 25); for (const c of o.choices) assert.ok(c.name.length <= 100 && String(c.value).length <= 100); }
      if (o.autocomplete) assert.ok(!o.choices);
    }
  };
  for (const c of COMMANDS) {
    assert.match(c.name, NAME);
    assert.ok(!names.has(c.name), `duplicate ${c.name}`); names.add(c.name);
    assert.ok(c.description.length >= 1 && c.description.length <= 100, `${c.name} description length ${c.description.length}`);
    if (['giveaway', 'invites'].includes(c.name)) assert.equal(c.default_member_permissions, null); else assert.match(c.default_member_permissions, /^\d+$/);
    const subs = (c.options || []).filter((o) => o.type === 1);
    if (subs.length) assert.equal(subs.length, c.options.length, `${c.name}: mixes subcommands and options`);
    checkOptions(c.options || [], c.name);
  }
  assert.ok(JSON.stringify(COMMANDS).length < 8000 * COMMANDS.length);
});

test('durations for giveaways', () => {
  assert.equal(L.parseDuration('30m'), 30 * 60_000);
  assert.equal(L.parseDuration('2h'), 2 * 3_600_000);
  assert.equal(L.parseDuration('1d12h'), 36 * 3_600_000);
  assert.equal(L.parseDuration('1 d 2 h 5 m'), (26 * 60 + 5) * 60_000);
  assert.equal(L.parseDuration('90'), 90 * 60_000);
  assert.equal(L.parseDuration('3tage'), 3 * 86_400_000);
  assert.equal(L.parseDuration('31d'), null);
  assert.equal(L.parseDuration('0m'), null);
  assert.equal(L.parseDuration('morgen'), null);
});
