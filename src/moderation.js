'use strict';
// Moderation commands, automod (spam, duplicates, invites, mass mentions), anti-raid and server logs.
const { embed, ok, fail } = require('./ui');
const { hasInvite, SpamTracker, RaidTracker, accountAgeDays } = require('./logic');
const { isStaff } = require('./tickets');

const spam = new SpamTracker();
const raid = new RaidTracker();
const HOUR = 3_600_000;

/** Can `actor` act on `target`? Returns an error text or null. */
function hierarchyError(actor, target, me) {
  if (!target) return 'Dieses Mitglied ist nicht auf dem Server.';
  if (target.id === actor.id) return 'Das geht nicht bei dir selbst.';
  if (target.id === target.guild.ownerId) return 'Der Server-Owner kann nicht moderiert werden.';
  if (target.id === me.id) return 'Das geht nicht beim Bot.';
  if (actor.id !== actor.guild.ownerId && target.roles.highest.comparePositionTo(actor.roles.highest) >= 0) return 'Das Mitglied hat eine gleich hohe oder höhere Rolle als du.';
  if (target.roles.highest.comparePositionTo(me.roles.highest) >= 0) return 'Das Mitglied steht über der Bot-Rolle – zieh die Bot-Rolle weiter nach oben.';
  return null;
}

async function dm(user, g, title, text) {
  await user.send({ embeds: [embed(g, { title, description: text })] }).catch(() => {});
}

function addWarn(g, userId, by, reason) {
  g.warns[userId] ||= [];
  g.warns[userId].push({ by, reason: String(reason).slice(0, 400), at: Date.now() });
  return g.warns[userId].length;
}

/** After a warning: at the configured count the member gets a 1 h timeout. */
async function escalate(member, g, ctx, count) {
  const at = g.config.automod.warnTimeoutAt;
  if (!at || count < at || count % at !== 0 || !member?.moderatable) return;
  await member.timeout(HOUR, `${count} Verwarnungen`).catch(() => {});
  await ctx.log(member.guild, { title: '⏳ Automatischer Timeout', description: `<@${member.id}> hat ${count} Verwarnungen → 1 Stunde Timeout.`, color: 0xe67e22 });
}

