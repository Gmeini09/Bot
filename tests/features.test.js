'use strict';
// Rights check, backups, extra logs, ticket auto-close, discount codes, stock, invites and the welcome picture.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeWorld, interaction, lastText, Coll } = require('./fake');
const { Store } = require('../src/store');
const setup = require('../src/setup');
const verify = require('../src/verify');
const tickets = require('../src/tickets');
const shop = require('../src/shop');
const perms = require('../src/perms');
const backup = require('../src/backup');
const audit = require('../src/audit');
const invites = require('../src/invites');
const card = require('../src/card');
const logic = require('../src/logic');

const H = 3_600_000;

async function world0(t) {
  t?.mock?.timers?.enable({ apis: ['setTimeout'] });
  const world = makeWorld();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xvy-f-'));
  const store = new Store(dir);
  shop.setImageDir(path.join(dir, 'images'));
  const logs = [];
  const ctx = { client: world.client, store, logs, verify, tickets, shop, async log(gd, e) { logs.push(e); }, async refreshPanels(gd, g) { await setup.postAll(gd, g, ctx); } };
  const G = world.guild;
  const g = store.guild(G.id);
  const mk = (name, type = 0) => G.channels.create({ name, type });
  const mod = await G.roles.create({ name: '・MOD' }); mod.position = 20;
  const ch = { shop: await mk('bestellen'), cat: await mk('Shop', 4), log: await mk('logs'), welcome: await mk('willkommen'), support: await mk('support') };
  Object.assign(g.config, { staffRoleIds: [mod.id], shopChannelId: ch.shop.id, orderCategoryId: ch.cat.id, ticketCategoryId: ch.cat.id, modLogChannelId: ch.log.id, ticketLogChannelId: ch.log.id, welcomeChannelId: ch.welcome.id, supportChannelId: ch.support.id });
  const staff = world.addUser('mod', { roles: [mod], position: 20 });
  return { world, ctx, g, ch, staff, mod, dir, store, G };
}

// ── 1 rights
test('rights: needed set has no Administrator; report flags admin, missing rights and blocked channels', async (t) => {
  const { world, g, ch } = await world0(t);
  assert.equal(perms.REQUIRED & perms.P.ADMIN, 0n);
  assert.match(perms.inviteUrl('123'), new RegExp(`permissions=${perms.REQUIRED}&`));
  const me = world.guild.members.me;
  me.permissions = { bitfield: 8n };
  let r = perms.report(world.guild, g);
  assert.ok(r.admin && !r.ok && /Administrator-Rechte/.test(r.lines[0]));
  me.permissions = { bitfield: perms.REQUIRED & ~perms.P.MANAGE_GUILD };
  ch.log.permissionsFor = () => ({ bitfield: perms.P.VIEW | perms.P.SEND });
  r = perms.report(world.guild, g);
  assert.deepEqual(r.missing, ['Server verwalten (für Invite-Tracking)']);
  assert.ok(r.lines.some((l) => l.includes(`<#${ch.log.id}>`) && /Links einbetten/.test(l)), 'mod log listed once with what is missing');
  assert.equal(r.lines.filter((l) => l.includes(ch.log.id)).length, 1);
  me.permissions = { bitfield: perms.REQUIRED };
  ch.log.permissionsFor = () => ({ bitfield: perms.REQUIRED });
  assert.ok(perms.report(world.guild, g).ok);
});

// ── 2 backups
test('backups: one snapshot per day, 14 kept, /backup sends the data', async (t) => {
  const { world, ctx, store, dir, g } = await world0(t);
  g.orders.O1 = { id: 'O1', total: 5 };
  const day0 = Date.UTC(2026, 0, 1);
  assert.ok(backup.snapshot(store, day0));
  assert.equal(backup.snapshot(store, day0 + 3 * H), null, 'once per day');
  for (let i = 1; i < 20; i++) backup.snapshot(store, day0 + i * 24 * H);
  const files = backup.list(store);
  assert.equal(files.length, 14);
  assert.equal(files[0], 'xvy-bot-2026-01-07.json');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'backups', files.at(-1)), 'utf8')).guilds[world.guild.id].orders.O1.total, 5);
  const i = interaction(world, world.owner, 'command', { commandName: 'backup' });
  await backup.onCommand(i, ctx);
  const f = i.calls[0][1].files[0];
  assert.equal(JSON.parse(f.attachment.toString()).data.orders.O1.total, 5);
  const plain = world.addUser('x');
  const j = interaction(world, plain, 'command', { commandName: 'backup' });
  await backup.onCommand(j, ctx);
  assert.match(lastText(j), /Nur der Server-Owner/);
});

