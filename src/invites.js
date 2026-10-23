'use strict';
// Invite tracking: on every join the bot compares invite use counts to find the link that was used and who made it.
// Counts per inviter: joins, left again, fake (account younger than 7 days). Needs "Manage Server" to read invites.
const { embed, fail } = require('./ui');

const cache = new Map(); // guildId → Map(code → { uses, inviterId })
const FAKE_DAYS = 7;

async function load(guild) {
  const list = await guild.invites.fetch().catch(() => null);
  if (!list) return false;
  const m = new Map();
  for (const inv of list.values()) m.set(inv.code, { uses: inv.uses ?? 0, inviterId: inv.inviterId ?? inv.inviter?.id ?? null });
  if (guild.vanityURLCode) {
    const v = await guild.fetchVanityData?.().catch(() => null);
    if (v) m.set(`vanity:${v.code}`, { uses: v.uses ?? 0, inviterId: null });
  }
  cache.set(guild.id, m);
  return true;
}

const onCreate = (inv) => { if (inv.guild) cache.get(inv.guild.id)?.set(inv.code, { uses: inv.uses ?? 0, inviterId: inv.inviterId ?? inv.inviter?.id ?? null }); };
const onDelete = (inv) => { if (inv.guild) cache.get(inv.guild.id)?.delete(inv.code); };

/** Which cached invite went up (pure, for tests). Returns { code, inviterId } or null when unclear. */
function findUsed(before, after) {
  const hits = [];
  for (const [code, a] of after) {
    const b = before.get(code);
    if ((a.uses ?? 0) > (b?.uses ?? 0)) hits.push({ code, inviterId: a.inviterId });
  }
  // a one-time invite disappears once used
  if (!hits.length) for (const [code, b] of before) if (!after.has(code) && !code.startsWith('vanity:')) hits.push({ code, inviterId: b.inviterId, gone: true });
  return hits.length === 1 ? hits[0] : null;
}

const statsOf = (g, id) => (g.invites.stats[id] ||= { joins: 0, left: 0, fake: 0 });
const net = (s) => Math.max(0, (s?.joins || 0) - (s?.left || 0) - (s?.fake || 0));

/** On join: who invited this member? Returns { inviterId, code, count } or null. */
async function onJoin(member, ctx) {
  const guild = member.guild;
  const before = cache.get(guild.id);
  if (!before) { await load(guild); return null; }
  await load(guild);
  const used = findUsed(before, cache.get(guild.id) || new Map());
  if (!used) return null;
  const g = ctx.store.guild(guild.id);
  const fake = (Date.now() - (member.user?.createdTimestamp ?? Date.now())) < FAKE_DAYS * 86_400_000;
  const vanity = used.code.startsWith('vanity:');
  g.invites.members[member.id] = { inviterId: used.inviterId, code: used.code, at: Date.now(), fake };
  if (used.inviterId && !vanity) {
    const s = statsOf(g, used.inviterId);
    // rejoining the same inviter doesn't count twice
    if (!(s.members ||= []).includes(member.id)) { s.members.push(member.id); s.joins++; if (fake) s.fake++; }
    else if (s.leftIds?.includes(member.id)) { s.left = Math.max(0, s.left - 1); s.leftIds = s.leftIds.filter((x) => x !== member.id); }
  }
  ctx.store.save();
  return { inviterId: vanity ? null : used.inviterId, code: vanity ? used.code.slice(7) : used.code, vanity, fake, count: used.inviterId && !vanity ? net(statsOf(g, used.inviterId)) : null };
}

function onLeave(member, ctx) {
  const g = ctx.store.guild(member.guild.id);
  const rec = g.invites.members[member.id];
  if (!rec?.inviterId) return null;
  const s = statsOf(g, rec.inviterId);
  if (!(s.leftIds ||= []).includes(member.id)) { s.leftIds.push(member.id); s.left++; }
  ctx.store.save();
  return rec.inviterId;
}

/** Text for the join log. */
function joinText(r) {
  if (!r) return 'Einladung: unbekannt';
  if (r.vanity) return `Einladung: Vanity-Link \`${r.code}\``;
  if (!r.inviterId) return `Einladung: \`${r.code}\``;
  return `Eingeladen von <@${r.inviterId}> (\`${r.code}\`) – hat jetzt **${r.count}** Invite(s)${r.fake ? ' · ⚠️ neuer Account' : ''}`;
}

async function onCommand(interaction, ctx) {
  const g = ctx.store.guild(interaction.guildId);
  const sub = interaction.options.getSubcommand();
  if (sub === 'rangliste') {
    const top = Object.entries(g.invites.stats).map(([id, s]) => [id, net(s), s]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 15);
    const medal = ['🥇', '🥈', '🥉'];
    return interaction.reply({ embeds: [embed(g, {
      title: `📨 Invite-Rangliste – ${g.config.name}`,
      description: top.length ? top.map(([id, n, s], i) => `${medal[i] ?? `**${i + 1}.**`} <@${id}> – **${n}** (${s.joins} beigetreten, ${s.left} wieder weg${s.fake ? `, ${s.fake} Fake` : ''})`).join('\n') : 'Noch keine Einladungen gezählt.',
    })], allowedMentions: { parse: [] } });
  }
  const u = interaction.options.getUser('nutzer') || interaction.user;
  const s = g.invites.stats[u.id];
  if (!cache.has(interaction.guildId)) await load(interaction.guild);
  if (!cache.has(interaction.guildId) && !s) return interaction.reply(fail(g, 'Der Bot darf die Einladungen nicht lesen – er braucht das Recht „Server verwalten“.'));
  const by = g.invites.members[u.id]?.inviterId;
  return interaction.reply({ embeds: [embed(g, {
    title: `📨 Invites von ${u.username}`,
    description: `**${net(s)}** Invites\n✅ ${s?.joins || 0} beigetreten · 🚪 ${s?.left || 0} wieder weg · ⚠️ ${s?.fake || 0} Fake (Account < ${FAKE_DAYS} Tage)${by ? `\n\nSelbst eingeladen von <@${by}>` : ''}`,
    thumbnail: u.displayAvatarURL?.({ size: 128 }),
  })], allowedMentions: { parse: [] } });
}

module.exports = { load, onCreate, onDelete, findUsed, onJoin, onLeave, joinText, onCommand, net, cache };
