'use strict';
// End-to-end flows on a simulated server: setup → verify → ticket → shop order → moderation/automod.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeWorld, interaction, lastText } = require('./fake');
const { Store } = require('../src/store');
const setup = require('../src/setup');
const verify = require('../src/verify');
const tickets = require('../src/tickets');
const shop = require('../src/shop');
const moderation = require('../src/moderation');
const config = require('../src/config');
const adopt = require('../src/adopt');

function makeCtx(world) {
  const store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'xvy-flow-')));
  const logs = [];
  const ctx = {
    client: world.client, store, logs, verify, tickets, shop,
    async log(guild, e) { logs.push(e); },
    async refreshPanels(guild, g) { await setup.postAll(guild, g, ctx); },
  };
  return ctx;
}
const customIds = (payload) => JSON.stringify(payload.components || []).match(/"custom_id":"[^"]+"/g) || [];

/** A server like XVY Imerpium: own roles and channels, plus what the first /setup version left behind. */
async function ownServer(world, ctx) {
  const G = world.guild;
  const mk = (name, type = 0, parent) => G.channels.create({ name, type, parent });
  const role = (name, position) => G.roles.create({ name }).then((r) => { r.position = position; return r; });
  const own = {
    founder: await role('・FOUNDER 𓇻', 30), owner: await role('・OWNER 𓇻', 29), gg: await role('・.gg/xvy 𓇻', 10),
    shopCat: await mk('।︱Shop︱।', 4), modOnly: await mk('mod-only'),
  };
  Object.assign(own, { welcome: await mk('✋┇wilkommen'), rules: await mk('📋┇rules'), infos: await mk('❗┇infos', 0, own.shopCat.id), wishes: await mk('🥳┇wünsche', 0, own.shopCat.id) });
  const g = ctx.store.guild(G.id);
  const oldStart = await mk('📌 START', 4), oldTeamCat = await mk('🔒 TEAM', 4), oldShopCat = await mk('🛒 SHOP', 4);
  const old = {
    team: await G.roles.create({ name: '🛡️ Team' }), member: await G.roles.create({ name: '✅ Mitglied' }), kunde: await G.roles.create({ name: '💎 Kunde' }),
    welcome: await mk('👋・willkommen', 0, oldStart.id), verify: await mk('✅・verifizieren', 0, oldStart.id), shop: await mk('🛍️・shop', 0, oldShopCat.id),
    support: await mk('🎫・support', 0, oldShopCat.id), modLog: await mk('🛡️・mod-log', 0, oldTeamCat.id), ticketLog: await mk('📁・ticket-log', 0, oldTeamCat.id),
    tickets: await mk('🎫 TICKETS', 4), orders: await mk('📦 BESTELLUNGEN', 4), oldStart, oldTeamCat, oldShopCat,
  };
  own.userInOldCat = await mk('mein-kanal', 0, oldShopCat.id); // an own channel in an old category keeps the category
  Object.assign(g.config, {
    staffRoleIds: [old.team.id], memberRoleId: old.member.id, customerRoleId: old.kunde.id,
    welcomeChannelId: old.welcome.id, verifyChannelId: old.verify.id, shopChannelId: old.shop.id, supportChannelId: old.support.id,
    modLogChannelId: old.modLog.id, ticketLogChannelId: old.ticketLog.id, ticketCategoryId: old.tickets.id, orderCategoryId: old.orders.id,
  });
  adopt.LAYOUTS[G.id] = {
    version: 1,
    channels: { welcomeChannelId: own.welcome.id, verifyChannelId: own.rules.id, shopChannelId: own.infos.id, supportChannelId: own.wishes.id, modLogChannelId: own.modOnly.id, ticketLogChannelId: own.modOnly.id, ticketCategoryId: own.shopCat.id, orderCategoryId: own.shopCat.id },
    staffRoles: ['FOUNDER', 'OWNER'], newStaffRole: '・MOD 𓇻', memberRole: '.gg/xvy',
    products: [{ key: 'thumb', name: 'Thumbnail', price: 0, emoji: '📸' }, { key: 'sp', name: 'Soundpack', price: 0.5, emoji: '🔊' }],
    ticketTypes: { bewerbung: { description: 'Bewirb dich für XVY' } },
  };
  return { own, old };
}

async function setUp(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const world = makeWorld();
  const ctx = makeCtx(world);
  const { own, old } = await ownServer(world, ctx);
  await adopt.applyLayout(world.guild, ctx);
  const g = ctx.store.guild(world.guild.id);
  const staffRole = world.guild.roles.cache.get(g.config.staffRoleIds[2]); // ・MOD
  return { world, ctx, g, own, old, staffRole };
}

