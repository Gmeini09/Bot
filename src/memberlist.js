'use strict';
// Member list: one message (or a few, for large servers) in the member-list channel. For every hoisted role
// (shown separately in Discord's sidebar) the role, then its members – each member only under their highest
// such role. Mentions inside embeds are clickable but never notify anyone, so updates don't spam pings.
// Updated automatically (debounced) when roles or members change.
const { embed } = require('./ui');

const MAX_DESC = 3900; // embed description limit is 4096
const MAX_MESSAGES = 8;
const DEBOUNCE_MS = 15_000;

/** True for roles almost everyone has (the verified/member role) – those would list the whole server. */
function isEveryoneRole(guild, g, role) {
  if (role.id === guild.id || role.id === g.config.memberRoleId) return true;
  const humans = [...guild.members.cache.values()].filter((m) => !m.user?.bot);
  if (humans.length < 20) return false;
  return humans.filter((m) => m.roles.cache.has(role.id)).length > humans.length / 2;
}

/** Roles that get a section: configured ones in the given order, otherwise every hoisted role highest first.
 *  Never bot roles, the verified role or a role more than half the server has. */
function listRoles(guild, g) {
  const ids = g.config.memberListRoleIds || [];
  const ok = (r) => r && !r.managed && !isEveryoneRole(guild, g, r);
  if (ids.length) return ids.map((id) => guild.roles.cache.get(id)).filter(ok);
  return [...guild.roles.cache.values()].filter((r) => r.hoist && ok(r)).sort((a, b) => b.position - a.position);
}

/** [{ role, members: [member] }] – every human member once, under their highest listed role. */
function sections(guild, g) {
  const roles = listRoles(guild, g);
  const out = roles.map((role) => ({ role, members: [] }));
  const idx = new Map(roles.map((r, i) => [r.id, i]));
  for (const m of guild.members.cache.values()) {
    if (m.user?.bot) continue;
    let best = -1;
    for (const id of m.roles.cache.keys()) { const i = idx.get(id); if (i !== undefined && (best === -1 || i < best)) best = i; }
    if (best !== -1) out[best].members.push(m);
  }
  const name = (m) => (m.displayName || m.user?.username || '').toLowerCase();
  for (const s of out) s.members.sort((a, b) => name(a).localeCompare(name(b), 'de'));
  return out.filter((s) => s.members.length);
}

/** The text blocks, each ≤ MAX_DESC characters, one per message. */
function blocks(guild, g) {
  const secs = sections(guild, g);
  const lines = [];
  for (const s of secs) {
    if (lines.length) lines.push('');
    lines.push(`<@&${s.role.id}> · **${s.members.length}**`);
    for (const m of s.members) lines.push(`> <@${m.id}>`);
  }
  if (!lines.length) return [listRoles(guild, g).length ? 'Noch niemand hat eine dieser Rollen.' : 'Keine Rollen zum Anzeigen – in den Servereinstellungen bei einer Rolle „Rollenmitglieder getrennt anzeigen“ einschalten.'];
  const out = [''];
  let header = '';
  for (const l of lines) {
    if (l.startsWith('<@&')) header = l.replace(/ · .*/, ' · *(Fortsetzung)*');
    const cur = out[out.length - 1];
    if (cur.length + l.length + 1 <= MAX_DESC) { out[out.length - 1] = cur ? `${cur}\n${l}` : l; continue; }
    if (out.length === MAX_MESSAGES) { out[out.length - 1] += '\n…'; break; }
    if (l === '') { out.push(''); continue; }
    // a role's members continue in the next message → repeat the role there
    out.push(l.startsWith('> ') ? `${header}\n${l}` : l);
  }
  return out.map((s) => s.trim());
}

function payloads(guild, g) {
  const list = blocks(guild, g);
  const total = sections(guild, g).reduce((a, s) => a + s.members.length, 0);
  return list.map((description, i) => ({
    embeds: [embed(g, {
      title: i === 0 ? `👥 Mitgliederliste – ${g.config.name}` : undefined,
      description,
      footer: i === list.length - 1 ? `${total} Mitglieder · aktualisiert` : g.config.name,
      timestamp: i === list.length - 1,
    })],
    allowedMentions: { parse: [] },
  }));
}

/** Posts or edits the list. Edits only messages whose text changed; removes surplus messages. */
async function refresh(guild, g, ctx, { fresh = false } = {}) {
  const ch = g.config.memberListChannelId && guild.channels.cache.get(g.config.memberListChannelId);
  if (!ch) return null;
  const want = payloads(guild, g);
  const ids = fresh ? [] : (Array.isArray(g.panels.memberList) ? g.panels.memberList : []);
  const old = [];
  for (const id of ids) old.push(await ch.messages.fetch(id).catch(() => null));
  // a message of the list was deleted → post the whole list again so the order stays right
  if (old.some((m) => !m) || old.length > want.length) {
    for (const m of old) if (m) await m.delete().catch(() => {});
    old.length = 0;
  }
  const kept = [];
  for (let i = 0; i < want.length; i++) {
    const m = old[i];
    if (m) {
      if (m.embeds?.[0]?.description !== want[i].embeds[0].description || i === want.length - 1) await m.edit(want[i]);
      kept.push(m.id);
    } else kept.push((await ch.send(want[i])).id);
  }
  g.panels.memberList = kept;
  ctx.store.save();
  return kept;
}

const timers = new Map();
/** Refreshes after things settled (many role changes at once → one edit). */
function schedule(guild, ctx, ms = DEBOUNCE_MS) {
  const g = ctx.store.guild(guild.id);
  if (!g.config.memberListChannelId) return;
  clearTimeout(timers.get(guild.id));
  const t = setTimeout(() => {
    timers.delete(guild.id);
    refresh(guild, ctx.store.guild(guild.id), ctx).catch((e) => console.error('❌ Mitgliederliste:', e.message));
  }, ms);
  t.unref?.();
  timers.set(guild.id, t);
}

/** True when a member update changed something the list shows. */
const relevantChange = (before, after) => before.partial
  || before.displayName !== after.displayName
  || before.roles.cache.size !== after.roles.cache.size
  || [...after.roles.cache.keys()].some((id) => !before.roles.cache.has(id));

module.exports = { isEveryoneRole, listRoles, sections, blocks, payloads, refresh, schedule, relevantChange };
