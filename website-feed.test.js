'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { Collection, PermissionsBitField, PermissionFlagsBits: P, ChannelType } = require('discord.js');
const { createRequestService, extractNvePreviews, verifyRequestSignature, validateRequest } = require('./website-feed');

const guildId = '1531989453168578650';
const userId = '697402284849627180';
const callback = 'https://turbodesigns.net/auth/discord/callback';
const env = { WEBSITE_REQUEST_SECRET: 'test-website-secret-with-at-least-32-characters', DISCORD_CLIENT_ID: '1540161502856740914', DISCORD_CLIENT_SECRET: 'only-for-tests-secret' };
const request = (extra = {}) => ({ requestId: crypto.randomUUID(), product: 'thumbnail', contact: 'browser supplied name', discordUserId: userId, project: 'A thumbnail with blue lettering', ...extra });
const permissions = flags => new PermissionsBitField(flags);

function signature(method, route, raw, stamp = String(Date.now())) {
  return { 'x-turbo-timestamp': stamp, 'x-turbo-signature': crypto.createHmac('sha256', env.WEBSITE_REQUEST_SECRET).update(`${stamp}:${method}:${route}:${raw}`).digest('hex') };
}
async function call(service, route, data, settings = {}) {
  const method = settings.method || (data === undefined ? 'GET' : 'POST');
  const raw = data === undefined ? '' : typeof data === 'string' ? data : JSON.stringify(data);
  const req = Readable.from([Buffer.from(raw)]);
  req.method = method;
  req.headers = settings.unsigned ? {} : signature(method, settings.signedRoute || route, raw, settings.stamp);
  let status, response, headers;
  const res = { writeHead(code, value) { status = code; headers = value; }, end(body) { response = JSON.parse(body); } };
  await (route === '/turbo-website-oauth' ? service.handleWebsiteOAuth : service.handleWebsiteRequest)(req, res);
  return { status, body: response, headers };
}

function setup(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'turbo-website-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const role = (id, name, flags = []) => ({ id, name, permissions: permissions(flags) });
  const everyone = role(guildId, '@everyone');
  const owner = role('1531994258691588177', '👑・INHABER', [P.Administrator]);
  const management = role('1531994258691588178', '⚜️・MANAGEMENT');
  const support = role('1531994258691588179', '🎫・SUPPORT');
  const designer = role('1531994258691588180', '🎨・DESIGNER');
  const customer = role('1531994258691588181', '💎・KUNDE');
  const roles = new Collection([everyone, owner, management, support, designer, customer].map(r => [r.id, r]));
  const member = { id: userId, user: { id: userId, username: 'actual-discord-name', bot: false } };
  const me = { id: env.DISCORD_CLIENT_ID, user: { id: env.DISCORD_CLIENT_ID, username: 'bot', bot: true }, permissions: permissions([P.ManageChannels]) };
  const channels = new Collection();
  const created = [], sent = [];
  const guild = { id: guildId, roles: { everyone, cache: roles, fetch: async () => roles }, members: { me, fetchMe: async () => me, fetch: async id => {
    if (options.nonMember || id !== userId) throw new Error('Unknown member');
    return member;
  } } };
  function textChannel(id, name, overwrites = [], topic) {
    const cache = new Collection(overwrites.map(o => [o.id, { id: o.id, type: roles.has(o.id) ? 0 : 1, allow: permissions(o.allow || []), deny: permissions(o.deny || []) }]));
    const messages = new Collection();
    const channel = { id, name, topic, guild, isTextBased: () => true, permissionOverwrites: { cache }, messages: { fetch: async () => messages }, permissionsFor: entity => {
      if (entity.id === me.id || entity.permissions?.has(P.Administrator)) return permissions([P.ViewChannel, P.SendMessages, P.EmbedLinks]);
      if (options.publicInternal && name === '📦・bestellungen' && entity.id === guildId) return permissions([P.ViewChannel]);
      return cache.get(entity.id)?.allow || permissions([]);
    }, send: async data => {
      sent.push({ channel, data });
      const message = { id: `15504705653645${String(sent.length).padStart(5, '0')}`, author: { id: me.id }, embeds: data.embeds };
      messages.set(message.id, message);
      return message;
    } };
    return channel;
  }
  channels.set('category', { id: '1550470565364506600', name: '┣━━〔 TICKETS 〕━━┫', type: ChannelType.GuildCategory });
  channels.set('internal', textChannel('1550470565364506601', '📦・bestellungen', [{ id: owner.id, allow: [P.ViewChannel] }, { id: management.id, allow: [P.ViewChannel] }]));
  guild.channels = { fetch: async () => channels, create: async config => {
    created.push(config);
    const overwrites = [...config.permissionOverwrites];
    if (options.leakyTicket) overwrites.push({ id: customer.id, allow: [P.ViewChannel] });
    const channel = textChannel(`15504705653646${String(created.length).padStart(5, '0')}`, config.name, overwrites, config.topic);
    channels.set(channel.id, channel);
    return channel;
  } };
  const client = { isReady: () => true, guilds: { fetch: async () => guild }, application: { id: env.DISCORD_CLIENT_ID }, user: { id: me.id } };
  const service = createRequestService(() => client, { env, directory, fetchImpl: options.fetchImpl });
  return { service, client, guild, created, sent, channels, directory, roles: { owner, management, support, designer, customer }, member, me };
}

