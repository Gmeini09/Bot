'use strict';
// Self roles: the owner picks existing roles (/rollen hinzufuegen), members toggle them with buttons.
// Roles with dangerous permissions, managed roles and team roles are refused – nobody can give himself power.
const { embed, button, row, ok, fail, BTN } = require('./ui');
const { postPanel } = require('./setup');
const { validEmoji } = require('./logic');

// Administrator, Kick, Ban, Manage Channels/Guild/Messages/Roles/Webhooks/Nicknames, Moderate, Mention everyone, View audit log
const DANGEROUS = (1n << 3n) | (1n << 1n) | (1n << 2n) | (1n << 4n) | (1n << 5n) | (1n << 13n) | (1n << 28n) | (1n << 29n) | (1n << 27n) | (1n << 40n) | (1n << 17n) | (1n << 7n);

function whyNot(role, guild, g) {
  if (!role || role.id === guild.id) return 'Diese Rolle geht nicht.';
  if (role.managed) return 'Diese Rolle gehört zu einem Bot oder einer Integration.';
  if ((g.config.staffRoleIds || []).includes(role.id)) return 'Team-Rollen können nicht selbst gewählt werden.';
  const perms = role.permissions?.bitfield ?? BigInt(role.permissions ?? 0);
  if ((BigInt(perms) & DANGEROUS) !== 0n) return 'Diese Rolle hat Moderations- oder Admin-Rechte und kann deshalb nicht selbst gewählt werden.';
  const me = guild.members.me;
  if (me && role.comparePositionTo(me.roles.highest) >= 0) return 'Die Rolle steht über der Bot-Rolle – zieh die Bot-Rolle in den Servereinstellungen höher.';
  return null;
}

function panel(g) {
  const list = g.selfRoles;
  const components = [];
  for (let i = 0; i < Math.min(list.length, 25); i += 5) components.push(row(...list.slice(i, i + 5).map((r) => button(`role:${r.roleId}`, r.label, BTN.secondary, r.emoji))));
  return {
    embeds: [embed(g, {
      title: '🎭 Rollen auswählen',
      description: list.length
        ? `Klick auf einen Button, um die Rolle zu bekommen – nochmal klicken entfernt sie.\n\n${list.map((r) => `${r.emoji ? `${r.emoji} ` : ''}<@&${r.roleId}>${r.description ? ` – ${r.description}` : ''}`).join('\n')}`
        : 'Noch keine Rollen – `/rollen hinzufuegen`.',
      timestamp: false,
    })],
    components,
  };
}

const refresh = (guild, g) => (g.config.rolesChannelId ? postPanel(guild, g, 'roles', g.config.rolesChannelId, panel(g)).catch(() => null) : null);

async function onCommand(interaction, ctx) {
  const g = ctx.store.guild(interaction.guildId);
  const sub = interaction.options.getSubcommand();
  if (sub === 'panel') {
    const ch = interaction.options.getChannel('kanal') || interaction.channel;
    if (g.config.rolesChannelId !== ch.id) { g.config.rolesChannelId = ch.id; delete g.panels.roles; }
    const msg = await postPanel(interaction.guild, g, 'roles', ch.id, panel(g));
    ctx.store.save();
    return interaction.reply(ok(g, `Rollen-Panel: ${msg.url}`));
  }
  const role = interaction.options.getRole('rolle', true);
  if (sub === 'entfernen') {
    const before = g.selfRoles.length;
    g.selfRoles = g.selfRoles.filter((r) => r.roleId !== role.id);
    if (before === g.selfRoles.length) return interaction.reply(fail(g, 'Diese Rolle ist nicht im Panel.'));
    ctx.store.save();
    await refresh(interaction.guild, g);
    return interaction.reply(ok(g, `<@&${role.id}> ist nicht mehr wählbar.`));
  }
  // hinzufuegen
  const err = whyNot(role, interaction.guild, g);
  if (err) return interaction.reply(fail(g, err));
  if (g.selfRoles.length >= 25 && !g.selfRoles.some((r) => r.roleId === role.id)) return interaction.reply(fail(g, 'Maximal 25 Rollen pro Panel.'));
  const emoji = interaction.options.getString('emoji') || '';
  if (emoji && !validEmoji(emoji)) return interaction.reply(fail(g, 'Das Emoji wird nicht erkannt – nimm ein einzelnes Emoji.'));
  const entry = { roleId: role.id, label: role.name.replace(/[^\p{L}\p{N} .\-_/]/gu, '').trim().slice(0, 80) || 'Rolle', emoji, description: interaction.options.getString('beschreibung')?.trim() || '' };
  const i = g.selfRoles.findIndex((r) => r.roleId === role.id);
  if (i >= 0) g.selfRoles[i] = entry; else g.selfRoles.push(entry);
  ctx.store.save();
  await refresh(interaction.guild, g);
  return interaction.reply(ok(g, `<@&${role.id}> ist jetzt wählbar.${g.config.rolesChannelId ? '' : ' Poste das Panel mit `/rollen panel`.'}`));
}

async function onButton(interaction, ctx) {
  const g = ctx.store.guild(interaction.guildId);
  const roleId = interaction.customId.split(':')[1];
  if (!g.selfRoles.some((r) => r.roleId === roleId)) return interaction.reply(fail(g, 'Diese Rolle kann man nicht mehr selbst wählen.'));
  const role = interaction.guild.roles.cache.get(roleId);
  const err = whyNot(role, interaction.guild, g);
  if (err) return interaction.reply(fail(g, err));
  const has = interaction.member.roles.cache.has(roleId);
  try {
    if (has) await interaction.member.roles.remove(roleId, 'Selbst-Rolle'); else await interaction.member.roles.add(roleId, 'Selbst-Rolle');
  } catch {
    return interaction.reply(fail(g, 'Ich darf diese Rolle gerade nicht vergeben – sag dem Team Bescheid.'));
  }
  return interaction.reply(ok(g, has ? `<@&${roleId}> entfernt.` : `Du hast jetzt <@&${roleId}>.`));
}

module.exports = { panel, refresh, onCommand, onButton, whyNot, DANGEROUS };
