'use strict';
// /setup posts the panels into the channels chosen with /config kanal. It never creates or deletes
// channels or roles – the server's own structure stays exactly as the owner built it.
const { embed, ok, fail } = require('./ui');

const F = {
  VIEW: 1n << 10n, SEND: 1n << 11n, MANAGE_MESSAGES: 1n << 13n, EMBED: 1n << 14n, ATTACH: 1n << 15n, HISTORY: 1n << 16n,
  REACT: 1n << 6n, MANAGE_CHANNELS: 1n << 4n, THREADS_SEND: 1n << 38n, THREADS_PUBLIC: 1n << 35n, THREADS_PRIVATE: 1n << 36n,
};
const TEXT = 0, CATEGORY = 4;

/** Where each panel goes. */
const PANELS = [
  ['verify', 'verifyChannelId', 'Verifizieren'],
  ['tickets', 'supportChannelId', 'Tickets'],
  ['shop', 'shopChannelId', 'Shop'],
];

async function postPanel(guild, g, key, channelId, payload) {
  const ch = channelId ? guild.channels.cache.get(channelId) : null;
  if (!ch) return null;
  const old = g.panels[key] ? await ch.messages.fetch(g.panels[key]).catch(() => null) : null;
  if (old) { await old.edit(payload); return old; }
  const msg = await ch.send(payload);
  g.panels[key] = msg.id;
  return msg;
}

const makers = (ctx) => ({ verify: ctx.verify.panel, tickets: ctx.tickets.panel, shop: ctx.shop.panel });

/** Posts (or updates) every panel whose channel is set. Returns lines for a report. */
async function postAll(guild, g, ctx) {
  const lines = [];
  const make = makers(ctx);
  for (const [key, cfgKey, label] of PANELS) {
    if (key === 'verify' && !g.config.memberRoleId) { lines.push(`➖ ${label}: aus (keine Rolle für Verifizierte)`); continue; }
    const id = g.config[cfgKey];
    if (!id || !guild.channels.cache.get(id)) { lines.push(`⚠️ ${label}: kein Kanal – \`/config kanal\``); continue; }
    try {
      const m = await postPanel(guild, g, key, id, make[key](g));
      lines.push(`✅ ${label}: ${m.url}`);
    } catch (e) {
      lines.push(`❌ ${label} in <#${id}>: ${e.message}`);
    }
  }
  return lines;
}

async function runSetup(interaction, ctx) {
  const { guild } = interaction;
  const g = ctx.store.guild(guild.id);
  await interaction.deferReply({ ephemeral: true });
  const lines = await postAll(guild, g, ctx);
  ctx.store.save();
  const c = g.config;
  const ch = (id) => (id ? `<#${id}>` : '–');
  await interaction.editReply({ embeds: [embed(g, {
    title: '⚙️ Panels',
    description: [
      ...lines,
      '',
      `Team: ${(c.staffRoleIds || []).map((id) => `<@&${id}>`).join(' ') || '–'} · Verifiziert: ${c.memberRoleId ? `<@&${c.memberRoleId}>` : '–'}`,
      `Willkommen: ${ch(c.welcomeChannelId)} · Logs: ${ch(c.modLogChannelId)} · Ticket-Kategorie: ${ch(c.ticketCategoryId)}`,
      '',
      'Kanäle ändern: `/config kanal` · Rollen: `/config teamrolle`, `/config mitgliedrolle`',
    ].join('\n'),
  })] });
}

/** /panel art: posts one panel again (e.g. after it was deleted or the texts changed). */
async function repostPanel(interaction, ctx) {
  const g = ctx.store.guild(interaction.guildId);
  const art = interaction.options.getString('art', true);
  const [, cfgKey] = PANELS.find(([k]) => k === art);
  const chId = g.config[cfgKey];
  if (!chId || !interaction.guild.channels.cache.get(chId)) return interaction.reply(fail(g, 'Für dieses Panel ist kein Kanal gesetzt – `/config kanal`.'));
  delete g.panels[art]; // post a fresh message at the bottom
  const msg = await postPanel(interaction.guild, g, art, chId, makers(ctx)[art](g));
  ctx.store.save();
  return interaction.reply(ok(g, `Panel gepostet: ${msg.url}`));
}

module.exports = { runSetup, repostPanel, postPanel, postAll, PANELS, F, TEXT, CATEGORY };
