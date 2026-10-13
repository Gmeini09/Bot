'use strict';
// Ticket system: panel with a type menu → modal → private channel; claim, add/remove members, close with transcript.
const { embed, button, row, select, modal, ok, fail, BTN } = require('./ui');
const { transcript, slug, pad } = require('./logic');
const { F, TEXT } = require('./setup');

const isStaff = (member, g) => !!member && (member.roles?.cache?.has(g.config.staffRoleId) || member.permissions?.has?.(1n << 5n));

function panel(g) {
  const types = g.config.ticketTypes;
  return {
    embeds: [embed(g, {
      title: '🎫 Support & Tickets',
      description: [
        'Du brauchst Hilfe, hast eine Frage oder willst dich bewerben?',
        'Wähle unten aus, worum es geht – es öffnet sich ein privater Kanal nur für dich und das Team.',
        '',
        ...types.map((t) => `${t.emoji} **${t.label}** – ${t.description}`),
      ].join('\n'),
      timestamp: false,
    })],
    components: [select('ticket:open', 'Ticket öffnen …', types.map((t) => ({ label: t.label, value: t.id, description: t.description, emoji: t.emoji })))],
  };
}

/** Private text channel for one member plus the team (used by tickets and orders). */
async function privateChannel(guild, g, parentId, name, userId, topic) {
  const me = guild.members.me;
  const overwrites = [
    { id: guild.roles.everyone.id, type: 0, deny: [F.VIEW] },
    { id: userId, type: 1, allow: [F.VIEW, F.SEND, F.HISTORY, F.ATTACH, F.EMBED] },
    { id: me.id, type: 1, allow: [F.VIEW, F.SEND, F.HISTORY, F.ATTACH, F.EMBED, F.MANAGE_MESSAGES, F.MANAGE_CHANNELS] },
  ];
  if (g.config.staffRoleId && guild.roles.cache.get(g.config.staffRoleId)) overwrites.push({ id: g.config.staffRoleId, type: 0, allow: [F.VIEW, F.SEND, F.HISTORY, F.ATTACH, F.EMBED, F.MANAGE_MESSAGES] });
  const parent = parentId && guild.channels.cache.get(parentId) ? parentId : null;
  return guild.channels.create({ name, type: TEXT, parent, topic: topic?.slice(0, 1024), permissionOverwrites: overwrites, reason: 'XVY-Bot' });
}

const openTicketOf = (g, userId) => Object.entries(g.tickets).find(([, t]) => t.userId === userId);

async function onSelect(interaction, ctx) {
  const g = ctx.store.guild(interaction.guildId);
  const type = g.config.ticketTypes.find((t) => t.id === interaction.values[0]);
  if (!type) return interaction.reply(fail(g, 'Diese Ticket-Art gibt es nicht mehr.'));
  const open = openTicketOf(g, interaction.user.id);
  if (open && interaction.guild.channels.cache.get(open[0])) return interaction.reply(fail(g, `Du hast schon ein offenes Ticket: <#${open[0]}>`));
  if (open) { delete g.tickets[open[0]]; ctx.store.save(); }
  return interaction.showModal(modal(`ticket:create:${type.id}`, `${type.label}-Ticket`, [
    { id: 'topic', label: 'Worum geht es?', style: 'long', max: 1000, placeholder: 'Beschreib dein Anliegen kurz' },
  ]));
}