test('signatures bind the timestamp, HTTP method, endpoint and exact body', () => {
  const raw = '{"code":"example-test-code"}', stamp = String(Date.now());
  const req = { method: 'POST', headers: signature('POST', '/turbo-website-oauth', raw, stamp) };
  assert.equal(verifyRequestSignature(req, raw, '/turbo-website-oauth', env), true);
  assert.equal(verifyRequestSignature(req, raw + ' ', '/turbo-website-oauth', env), false);
  assert.equal(verifyRequestSignature(req, raw, '/turbo-website-requests', env), false);
  assert.equal(verifyRequestSignature({ ...req, method: 'GET' }, raw, '/turbo-website-oauth', env), false);
  assert.equal(verifyRequestSignature(req, raw, '/turbo-website-oauth', env, Number(stamp) + 60001), false);
});

test('unsigned requests cannot exchange OAuth codes or create tickets', async t => {
  let calls = 0;
  const mock = setup(t, { fetchImpl: async () => { calls++; throw new Error('Unexpected call'); } });
  assert.equal((await call(mock.service, '/turbo-website-oauth', { code: 'example-test-code', redirectUri: callback }, { unsigned: true })).status, 401);
  assert.equal((await call(mock.service, '/turbo-website-requests', request(), { unsigned: true })).status, 401);
  assert.equal(calls, 0);
  assert.equal(mock.created.length, 0);
});

test('OAuth GET returns actual public application config without the secret', async t => {
  const mock = setup(t);
  const response = await call(mock.service, '/turbo-website-oauth');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { ready: true, clientId: env.DISCORD_CLIENT_ID, redirectUri: callback });
  assert.equal(JSON.stringify(response).includes(env.DISCORD_CLIENT_SECRET), false);
});

test('OAuth exchange looks up the user and never returns user or client tokens', async t => {
  const calls = [];
  const mock = setup(t, { fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => url.endsWith('/token') ? { access_token: 'private-discord-access-token', refresh_token: 'private-refresh-token', token_type: 'Bearer', scope: 'identify' } : { id: userId, username: 'actual-discord-name', global_name: 'Actual name', avatar: 'abc123' } };
  } });
  const response = await call(mock.service, '/turbo-website-oauth', { code: 'example-test-code', redirectUri: callback });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { ok: true, user: { id: userId, username: 'actual-discord-name', globalName: 'Actual name', avatar: 'abc123' } });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.body.get('client_secret'), env.DISCORD_CLIENT_SECRET);
  assert.equal(calls[0].options.body.get('redirect_uri'), callback);
  assert.equal(calls[1].options.headers.Authorization, 'Bearer private-discord-access-token');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[1].options.redirect, 'error');
  assert.doesNotMatch(JSON.stringify(response), /secret|access-token|refresh-token/);
});