test('layout: uses the own channels and roles, removes only the old setup leftovers, posts panels, runs once', async (t) => {
  const { world, ctx, g, own, old } = await setUp(t);
  const G = world.guild, c = g.config;
  for (const k of ['team', 'member', 'kunde']) assert.ok(old[k].deleted, `old role ${k} removed`);
  for (const k of ['welcome', 'verify', 'shop', 'support', 'modLog', 'ticketLog', 'tickets', 'orders', 'oldStart', 'oldTeamCat']) assert.ok(old[k].deleted, `old ${k} removed`);
  assert.ok(!old.oldShopCat.deleted, 'category with an own channel stays');
  for (const k of Object.keys(own)) assert.ok(!own[k].deleted, `own ${k} untouched`);
  assert.equal(c.welcomeChannelId, own.welcome.id);
  assert.equal(c.verifyChannelId, own.rules.id);
  assert.equal(c.ticketCategoryId, own.shopCat.id);
  assert.equal(c.memberRoleId, own.gg.id);
  assert.equal(c.customerRoleId, null);
  const mod = G.roles.cache.find((r) => r.name === '・MOD 𓇻');
  assert.ok(mod && mod.hoist, 'MOD role created');
  assert.equal(mod.position, 28, 'MOD sits right below OWNER');
  assert.deepEqual(c.staffRoleIds, [own.founder.id, own.owner.id, mod.id]);
  assert.deepEqual(customIds(own.rules.messages.cache.get(g.panels.verify).payload), ['"custom_id":"verify:start"']);
  assert.ok(customIds(own.wishes.messages.cache.get(g.panels.tickets).payload).includes('"custom_id":"ticket:open"'));
  assert.match(JSON.stringify(own.wishes.messages.cache.get(g.panels.tickets).payload), /Bewerbung\*\* – Bewirb dich für XVY/);
  assert.equal(require('../src/store').DEFAULT_TICKET_TYPES[2].description, 'Bewirb dich für das Team', 'default not changed');
  assert.ok(customIds(own.infos.messages.cache.get(g.panels.shop).payload).includes('"custom_id":"shop:cart"'));
  assert.ok(ctx.logs.some((l) => /eingerichtet/.test(l.title)));
  const shopText = JSON.stringify(own.infos.messages.cache.get(g.panels.shop).payload);
  assert.match(shopText, /Thumbnail\*\* – Gratis/);
  assert.match(shopText, /Soundpack\*\* – €\s0,50/);
  // a removed seed product does not come back on the next start
  delete g.products.p1;
  await adopt.applyLayout(G, ctx);
  assert.equal(Object.values(g.products).filter((p) => p.name === 'Thumbnail').length, 0);
  const roles = G.roles.cache.size, msgs = own.rules.messages.cache.size;
  assert.equal(await adopt.applyLayout(G, ctx), false, 'runs only once');
  assert.equal(G.roles.cache.size, roles);
  assert.equal(own.rules.messages.cache.size, msgs);
  const chans = G.channels.cache.size;
  const s = interaction(world, world.owner, 'command', { commandName: 'setup' });
  await setup.runSetup(s, ctx);
  assert.equal(G.channels.cache.size, chans, '/setup creates no channels');
  assert.equal(G.roles.cache.size, roles, '/setup creates no roles');
  assert.match(lastText(s), /Verifizieren/);
  const neu = await G.channels.create({ name: 'shop-neu', type: 0 });
  await config.onCommand(interaction(world, world.owner, 'command', { commandName: 'config', sub: 'kanal', opts: { art: 'shopChannelId', kanal: neu } }), ctx);
  assert.equal(c.shopChannelId, neu.id);
  assert.equal(neu.messages.cache.size, 1, 'shop panel posted in the new channel');
  const bad = interaction(world, world.owner, 'command', { commandName: 'config', sub: 'kanal', opts: { art: 'ticketCategoryId', kanal: neu } });
  await config.onCommand(bad, ctx);
  assert.match(lastText(bad), /Kategorie/);
  const extra = await G.roles.create({ name: 'Helfer' });
  await config.onCommand(interaction(world, world.owner, 'command', { commandName: 'config', sub: 'teamrolle', opts: { rolle: extra } }), ctx);
  assert.ok(c.staffRoleIds.includes(extra.id));
  await config.onCommand(interaction(world, world.owner, 'command', { commandName: 'config', sub: 'teamrolle', opts: { rolle: extra } }), ctx);
  assert.ok(!c.staffRoleIds.includes(extra.id));
});

