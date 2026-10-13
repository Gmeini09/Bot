'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { Collection, PermissionsBitField, PermissionFlagsBits: P, ChannelType, EmbedBuilder } = require('discord.js');
const { createRequestService, extractNvePreviews, extractReviews, verifyRequestSignature, validateRequest, assertPrivateChannel } = require('./website-feed');
const { createSellingOrderService, ShopRequestError } = require('./selling-order-service');

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
    const channel = { id, name, topic, guild, isTextBased: () => true, permissionOverwrites: { cache }, messages: { fetch: async value => typeof value === 'string' ? messages.get(value) : messages }, permissionsFor: entity => {
      if (entity.id === me.id || entity.permissions?.has(P.Administrator)) return permissions([P.ViewChannel, P.SendMessages, P.EmbedLinks]);
      if (options.publicInternal && name === '🤝・partner-anfragen' && entity.id === guildId) return permissions([P.ViewChannel]);
      return cache.get(entity.id)?.allow || permissions([]);
    }, send: async data => {
      const embeds = data.embeds.map(embed => embed.toJSON ? embed.toJSON() : embed);
      sent.push({ channel, data: { ...data, embeds } });
      const message = { id: `15504705653645${String(sent.length).padStart(5, '0')}`, author: { id: me.id }, embeds };
      messages.set(message.id, message);
      return message;
    } };
    return channel;
  }
  channels.set('category', { id: '1550470565364506600', name: '┣━━〔 TICKETS 〕━━┫', type: ChannelType.GuildCategory });
  channels.set('internal', textChannel('1550470565364506601', '📦・bestellungen', [{ id: owner.id, allow: [P.ViewChannel] }, { id: management.id, allow: [P.ViewChannel] }]));
  channels.set('partner', textChannel('1550470565364506602', '🤝・partner-anfragen', [{ id: owner.id, allow: [P.ViewChannel] }, { id: management.id, allow: [P.ViewChannel] }]));
  guild.channels = { cache: channels, fetch: async id => id ? channels.find(channel => channel.id === id) : channels, create: async config => {
    if (options.failCreateOnce) { options.failCreateOnce=false; throw new Error('Simulated Discord timeout'); }
    created.push(config);
    const overwrites = [...config.permissionOverwrites];
    if (options.leakyTicket) overwrites.push({ id: customer.id, allow: [P.ViewChannel] });
    const channel = textChannel(`15504705653646${String(created.length).padStart(5, '0')}`, config.name, overwrites, config.topic);
    channels.set(channel.id, channel);
    return channel;
  } };
  const client = { isReady: () => true, guilds: { fetch: async () => guild }, application: { id: env.DISCORD_CLIENT_ID }, user: { id: me.id } };
  const data = { orders: {}, partnerApplications: {}, blacklist: {}, config: { availability: 'open' }, nextOrder: 1, nextPartner: 1 };
  const locks = new Set(), workflow = [];
  const native = createSellingOrderService({
    products: { thumbnail: { label: 'Thumbnail', etaDays: 2, revisions: 1 }, sptool: { label: 'Soundpack Tool', etaDays: 1, revisions: 0 } },
    ordersCategory: 'tickets', findSellingCategory: () => channels.get('category'),
    getGuildShopData: () => ({ store: data, data }), saveSellingStore: () => {},
    acquireSellingActionLock: key => !locks.has(key) && (locks.add(key), true), releaseSellingActionLock: key => locks.delete(key),
    consumeSellingRateLimit: () => !options.rateLimited, productConfig: () => ({ enabled: !options.productDisabled }),
    getDiscountCodeState: () => ({}), loyaltyForUser: () => ({ discount: 0 }),
    nextOrderId: () => `UF-${String(data.nextOrder++).padStart(4,'0')}`, nextAdvancedId: () => `PA-${data.nextPartner++}`,
    parseDeadlineToTimestamp: () => null, sanitizeName: value => value,
    sellingOrderTicketOverwrites: () => [
      { id: guildId, deny: [P.ViewChannel] }, { id: userId, allow: [P.ViewChannel,P.SendMessages] },
      ...[owner,management,support,designer].map(role => ({ id: role.id, allow: [P.ViewChannel,P.SendMessages] })),
    ],
    configuredOrderPrice: () => 0, calculateOrderFinalPrice: order => order.basePrice,
    orderInfoEmbed: order => new EmbedBuilder().setTitle(`Bestellung ${order.id}`).addFields(
      { name: 'Kunde', value: `<@${order.userId}>` }, { name: 'Preis', value: `${order.finalPrice.toFixed(2).replace('.',',')} €` },
    ),
    assertPrivateOrderChannel: channel => assertPrivateChannel(channel,guild,[owner,management,support,designer],member,me),
    assertPrivatePartnerChannel: channel => assertPrivateChannel(channel,guild,[owner,management],null,me),
    automateNewOrder: async (guild,data,order) => { order.assignedTo=designer.id; workflow.push('assign'); },
    syncOrderWorkflow: async (guild,data,order,channel) => { workflow.push('sync'); },
    notifyNewOrder: async () => { workflow.push('notify'); }, refreshOrderStatusPanel: async () => { workflow.push('status'); },
    logSelling: async () => {}, queueInfoForOrder: () => ({ position: null }),
    findSellingTextChannel: (guild,name) => channels.find(channel => channel.name === name),
    shopEmbed: (title,description) => new EmbedBuilder().setTitle(title).setDescription(description),
  });
  client.__turboSellingWebsite = {
    ready: () => native.ready(guild),
    createRequest: async (request,fingerprint) => {
      const verified = await guild.members.fetch(request.discordUserId).catch(() => null);
      if (!verified) throw new ShopRequestError('JOIN_REQUIRED');
      return native.createWebsiteRequest(guild,verified.user,request,fingerprint);
    },
  };
  const service = createRequestService(() => client, { env, directory, fetchImpl: options.fetchImpl });
  return { service, native, data, workflow, client, guild, created, sent, channels, directory, roles: { owner, management, support, designer, customer }, member, me };
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
  assert.match(mock.created[0].name, /^uf-0001-thumbnail-actual-discord-name/);
  assert.equal(mock.created[0].parent, '1550470565364506600');
  const overwrites = mock.created[0].permissionOverwrites;
  assert.ok(overwrites.find(o => o.id === guildId).deny.includes(P.ViewChannel));
  assert.ok(overwrites.find(o => o.id === userId).allow.includes(P.ViewChannel));
  assert.equal(overwrites.some(o => o.id === mock.roles.customer.id), false);
  const customerField = mock.sent[0].data.embeds[0].fields.find(field => field.name === 'Kunde').value;
  assert.match(customerField, new RegExp(userId));
  assert.doesNotMatch(customerField, /browser supplied name/);
  const saved = mock.data.orders['UF-0001'];
  assert.equal(saved.source, 'website');
  assert.equal(saved.userId, userId);
  assert.equal(saved.assignedTo, mock.roles.designer.id);
  assert.ok(saved.creationCompletedAt);
  assert.deepEqual(mock.workflow, ['assign','sync','notify','status']);
  const ids = mock.sent[0].data.components.flatMap(row => row.toJSON().components.map(component => component.custom_id));
  assert.equal(ids.length, 11);
  assert.ok(ids.includes('selling_claim:UF-0001'));
  assert.ok(ids.includes('selling_deliver_start:UF-0001'));
  assert.ok(ids.includes('selling_close:UF-0001'));
  assert.ok(ids.every(id => id.startsWith('selling_')));
  assert.match(response.body.reference, /^WEB-[A-F0-9]{8}$/);
});

