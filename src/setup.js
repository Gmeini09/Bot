'use strict';
// /setup: creates (or finds again) roles, categories and channels, then posts the panels.
// It never deletes or changes channels it did not create – existing server channels stay as they are.
const { embed, ok } = require('./ui');

const F = {
  VIEW: 1n << 10n, SEND: 1n << 11n, MANAGE_MESSAGES: 1n << 13n, EMBED: 1n << 14n, ATTACH: 1n << 15n, HISTORY: 1n << 16n,
  REACT: 1n << 6n, MANAGE_CHANNELS: 1n << 4n, THREADS_SEND: 1n << 38n, THREADS_PUBLIC: 1n << 35n, THREADS_PRIVATE: 1n << 36n,
};
const TEXT = 0, CATEGORY = 4;

async function ensureRole(guild, id, name, color, extra = {}) {
  let role = id ? guild.roles.cache.get(id) : null;
  role ||= guild.roles.cache.find((r) => r.name === name);
  role ||= await guild.roles.create({ name, color, reason: 'XVY-Bot Setup', ...extra });
  return role;
}

async function ensureChannel(guild, id, name, type, options) {
  let ch = id ? guild.channels.cache.get(id) : null;
  ch ||= guild.channels.cache.find((c) => c.name === name && c.type === type && (type === CATEGORY || (c.parentId ?? null) === (options.parent ?? null)));
  if (!ch) ch = await guild.channels.create({ name, type, reason: 'XVY-Bot Setup', ...options });
  return ch;
}

async function postPanel(guild, g, key, channelId, payload) {
  const ch = channelId ? guild.channels.cache.get(channelId) : null;
  if (!ch) return null;
  const old = g.panels[key] ? await ch.messages.fetch(g.panels[key]).catch(() => null) : null;
  if (old) { await old.edit(payload); return old; }
  const msg = await ch.send(payload);
  g.panels[key] = msg.id;
  return msg;
}

