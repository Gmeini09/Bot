'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const { Store } = require('./store');
const { Twitch, parseLine } = require('./twitch');
const { createIntegration, commands, format } = require('./index');

function temp(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unfug-test-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }
function state(t) { let now = 1000; const dir = temp(t); const s = new Store(dir, () => now); s.guild('1').channel = 'unfug'; return { s, dir, time: n => now = n }; }
function setup(t, options = {}) {
  const messages = [];
  const twitch = { configured: true, connected: () => true, ensure: async () => {}, live: async () => null, close() {}, stop() {}, ...options.twitch };
  const client = { guilds: { cache: new Map([['1', {}]]) }, channels: { fetch: async () => ({ guildId: '1', isTextBased: () => true, send: async m => { messages.push(m); if (options.sendFails) throw new Error('network'); return {}; } }) } };
  const integration = createIntegration({ client, storageDir: temp(t), canManage: m => m.admin, env: { STREAM_ENABLED: 'true', TWITCH_CLIENT_ID: 'id', TWITCH_CLIENT_SECRET: 'fake-test-only' }, twitch });
  Object.assign(integration.store.guild('1'), { guildId: '1', channel: 'unfug', announcementChannel: '2', enabled: true, role: '3' });
  return { integration, messages, twitch };
}
function interaction(commandName, action, values = {}, admin = true) {
  return { commandName, guildId: '1', member: { admin }, isChatInputCommand: () => true, inGuild: () => true,
    options: { getSubcommand: () => action, getString: n => values[n], getInteger: n => values[n], getChannel: n => values[n], getRole: n => values[n] },
    async reply(v) { this.result = v; }, async deferReply(v) { this.deferred = v; }, async editReply(v) { this.result = v; } };
}
test('one entry per Twitch user ID; deadline excludes late joins; persistence resumes draw', t => {
  const { s, dir, time } = state(t); s.create('1', 'Test', 1, 1);
  assert.equal(s.join('unfug', '42', 'viewer'), true); assert.equal(s.join('unfug', '42', 'renamed'), false);
  assert.equal(s.join('wrong', '44', 'other'), false); assert.equal(s.join('unfug', '', 'other'), false);
  time(61000); assert.equal(s.join('unfug', '45', 'late'), false);
  assert.equal(s.guild('1').giveaway.status, 'ended');
  assert.deepEqual(new Store(dir).guild('1').giveaway.winners, [{ userId: '42', login: 'viewer' }]);
});
test('restart catches overdue draw, empty draws, cancellation and reroll exclusions', t => {
  const { s, dir } = state(t); s.create('1', 'Test', 1, 2);
  for (let n = 1; n <= 5; n++) s.join('unfug', String(n), 'user' + n);
  const restored = new Store(dir, () => 90000); restored.expire();
  const first = restored.guild('1').giveaway.winners.map(w => w.userId);
  restored.draw('1', true); assert.ok(restored.guild('1').giveaway.winners.every(w => !first.includes(w.userId)));
  restored.draw('1', true); assert.equal(restored.guild('1').giveaway.drawn.length, 5);
  assert.throws(() => restored.draw('1', true));
  restored.create('1', 'Empty', 1, 20); restored.draw('1'); assert.equal(restored.guild('1').giveaway.winners.length, 0);
  restored.create('1', 'Cancel', 1, 1); restored.cancel('1'); assert.throws(() => restored.draw('1'));
});
test('active giveaway cannot be overwritten; invalid input rejected; corrupt disk fails closed', t => {
  const { s, dir } = state(t); assert.throws(() => s.create('1', 'Test', 0, 1)); s.create('1', 'Test', 1, 1);
  assert.throws(() => s.create('1', 'Replacement', 1, 1));
  fs.writeFileSync(path.join(dir, 'unfug-stream.json'), 'invalid'); assert.throws(() => new Store(dir));
});
test('IRC parser requires real user ID for participation; no display-name injection', () => {
  const p = parseLine('@user-id=42;display-name=<script> :viewer!viewer@viewer.tmi.twitch.tv PRIVMSG #unfug :!join');
  assert.deepEqual(p, { userId: '42', login: 'viewer', channel: 'unfug', text: '!join' }); assert.equal(parseLine('PING :tmi.twitch.tv'), null);
});
test('IRC handles fragmented messages, ping, duplicate join and reconnect', async t => {
  const { s } = state(t); s.create('1', 'Test', 1, 1);
  s.guild('1').auth = { access: 'fake', refresh: 'fake', login: 'unfug', expiresAt: Date.now() + 3600000, validatedAt: Date.now() };
  const writes = []; let socket;
  const connect = (_options, ready) => { socket = new EventEmitter(); socket.setEncoding = () => {}; socket.setTimeout = () => {}; socket.write = x => writes.push(x); socket.destroy = () => socket.emit('close'); queueMicrotask(ready); return socket; };
  const tw = new Twitch(s, { TWITCH_CLIENT_ID: 'client' }, async () => ({ ok: true, json: async () => ({ client_id: 'client', scopes: ['chat:read'], login: 'unfug' }) }), connect); await tw.ensure('1'); await Promise.resolve();
  assert.ok(writes[0].includes('JOIN #unfug'));
  socket.emit('data', ':tmi.twitch.tv ROOMSTATE #unfug\r\nPING :server\r\n@user-id=42 :viewer!v@v PRIVMSG #unfug :!jo');
  socket.emit('data', 'in\r\n@user-id=42 :viewer!v@v PRIVMSG #unfug :!join\r\n');
  assert.equal(tw.connected('1'), true); assert.ok(writes.includes('PONG :server\r\n')); assert.equal(Object.keys(s.guild('1').giveaway.entrants).length, 1);
  socket.emit('data', ':tmi.twitch.tv RECONNECT\r\n'); assert.equal(tw.connected('1'), false); tw.stop();
});
test('refresh rotates and persists refresh token; wrong OAuth account rejected', async t => {
  const { s } = state(t); s.guild('1').auth = { access: 'expired', refresh: 'old', login: 'unfug', expiresAt: 0, validatedAt: 0 };
  let login = 'unfug'; let requests = 0;
  const tw = new Twitch(s, { TWITCH_CLIENT_ID: 'client', TWITCH_CLIENT_SECRET: 'fake' }, async url => ({ ok: true, json: async () => {
    requests++; return url.endsWith('/validate') ? { client_id: 'client', scopes: ['chat:read'], login } : { access_token: 'new', refresh_token: 'rotated', expires_in: 3600 };
  } }));
  await Promise.all([tw.access('1'), tw.access('1')]); assert.equal(requests, 2); assert.equal(s.guild('1').auth.refresh, 'rotated');
  login = 'wrong'; await assert.rejects(tw.authorize('1', 'code', 'https://example.test/callback', 'unfug'), /MISMATCH/);
});
test('live stream deduplicated across polls and persistence; test has no role ping', async t => {
  const { integration: i, messages } = setup(t, { twitch: { live: async () => ({ id: 'live1', type: 'live', user_name: 'UNFUG', user_login: 'unfug', title: '@everyone', game_name: 'FiveM' }) } });
  await Promise.all([i.poll(), i.poll()]); await i.poll(); assert.equal(messages.length, 1);
  assert.deepEqual(messages[0].allowedMentions, { parse: [], roles: ['3'] });
  assert.ok(new Store(path.dirname(i.store.file)).guild('1').seen.includes('live1'));
  const input = interaction('stream', 'test'); await i.handleInteraction(input); assert.deepEqual(messages[1].allowedMentions, { parse: [], roles: [] }); assert.equal(messages[1].content, undefined);
});
test('ambiguous send failure never repeats a role ping and is visible in status', async t => {
  const { integration: i, messages } = setup(t, { sendFails: true, twitch: { live: async () => ({ id: 'live1', user_login: 'unfug', user_name: 'UNFUG', title: 'Title' }) } });
  await i.poll(); await i.poll(); assert.equal(messages.length, 1); assert.match(i.store.guild('1').lastResult, /fehlgeschlagen/);
});
test('unauthorized commands cannot mutate state; unrelated commands pass through', async t => {
  const { integration: i } = setup(t); const input = interaction('stream', 'aus', {}, false);
  assert.equal(await i.handleInteraction(input), true); assert.equal(i.store.guild('1').enabled, true); assert.match(input.result.content, /Berechtigung/);
  assert.equal(await i.handleInteraction(interaction('help', 'status')), false);
});
test('disconnected chat blocks giveaway start; connected start, end and status work', async t => {
  const { integration: i, twitch } = setup(t); twitch.connected = () => false;
  const args = { gewinn: 'Test', minuten: 1, gewinner: 1 }; const input = interaction('streamgiveaway', 'start', args);
  await i.handleInteraction(input); assert.equal(i.store.guild('1').giveaway, null);
  twitch.connected = () => true; await i.handleInteraction(interaction('streamgiveaway', 'start', args));
  i.store.join('unfug', '42', 'viewer'); await i.handleInteraction(interaction('streamgiveaway', 'beenden')); assert.equal(i.store.guild('1').giveaway.winners[0].login, 'viewer');
});
test('disabled integration is inert and does not touch storage', async () => {
  const i = createIntegration({ env: {}, storageDir: 'never-created' }); assert.deepEqual(i.commands(), []); assert.equal(i.handleHttp({}, {}), false); assert.equal(await i.handleInteraction({}), false);
});
test('HTTP overlay requires key, isolates guilds, excludes entrants/tokens and supports rotation', async t => {
  const { integration: i } = setup(t); i.store.create('1', '<script>bad</script>', 1, 1); i.store.join('unfug', '42', 'viewer');
  const server = http.createServer((req, res) => { if (!i.handleHttp(req, res)) { res.writeHead(404); res.end(); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => { server.closeAllConnections(); server.close(); });
  const origin = 'http://127.0.0.1:' + server.address().port;
  assert.equal((await fetch(origin + '/stream/state')).status, 401);
  const key = '1.' + i.store.guild('1').overlayKey;
  const good = await fetch(origin + '/stream/state', { headers: { Authorization: 'Bearer ' + key } });
  assert.equal(good.status, 200); const data = await good.json(); assert.equal(data.giveaway.count, 1); assert.equal(data.giveaway.entrants, undefined); assert.equal(data.auth, undefined);
  assert.equal((await fetch(origin + '/stream/state', { headers: { Authorization: 'Bearer 2.' + key.split('.')[1] } })).status, 401);
  const overlay = await fetch(origin + '/stream/overlay'); assert.match(overlay.headers.get('content-security-policy'), /default-src 'none'/);
  await i.handleInteraction(interaction('stream', 'overlayneu')); assert.equal((await fetch(origin + '/stream/state', { headers: { Authorization: 'Bearer ' + key } })).status, 401);
  assert.equal((await fetch(origin + '/stream/oauth/callback?state=bad&code=bad')).status, 400);
});
test('command definitions serialize using installed discord.js; template expansion is bounded', () => {
  const { SlashCommandBuilder } = require('discord.js');
  for (const cmd of commands()) {
    const b = new SlashCommandBuilder().setName(cmd.name).setDescription(cmd.description);
    for (const sub of cmd.options) b.addSubcommand(s => {
      s.setName(sub.name).setDescription(sub.description);
      for (const o of sub.options) {
        const method = { 3: 'addStringOption', 4: 'addIntegerOption', 7: 'addChannelOption', 8: 'addRoleOption' }[o.type];
        s[method](v => { v.setName(o.name).setDescription(o.description).setRequired(Boolean(o.required)); if (o.max_length) v.setMaxLength(o.max_length); if (o.min_value) v.setMinValue(o.min_value).setMaxValue(o.max_value); return v; });
      } return s;
    });
    assert.equal(b.toJSON().options.length, cmd.options.length);
  }
  assert.equal(format('{name} {url}', { user_name: 'U', user_login: 'unfug' }), 'U https://www.twitch.tv/unfug');
});
test('OAuth state is one-use and scoped to configured guild/channel', async t => {
  let authorizations = [];
  const { integration: i } = setup(t, { twitch: { authorize: async (...args) => { authorizations.push(args); } } });
  const input = interaction('stream','verbinden'); await i.handleInteraction(input);
  const link = input.result.content.match(/https:\/\/id\.twitch\.tv\/[^\s]+/)[0];
  const state = new URL(link).searchParams.get('state');
  const callback = () => new Promise(resolve => {
    const res = { writeHead(code) { this.code=code; }, end(body) { resolve({ code:this.code,body }); } };
    i.handleHttp({method:'GET',url:'/stream/oauth/callback?state='+state+'&code=fake',headers:{}},res);
  });
  assert.equal((await callback()).code,200); assert.equal((await callback()).code,400);
  assert.equal(authorizations.length,1); assert.equal(authorizations[0][0],'1'); assert.equal(authorizations[0][3],'unfug');
});
test('bad stream setup cannot stop community bot startup; unknown HTTP error gives generic response', t => {
  const disabled = createIntegration({ storageDir: temp(t), env: {STREAM_ENABLED:'true',PUBLIC_URL:'http://invalid'} });
  assert.deepEqual(disabled.commands(),[]);
  const {integration:i} = setup(t); const key = '1.'+i.store.guild('1').overlayKey;
  i.store.publicState = () => {throw new Error('private test detail');};
  const res = {writeHead(code){this.code=code;},end(body){this.body=body;}};
  assert.equal(i.handleHttp({method:'GET',url:'/stream/state',headers:{authorization:'Bearer '+key}},res),true);
  assert.equal(res.code,503); assert.equal(res.body,'Stream unavailable');
});
test('winner overlay can be hidden without deleting participants; a new round becomes visible', async t => {
  const {integration:i}=setup(t);i.store.create('1','Test',1,1);i.store.join('unfug','42','viewer');i.store.draw('1');
  await i.handleInteraction(interaction('streamgiveaway','ausblenden'));
  assert.equal(i.store.publicState('1',true).giveaway,null);assert.equal(i.store.guild('1').giveaway.winners[0].login,'viewer');
  i.store.create('1','Next',1,1);assert.equal(i.store.publicState('1',true).giveaway.prize,'Next');
});
