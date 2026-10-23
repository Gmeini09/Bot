'use strict';
// Extra server logs in the mod log: role changes on members, nicknames, timeouts given in Discord's own menu,
// channels and roles created/deleted, role permission changes. The audit log says who did it; the bot's own
// actions are skipped (they are logged where they happen).

const AL = { CHANNEL_CREATE: 10, CHANNEL_DELETE: 12, MEMBER_UPDATE: 24, MEMBER_ROLE_UPDATE: 25, ROLE_CREATE: 30, ROLE_UPDATE: 31, ROLE_DELETE: 32 };

const PERM_NAMES = {
  3: 'Administrator', 1: 'Kicken', 2: 'Bannen', 4: 'Kanäle verwalten', 5: 'Server verwalten', 7: 'Audit-Log', 13: 'Nachrichten verwalten',
  17: '@everyone erwähnen', 27: 'Nicknames verwalten', 28: 'Rollen verwalten', 29: 'Webhooks verwalten', 40: 'Timeout',
};
const CHANNEL_TYPES = { 0: 'Textkanal', 2: 'Sprachkanal', 4: 'Kategorie', 5: 'Ankündigungen', 13: 'Stage', 15: 'Forum' };

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Latest audit-log entry of `type` for `targetId` (within 15 s). Audit entries show up shortly after the event. */
async function executor(guild, type, targetId, delay = 1200) {
  if (delay) await wait(delay);
  const logs = await guild.fetchAuditLogs?.({ type, limit: 5 }).catch(() => null);
  const e = logs?.entries?.find?.((x) => x.targetId === targetId && Date.now() - x.createdTimestamp < 15_000);
  return e ? { id: e.executorId, reason: e.reason } : null;
}

const by = (ex) => (ex?.id ? `\n**Von:** <@${ex.id}>` : '') + (ex?.reason ? `\n**Grund:** ${ex.reason}` : '');
const mine = (guild, ex) => ex?.id && ex.id === guild.client?.user?.id;

/** Lines that describe what changed on a member (pure, for tests). */
function memberDiff(before, after) {
  const added = [...after.roles.cache.keys()].filter((id) => !before.roles.cache.has(id) && id !== after.guild.id);
  const removed = [...before.roles.cache.keys()].filter((id) => !after.roles.cache.has(id) && id !== after.guild.id);
  const out = { added, removed, nick: null, timeout: null };
  if ((before.nickname ?? null) !== (after.nickname ?? null)) out.nick = [before.nickname ?? null, after.nickname ?? null];
  const t0 = before.communicationDisabledUntilTimestamp ?? null, t1 = after.communicationDisabledUntilTimestamp ?? null;
  const active = (t) => t && t > Date.now();
  if (active(t1) && t1 !== t0) out.timeout = { until: t1 };
  else if (active(t0) && !active(t1)) out.timeout = { until: null };
  return out;
}

/** Changed permissions of a role: { added: [names], removed: [names] } (only the powerful ones). */
function permDiff(before, after) {
  const b = BigInt(before?.bitfield ?? before ?? 0), a = BigInt(after?.bitfield ?? after ?? 0);
  const added = [], removed = [];
  for (const [bit, name] of Object.entries(PERM_NAMES)) {
    const f = 1n << BigInt(bit);
    if ((a & f) && !(b & f)) added.push(name);
    if (!(a & f) && (b & f)) removed.push(name);
  }
  return { added, removed };
}

async function onMemberUpdate(before, after, ctx) {
  if (before.partial) return;
  const d = memberDiff(before, after);
  const guild = after.guild;
  const who = `<@${after.id}> (${after.user?.tag ?? after.id})`;
  if (d.added.length || d.removed.length) {
    const ex = await executor(guild, AL.MEMBER_ROLE_UPDATE, after.id);
    if (!mine(guild, ex)) {
      const lines = [...d.added.map((id) => `➕ <@&${id}>`), ...d.removed.map((id) => `➖ <@&${id}>`)];
      await ctx.log(guild, { title: '🎭 Rollen geändert', description: `${who}\n${lines.join('\n')}${by(ex)}`, color: 0x9b59b6 });
    }
  }
  if (d.nick || d.timeout) {
    const ex = await executor(guild, AL.MEMBER_UPDATE, after.id, d.added.length || d.removed.length ? 0 : 1200);
    if (mine(guild, ex)) return;
    if (d.nick) await ctx.log(guild, { title: '✏️ Nickname geändert', description: `${who}\n**Vorher:** ${d.nick[0] ?? '–'}\n**Nachher:** ${d.nick[1] ?? '–'}${by(ex)}`, color: 0x3498db });
    if (d.timeout) {
      await ctx.log(guild, d.timeout.until
        ? { title: '⏳ Timeout', description: `${who} bis <t:${Math.floor(d.timeout.until / 1000)}:f>${by(ex)}`, color: 0xe67e22 }
        : { title: '🔊 Timeout aufgehoben', description: `${who}${by(ex)}`, color: 0x2ecc71 });
    }
  }
}

async function onChannel(channel, created, ctx) {
  if (!channel.guild) return;
  const ex = await executor(channel.guild, created ? AL.CHANNEL_CREATE : AL.CHANNEL_DELETE, channel.id);
  if (mine(channel.guild, ex)) return; // tickets and orders
  const kind = CHANNEL_TYPES[channel.type] ?? 'Kanal';
  await ctx.log(channel.guild, {
    title: created ? '📁 Kanal erstellt' : '🗑️ Kanal gelöscht',
    description: `${created ? `<#${channel.id}> ` : ''}**${channel.name}** (${kind})${by(ex)}`, color: created ? 0x2ecc71 : 0xe74c3c,
  });
}

async function onRole(role, created, ctx) {
  const ex = await executor(role.guild, created ? AL.ROLE_CREATE : AL.ROLE_DELETE, role.id);
  if (mine(role.guild, ex)) return;
  await ctx.log(role.guild, { title: created ? '🏷️ Rolle erstellt' : '🗑️ Rolle gelöscht', description: `${created ? `<@&${role.id}> ` : ''}**${role.name}**${by(ex)}`, color: created ? 0x2ecc71 : 0xe74c3c });
}

async function onRoleUpdate(before, after, ctx) {
  const p = permDiff(before.permissions, after.permissions);
  const renamed = before.name !== after.name;
  if (!p.added.length && !p.removed.length && !renamed) return;
  const ex = await executor(after.guild, AL.ROLE_UPDATE, after.id);
  if (mine(after.guild, ex)) return;
  const lines = [];
  if (renamed) lines.push(`**Name:** ${before.name} → ${after.name}`);
  if (p.added.length) lines.push(`**⚠️ Neue Rechte:** ${p.added.join(', ')}`);
  if (p.removed.length) lines.push(`**Entfernte Rechte:** ${p.removed.join(', ')}`);
  await ctx.log(after.guild, { title: '🏷️ Rolle geändert', description: `<@&${after.id}>\n${lines.join('\n')}${by(ex)}`, color: p.added.length ? 0xe67e22 : 0x3498db, ping: p.added.includes('Administrator') });
}

module.exports = { memberDiff, permDiff, executor, onMemberUpdate, onChannel, onRole, onRoleUpdate, AL };