async function onCommand(interaction, ctx) {
  const g = ctx.store.guild(interaction.guildId);
  const name = interaction.commandName;
  const guild = interaction.guild;
  const me = guild.members.me;
  const reason = interaction.options.getString('grund') || 'Kein Grund angegeben';
  const logMod = (title, description, color) => ctx.log(guild, { title, description: `${description}\n**Von:** <@${interaction.user.id}>`, color });

  if (name === 'warns') {
    const u = interaction.options.getUser('nutzer', true);
    const list = g.warns[u.id] || [];
    return interaction.reply({ embeds: [embed(g, { title: `⚠️ Verwarnungen von ${u.username}`, description: list.length ? list.map((w, i) => `**${i + 1}.** ${w.reason} – <@${w.by}> <t:${Math.floor(w.at / 1000)}:R>`).join('\n') : 'Keine Verwarnungen.' })], ephemeral: true });
  }
  if (name === 'unwarn') {
    const u = interaction.options.getUser('nutzer', true);
    const n = interaction.options.getInteger('nummer');
    const list = g.warns[u.id] || [];
    if (!list.length) return interaction.reply(fail(g, 'Keine Verwarnungen vorhanden.'));
    if (n) { if (n > list.length) return interaction.reply(fail(g, `Es gibt nur ${list.length} Verwarnung(en).`)); list.splice(n - 1, 1); } else delete g.warns[u.id];
    ctx.store.save();
    await logMod('✅ Verwarnung entfernt', `<@${u.id}> ${n ? `– Nr. ${n}` : '– alle'}`, 0x2ecc71);
    return interaction.reply(ok(g, `Verwarnung${n ? ` Nr. ${n}` : 'en'} von <@${u.id}> entfernt.`));
  }
  if (name === 'unban') {
    const id = interaction.options.getString('user_id', true).trim();
    if (!/^\d{15,21}$/.test(id)) return interaction.reply(fail(g, 'Ungültige Discord-ID.'));
    try { await guild.members.unban(id, reason); } catch { return interaction.reply(fail(g, 'Dieser Nutzer ist nicht gebannt.')); }
    await logMod('♻️ Entbannt', `<@${id}> (${id})\n**Grund:** ${reason}`, 0x2ecc71);
    return interaction.reply(ok(g, `<@${id}> wurde entbannt.`));
  }
  if (name === 'clear') {
    const n = interaction.options.getInteger('anzahl', true);
    const u = interaction.options.getUser('nutzer');
    await interaction.deferReply({ ephemeral: true });
    let msgs = await interaction.channel.messages.fetch({ limit: 100 });
    if (u) msgs = msgs.filter((m) => m.author.id === u.id);
    const del = await interaction.channel.bulkDelete([...msgs.values()].slice(0, n), true).catch(() => null);
    const count = del?.size ?? 0;
    await logMod('🧹 Nachrichten gelöscht', `${count} in <#${interaction.channelId}>${u ? ` von <@${u.id}>` : ''}`);
    return interaction.editReply(ok(g, `${count} Nachricht(en) gelöscht${count < n ? ' (ältere als 14 Tage kann Discord nicht in einem Rutsch löschen)' : ''}.`));
  }
  if (name === 'lock' || name === 'unlock') {
    await interaction.channel.permissionOverwrites.edit(guild.roles.everyone.id, { SendMessages: name === 'lock' ? false : null });
    if (g.config.memberRoleId && guild.roles.cache.get(g.config.memberRoleId)) await interaction.channel.permissionOverwrites.edit(g.config.memberRoleId, { SendMessages: name === 'lock' ? false : null }).catch(() => {});
    await logMod(name === 'lock' ? '🔒 Kanal gesperrt' : '🔓 Kanal entsperrt', `<#${interaction.channelId}>${name === 'lock' ? `\n**Grund:** ${reason}` : ''}`);
    return interaction.reply({ embeds: [embed(g, { description: name === 'lock' ? `🔒 Kanal gesperrt – ${reason}` : '🔓 Kanal entsperrt.', timestamp: false })] });
  }
  if (name === 'slowmode') {
    const s = interaction.options.getInteger('sekunden', true);
    await interaction.channel.setRateLimitPerUser(s);
    return interaction.reply(ok(g, s ? `Slowmode: ${s} Sekunden.` : 'Slowmode aus.'));
  }
  if (name === 'raidmode') {
    const on = interaction.options.getBoolean('an', true);
    if (on) raid.until.set(guild.id, Date.now() + 10 * 60_000); else raid.stop(guild.id);
    await logMod(on ? '🚨 Raid-Modus an' : '✅ Raid-Modus aus', on ? 'Neue Accounts unter 7 Tagen werden 10 Minuten lang gekickt.' : 'Beitritte laufen wieder normal.');
    return interaction.reply(ok(g, on ? 'Raid-Modus für 10 Minuten aktiv.' : 'Raid-Modus beendet.'));
  }

  // member actions
  const user = interaction.options.getUser('nutzer', true);
  const target = await guild.members.fetch(user.id).catch(() => null);
  if (name === 'ban' && !target) {
    await guild.members.ban(user.id, { reason, deleteMessageSeconds: (interaction.options.getInteger('nachrichten_tage') || 0) * 86400 });
    await logMod('🔨 Gebannt', `<@${user.id}> (${user.id})\n**Grund:** ${reason}`, 0xe74c3c);
    return interaction.reply(ok(g, `<@${user.id}> wurde gebannt.`));
  }
  const err = hierarchyError(interaction.member, target, me);
  if (err) return interaction.reply(fail(g, err));

  if (name === 'warn') {
    const count = addWarn(g, user.id, interaction.user.id, reason);
    ctx.store.save();
    await dm(user, g, `⚠️ Verwarnung auf ${g.config.name}`, `**Grund:** ${reason}\nDas ist deine ${count}. Verwarnung.`);
    await logMod('⚠️ Verwarnt', `<@${user.id}> – ${count}. Verwarnung\n**Grund:** ${reason}`, 0xf1c40f);
    await interaction.reply(ok(g, `<@${user.id}> verwarnt (${count}. Verwarnung).`));
    return escalate(target, g, ctx, count);
  }
  if (name === 'timeout') {
    const min = interaction.options.getInteger('minuten', true);
    if (!target.moderatable) return interaction.reply(fail(g, 'Dieses Mitglied kann ich nicht stummschalten.'));
    await target.timeout(min * 60_000, reason);
    await dm(user, g, `⏳ Timeout auf ${g.config.name}`, `**Dauer:** ${min} Minuten\n**Grund:** ${reason}`);
    await logMod('⏳ Timeout', `<@${user.id}> – ${min} min\n**Grund:** ${reason}`, 0xe67e22);
    return interaction.reply(ok(g, `<@${user.id}> ist für ${min} Minuten stummgeschaltet.`));
  }
  if (name === 'untimeout') {
    await target.timeout(null, 'Aufgehoben');
    await logMod('🔊 Timeout aufgehoben', `<@${user.id}>`, 0x2ecc71);
    return interaction.reply(ok(g, `Timeout von <@${user.id}> aufgehoben.`));
  }
  if (name === 'kick') {
    if (!target.kickable) return interaction.reply(fail(g, 'Dieses Mitglied kann ich nicht kicken.'));
    await dm(user, g, `👢 Gekickt von ${g.config.name}`, `**Grund:** ${reason}`);
    await target.kick(reason);
    await logMod('👢 Gekickt', `<@${user.id}> (${user.id})\n**Grund:** ${reason}`, 0xe67e22);
    return interaction.reply(ok(g, `<@${user.id}> wurde gekickt.`));
  }
  if (name === 'ban') {
    if (!target.bannable) return interaction.reply(fail(g, 'Dieses Mitglied kann ich nicht bannen.'));
    await dm(user, g, `🔨 Gebannt von ${g.config.name}`, `**Grund:** ${reason}`);
    await target.ban({ reason, deleteMessageSeconds: (interaction.options.getInteger('nachrichten_tage') || 0) * 86400 });
    await logMod('🔨 Gebannt', `<@${user.id}> (${user.id})\n**Grund:** ${reason}`, 0xe74c3c);
    return interaction.reply(ok(g, `<@${user.id}> wurde gebannt.`));
  }
  return undefined;
}