// ── 3 logs
test('logs: role, nickname and timeout changes with who did it; the bot\'s own changes are skipped', async (t) => {
  const { world, ctx, mod, staff } = await world0(t);
  t.mock.timers.reset();
  const G = world.guild;
  const u = world.addUser('anna');
  const snap = (m) => ({ guild: G, id: m.id, user: m.user, roles: { cache: new Coll(m.roles.cache) }, nickname: m.nickname ?? null, communicationDisabledUntilTimestamp: m.communicationDisabledUntilTimestamp ?? null });
  let entries = [];
  G.fetchAuditLogs = async () => ({ entries: new Coll(entries.map((e, i) => [String(i), e])) });
  const before = snap(u);
  u.roles.cache.set(mod.id, mod);
  u.nickname = 'Anni';
  u.communicationDisabledUntilTimestamp = Date.now() + H;
  entries = [{ targetId: u.id, executorId: staff.id, createdTimestamp: Date.now(), reason: 'test' }];
  const orig = audit.executor;
  const d = audit.memberDiff(before, u);
  assert.deepEqual(d.added, [mod.id]);
  assert.deepEqual(d.nick, [null, 'Anni']);
  assert.ok(d.timeout.until > Date.now());
  // run without the 1.2 s wait
  const ex = await audit.executor(G, audit.AL.MEMBER_ROLE_UPDATE, u.id, 0);
  assert.equal(ex.id, staff.id);
  assert.equal(orig, audit.executor);
  // full handler (waits are real timers → keep them short by stubbing setTimeout)
  const st = global.setTimeout; global.setTimeout = (fn) => st(fn, 0);
  try {
    await audit.onMemberUpdate(before, u, ctx);
    const titles = ctx.logs.map((l) => l.title);
    assert.deepEqual(titles, ['🎭 Rollen geändert', '✏️ Nickname geändert', '⏳ Timeout']);
    assert.match(ctx.logs[0].description, new RegExp(`➕ <@&${mod.id}>[\\s\\S]*Von:\\*\\* <@${staff.id}>`));
    ctx.logs.length = 0;
    entries = [{ targetId: u.id, executorId: world.client.user.id, createdTimestamp: Date.now() }];
    const b2 = snap(u); u.roles.cache.delete(mod.id);
    await audit.onMemberUpdate(b2, u, ctx);
    assert.equal(ctx.logs.length, 0, 'bot\'s own role change not logged');
    // role permission change
    const p = audit.permDiff({ bitfield: 0n }, { bitfield: 8n | (1n << 2n) });
    assert.deepEqual(p.added.sort(), ['Administrator', 'Bannen']);
    entries = [{ targetId: mod.id, executorId: staff.id, createdTimestamp: Date.now() }];
    await audit.onRoleUpdate({ name: '・MOD', permissions: { bitfield: 0n } }, { id: mod.id, guild: G, name: '・MOD', permissions: { bitfield: 8n } }, ctx);
    assert.match(ctx.logs[0].description, /Neue Rechte:\*\* Administrator/);
    assert.equal(ctx.logs[0].ping, true, 'admin given → team pinged');
  } finally { global.setTimeout = st; }
});