test('verification with captcha: wrong answer refused, right answer gives the member role', async (t) => {
  const { world, ctx, g, staffRole } = await setUp(t);
  const m = world.addUser('neu');
  const b = interaction(world, m, 'button', { customId: 'verify:start' });
  await verify.onButton(b, ctx);
  assert.equal(b.calls[0][0], 'modal');
  const q = b.calls[0][1].components[0].components[0].label;
  const [x, y] = q.match(/\d+/g).map(Number);
  const wrong = interaction(world, m, 'modal', { customId: 'verify:captcha', fields: { answer: String(x + y + 1) } });
  await verify.onModal(wrong, ctx);
  assert.match(lastText(wrong), /falsch/);
  assert.ok(!m.roles.cache.has(g.config.memberRoleId));
  await verify.onButton(interaction(world, m, 'button', { customId: 'verify:start' }), ctx);
  const key = `${world.guild.id}:${m.id}`;
  const ans = verify.pending.get(key).answer;
  const right = interaction(world, m, 'modal', { customId: 'verify:captcha', fields: { answer: ` ${ans} ` } });
  await verify.onModal(right, ctx);
  assert.ok(m.roles.cache.has(g.config.memberRoleId), 'member role given');
  // without captcha: one click
  g.config.captcha = false;
  const m2 = world.addUser('neu2');
  await verify.onButton(interaction(world, m2, 'button', { customId: 'verify:start' }), ctx);
  assert.ok(m2.roles.cache.has(g.config.memberRoleId));
  // welcome message
  await verify.welcome(m2, ctx);
  const wc = world.guild.channels.cache.get(g.config.welcomeChannelId);
  assert.match(JSON.stringify(wc.messages.cache.last().payload), new RegExp(`<@${m2.id}>`));
});

test('ticket: open via menu + modal, one per user, claim, add member, close with transcript and DM', async (t) => {
  const { world, ctx, g, staffRole } = await setUp(t);
  const staff = world.addUser('mod', { roles: [staffRole], position: 10 });
  const u = world.addUser('kunde');
  const sel = interaction(world, u, 'select', { customId: 'ticket:open', values: ['support'] });
  await tickets.onSelect(sel, ctx);
  assert.equal(sel.calls[0][1].custom_id, 'ticket:create:support');
  const create = interaction(world, u, 'modal', { customId: 'ticket:create:support', fields: { topic: 'Mein Kauf geht nicht' } });
  await tickets.onCreate(create, ctx);
  const [chId, rec] = Object.entries(g.tickets)[0];
  const ch = world.guild.channels.cache.get(chId);
  assert.equal(ch.parentId, g.config.ticketCategoryId);
  assert.match(ch.name, /^support-0001-kunde$/);
  assert.ok(ch.overwrites.some((o) => o.id === u.id && o.type === 1));
  assert.ok(g.config.staffRoleIds.every((id) => ch.overwrites.some((o) => o.id === id && o.type === 0)), 'all team roles see the ticket');
  assert.match(JSON.stringify(ch.messages.cache.first().payload), /Mein Kauf geht nicht/);
  // second ticket refused
  const again = interaction(world, u, 'select', { customId: 'ticket:open', values: ['support'] });
  await tickets.onSelect(again, ctx);
  assert.match(lastText(again), /schon ein offenes Ticket/);
  // claim: only staff
  const c1 = interaction(world, u, 'button', { customId: 'ticket:claim', channel: ch });
  await tickets.onClaim(c1, ctx);
  assert.match(lastText(c1), /Nur das Team/);
  await tickets.onClaim(interaction(world, staff, 'button', { customId: 'ticket:claim', channel: ch }), ctx);
  assert.equal(rec.claimedBy, staff.id);
  // add a member
  const friend = world.addUser('freund');
  await tickets.onCommand(interaction(world, staff, 'command', { commandName: 'ticket', sub: 'hinzufuegen', opts: { nutzer: friend.user }, channel: ch }), ctx);
  assert.equal(ch.permissionOverwrites.edits[0].target, friend.id);
  // close
  await ch.send({ content: 'Antwort vom Team' });
  const yes = interaction(world, u, 'button', { customId: 'ticket:close:yes', channel: ch });
  await tickets.onCloseConfirm(yes, ctx);
  assert.equal(g.tickets[chId], undefined);
  const log = world.guild.channels.cache.get(g.config.ticketLogChannelId).messages.cache.last();
  assert.ok(log.payload.files[0].attachment.toString().includes('Antwort vom Team'), 'transcript in log');
  assert.equal(u.user.dms.length, 1, 'creator gets the transcript by DM');
  t.mock.timers.tick(5000);
  await new Promise((r) => setImmediate(r));
  assert.ok(ch.deleted, 'channel deleted after 5 s');
});

