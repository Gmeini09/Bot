'use strict';
// Member list: hoisted roles with their members, each member once, split across messages, kept up to date.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeWorld, interaction } = require('./fake');
const { Store } = require('../src/store');
const setup = require('../src/setup');
const memberlist = require('../src/memberlist');

async function world0() {
  const world = makeWorld();
  const store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'xvy-ml-')));
  const ctx = { client: world.client, store, async log() {}, verify: { panel: () => ({}) }, tickets: { panel: () => ({}) }, shop: { panel: () => ({}) } };
  const G = world.guild;
  const g = store.guild(G.id);
  const role = async (name, position, hoist = true) => { const r = await G.roles.create({ name, hoist }); r.position = position; return r; };
  const founder = await role('FOUNDER', 30), mod = await role('・MOD', 20), member = await role('.gg/xvy', 10), hidden = await role('giveaway perms', 5, false);
  const ch = await G.channels.create({ name: 'member-list', type: 0 });
  g.config.memberListChannelId = ch.id;
  return { world, store, ctx, G, g, ch, founder, mod, member, hidden };
}

test('lists each member once under their highest hoisted role; bots and unlisted roles left out', async () => {
  const w = await world0();
  const a = w.world.addUser('Anna', { roles: [w.founder, w.mod, w.member] });
  const b = w.world.addUser('Ben', { roles: [w.mod, w.hidden] });
  const c = w.world.addUser('Cem', { roles: [w.member] });
  w.world.addUser('Dora', { roles: [w.hidden] });
  const secs = memberlist.sections(w.G, w.g);
  assert.deepEqual(secs.map((s) => [s.role.name, s.members.map((m) => m.user.username)]), [['FOUNDER', ['Anna']], ['・MOD', ['Ben']], ['.gg/xvy', ['Cem']]]);
  const [text] = memberlist.blocks(w.G, w.g);
  assert.equal(text, `<@&${w.founder.id}> · **1**\n> <@${a.id}>\n\n<@&${w.mod.id}> · **1**\n> <@${b.id}>\n\n<@&${w.member.id}> · **1**\n> <@${c.id}>`);
  // no notifications: mentions sit in an embed and nothing may be parsed
  assert.deepEqual(memberlist.payloads(w.G, w.g)[0].allowedMentions, { parse: [] });
});

test('configured roles override the hoisted ones', async () => {
  const w = await world0();
  w.world.addUser('Dora', { roles: [w.hidden] });
  w.world.addUser('Anna', { roles: [w.founder] });
  w.g.config.memberListRoleIds = [w.hidden.id];
  assert.deepEqual(memberlist.sections(w.G, w.g).map((s) => s.role.name), ['giveaway perms']);
});

test('posts once, then edits in place; a long list is split and the role is repeated', async () => {
  const w = await world0();
  const first = await memberlist.refresh(w.G, w.g, w.ctx);
  assert.equal(first.length, 1);
  assert.match(w.ch.messages.cache.get(first[0]).embeds[0].description, /Noch niemand/);
  for (let i = 0; i < 250; i++) w.world.addUser(`User${String(i).padStart(3, '0')}`, { roles: [w.member] });
  const ids = await memberlist.refresh(w.G, w.g, w.ctx);
  assert.ok(ids.length >= 2, 'split into several messages');
  assert.equal(ids[0], first[0], 'first message edited, not reposted');
  const msgs = ids.map((id) => w.ch.messages.cache.get(id));
  for (const m of msgs) assert.ok(m.embeds[0].description.length <= 4096);
  assert.match(msgs[1].embeds[0].description, /^<@&\d+> · \*\(Fortsetzung\)\*/);
  const all = msgs.map((m) => m.embeds[0].description).join('\n');
  assert.equal((all.match(/^> <@\d+>$/gm) || []).length, 250, 'everyone listed exactly once');
  // shrinks again → surplus messages removed, list reposted in order
  for (const m of [...w.G.members.cache.values()]) if (m.user.username.startsWith('User') && m.user.username > 'User005') w.G.members.cache.delete(m.id);
  const after = await memberlist.refresh(w.G, w.g, w.ctx);
  assert.equal(after.length, 1);
  assert.equal(w.ch.messages.cache.size, 1);
});

test('a deleted list message is posted again; /panel memberlist reposts at the bottom', async () => {
  const w = await world0();
  w.world.addUser('Anna', { roles: [w.founder] });
  const [id] = await memberlist.refresh(w.G, w.g, w.ctx);
  await w.ch.messages.cache.get(id).delete();
  const [id2] = await memberlist.refresh(w.G, w.g, w.ctx);
  assert.notEqual(id2, id);
  w.G.members.fetch = async () => w.G.members.cache;
  const i = interaction(w.world, w.world.owner, 'command', { commandName: 'panel', opts: { art: 'memberlist' } });
  await setup.repostPanel(i, w.ctx);
  assert.equal(w.ch.messages.cache.size, 1);
  assert.notEqual(w.g.panels.memberList[0], id2);
  assert.match(JSON.stringify(i.calls.at(-1)[1]), /Mitgliederliste gepostet/);
});

test('/setup report includes the member list', async () => {
  const w = await world0();
  w.world.addUser('Anna', { roles: [w.mod] });
  const lines = await setup.postAll(w.G, w.g, w.ctx);
  assert.ok(lines.some((l) => l.startsWith('✅ Mitgliederliste')));
});

test('only role/name changes count as relevant member updates', () => {
  const R = (ids) => ({ cache: new Map(ids.map((x) => [x, {}])) });
  assert.equal(memberlist.relevantChange({ roles: R(['a']), displayName: 'x' }, { roles: R(['a']), displayName: 'x' }), false);
  assert.equal(memberlist.relevantChange({ roles: R(['a']), displayName: 'x' }, { roles: R(['b']), displayName: 'x' }), true);
  assert.equal(memberlist.relevantChange({ roles: R(['a']), displayName: 'x' }, { roles: R(['a']), displayName: 'y' }), true);
});
