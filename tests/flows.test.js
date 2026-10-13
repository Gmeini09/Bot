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

function makeCtx(world) {
  const store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'xvy-flow-')));
  const logs = [];
  const ctx = {
    client: world.client, store, logs, verify, tickets, shop,
    async log(guild, e) { logs.push(e); },
    async refreshPanels(guild, g) {
      await setup.postPanel(guild, g, 'verify', g.config.verifyChannelId, verify.panel(g));
      await setup.postPanel(guild, g, 'shop', g.config.shopChannelId, shop.panel(g));
    },
  };
  return ctx;
}
const customIds = (payload) => JSON.stringify(payload.components || []).match(/"custom_id":"[^"]+"/g) || [];

async function setUp(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const world = makeWorld();
  const ctx = makeCtx(world);
  const i = interaction(world, world.owner, 'command', { commandName: 'setup' });
  await setup.runSetup(i, ctx);
  return { world, ctx, g: ctx.store.guild(world.guild.id) };
}

test('setup creates roles, channels and all three panels; running it again creates nothing new', async (t) => {
  const { world, ctx, g } = await setUp(t);
  const c = g.config;
  for (const k of ['staffRoleId', 'memberRoleId', 'customerRoleId', 'welcomeChannelId', 'verifyChannelId', 'shopChannelId', 'supportChannelId', 'ticketCategoryId', 'orderCategoryId', 'modLogChannelId', 'ticketLogChannelId']) assert.ok(c[k], k);
  const verifyCh = world.guild.channels.cache.get(c.verifyChannelId);
  const panelMsg = verifyCh.messages.cache.get(g.panels.verify);
  assert.deepEqual(customIds(panelMsg.payload), ['"custom_id":"verify:start"']);
  assert.ok(customIds(world.guild.channels.cache.get(c.supportChannelId).messages.cache.get(g.panels.tickets).payload).includes('"custom_id":"ticket:open"'));
  assert.ok(customIds(world.guild.channels.cache.get(c.shopChannelId).messages.cache.get(g.panels.shop).payload).includes('"custom_id":"shop:cart"'));
  // staff-only channels hide from @everyone
  const modLog = world.guild.channels.cache.get(c.modLogChannelId);
  assert.ok(modLog.overwrites.some((o) => o.id === world.guild.id && o.deny?.includes(1n << 10n)));
  const channels = world.guild.channels.cache.size, roles = world.guild.roles.cache.size;
  await setup.runSetup(interaction(world, world.owner, 'command', { commandName: 'setup' }), ctx);
  assert.equal(world.guild.channels.cache.size, channels);
  assert.equal(world.guild.roles.cache.size, roles);
  assert.equal(panelMsg.edits, 1, 'panel edited in place, not posted twice');
});

test('verification with captcha: wrong answer refused, right answer gives the member role', async (t) => {
  const { world, ctx, g } = await setUp(t);
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
  const { world, ctx, g } = await setUp(t);
  const staff = world.addUser('mod', { roles: [world.guild.roles.cache.get(g.config.staffRoleId)], position: 10 });
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
  assert.ok(ch.overwrites.some((o) => o.id === g.config.staffRoleId && o.type === 0));
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
  const { world, ctx, g } = await setUp(t);
  const staff = world.addUser('mod', { roles: [world.guild.roles.cache.get(g.config.staffRoleId)], position: 10 });
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
  assert.ok(u.roles.cache.has(g.config.customerRoleId), 'customer role after delivery');
  assert.ok(u.user.dms.length >= 2, 'customer informed by DM');
  await shop.onOrderButton(interaction(world, staff, 'button', { customId: 'order:close', channel: och }), ctx);
  t.mock.timers.tick(5000);
  await new Promise((r) => setImmediate(r));
  assert.ok(och.deleted);
  assert.ok(o.closedAt);
  // edit & remove product
  await shop.onProductCommand(interaction(world, world.owner, 'command', { commandName: 'produkt', sub: 'bearbeiten', opts: { produkt: 'p2', preis: '7,50', verfuegbar: false } }), ctx);
  assert.equal(g.products.p2.price, 7.5);
  assert.equal(g.products.p2.enabled, false);
  assert.doesNotMatch(JSON.stringify(shop.panel(g)), /Banner/);
  await shop.onProductCommand(interaction(world, world.owner, 'command', { commandName: 'produkt', sub: 'entfernen', opts: { produkt: 'Logo' } }), ctx);
  assert.equal(g.products.p1, undefined);
});

test('moderation: warn escalates to timeout, hierarchy is respected, kick/ban/clear', async (t) => {
  const { world, ctx, g } = await setUp(t);
  const mod = world.addUser('mod', { roles: [world.guild.roles.cache.get(g.config.staffRoleId)], perms: (1n << 40n) | (1n << 1n) | (1n << 2n), position: 10 });
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
  const boss = world.addUser('boss', { position: 20 });
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
  const { world, ctx, g } = await setUp(t);
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
  const staff = world.addUser('mod', { roles: [world.guild.roles.cache.get(g.config.staffRoleId)], position: 10 });
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
  const { world, ctx, g } = await setUp(t);
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