test('shop: products, panel, cart, order channel, status buttons, customer role', async (t) => {
  const { world, ctx, g, staffRole } = await setUp(t);
  for (const k of Object.keys(g.products)) delete g.products[k]; // start without the seeded products
  g.productCounter = 0;
  const staff = world.addUser('mod', { roles: [staffRole], position: 10 });
  const add = (opts) => shop.onProductCommand(interaction(world, world.owner, 'command', { commandName: 'produkt', sub: 'hinzufuegen', opts }), ctx);
  await add({ name: 'Logo', preis: '14,99', beschreibung: 'Dein Logo', emoji: '🎨' });
  await add({ name: 'Banner', preis: '5' });
  const bad = interaction(world, world.owner, 'command', { commandName: 'produkt', sub: 'hinzufuegen', opts: { name: 'X', preis: 'gratis' } });
  await shop.onProductCommand(bad, ctx);
  assert.match(lastText(bad), /Ungültiger Preis/);
  assert.equal(Object.keys(g.products).length, 2);
  const panelPayload = world.guild.channels.cache.get(g.config.shopChannelId).messages.cache.get(g.panels.shop).payload;
  assert.match(JSON.stringify(panelPayload), /Logo.*14,99/);
  const menu = panelPayload.components[0].components[0];
  assert.equal(menu.custom_id, 'shop:add');
  assert.deepEqual(menu.options[0].emoji, { name: '🎨' });
  // autocomplete
  const ac = interaction(world, world.owner, 'autocomplete', { commandName: 'produkt', opts: { focused: 'ban' } });
  await shop.onAutocomplete(ac, ctx);
  assert.equal(ac.calls[0][1][0].value, 'p2');
  // customer
  const u = world.addUser('kaeufer');
  await shop.onAdd(interaction(world, u, 'select', { customId: 'shop:add', values: ['p1'] }), ctx);
  const add2 = interaction(world, u, 'select', { customId: 'shop:add', values: ['p1'] });
  await shop.onAdd(add2, ctx);
  await shop.onAdd(interaction(world, u, 'select', { customId: 'shop:add', values: ['p2'] }), ctx);
  const cart = interaction(world, u, 'button', { customId: 'shop:cart' });
  await shop.onCart(cart, ctx);
  assert.match(lastText(cart), /Summe: €\s34,98/);
  const co = interaction(world, u, 'button', { customId: 'shop:checkout' });
  await shop.onCheckout(co, ctx);
  assert.equal(co.calls[0][1].custom_id, 'shop:order');
  await shop.onOrder(interaction(world, u, 'modal', { customId: 'shop:order', fields: { notes: 'Bitte in Gold' } }), ctx);
  const o = Object.values(g.orders)[0];
  assert.equal(o.total, 34.98);
  assert.equal(g.carts[u.id], undefined, 'cart emptied');
  const och = world.guild.channels.cache.get(o.channelId);
  assert.equal(och.parentId, g.config.orderCategoryId);
  assert.match(JSON.stringify(och.messages.cache.first().payload), /Bitte in Gold/);
  // second order blocked while one is open
  await shop.onAdd(interaction(world, u, 'select', { customId: 'shop:add', values: ['p2'] }), ctx);
  const co2 = interaction(world, u, 'button', { customId: 'shop:checkout' });
  await shop.onCheckout(co2, ctx);
  assert.match(lastText(co2), /schon eine offene Bestellung/);
  // customer cannot set status
  const cheat = interaction(world, u, 'button', { customId: 'order:paid', channel: och });
  await shop.onOrderButton(cheat, ctx);
  assert.match(lastText(cheat), /Nur das Team/);
  await shop.onOrderButton(interaction(world, staff, 'button', { customId: 'order:paid', channel: och }), ctx);
  assert.equal(o.status, 'paid');
  await shop.onOrderButton(interaction(world, staff, 'button', { customId: 'order:delivered', channel: och }), ctx);
  assert.equal(o.status, 'delivered');
  assert.equal(g.config.customerRoleId, null, 'no customer role by default – delivery works without one');
  assert.ok(u.user.dms.length >= 2, 'customer informed by DM');
  await shop.onOrderButton(interaction(world, staff, 'button', { customId: 'order:close', channel: och }), ctx);
  t.mock.timers.tick(5000);
  await new Promise((r) => setImmediate(r));
  assert.ok(och.deleted);
  assert.ok(o.closedAt);
  // with a customer role set, delivery gives it
  const kundeRole = await world.guild.roles.create({ name: 'Kunde' });
  await config.onCommand(interaction(world, world.owner, 'command', { commandName: 'config', sub: 'kundenrolle', opts: { rolle: kundeRole } }), ctx);
  await shop.onAdd(interaction(world, u, 'select', { customId: 'shop:add', values: ['p1'] }), ctx);
  await shop.onOrder(interaction(world, u, 'modal', { customId: 'shop:order', fields: { notes: '' } }), ctx);
  const o2 = Object.values(g.orders).find((x) => x.no === 2);
  await shop.onOrderButton(interaction(world, staff, 'button', { customId: 'order:delivered', channel: world.guild.channels.cache.get(o2.channelId) }), ctx);
  assert.ok(u.roles.cache.has(kundeRole.id), 'customer role after delivery');
  // edit & remove product
  await shop.onProductCommand(interaction(world, world.owner, 'command', { commandName: 'produkt', sub: 'bearbeiten', opts: { produkt: 'p2', preis: '7,50', verfuegbar: false } }), ctx);
  assert.equal(g.products.p2.price, 7.5);
  assert.equal(g.products.p2.enabled, false);
  assert.doesNotMatch(JSON.stringify(shop.panel(g)), /Banner/);
  await shop.onProductCommand(interaction(world, world.owner, 'command', { commandName: 'produkt', sub: 'entfernen', opts: { produkt: 'Logo' } }), ctx);
  assert.equal(g.products.p1, undefined);
});