// ── 4 ticket auto close
test('tickets: reminder after 48 h, closed 24 h later; a message keeps it open', async (t) => {
  const { world, ctx, g, ch } = await world0(t);
  const u = world.addUser('kunde');
  const tch = await world.guild.channels.create({ name: 'support-0001', type: 0, parent: ch.cat.id });
  const t0 = Date.now();
  g.tickets[tch.id] = { no: 1, userId: u.id, type: 'support', openedAt: t0, lastActivity: t0, remindedAt: null };
  const cfg = g.config.ticketAutoClose;
  assert.deepEqual(cfg, { enabled: true, remindHours: 48, closeHours: 24 });
  assert.equal(tickets.autoCloseAction(g.tickets[tch.id], cfg, t0 + 47 * H), null);
  await tickets.tick(ctx, t0 + 49 * H);
  assert.equal(g.tickets[tch.id].remindedAt, t0 + 49 * H);
  assert.match(JSON.stringify([...tch.messages.cache.values()].at(-1).payload), /automatisch geschlossen/);
  // the member answers → open again, reminder reset
  tickets.onMessage({ guild: world.guild, channelId: tch.id, author: u.user }, ctx);
  assert.equal(g.tickets[tch.id].remindedAt, null);
  const later = g.tickets[tch.id].lastActivity;
  await tickets.tick(ctx, later + 49 * H);
  await tickets.tick(ctx, later + 74 * H);
  assert.equal(g.tickets[tch.id], undefined, 'closed');
  assert.ok(ctx.logs.some((l) => /automatisch geschlossen/.test(l.title)));
  assert.match(JSON.stringify(u.user.dms.at(-1)), /Automatisch geschlossen/);
  // off → nothing happens; tickets from before the feature start fresh
  cfg.enabled = false;
  assert.equal(tickets.autoCloseAction({ lastActivity: 0 }, cfg, t0), null);
  cfg.enabled = true;
  const old = await world.guild.channels.create({ name: 'alt', type: 0 });
  g.tickets[old.id] = { no: 2, userId: u.id, openedAt: 0 };
  await tickets.tick(ctx, t0);
  assert.equal(g.tickets[old.id].lastActivity, t0);
  // settings
  const c = interaction(world, world.owner, 'command', { commandName: 'config', sub: 'tickets', opts: { erinnerung_stunden: 12 } });
  await require('../src/config').onCommand(c, ctx);
  assert.equal(cfg.remindHours, 12);
});

// ── 5 + 6 discounts and stock
async function order(world, ctx, user, productId, code = '') {
  await shop.onAdd(interaction(world, user, 'select', { values: [productId] }), ctx);
  const i = interaction(world, user, 'modal', { customId: 'shop:order', fields: { notes: '', code } });
  await shop.onOrder(i, ctx);
  return i;
}

test('discounts: percent/amount, expiry, max uses, once per member, given back on cancel', async (t) => {
  const { world, ctx, g, staff } = await world0(t);
  g.products.p1 = { id: 'p1', name: 'NVE', price: 20, enabled: true, createdAt: 1 };
  assert.deepEqual(logic.parseDiscount('10%'), { type: 'percent', value: 10 });
  assert.deepEqual(logic.parseDiscount('4,50'), { type: 'amount', value: 4.5 });
  assert.equal(logic.parseDiscount('150%'), null);
  assert.deepEqual(logic.applyDiscount(20, { type: 'amount', value: 50 }), { amount: 20, total: 0 });
  const mk = (opts) => { const i = interaction(world, staff, 'command', { commandName: 'rabatt', sub: 'erstellen', opts }); return shop.onDiscountCommand(i, ctx).then(() => i); };
  await mk({ code: 'xvy10', rabatt: '10%', max_nutzungen: 2 });
  assert.equal(g.discounts.XVY10.value, 10);
  assert.match(lastText(await mk({ code: 'XVY10', rabatt: '5' })), /gibt es schon/);
  assert.match(lastText(await mk({ code: 'a b', rabatt: '5' })), /3–30 Zeichen/);
  const a = world.addUser('a'), b = world.addUser('b'), c = world.addUser('c');
  await order(world, ctx, a, 'p1', 'xvy10');
  const oa = Object.values(g.orders)[0];
  assert.equal(oa.subtotal, 20);
  assert.equal(oa.total, 18);
  assert.equal(oa.discount.amount, 2);
  assert.match(JSON.stringify(world.guild.channels.cache.get(oa.channelId).messages.cache.first().payload), /Rabatt `XVY10`/);
  // same member again → refused, cart stays
  const och = world.guild.channels.cache.get(oa.channelId);
  await shop.onOrderButton(interaction(world, staff, 'button', { customId: 'order:close', channel: och }), ctx);
  oa.closedAt = Date.now(); oa.status = 'delivered';
  const again = await order(world, ctx, a, 'p1', 'XVY10');
  assert.match(lastText(again), /schon benutzt/);
  assert.ok(g.carts[a.id], 'cart kept');
  await order(world, ctx, b, 'p1', 'XVY10');
  assert.match(lastText(await order(world, ctx, c, 'p1', 'XVY10')), /aufgebraucht/);
  // cancel b's order → code usable again
  const ob = Object.values(g.orders).find((o) => o.userId === b.id);
  await shop.onOrderButton(interaction(world, staff, 'button', { customId: 'order:cancel', channel: world.guild.channels.cache.get(ob.channelId) }), ctx);
  assert.equal(g.discounts.XVY10.uses, 1);
  await order(world, ctx, c, 'p1', 'XVY10');
  assert.equal(Object.values(g.orders).find((o) => o.userId === c.id).total, 36, 'cart kept from the refused try → 2 × 20 − 10 %');
  // expired / unknown
  g.discounts.OLD = { type: 'percent', value: 50, expiresAt: Date.now() - 1, uses: 0, usedBy: [] };
  const d = world.addUser('d');
  assert.match(lastText(await order(world, ctx, d, 'p1', 'old')), /abgelaufen/);
  assert.match(lastText(await order(world, ctx, d, 'p1', 'NOPE')), /gibt es nicht/);
  const list = interaction(world, staff, 'command', { commandName: 'rabatt', sub: 'liste' });
  await shop.onDiscountCommand(list, ctx);
  assert.match(lastText(list), /XVY10[\s\S]*aufgebraucht[\s\S]*OLD[\s\S]*abgelaufen/);
});