test('partnerships enter the native staff inbox and registry without exposing its URL', async t => {
  const mock = setup(t);
  const response = await call(mock.service, '/turbo-website-requests', request({ product: 'partnership', project: 'Community partnership proposal' }));
  assert.equal(response.status, 200);
  assert.equal(mock.created.length, 0);
  assert.equal(mock.sent[0].channel.name, '🤝・partner-anfragen');
  assert.equal(mock.sent[0].data.embeds[0].title, '🤝 Partnerschaft PA-1');
  assert.equal(mock.data.partnerApplications['PA-1'].userId, userId);
  assert.equal(mock.data.partnerApplications['PA-1'].status, 'pending');
  assert.equal(response.body.requestType, 'partnership');
  assert.equal(response.body.ticketUrl, undefined);
});

test('Soundpack Tool prices are assigned by the bot for all three plans', async t => {
  const mock = setup(t);
  for (const [plan, price] of [['week', '10,00 €'], ['month', '15,00 €'], ['lifetime', '20,00 €']]) {
    const response = await call(mock.service, '/turbo-website-requests', request({ product: 'soundpack-tool', plan, price: 0.01 }));
    assert.equal(response.status, 200);
    assert.equal(mock.sent.at(-1).data.embeds[0].fields.find(field => field.name === 'Preis').value, price);
    assert.equal(Object.values(mock.data.orders).at(-1).productKey, 'sptool');
    Object.values(mock.data.orders).at(-1).closedAt = Date.now();
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

test('an open native order is reused as the next step instead of creating another ticket', async t => {
  const mock = setup(t);
  const first = await call(mock.service, '/turbo-website-requests', request());
  const second = await call(mock.service, '/turbo-website-requests', request());
  assert.equal(mock.created.length, 1);
  assert.equal(second.status, 409);
  assert.equal(second.body.error, 'ORDER_EXISTS');
  assert.equal(first.body.ticketUrl, second.body.ticketUrl);
});

test('non-members must join before an order ticket is created', async t => {
  const mock = setup(t, { nonMember: true });
  const response = await call(mock.service, '/turbo-website-requests', request());
  assert.equal(response.status, 409);
  assert.equal(response.body.error, 'JOIN_REQUIRED');
  assert.equal(mock.created.length, 0);
});

test('Discord checkout and website checkout share the native order registry and controls', async t => {
  const mock = setup(t);
  const native = await mock.native.createOrder({ guild: mock.guild, user: mock.member.user, productKey: 'thumbnail', input: { details: 'Discord checkout brief' } });
  assert.equal(native.reference, 'UF-0001');
  assert.equal(mock.data.orders[native.reference].source, undefined);
  const web = await call(mock.service, '/turbo-website-requests', request());
  assert.equal(web.body.error, 'ORDER_EXISTS');
  assert.equal(web.body.ticketUrl, native.ticketUrl);
  assert.equal(mock.created.length, 1);
});

test('native admission checks block closed, disabled, blacklisted and rate-limited orders', async t => {
  for (const [kind, expected] of [['closed','SHOP_CLOSED'],['disabled','PRODUCT_UNAVAILABLE'],['blocked','BLACKLISTED'],['rate','RATE_LIMIT']]) {
    const mock = setup(t, { productDisabled: kind==='disabled', rateLimited: kind==='rate' });
    if (kind==='closed') mock.data.config.availability='closed';
    if (kind==='blocked') mock.data.blacklist[userId]={reason:'test'};
    const response = await call(mock.service, '/turbo-website-requests', request());
    assert.equal(response.status, kind==='rate'?429:409);
    assert.equal(response.body.error, expected);
    assert.equal(mock.created.length, 0);
    assert.equal(mock.sent.length, 0);
  }
});

test('a failed Discord channel creation resumes the reserved native order on retry', async t => {
  const mock = setup(t, { failCreateOnce: true }), data=request();
  const failed = await call(mock.service, '/turbo-website-requests', data);
  assert.equal(failed.status, 503);
  assert.equal(Object.keys(mock.data.orders).length, 1);
  assert.equal(mock.created.length, 0);
  const retry = await call(mock.service, '/turbo-website-requests', data);
  assert.equal(retry.status, 200);
  assert.equal(Object.keys(mock.data.orders).length, 1);
  assert.equal(mock.created.length, 1);
  assert.equal(mock.sent.length, 1);
});

test('receipt recovery keeps the native order after workflow updates and a lost message pointer', async t => {
  const mock = setup(t), data=request();
  const first = await call(mock.service, '/turbo-website-requests', data);
  const saved = mock.data.orders['UF-0001'], channel=mock.channels.get(saved.channelId);
  channel.topic=`selling-owner:${userId}|selling-kind:order|selling-order:${saved.id}|selling-product:thumbnail|selling-status:processing|website-request:${data.requestId}|website-fingerprint:${saved.websiteFingerprint}|`;
  saved.initialMessageId=null;
  fs.unlinkSync(path.join(mock.directory,'website-request-receipts.json'));
  const restarted = createRequestService(() => mock.client, { env, directory: mock.directory });
  const retry = await call(restarted, '/turbo-website-requests', data);
  assert.deepEqual(retry.body, first.body);
  assert.equal(mock.created.length, 1);
  assert.equal(mock.sent.length, 1);
  assert.deepEqual(mock.workflow,['assign','sync','notify','status']);
});

test('public or leaky channels fail closed without sending order details', async t => {
  for (const options of [{ publicInternal: true }, { leakyTicket: true }]) {
    const mock = setup(t, options);
    const response = await call(mock.service, '/turbo-website-requests', request(options.publicInternal ? { product: 'partnership' } : {}));
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

const reviewChannelId = '1550121564870025398';
function publishedReview(overrides = {}, embedOverrides = {}) {
  return {
    id: '1550470513070178399', author: { id: env.DISCORD_CLIENT_ID, bot: true }, createdTimestamp: Date.UTC(2026, 9, 10, 12),
    embeds: [{ title: '⭐⭐⭐⭐⭐ Verifizierte Bewertung', footer: { text: 'Turbo Designs • Verifizierter Kauf' },
      description: 'Schnelle Umsetzung und tolles Ergebnis!', author: { name: 'Creator.One', iconURL: 'https://avatar.invalid/private.png' },
      fields: [{ name: 'Bewertung', value: '**5/5**' }, { name: 'Produkt', value: '🖼️ Thumbnail' }, { name: 'Bestellung', value: '`UF-0042`' }],
      ...embedOverrides }], ...overrides,
  };
}

test('public reviews expose only actual native published review fields', () => {
  const reviews = extractReviews([publishedReview()], guildId, reviewChannelId, env.DISCORD_CLIENT_ID);
  assert.deepEqual(reviews, [{ text: 'Schnelle Umsetzung und tolles Ergebnis!', rating: 5, authorDisplayName: 'Creator.One', date: '2026-10-10T12:00:00.000Z',
    messageUrl: `https://discord.com/channels/${guildId}/${reviewChannelId}/1550470513070178399`, productKey: 'thumbnail' }]);
  assert.doesNotMatch(JSON.stringify(reviews), /UF-0042|avatar\.invalid|userId|orderId|iconURL/);
});

test('review extraction ignores arbitrary text, impostors, webhooks, private channels and invalid native markers', () => {
  const invalid = [
    publishedReview({ author: { id: userId, bot: false } }),
    publishedReview({ author: { id: env.DISCORD_CLIENT_ID, bot: false } }),
    publishedReview({ webhookId: '1550470999999999999' }),
    publishedReview({ embeds: [], content: '⭐⭐⭐⭐⭐ fake customer review' }),
    publishedReview({}, { title: 'Bestellübersicht' }),
    publishedReview({}, { footer: { text: 'Turbo Designs • Order Center' } }),
    publishedReview({}, { fields: [{ name: 'Bewertung', value: '**4/5**' }] }),
    publishedReview({}, { author: { name: '' } }),
    publishedReview({ createdTimestamp: NaN }),
    publishedReview({ createdTimestamp: Date.now() + 600000 }),
  ];
  assert.deepEqual(extractReviews(invalid, guildId, reviewChannelId, env.DISCORD_CLIENT_ID), []);
  assert.deepEqual(extractReviews([publishedReview()], guildId, '1550470565364506694', env.DISCORD_CLIENT_ID), []);
  assert.deepEqual(extractReviews([publishedReview()], '999999999999999999', reviewChannelId, env.DISCORD_CLIENT_ID), []);
});

test('review plain text is bounded and removes mentions, order references, tokens, emails and markup', () => {
  const description = '**Sehr gut!** <@697402284849627180> UF-0042 LIC-UF-0042-0001-SECRET test@example.com https://evil.invalid/?token=private <b>Danke</b> ' + 'a'.repeat(500);
  const reviews = extractReviews([publishedReview({}, { description })], guildId, reviewChannelId, env.DISCORD_CLIENT_ID);
  assert.equal(reviews.length, 1);
  assert.ok(reviews[0].text.length <= 320);
  assert.match(reviews[0].text, /^Sehr gut! Danke /);
  assert.doesNotMatch(reviews[0].text, /697402284849627180|UF-0042|LIC-|SECRET|example\.com|evil\.invalid|<|\*/);
});

test('reviews deduplicate publication links and do not misclassify mixed product bundles', () => {
  const mixed = publishedReview({}, { fields: [{ name: 'Bewertung', value: '**5/5**' }, { name: 'Produkt', value: '🛒 Thumbnail + Soundpack' }] });
  const review = extractReviews([mixed, mixed], guildId, reviewChannelId, env.DISCORD_CLIENT_ID);
  assert.equal(review.length, 1);
  assert.equal(review[0].productKey, undefined);
  const messages = Array.from({ length: 15 }, (_, index) => publishedReview({ id: String(1550470513070178400n + BigInt(index)) }));
  assert.equal(extractReviews(messages, guildId, reviewChannelId, env.DISCORD_CLIENT_ID).length, 12);
});