// ── automod
async function onMessage(message, ctx) {
  if (!message.guild || message.author.bot || message.webhookId) return;
  const g = ctx.store.guild(message.guild.id);
  const a = g.config.automod;
  if (!a.enabled) return;
  const member = message.member;
  if (!member || isStaff(member, g) || member.permissions.has(1n << 13n)) return; // team and moderators are exempt
  let reason = null;
  if (a.invites && hasInvite(message.content)) reason = 'Fremde Einladungslinks sind nicht erlaubt';
  else if (a.maxMentions && (message.mentions.users.size + message.mentions.roles.size) >= a.maxMentions) reason = 'Massen-Erwähnungen';
  else {
    const s = spam.check(`${message.guild.id}:${message.author.id}`, message.content, Date.now(), a);
    if (s) reason = s === 'spam' ? 'Spam (zu viele Nachrichten)' : 'Spam (gleiche Nachricht wiederholt)';
  }
  if (!reason) return;
  spam.reset(`${message.guild.id}:${message.author.id}`);
  await message.delete().catch(() => {});
  // spam bursts: clear the user's last messages in this channel too
  if (reason.startsWith('Spam')) {
    const recent = await message.channel.messages.fetch({ limit: 30 }).catch(() => null);
    if (recent) await message.channel.bulkDelete([...recent.values()].filter((m) => m.author.id === message.author.id && Date.now() - m.createdTimestamp < 30_000), true).catch(() => {});
  }
  if (member.moderatable) await member.timeout(5 * 60_000, `Automod: ${reason}`).catch(() => {});
  const count = addWarn(g, member.id, message.client.user.id, `Automod: ${reason}`);
  ctx.store.save();
  await message.channel.send({ content: `<@${member.id}>`, embeds: [embed(g, { description: `🛡️ ${reason} – 5 Minuten Timeout.`, color: 0xe67e22, timestamp: false })], allowedMentions: { users: [member.id] } })
    .then((m) => setTimeout(() => m.delete().catch(() => {}), 10_000)).catch(() => {});
  await ctx.log(message.guild, { title: '🛡️ Automod', description: `<@${member.id}> in <#${message.channelId}>\n**Grund:** ${reason} (${count}. Verwarnung)\n**Nachricht:** ${String(message.content || '').slice(0, 500) || '–'}`, color: 0xe67e22 });
  await escalate(member, g, ctx, count);
}

/** Join checks: minimum account age and raid mode (accounts younger than 7 days are kicked). Returns true if kicked. */
async function onJoin(member, ctx) {
  const g = ctx.store.guild(member.guild.id);
  const a = g.config.automod;
  if (!a.enabled || member.user.bot) return false;
  const age = accountAgeDays(member.user.createdTimestamp);
  const state = raid.join(member.guild.id, Date.now(), a);
  if (state === 'started') await ctx.log(member.guild, { title: '🚨 Raid erkannt', description: `${a.raidJoins} Beitritte in ${a.raidSeconds} s. Für 10 Minuten werden neue Accounts unter 7 Tagen automatisch gekickt.\nBeenden: \`/raidmode an:false\``, color: 0xe74c3c, ping: true });
  let why = null;
  if (a.minAccountAgeDays && age < a.minAccountAgeDays) why = `Account jünger als ${a.minAccountAgeDays} Tage`;
  else if (raid.active(member.guild.id, Date.now()) && age < 7) why = 'Raid-Schutz (neuer Account)';
  if (!why || !member.kickable) return false;
  await dm(member.user, g, `Beitritt zu ${g.config.name} abgelehnt`, `${why}. Versuch es später noch einmal.`);
  await member.kick(why).catch(() => {});
  await ctx.log(member.guild, { title: '🚫 Beitritt abgelehnt', description: `<@${member.id}> (${member.user.tag}) – ${why}, Account ${age} Tage alt.`, color: 0xe74c3c });
  return true;
}

module.exports = { onCommand, onMessage, onJoin, hierarchyError, addWarn, spam, raid };
