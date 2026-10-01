'use strict';
// Tests for the SP Tool license integration. Uses a small discord.js stub so it runs without a bot token.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const Module = require('node:module');
const { EventEmitter } = require('node:events');

// ── discord.js stub ──────────────────────────────────────────────────────────
const posted = [];
class Client extends EventEmitter {
  constructor() { super(); this.token = null; this.application = null; }
  login(token) { this.token = token; return Promise.resolve(token); }
}
const stub = {
  Client,
  Events: { InteractionCreate: 'interactionCreate', ClientReady: 'clientReady' },
  REST: class { setToken() { return this; } post(route, { body }) { posted.push({ route, name: body.name }); return Promise.resolve({}); } },
  Routes: { applicationCommands: (id) => `/applications/${id}/commands` },
  MessageFlags: { Ephemeral: 64 },
};
const realResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) { return request === 'discord.js' ? 'discord.js' : realResolve.call(this, request, ...rest); };
require.cache['discord.js'] = { id: 'discord.js', filename: 'discord.js', loaded: true, exports: stub };

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sptool-bot-'));
process.env.DATA_DIR = dataDir;
process.env.PUBLIC_BASE_URL = 'https://bot.example.app';
process.env.DISCORD_CLIENT_SECRET = 'test-secret';

const lic = require('./bot.js');
const OWNER = lic.OWNER_ID, USER = '312345678901234567', OTHER = '412345678901234567';

// ── fake interactions ────────────────────────────────────────────────────────
function interaction(userId, commandName, sub, opts = {}) {
  const out = { replies: [] };
  const i = {
    commandName,
    user: { id: userId, username: `u${userId.slice(-3)}`, globalName: null, avatar: null },
    client: { users: { fetch: async () => { throw new Error('no dm'); } } },
    isChatInputCommand: () => true,
    options: {
      getSubcommand: () => sub,
      getString: (k) => (opts[k] ?? null),
      getInteger: (k) => (opts[k] ?? null),
      getUser: (k) => (k === 'user' && opts.user ? { id: opts.user, username: 'kevin', globalName: 'Kevin', avatar: null, send: async () => {} } : null),
    },
    reply: async (p) => { out.replies.push(p); },
    editReply: async (p) => { out.replies.push(p); },
    deferred: false, replied: false,
  };
  out.i = i;
  return out;
}
const run = async (...a) => { const x = interaction(...a); await lic.handleInteraction(x.i); return x.replies.at(-1); };
const text = (r) => JSON.stringify(r);

let server, base;
before(async () => {
  await lic.ready;
  assert.equal(lic.state.ready, true, String(lic.state.error));
  // The bot's own server: index.js creates it with its listener; /api/v1 must be routed to the license API.
  server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ bot: true, path: req.url })); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server?.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

test('license API is mounted on the bot web server, other paths stay with the bot', async () => {
  const h = await (await fetch(`${base}/api/v1/health`)).json();
  assert.equal(h.ok, true);
  const bot = await (await fetch(`${base}/health`)).json();
  assert.equal(bot.bot, true);
  const r = await fetch(`${base}/api/v1/auth/discord/start?state=${'s'.repeat(40)}&hwid=${'a'.repeat(64)}`, { redirect: 'manual' });
  assert.equal(r.status, 302);
  const loc = r.headers.get('location');
  assert.match(loc, /^https:\/\/discord\.com\/oauth2\/authorize/);
  assert.match(decodeURIComponent(loc), /redirect_uri=https:\/\/bot\.example\.app\/api\/v1\/auth\/discord\/callback/);
});

test('signing key and HWID salt are created once on the volume', () => {
  assert.ok(fs.existsSync(path.join(dataDir, 'sptool-license-ed25519.pem')));
  assert.ok(fs.existsSync(path.join(dataDir, 'sptool-hwid-salt.txt')));
  assert.ok(fs.existsSync(path.join(dataDir, 'sptool-license.db')));
  assert.match(lic.state.publicKey, /^[A-Za-z0-9_-]{43}$/);
});

test('command definitions are valid for Discord', () => {
  for (const c of lic.commandBodies) {
    assert.match(c.name, /^[a-z0-9-]{1,32}$/);
    assert.ok(c.description.length <= 100);
    assert.ok(c.options.length <= 25);
    for (const s of c.options) {
      assert.match(s.name, /^[a-z0-9-]{1,32}$/, s.name);
      assert.ok(s.description.length <= 100, s.name);
      let seenOptional = false;
      for (const o of s.options ?? []) {
        assert.match(o.name, /^[a-z0-9-]{1,32}$/);
        assert.ok(o.description.length <= 100, `${s.name}.${o.name}`);
        if (!o.required) seenOptional = true; else assert.ok(!seenOptional, `${s.name}: required after optional`);
      }
    }
  }
});