test('stock: shown in the shop, sold out → notify button, DM when back, order takes and cancel gives back', async (t) => {
  const { world, ctx, g, ch, staff } = await world0(t);
  g.products.p1 = { id: 'p1', name: 'Soundpack', price: 1, enabled: true, createdAt: 1 };
  const setS = async (anzahl) => { const i = interaction(world, staff, 'command', { commandName: 'produkt', sub: 'bestand', opts: { produkt: 'p1', anzahl } }); await shop.onProductCommand(i, ctx); return i; };
  await setS(1);
  assert.match(JSON.stringify(shop.panel(g).embeds[0]), /noch 1/);
  const a = world.addUser('a'), b = world.addUser('b');
  await order(world, ctx, a, 'p1');
  assert.equal(g.products.p1.stock, 0);
  assert.match(JSON.stringify(ch.shop.messages.cache.get(g.panels.shop).payload), /ausverkauft/);
  const add = interaction(world, b, 'select', { values: ['p1'] });
  await shop.onAdd(add, ctx);
  assert.match(lastText(add), /ausverkauft[\s\S]*restock:p1/);
  const bell = interaction(world, b, 'button', { customId: 'restock:p1' });
  await shop.onRestock(bell, ctx);
  assert.deepEqual(g.products.p1.notify, [b.id]);
  // cancel a's order → stock back → b gets a DM
  const oa = Object.values(g.orders)[0];
  await shop.onOrderButton(interaction(world, staff, 'button', { customId: 'order:cancel', channel: world.guild.channels.cache.get(oa.channelId) }), ctx);
  assert.equal(g.products.p1.stock, 1);
  assert.match(JSON.stringify(b.user.dms.at(-1)), /Soundpack ist wieder da/);
  assert.deepEqual(g.products.p1.notify, []);
  // restock via command notifies too; unlimited removes the limit
  await setS(0);
  g.products.p1.notify = [a.id];
  assert.match(lastText(await setS(5)), /1 Mitglied\(er\) per DM/);
  await setS(undefined);
  assert.equal(g.products.p1.stock, null);
  // can't order more than in stock
  await setS(1);
  g.carts[b.id] = { items: { p1: 3 } };
  const i = interaction(world, b, 'modal', { customId: 'shop:order', fields: { notes: '' } });
  await shop.onOrder(i, ctx);
  assert.match(lastText(i), /nur noch 1/);
});