test('moderation: warn escalates to timeout, hierarchy is respected, kick/ban/clear', async (t) => {
  const { world, ctx, g, staffRole } = await setUp(t);
  const mod = world.addUser('mod', { roles: [staffRole], perms: (1n << 40n) | (1n << 1n) | (1n << 2n), position: 10 });
  const u = world.addUser('stoerer', { position: 1 });
  for (let n = 0; n < 3; n++) await moderation.onCommand(interaction(world, mod, 'command', { commandName: 'warn', opts: { nutzer: u.user, grund: `Test ${n}` } }), ctx);
  assert.equal(g.warns[u.id].length, 3);
  assert.equal(u.timeouts.length, 1, '3 warnings → 1 h timeout');
  assert.equal(u.timeouts[0].ms, 3_600_000);
  assert.equal(u.user.dms.length, 3);
  const ws = interaction(world, mod, 'command', { commandName: 'warns', opts: { nutzer: u.user } });
  await moderation.onCommand(ws, ctx);
  assert.match(lastText(ws), /Test 2/);
  await moderation.onCommand(interaction(world, mod, 'command', { commandName: 'unwarn', opts: { nutzer: u.user, nummer: 1 } }), ctx);
  assert.equal(g.warns[u.id].length, 2);
  // a member above the moderator cannot be touched
  const boss = world.addUser('boss', { position: 40 });
  const tryKick = interaction(world, mod, 'command', { commandName: 'kick', opts: { nutzer: boss.user } });
  await moderation.onCommand(tryKick, ctx);
  assert.match(lastText(tryKick), /höhere Rolle/);
  assert.equal(boss.kicked, false);
  const self = interaction(world, mod, 'command', { commandName: 'ban', opts: { nutzer: mod.user } });
  await moderation.onCommand(self, ctx);
  assert.match(lastText(self), /selbst/);
  await moderation.onCommand(interaction(world, mod, 'command', { commandName: 'kick', opts: { nutzer: u.user, grund: 'tschüss' } }), ctx);
  assert.equal(u.kicked, 'tschüss');
  await moderation.onCommand(interaction(world, mod, 'command', { commandName: 'timeout', opts: { nutzer: u.user, minuten: 10 } }), ctx);
  assert.equal(u.timeouts.at(-1).ms, 600_000);
  // ban of someone who already left
  const gone = { id: '123456789012345678', username: 'weg', send: async () => {} };
  await moderation.onCommand(interaction(world, mod, 'command', { commandName: 'ban', opts: { nutzer: gone } }), ctx);
  assert.equal(world.guild.bans[0].id, gone.id);
  // clear
  const ch = world.guild.channels.cache.get(g.config.shopChannelId);
  for (let n = 0; n < 5; n++) await ch.send({ content: `m${n}` });
  const cl = interaction(world, mod, 'command', { commandName: 'clear', opts: { anzahl: 3 }, channel: ch });
  await moderation.onCommand(cl, ctx);
  assert.match(lastText(cl), /3 Nachricht/);
  assert.ok(ctx.logs.length >= 5, 'actions are logged');
});