async function runSetup(interaction, ctx) {
  const { guild } = interaction;
  const g = ctx.store.guild(guild.id);
  const c = g.config;
  await interaction.deferReply({ ephemeral: true });
  const me = guild.members.me;
  const everyone = guild.roles.everyone.id;

  const staff = await ensureRole(guild, c.staffRoleId, '🛡️ Team', 0xc9a227, { hoist: true });
  const member = await ensureRole(guild, c.memberRoleId, '✅ Mitglied', 0x95a5a6);
  const customer = await ensureRole(guild, c.customerRoleId, '💎 Kunde', 0x9b59b6);
  Object.assign(c, { staffRoleId: staff.id, memberRoleId: member.id, customerRoleId: customer.id });

  const bot = { id: me.id, type: 1, allow: [F.VIEW, F.SEND, F.EMBED, F.ATTACH, F.HISTORY, F.MANAGE_MESSAGES, F.MANAGE_CHANNELS] };
  const readOnlyAll = [{ id: everyone, type: 0, allow: [F.VIEW, F.HISTORY], deny: [F.SEND, F.REACT, F.THREADS_SEND, F.THREADS_PUBLIC, F.THREADS_PRIVATE] }, bot];
  const readOnlyMembers = [
    { id: everyone, type: 0, deny: [F.VIEW] },
    { id: member.id, type: 0, allow: [F.VIEW, F.HISTORY], deny: [F.SEND, F.THREADS_SEND, F.THREADS_PUBLIC, F.THREADS_PRIVATE] },
    { id: staff.id, type: 0, allow: [F.VIEW, F.HISTORY, F.SEND] }, bot,
  ];
  const staffOnly = [{ id: everyone, type: 0, deny: [F.VIEW] }, { id: staff.id, type: 0, allow: [F.VIEW, F.HISTORY, F.SEND] }, bot];

  const info = await ensureChannel(guild, null, '📌 START', CATEGORY, {});
  const welcome = await ensureChannel(guild, c.welcomeChannelId, '👋・willkommen', TEXT, { parent: info.id, permissionOverwrites: readOnlyAll });
  const verify = await ensureChannel(guild, c.verifyChannelId, '✅・verifizieren', TEXT, { parent: info.id, permissionOverwrites: readOnlyAll });

  const shopCat = await ensureChannel(guild, null, '🛒 SHOP', CATEGORY, {});
  const shop = await ensureChannel(guild, c.shopChannelId, '🛍️・shop', TEXT, { parent: shopCat.id, permissionOverwrites: readOnlyMembers });
  const support = await ensureChannel(guild, c.supportChannelId, '🎫・support', TEXT, { parent: shopCat.id, permissionOverwrites: readOnlyMembers });

  const ticketCat = await ensureChannel(guild, c.ticketCategoryId, '🎫 TICKETS', CATEGORY, { permissionOverwrites: staffOnly });
  const orderCat = await ensureChannel(guild, c.orderCategoryId, '📦 BESTELLUNGEN', CATEGORY, { permissionOverwrites: staffOnly });

  const teamCat = await ensureChannel(guild, null, '🔒 TEAM', CATEGORY, { permissionOverwrites: staffOnly });
  const modLog = await ensureChannel(guild, c.modLogChannelId, '🛡️・mod-log', TEXT, { parent: teamCat.id, permissionOverwrites: staffOnly });
  const ticketLog = await ensureChannel(guild, c.ticketLogChannelId, '📁・ticket-log', TEXT, { parent: teamCat.id, permissionOverwrites: staffOnly });

  Object.assign(c, {
    welcomeChannelId: welcome.id, verifyChannelId: verify.id, shopChannelId: shop.id, supportChannelId: support.id,
    ticketCategoryId: ticketCat.id, orderCategoryId: orderCat.id, modLogChannelId: modLog.id, ticketLogChannelId: ticketLog.id,
  });

  await postPanel(guild, g, 'verify', verify.id, ctx.verify.panel(g));
  await postPanel(guild, g, 'tickets', support.id, ctx.tickets.panel(g));
  await postPanel(guild, g, 'shop', shop.id, ctx.shop.panel(g));
  ctx.store.save();

  const roleWarn = me.roles.highest.comparePositionTo(member) <= 0 || me.roles.highest.comparePositionTo(customer) <= 0
    ? '\n\n⚠️ **Wichtig:** Zieh die Bot-Rolle in *Servereinstellungen → Rollen* über **✅ Mitglied** und **💎 Kunde**, sonst kann der Bot diese Rollen nicht vergeben.' : '';
  await interaction.editReply(ok(g, [
    '**Setup fertig.**',
    `Rollen: ${staff} · ${member} · ${customer}`,
    `Kanäle: ${welcome} · ${verify} · ${shop} · ${support} · ${modLog} · ${ticketLog}`,
    '',
    '**Nächste Schritte**',
    `1. Gib deinem Team die Rolle ${staff}.`,
    '2. Produkte anlegen: `/produkt hinzufuegen`',
    '3. Zahlungsinfos setzen: `/config zahlung`',
    `4. Damit Unverifizierte nur ${verify} sehen: bei deinen bestehenden Kanälen @everyone „Kanal ansehen“ entziehen und ${member} erlauben.`,
  ].join('\n') + roleWarn));
}

/** /panel art: posts one panel again (e.g. after it was deleted or the texts changed). */
async function repostPanel(interaction, ctx) {
  const g = ctx.store.guild(interaction.guildId);
  const art = interaction.options.getString('art', true);
  const map = { verify: ['verifyChannelId', ctx.verify.panel], tickets: ['supportChannelId', ctx.tickets.panel], shop: ['shopChannelId', ctx.shop.panel] };
  const [key, make] = map[art];
  const chId = g.config[key];
  if (!chId || !interaction.guild.channels.cache.get(chId)) return interaction.reply({ embeds: [embed(g, { description: '❌ Kanal fehlt – führe zuerst `/setup` aus.', color: 0xe74c3c })], ephemeral: true });
  const msg = await postPanel(interaction.guild, g, art, chId, make(g));
  ctx.store.save();
  return interaction.reply(ok(g, `Panel aktualisiert: ${msg.url}`));
}

module.exports = { runSetup, repostPanel, postPanel, F, TEXT, CATEGORY };