// ── 7 invites
test('invites: finds the used link, counts joins/leaves/fakes, leaderboard', async (t) => {
  const { world, ctx, g } = await world0(t);
  const G = world.guild;
  const inviter = world.addUser('werber');
  let list = [{ code: 'abc', uses: 0, inviterId: inviter.id }, { code: 'xyz', uses: 4, inviterId: world.owner.id }];
  G.invites = { fetch: async () => new Coll(list.map((x) => [x.code, { ...x }])) };
  assert.equal(invites.findUsed(new Map([['a', { uses: 1 }]]), new Map([['a', { uses: 1 }]])), null);
  await invites.load(G);
  const join = async (name, ageDays = 400) => {
    list = list.map((x) => (x.code === 'abc' ? { ...x, uses: x.uses + 1 } : x));
    const m = world.addUser(name); m.user.createdTimestamp = Date.now() - ageDays * 86_400_000;
    return [m, await invites.onJoin(m, ctx)];
  };
  const [m1, r1] = await join('neu1');
  assert.deepEqual([r1.inviterId, r1.code, r1.count], [inviter.id, 'abc', 1]);
  assert.match(invites.joinText(r1), /Eingeladen von .* hat jetzt \*\*1\*\*/);
  const [, r2] = await join('neu2', 2);
  assert.equal(r2.fake, true);
  assert.equal(r2.count, 1, 'fake account does not count');
  assert.equal(invites.onLeave(m1, ctx), inviter.id);
  assert.equal(invites.net(g.invites.stats[inviter.id]), 0);
  // rejoin brings it back, no double count
  list = list.map((x) => (x.code === 'abc' ? { ...x, uses: x.uses + 1 } : x));
  const back = await invites.onJoin(m1, ctx);
  assert.equal(back.count, 1);
  assert.equal(g.invites.stats[inviter.id].joins, 2);
  const lb = interaction(world, m1, 'command', { commandName: 'invites', sub: 'rangliste' });
  await invites.onCommand(lb, ctx);
  assert.match(lastText(lb), new RegExp(`🥇 <@${inviter.id}> – \\*\\*1\\*\\*`));
  const me = interaction(world, inviter, 'command', { commandName: 'invites', sub: 'anzeigen' });
  await invites.onCommand(me, ctx);
  assert.match(lastText(me), /\*\*1\*\* Invites/);
  // one-time invite disappears when used
  assert.deepEqual(invites.findUsed(new Map([['once', { uses: 0, inviterId: 'x' }]]), new Map()), { code: 'once', inviterId: 'x', gone: true });
});

// ── 9 welcome picture
test('welcome: picture with name and member number, plain embed when switched off', async (t) => {
  const { world, ctx, g, ch } = await world0(t);
  assert.equal(card.drawableName('Jul XV¥', 'jul'), 'Jul XV¥');
  assert.equal(card.drawableName('𝒥𝓊𝓁', 'jul'), 'jul', 'fancy letters → username');
  const png = await card.render({ name: 'Jul', count: 12, server: 'XVY Kaiserreich', avatar: null });
  assert.ok(png && png.subarray(1, 4).toString() === 'PNG');
  const m = world.addUser('neu');
  m.displayName = 'Neu';
  await verify.welcome(m, ctx, { inviterId: world.owner.id });
  const msg = [...ch.welcome.messages.cache.values()].at(-1).payload;
  assert.equal(msg.files[0].name, 'willkommen.png');
  assert.equal(msg.embeds[0].image.url, 'attachment://willkommen.png');
  g.config.welcomeCard = false;
  g.config.welcomeText = 'Hi {user}, eingeladen von {inviter}';
  await verify.welcome(m, ctx, { inviterId: world.owner.id });
  const plain = [...ch.welcome.messages.cache.values()].at(-1).payload;
  assert.equal(plain.files.length, 0);
  assert.match(plain.embeds[0].description, new RegExp(`eingeladen von <@${world.owner.id}>`));
});

test('rights: fix lets the bot into blocked channels with an allow just for itself', async (t) => {
  const { world, g, ch } = await world0(t);
  const me = world.guild.members.me;
  me.permissions = { bitfield: perms.REQUIRED };
  const blocked = new Set([ch.welcome.id, ch.cat.id]);
  for (const c of world.guild.channels.cache.values()) c.permissionsFor = () => ({ bitfield: blocked.has(c.id) ? perms.P.VIEW : perms.REQUIRED });
  const r = perms.check(world.guild, g);
  assert.deepEqual(r.channels.map((c) => c.id).sort(), [ch.welcome.id, ch.cat.id].sort());
  const lines = await perms.fix(world.guild, g);
  assert.equal(lines.length, 2);
  const w = ch.welcome.permissionOverwrites.edits[0];
  assert.equal(w.target, me.id);
  assert.deepEqual(w.perms, { SendMessages: true, EmbedLinks: true, ReadMessageHistory: true, AttachFiles: true });
  assert.equal(w.opts.type, 1);
  assert.deepEqual(ch.cat.permissionOverwrites.edits[0].perms, { ManageChannels: true });
  ch.shop.permissionOverwrites.edit = async () => { throw new Error('Missing Access'); };
  blocked.add(ch.shop.id);
  assert.match((await perms.fix(world.guild, g)).find((l) => l.includes(ch.shop.id)), /Missing Access – bitte von Hand/);
});
