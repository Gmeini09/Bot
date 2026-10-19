'use strict';
// node --test sptool-version.test.js – license DB from 001_init.sql, an update check, the command's reply.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spv-'));
process.env.DATA_DIR = dir;
delete process.env.RAILWAY_VOLUME_MOUNT_PATH;
const db = new DatabaseSync(path.join(dir, 'sptool-license.db'));
db.exec(fs.readFileSync(path.join(__dirname, '001_init.sql'), 'utf8'));
const now = Date.now();
db.prepare("INSERT INTO users (discord_id, username, created_at) VALUES ('u1', 'turbo', ?)").run(now);
for (const [id, name] of [['d1', 'Gaming-PC'], ['d2', 'Laptop'], ['d3', 'Alt-PC']]) db.prepare("INSERT INTO devices (id, discord_id, hwid_hash, name, first_seen, last_seen) VALUES (?, 'u1', ?, ?, ?, ?)").run(id, id + 'h', name, now, now);
const token = 'tok_' + 'x'.repeat(40);
db.prepare("INSERT INTO sessions (token_hash, discord_id, device_id, created_at, expires_at, last_used) VALUES (?, 'u1', 'd1', ?, ?, ?)").run(crypto.createHash('sha256').update(token).digest('hex'), now, now + 1e9, now);
const tok2 = 'tok_' + 'y'.repeat(40);
db.prepare("INSERT INTO sessions (token_hash, discord_id, device_id, created_at, expires_at, last_used) VALUES (?, 'u1', 'd2', ?, ?, ?)").run(crypto.createHash('sha256').update(tok2).digest('hex'), now, now + 1e9, now);
fs.mkdirSync(path.join(dir, 'sptool-app'));
fs.writeFileSync(path.join(dir, 'sptool-app', 'meta.json'), JSON.stringify({ version: '1.10.6', uploadedAt: now, stored: 'x.zip' }));

const spv = require('./sptool-version.js');
const req = (t, v, q = '') => ({ method: 'GET', url: `/api/v1/sptool-app/latest?v=${encodeURIComponent(v)}${q}`, headers: { authorization: `Bearer ${t}` } });

test('update checks record the version per PC (only valid sessions and versions)', () => {
  spv.record(req(token, '1.10.6'));
  spv.record(req(tok2, '1.10.5'));
  spv.record(req('tok_' + 'z'.repeat(40), '9.9.9')); // unknown session
  spv.record(req(token, 'abc'));                      // bad version
  spv.record(req(token, '2.0.0', '&product=skin')); // other product
  const rows = db.prepare('SELECT device_id, product, version FROM sptool_app_versions ORDER BY device_id, product').all().map((r) => ({ ...r }));
  assert.deepEqual(rows, [{ device_id: 'd1', product: 'skin', version: '2.0.0' }, { device_id: 'd1', product: 'sptool', version: '1.10.6' }, { device_id: 'd2', product: 'sptool', version: '1.10.5' }]);
});

test('the reply: newest version, each PC up to date / behind / unknown', () => {
  const v = spv.versionView('u1');
  const e = v.embeds[0];
  assert.equal(v.flags, 64);
  assert.match(e.fields[0].value, /\*\*1\.10\.6\*\*/);
  const pcs = e.fields[1].value;
  assert.match(pcs, /Gaming-PC\*\* – \*\*1\.10\.6\*\* · ✅ aktuell/);
  assert.match(pcs, /Laptop\*\* – \*\*1\.10\.5\*\* · ⬆️ Update auf \*\*1\.10\.6\*\*/);
  assert.match(pcs, /Alt-PC\*\* – Version unbekannt/);
  assert.match(e.description, /Ein PC ist nicht/);
  assert.match(e.fields[2].value, /Updaten/);
});

test('someone without SP Tool', () => {
  assert.match(spv.versionView('nobody', { self: false, name: 'Max' }).embeds[0].fields[1].value, /Max\*\* hat SP Tool noch auf keinem PC/);
});

test('the request tap sees update checks before any router answers them', async () => {
  const http = require('http');
  const srv = http.createServer((q, r) => { r.end('ok'); });
  await new Promise((r) => srv.listen(0, r));
  const { port } = srv.address();
  await fetch(`http://127.0.0.1:${port}/api/v1/sptool-app/latest?v=1.10.6`, { headers: { authorization: `Bearer ${tok2}` } }).then((r) => r.text());
  srv.close();
  assert.equal(db.prepare("SELECT version FROM sptool_app_versions WHERE device_id = 'd2' AND product = 'sptool'").get().version, '1.10.6');
});

test('the slash command: own version, others only for staff, other routers skip it', async () => {
  const { Client, Events } = require('discord.js');
  const seen = [];
  const c = new Client({ intents: [] });
  c.on(Events.InteractionCreate, (i) => seen.push(i.commandName));
  c.__spvInstalled = false;
  // attach the way login does, without connecting
  Client.prototype.login.call(Object.assign(c, { }), 'x').catch(() => {});
  const replies = [];
  const mk = (user, opt, perms = 0n) => ({ commandName: 'sptool-version', isChatInputCommand: () => true, user: { id: user, username: user }, memberPermissions: { has: (b) => (perms & b) === b }, options: { getUser: () => opt }, reply: async (p) => replies.push(p) });
  c.emit(Events.InteractionCreate, mk('u1', null));
  c.emit(Events.InteractionCreate, mk('u2', { id: 'u1', username: 'turbo' }));
  c.emit(Events.InteractionCreate, mk('u2', { id: 'u1', username: 'turbo' }, 0x8n));
  c.emit(Events.InteractionCreate, { commandName: 'ping', isChatInputCommand: () => true });
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(seen, ['ping'], 'other routers never see /sptool-version');
  assert.equal(replies.length, 3);
  assert.match(replies[0].embeds[0].title, /SP Tool – Version$/);
  assert.match(replies[1].content, /nur Admins/);
  assert.match(replies[2].embeds[0].title, /von turbo/);
  c.destroy();
});