test('automod: invites, mass mentions, spam; team is exempt; raid kicks new accounts', async (t) => {
  const { world, ctx, g, staffRole } = await setUp(t);
  const ch = world.guild.channels.cache.get(g.config.shopChannelId);
  const u = world.addUser('spammer', { position: 1 });
  const msg = async (member, content, mentions = 0) => {
    const m = await ch.send({ content });
    m.author = member.user; m.member = member; m.guild = world.guild; m.client = world.client; m.webhookId = null;
    m.mentions = { users: { size: mentions }, roles: { size: 0 } };
    await moderation.onMessage(m, ctx);
    return m;
  };
  const inv = await msg(u, 'join discord.gg/werbung');
  assert.ok(inv.deleted);
  assert.equal(u.timeouts.length, 1);
  const ment = await msg(u, 'hey', 6);
  assert.ok(ment.deleted);
  const okMsg = await msg(u, 'ganz normal');
  assert.ok(!okMsg.deleted);
  const before = u.timeouts.length;
  const burst = [];
  for (let n = 0; n < 8; n++) burst.push(await msg(u, `spam ${n}`));
  assert.ok(burst.some((m) => m.deleted), 'burst detected');
  assert.ok(u.timeouts.length >= before + 1, "spammer timed out");
  assert.equal(u.timeouts.at(-1).ms, 3_600_000, "3rd automod warning escalates to 1 h");
  const staff = world.addUser('mod', { roles: [staffRole], position: 10 });
  const teamInv = await msg(staff, 'discord.gg/partner');
  assert.ok(!teamInv.deleted, 'team may post invites');
  // raid: 8 joins in 30 s → new accounts are kicked
  g.config.automod.raidJoins = 3;
  const joins = [];
  for (let n = 0; n < 4; n++) {
    const m = world.addUser(`raid${n}`);
    m.user.createdTimestamp = Date.now() - 86_400_000; // 1 day old
    joins.push([m, await moderation.onJoin(m, ctx)]);
  }
  assert.equal(joins[0][1], false);
  assert.equal(joins[2][1], true, 'third join starts raid mode and is kicked');
  assert.equal(joins[3][1], true);
  assert.ok(ctx.logs.some((l) => /Raid erkannt/.test(l.title)));
  const old = world.addUser('veteran');
  assert.equal(await moderation.onJoin(old, ctx), false, 'old accounts may join during raid mode');
  moderation.raid.stop(world.guild.id);
});

test('config: settings change and panels refresh', async (t) => {
  const { world, ctx, g, staffRole } = await setUp(t);
  const run = (sub, opts) => config.onCommand(interaction(world, world.owner, 'command', { commandName: 'config', sub, opts }), ctx);
  await run('name', { name: 'XVY Imperium RP' });
  await run('farbe', { hex: '#112233' });
  await run('zahlung', { text: 'PayPal: test@xvy.at\\nBitte mit Bestellnummer' });
  await run('automod', { einladungen: false, max_erwaehnungen: 8 });
  assert.equal(g.config.name, 'XVY Imperium RP');
  assert.equal(g.config.color, 0x112233);
  assert.equal(g.config.paymentInfo, 'PayPal: test@xvy.at\nBitte mit Bestellnummer');
  assert.equal(g.config.automod.invites, false);
  assert.equal(g.config.automod.maxMentions, 8);
  const verifyMsg = world.guild.channels.cache.get(g.config.verifyChannelId).messages.cache.get(g.panels.verify);
  assert.match(JSON.stringify(verifyMsg.payload), /XVY Imperium RP/);
  const bad = interaction(world, world.owner, 'command', { commandName: 'config', sub: 'farbe', opts: { hex: 'blau' } });
  await config.onCommand(bad, ctx);
  assert.match(lastText(bad), /Ungültige Farbe/);
  const show = interaction(world, world.owner, 'command', { commandName: 'config', sub: 'anzeigen' });
  await config.onCommand(show, ctx);
  assert.match(lastText(show), /Automod/);
});