test('OAuth refuses an arbitrary redirect URL before contacting Discord', async t => {
  let calls = 0;
  const mock = setup(t, { fetchImpl: async () => { calls++; } });
  const response = await call(mock.service, '/turbo-website-oauth', { code: 'example-test-code', redirectUri: 'https://other-site.invalid/callback' });
  assert.equal(response.status, 400);
  assert.equal(calls, 0);
});

test('failed OAuth token exchange produces a generic authentication error', async t => {
  const mock = setup(t, { fetchImpl: async () => ({ ok: false, status: 400 }) });
  const response = await call(mock.service, '/turbo-website-oauth', { code: 'example-test-code', redirectUri: callback });
  assert.deepEqual(response, { status: 401, body: { ok: false, error: 'AUTH_FAILED' }, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
});

test('orders require a verified identity and reject unavailable products and invalid tool plans', async t => {
  const mock = setup(t);
  for (const data of [request({ discordUserId: '' }), request({ product: 'weapon-tool' }), request({ product: 'soundpack-tool', plan: 'year' }), request({ plan: 'week' })]) {
    assert.ok((await call(mock.service, '/turbo-website-requests', data)).status >= 400);
  }
  assert.equal(mock.created.length, 0);
  assert.throws(() => validateRequest(request({ requestId: '------------------------------------' })), /INVALID_REQUEST/);
});

test('an order creates a personal Bestellticket with only the customer and authorized team', async t => {
  const mock = setup(t);
  const response = await call(mock.service, '/turbo-website-requests', request());
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.match(response.body.ticketUrl, /^https:\/\/discord\.com\/channels\/1531989453168578650\/\d+$/);
  assert.match(mock.created[0].name, /^bestellung-actual-discord-name-/);
  assert.equal(mock.created[0].parent, '1550470565364506600');
  const overwrites = mock.created[0].permissionOverwrites;
  assert.ok(overwrites.find(o => o.id === guildId).deny.includes(P.ViewChannel));
  assert.ok(overwrites.find(o => o.id === userId).allow.includes(P.ViewChannel));
  assert.equal(overwrites.some(o => o.id === mock.roles.customer.id), false);
  const customerField = mock.sent[0].data.embeds[0].fields.find(field => field.name === 'Kunde').value;
  assert.match(customerField, /actual-discord-name/);
  assert.doesNotMatch(customerField, /browser supplied name/);
});

test('partnership ticket is limited to the applicant, bot, management and owner', async t => {
  const mock = setup(t);
  const response = await call(mock.service, '/turbo-website-requests', request({ product: 'partnership', project: 'Community partnership proposal' }));
  assert.equal(response.status, 200);
  assert.match(mock.created[0].name, /^partnerschaft-/);
  assert.equal(mock.created[0].permissionOverwrites.some(o => o.id === mock.roles.support.id || o.id === mock.roles.designer.id), false);
  assert.equal(mock.sent[0].data.embeds[0].title, 'Neue Partnerschaftsanfrage');
});

test('Soundpack Tool prices are assigned by the bot for all three plans', async t => {
  const mock = setup(t);
  for (const [plan, price] of [['week', '10,00 €'], ['month', '15,00 €'], ['lifetime', '20,00 €']]) {
    const response = await call(mock.service, '/turbo-website-requests', request({ product: 'soundpack-tool', plan, price: 0.01 }));
    assert.equal(response.status, 200);
    assert.equal(mock.sent.at(-1).data.embeds[0].fields.find(field => field.name === 'Preis').value, price);
  }
});

test('concurrent duplicate submissions and retries after restart create one channel and message', async t => {
  const mock = setup(t), data = request();
  const results = await Promise.all([call(mock.service, '/turbo-website-requests', data), call(mock.service, '/turbo-website-requests', data)]);
  assert.deepEqual(results[0].body, results[1].body);
  assert.equal(mock.created.length, 1);
  assert.equal(mock.sent.length, 1);
  const restarted = createRequestService(() => mock.client, { env, directory: mock.directory });
  assert.deepEqual((await call(restarted, '/turbo-website-requests', data)).body, results[0].body);
  assert.equal(mock.sent.length, 1);
  // Simulate a crash between the Discord send and saving the receipt.
  fs.unlinkSync(path.join(mock.directory, 'website-request-receipts.json'));
  const recovering = createRequestService(() => mock.client, { env, directory: mock.directory });
  assert.deepEqual((await call(recovering, '/turbo-website-requests', data)).body, results[0].body);
  assert.equal(mock.created.length, 1);
  assert.equal(mock.sent.length, 1);
});

test('a lost receipt does not allow changing the original tool plan or project', async t => {
  const mock = setup(t), data = request({ product: 'soundpack-tool', plan: 'week' });
  assert.equal((await call(mock.service, '/turbo-website-requests', data)).status, 200);
  fs.unlinkSync(path.join(mock.directory, 'website-request-receipts.json'));
  const restarted = createRequestService(() => mock.client, { env, directory: mock.directory });
  assert.equal((await call(restarted, '/turbo-website-requests', { ...data, plan: 'lifetime' })).status, 400);
  assert.equal((await call(restarted, '/turbo-website-requests', { ...data, project: 'Different project' })).status, 400);
  assert.equal(mock.created.length, 1);
  assert.equal(mock.sent.length, 1);
});

test('a request ID cannot be reused for another owner or changed order details', async t => {
  const mock = setup(t), data = request();
  assert.equal((await call(mock.service, '/turbo-website-requests', data)).status, 200);
  assert.equal((await call(mock.service, '/turbo-website-requests', { ...data, discordUserId: '123456789012345678' })).status, 400);
  assert.equal((await call(mock.service, '/turbo-website-requests', { ...data, project: 'A different order' })).status, 400);
  assert.equal(mock.sent.length, 1);
});

test('each different order gets its own ticket', async t => {
  const mock = setup(t);
  const first = await call(mock.service, '/turbo-website-requests', request());
  const second = await call(mock.service, '/turbo-website-requests', request());
  assert.equal(mock.created.length, 2);
  assert.notEqual(first.body.ticketUrl, second.body.ticketUrl);
});

test('non-members must join before an order ticket is created', async t => {
  const mock = setup(t, { nonMember: true });
  const response = await call(mock.service, '/turbo-website-requests', request());
  assert.equal(response.status, 409);
  assert.equal(response.body.error, 'JOIN_REQUIRED');
  assert.equal(mock.created.length, 0);
});

test('public or leaky channels fail closed without sending order details', async t => {
  for (const options of [{ publicInternal: true }, { leakyTicket: true }]) {
    const mock = setup(t, options);
    const response = await call(mock.service, '/turbo-website-requests', request());
    assert.equal(response.status, 409);
    assert.equal(response.body.error, 'TICKET_UNAVAILABLE');
    assert.equal(mock.sent.length, 0);
  }
});

test('NVE previews accept only safe Discord image/video attachments and deduplicate embeds', () => {
  const cdn = 'https://cdn.discordapp.com/attachments/1550470513070178374/1550470513070178375/';
  const image = cdn + 'preset.png';
  const items = extractNvePreviews([{ id: '1550470513070178376', attachments: new Collection([
    ['image', { id: 'image', url: image, name: 'preset.png', contentType: 'image/png' }],
    ['video', { id: 'video', url: cdn + 'preview.mp4', name: 'preview.mp4', contentType: 'video/mp4' }],
    ['private', { id: 'private', url: cdn + 'hidden.png', name: 'hidden.png', spoiler: true }],
    ['external', { id: 'external', url: 'https://other-site.invalid/image.png', name: 'image.png' }],
    ['archive', { id: 'archive', url: cdn + 'preset.zip', name: 'preset.zip' }]
  ]), embeds: [{ image: { url: image } }] }], guildId, '1550470513070178374');
  assert.equal(items.length, 2);
  assert.deepEqual(items.map(item => item.kind), ['image', 'video']);
  assert.equal(items[0].image, image);
  assert.ok(items[1].url.endsWith('preview.mp4'));
  assert.match(items[0].messageUrl, /1550470513070178374\/1550470513070178376$/);
});