test('client hooks: our commands bypass the bot router; global commands are registered on ready', async () => {
  const client = new Client();
  const seenByBot = [];
  client.on('interactionCreate', (i) => seenByBot.push(i.commandName)); // like index.js
  await client.login('token');
  const mine = interaction(USER, 'sptool', 'lizenz');
  const theirs = { commandName: 'sell', isChatInputCommand: () => true };
  client.emit('interactionCreate', mine.i);
  client.emit('interactionCreate', theirs);
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(seenByBot, ['sell']);
  assert.equal(mine.replies.length, 1);
  client.application = { id: '999999999999999999' };
  client.emit('clientReady', client);
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(posted.map((p) => p.name), ['sptool', 'sptool-admin']);
  assert.ok(posted.every((p) => p.route === '/applications/999999999999999999/commands'));
  assert.equal(lic.state.cfg.discord.clientId, '999999999999999999');
});

test('non-admins cannot use /sptool-admin', async () => {
  const r = await run(USER, 'sptool-admin', 'stats');
  assert.match(text(r), /Nur SP Tool Admins/);
  assert.equal(r.flags, 64);
});

test('owner grants a license by user or by raw Discord ID', async () => {
  let r = await run(OWNER, 'sptool-admin', 'lizenz-geben', { plan: 'premium', user: USER, tage: 30, geraete: 2 });
  assert.match(text(r), /Lizenz gesetzt/);
  r = await run(USER, 'sptool', 'lizenz');
  assert.match(text(r), /Premium/);
  r = await run(OWNER, 'sptool-admin', 'lizenz-geben', { plan: 'creator', id: OTHER });
  assert.match(text(r), /lebenslang/);
  r = await run(OWNER, 'sptool-admin', 'info', { id: OTHER });
  assert.match(text(r), /Creator/);
  r = await run(OWNER, 'sptool-admin', 'info', {});
  assert.match(text(r), /gültige Discord/);
});

test('keys: create, redeem once, revoke', async () => {
  const r = await run(OWNER, 'sptool-admin', 'keys-erstellen', { plan: 'premium', anzahl: 2, tage: 7 });
  const keys = r.content.match(/SPT-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}/g);
  assert.equal(keys.length, 2);
  const NEW = '512345678901234567';
  assert.match(text(await run(NEW, 'sptool', 'einloesen', { key: keys[0].toLowerCase() })), /Key eingelöst/);
  assert.match(text(await run(NEW, 'sptool', 'einloesen', { key: keys[0] })), /bereits eingelöst/);
  assert.match(text(await run(OWNER, 'sptool-admin', 'key-widerrufen', { key: keys[1] })), /widerrufen/);
  assert.match(text(await run(NEW, 'sptool', 'einloesen', { key: keys[1] })), /gibt es nicht/);
});

test('ban, owner protection, admin roles, device reset, setup', async () => {
  assert.match(text(await run(OWNER, 'sptool-admin', 'ban', { user: USER, grund: 'Weitergabe' })), /gesperrt/);
  assert.match(text(await run(OWNER, 'sptool-admin', 'info', { user: USER })), /Weitergabe/);
  assert.match(text(await run(OWNER, 'sptool-admin', 'unban', { user: USER })), /aufgehoben/);
  assert.match(text(await run(OWNER, 'sptool-admin', 'ban', { id: OWNER })), /Owner kann nicht/);
  assert.match(text(await run(OWNER, 'sptool-admin', 'admin', { aktion: 'admin', id: OTHER })), /jetzt SP Tool Admin/);
  assert.match(text(await run(OTHER, 'sptool-admin', 'stats')), /Übersicht/);
  assert.match(text(await run(OTHER, 'sptool-admin', 'admin', { aktion: 'admin', id: USER })), /nur der Owner/);
  assert.match(text(await run(OTHER, 'sptool-admin', 'ban', { id: OWNER })), /Owner kann nicht/);
  assert.match(text(await run(OWNER, 'sptool-admin', 'admin', { aktion: 'user', id: OTHER })), /kein Admin mehr/);
  assert.match(text(await run(OTHER, 'sptool-admin', 'stats')), /Nur SP Tool Admins/);
  assert.match(text(await run(OWNER, 'sptool-admin', 'geraete-reset', { user: USER })), /entfernt/);
  const s = text(await run(OWNER, 'sptool-admin', 'setup'));
  assert.ok(s.includes(lic.state.publicKey));
  assert.ok(s.includes('https://bot.example.app/api/v1/auth/discord/callback'));
  const audit = lic.state.svc.auditLog().map((e) => e.action);
  for (const a of ['license.set', 'keys.created', 'key.redeemed', 'user.banned', 'user.role', 'devices.reset']) assert.ok(audit.includes(a), a);
});