async function onCreate(interaction, ctx) {
  const g = ctx.store.guild(interaction.guildId);
  const typeId = interaction.customId.split(':')[2];
  const type = g.config.ticketTypes.find((t) => t.id === typeId) || { id: typeId, label: 'Ticket', emoji: '🎫' };
  const open = openTicketOf(g, interaction.user.id);
  if (open && interaction.guild.channels.cache.get(open[0])) return interaction.reply(fail(g, `Du hast schon ein offenes Ticket: <#${open[0]}>`));
  await interaction.deferReply({ ephemeral: true });
  const topic = interaction.fields.getTextInputValue('topic');
  const no = ++g.ticketCounter;
  let ch;
  try {
    ch = await privateChannel(interaction.guild, g, g.config.ticketCategoryId, `${type.id}-${pad(no)}-${slug(interaction.user.username)}`, interaction.user.id, `${type.label} von ${interaction.user.tag} (${interaction.user.id})`);
  } catch (e) {
    return interaction.editReply(fail(g, `Ticket konnte nicht erstellt werden: ${e.message}`));
  }
  g.tickets[ch.id] = { no, userId: interaction.user.id, type: type.id, topic: topic.slice(0, 1000), openedAt: Date.now(), claimedBy: null };
  ctx.store.save();
  const staffPing = g.config.staffRoleId ? `<@&${g.config.staffRoleId}>` : '';
  await ch.send({
    content: `<@${interaction.user.id}> ${staffPing}`.trim(),
    embeds: [embed(g, {
      title: `${type.emoji} ${type.label} #${pad(no)}`,
      description: `Danke, <@${interaction.user.id}>! Das Team meldet sich so schnell wie möglich.\n\n**Anliegen**\n${topic}`,
      fields: [{ name: 'Erstellt von', value: `<@${interaction.user.id}>`, inline: true }, { name: 'Art', value: type.label, inline: true }],
    })],
    components: [row(button('ticket:claim', 'Übernehmen', BTN.primary, '🙋'), button('ticket:close', 'Schließen', BTN.danger, '🔒'))],
    allowedMentions: { users: [interaction.user.id], roles: g.config.staffRoleId ? [g.config.staffRoleId] : [] },
  });
  return interaction.editReply(ok(g, `Dein Ticket ist offen: ${ch}`));
}

async function onClaim(interaction, ctx) {
  const g = ctx.store.guild(interaction.guildId);
  const t = g.tickets[interaction.channelId];
  if (!t) return interaction.reply(fail(g, 'Das ist kein offenes Ticket.'));
  if (!isStaff(interaction.member, g)) return interaction.reply(fail(g, 'Nur das Team kann Tickets übernehmen.'));
  if (t.claimedBy) return interaction.reply(fail(g, `Bereits übernommen von <@${t.claimedBy}>.`));
  t.claimedBy = interaction.user.id;
  ctx.store.save();
  return interaction.reply({ embeds: [embed(g, { description: `🙋 <@${interaction.user.id}> kümmert sich um dieses Ticket.`, timestamp: false })] });
}

async function onCloseButton(interaction, ctx) {
  const g = ctx.store.guild(interaction.guildId);
  const t = g.tickets[interaction.channelId];
  if (!t) return interaction.reply(fail(g, 'Das ist kein offenes Ticket.'));
  if (t.userId !== interaction.user.id && !isStaff(interaction.member, g)) return interaction.reply(fail(g, 'Nur der Ersteller oder das Team kann das Ticket schließen.'));
  return interaction.reply({
    embeds: [embed(g, { description: 'Ticket wirklich schließen? Der Kanal wird danach gelöscht, ein Transkript wird gespeichert.', timestamp: false })],
    components: [row(button('ticket:close:yes', 'Ja, schließen', BTN.danger, '🔒'), button('ticket:close:no', 'Abbrechen', BTN.secondary))],
    ephemeral: true,
  });
}

async function fetchAll(channel, limit = 1000) {
  const out = [];
  let before;
  while (out.length < limit) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (!batch.size) break;
    out.push(...batch.values());
    before = batch.last().id;
    if (batch.size < 100) break;
  }
  return out.reverse().map((m) => ({
    createdTimestamp: m.createdTimestamp, author: m.author?.tag ?? m.author?.username ?? '?', content: m.content,
    attachments: [...(m.attachments?.values?.() ?? [])].map((a) => a.url), embeds: m.embeds?.length || 0,
  }));
}

/** Saves the transcript to the ticket log, DMs it to the creator and deletes the channel. */
async function closeTicket(channel, ctx, by, reason = '') {
  const g = ctx.store.guild(channel.guild.id);
  const t = g.tickets[channel.id];
  if (!t) return false;
  delete g.tickets[channel.id];
  ctx.store.save();
  const text = transcript(channel.name, await fetchAll(channel).catch(() => []));
  const file = { attachment: Buffer.from(text, 'utf8'), name: `${channel.name}.txt` };
  const info = embed(g, {
    title: `🔒 Ticket #${pad(t.no)} geschlossen`,
    fields: [
      { name: 'Erstellt von', value: `<@${t.userId}>`, inline: true }, { name: 'Geschlossen von', value: `<@${by}>`, inline: true },
      { name: 'Übernommen von', value: t.claimedBy ? `<@${t.claimedBy}>` : '–', inline: true },
      { name: 'Art', value: t.type, inline: true }, { name: 'Grund', value: reason || '–' },
    ],
  });
  const log = channel.guild.channels.cache.get(g.config.ticketLogChannelId);
  if (log) await log.send({ embeds: [info], files: [file] }).catch(() => {});
  const user = await channel.client.users.fetch(t.userId).catch(() => null);
  if (user) await user.send({ embeds: [embed(g, { title: `Dein Ticket bei ${g.config.name} wurde geschlossen`, description: reason ? `Grund: ${reason}` : 'Danke für deine Anfrage!' })], files: [{ attachment: Buffer.from(text, 'utf8'), name: `${channel.name}.txt` }] }).catch(() => {});
  await channel.send({ embeds: [embed(g, { description: '🔒 Ticket wird in 5 Sekunden gelöscht …', timestamp: false })] }).catch(() => {});
  setTimeout(() => channel.delete('Ticket geschlossen').catch(() => {}), 5000);
  return true;
}

async function onCloseConfirm(interaction, ctx) {
  const g = ctx.store.guild(interaction.guildId);
  if (interaction.customId === 'ticket:close:no') return interaction.update({ embeds: [embed(g, { description: 'Abgebrochen.', timestamp: false })], components: [] });
  await interaction.update({ embeds: [embed(g, { description: '🔒 Wird geschlossen …', timestamp: false })], components: [] });
  await closeTicket(interaction.channel, ctx, interaction.user.id);
}

async function onCommand(interaction, ctx) {
  const g = ctx.store.guild(interaction.guildId);
  const t = g.tickets[interaction.channelId];
  if (!t) return interaction.reply(fail(g, 'Dieser Befehl geht nur in einem offenen Ticket-Kanal.'));
  const sub = interaction.options.getSubcommand();
  if (sub === 'schliessen') {
    await interaction.reply(ok(g, 'Ticket wird geschlossen.'));
    return closeTicket(interaction.channel, ctx, interaction.user.id, interaction.options.getString('grund') || '');
  }
  const u = interaction.options.getUser('nutzer', true);
  if (sub === 'hinzufuegen') {
    await interaction.channel.permissionOverwrites.edit(u, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true }, { type: 1, reason: 'Zum Ticket hinzugefügt' });
    return interaction.reply({ embeds: [embed(g, { description: `➕ <@${u.id}> wurde zum Ticket hinzugefügt.`, timestamp: false })] });
  }
  if (u.id === t.userId) return interaction.reply(fail(g, 'Den Ersteller kannst du nicht entfernen – schließ das Ticket stattdessen.'));
  await interaction.channel.permissionOverwrites.delete(u, 'Aus dem Ticket entfernt');
  return interaction.reply({ embeds: [embed(g, { description: `➖ <@${u.id}> wurde aus dem Ticket entfernt.`, timestamp: false })] });
}

module.exports = { panel, onSelect, onCreate, onClaim, onCloseButton, onCloseConfirm, onCommand, closeTicket, privateChannel, isStaff, fetchAll };
