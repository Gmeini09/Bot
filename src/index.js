'use strict';
// XVY Kaiserreich Bot – entry point: login, command registration, event routing, health endpoint.
const http = require('http');
const path = require('path');
const { Client, GatewayIntentBits, Partials, Events, AuditLogEvent } = require('discord.js');
const { Store } = require('./store');
const { COMMANDS } = require('./commands');
const { embed, fail, button, row, BTN } = require('./ui');
const setup = require('./setup');
const verify = require('./verify');
const tickets = require('./tickets');
const shop = require('./shop');
const moderation = require('./moderation');
const config = require('./config');
const adopt = require('./adopt');
const giveaway = require('./giveaway');
const roles = require('./roles');
const stats = require('./stats');
const memberlist = require('./memberlist');
const perms = require('./perms');
const backup = require('./backup');
const audit = require('./audit');
const invites = require('./invites');
const aiChat = require('./ai-chat');

const TOKEN = process.env.DISCORD_TOKEN;
const DATA_DIR = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, '..', 'data');

const store = new Store(DATA_DIR);
shop.setImageDir(path.join(DATA_DIR, 'images'));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, GatewayIntentBits.GuildModeration, GatewayIntentBits.GuildInvites,
  ],
  partials: [Partials.Message, Partials.Channel],
  allowedMentions: { parse: [] },
});
aiChat.attach(client); // KI-Chat in AI_CHANNEL_IDS and /ki

/** Sends an embed to the mod log channel. */
async function log(guild, { title, description, color, ping }) {
  const g = store.guild(guild.id);
  const ch = guild.channels.cache.get(g.config.modLogChannelId);
  if (!ch) return;
  const p = ping ? tickets.staffPing(g, guild) : { text: '', roles: [] };
  await ch.send({
    content: p.text || undefined,
    embeds: [embed(g, { title, description, color: color ?? 0x5865f2 })],
    allowedMentions: { roles: p.roles },
  }).catch(() => {});
}

async function refreshPanels(guild, g) {
  await setup.postAll(guild, g, ctx).catch(() => {});
  store.save();
}

const ctx = { client, store, log, refreshPanels, verify, tickets, shop };

async function registerCommands(guild) {
  try {
    await guild.commands.set(COMMANDS);
    console.log(`✅ ${COMMANDS.length} Befehle registriert auf ${guild.name} (${guild.id})`);
  } catch (e) {
    console.error(`❌ Befehle auf ${guild.name} nicht registriert:`, e.message, e.rawError ? JSON.stringify(e.rawError).slice(0, 1500) : '');
  }
}

client.once(Events.ClientReady, async (c) => {
  console.log(`✅ Eingeloggt als ${c.user.tag} – ${c.guilds.cache.size} Server`);
  c.user.setPresence({ activities: [{ name: 'XVY Kaiserreich', type: 3 }], status: 'online' });
  // the bot account itself: "… Imperium" → "… Kaiserreich" (Discord allows only a few name changes per hour)
  if (/imperium/i.test(c.user.username)) {
    const name = c.user.username.replace(/imperium/i, 'Kaiserreich');
    await c.user.setUsername(name).then(() => console.log(`✏️ Bot-Name: ${name}`)).catch((e) => console.error('❌ Bot-Name nicht geändert:', e.message));
  }
  for (const guild of c.guilds.cache.values()) {
    await registerCommands(guild);
    await guild.members.fetch().catch((e) => console.error('❌ Mitglieder nicht geladen:', e.message)); // full list for the member list
    const me = guild.members.me;
    if (me?.nickname && /imperium/i.test(me.nickname)) await me.setNickname(me.nickname.replace(/imperium/i, 'Kaiserreich')).catch((e) => console.error('❌ Spitzname nicht geändert:', e.message));
    store.guild(guild.id);
    await adopt.applyLayout(guild, ctx).catch((e) => console.error(`❌ Layout für ${guild.name} fehlgeschlagen:`, e));
    memberlist.schedule(guild, ctx, 3_000); // list up to date after a restart
    if (!(await invites.load(guild))) console.error(`⚠️ Einladungen auf ${guild.name} nicht lesbar – Recht „Server verwalten“ fehlt`);
    const pr = perms.report(guild, store.guild(guild.id));
    console.log(`🔐 Rechte auf ${guild.name}:\n${pr.lines.join('\n').replace(/<#(\d+)>/g, '#$1')}`);
    if (!pr.ok) await log(guild, { title: '🔐 Bot-Rechte prüfen', description: `${pr.lines.join('\n')}\n\nAlles prüfen: \`/rechte\``, color: 0xe67e22 });
  }
  store.save();
  setInterval(() => giveaway.tick(ctx).catch((e) => console.error('giveaway tick', e)), 15_000).unref?.();
  setInterval(() => tickets.tick(ctx).catch((e) => console.error('ticket tick', e)), 5 * 60_000).unref?.();
  const snap = () => { try { const f = backup.snapshot(store); if (f) console.log(`💾 Sicherung: ${f}`); } catch (e) { console.error('❌ Sicherung:', e.message); } };
  snap();
  setInterval(snap, 3_600_000).unref?.();
  console.log(`🔗 Einladen (ohne Admin): ${perms.inviteUrl(c.user.id)}`);
});

client.on(Events.GuildCreate, (guild) => registerCommands(guild));

// ── interactions
const BUTTONS = {
  'verify:start': verify.onButton,
  'ticket:claim': tickets.onClaim,
  'ticket:close': tickets.onCloseButton,
  'ticket:close:yes': tickets.onCloseConfirm,
  'ticket:close:no': tickets.onCloseConfirm,
  'shop:cart': shop.onCart,
  'shop:clear': shop.onClear,
  'shop:checkout': shop.onCheckout,
  'order:paid': shop.onOrderButton,
  'order:delivered': shop.onOrderButton,
  'order:cancel': shop.onOrderButton,
  'order:close': shop.onOrderButton,
  'perms:fix': (i) => onPermsFix(i),
};
const SELECTS = { 'ticket:open': tickets.onSelect, 'shop:add': shop.onAdd };

/** /rechte – what the bot is missing, and the invite link without Administrator. */
async function onPermsCommand(i) {
  const g = store.guild(i.guildId);
  const r = perms.report(i.guild, g);
  return i.reply({ embeds: [embed(g, {
    title: r.ok ? '🔐 Rechte – alles in Ordnung' : '🔐 Rechte prüfen',
    description: `${r.lines.join('\n')}\n\n**Benötigt:** ${Object.values(perms.NAMES).join(', ')}\n\n[Bot mit genau diesen Rechten einladen](${perms.inviteUrl(i.client.user.id)})`,
    color: r.ok ? 0x2ecc71 : 0xe67e22,
  })], components: r.channels.length ? [row(button('perms:fix', 'Bot in diesen Kanälen freischalten', BTN.success, '🔧'))] : [], flags: 64 });
}

/** 🔧 button: the bot allows itself in the blocked channels (owner/admins only). */
async function onPermsFix(i) {
  const g = store.guild(i.guildId);
  if (i.user.id !== i.guild.ownerId && !i.member.permissions.has(1n << 3n)) return i.reply(fail(g, 'Nur der Server-Owner oder Admins.'));
  await i.deferUpdate?.();
  const lines = await perms.fix(i.guild, g);
  const r = perms.report(i.guild, g);
  await log(i.guild, { title: '🔧 Bot-Zugriff auf Kanäle', description: `${lines.join('\n')}\n**Von:** <@${i.user.id}>`.slice(0, 4000), color: 0x2ecc71 });
  if (r.ok) await refreshPanels(i.guild, g);
  const payload = { embeds: [embed(g, { title: r.ok ? '🔐 Rechte – alles in Ordnung' : '🔐 Rechte – noch nicht alles', description: [...lines, '', ...r.lines].join('\n').slice(0, 4000), color: r.ok ? 0x2ecc71 : 0xe67e22 })], components: [] };
  return i.deferUpdate ? i.editReply(payload) : i.update(payload);
}
const COMMAND_HANDLERS = {
  setup: setup.runSetup, panel: setup.repostPanel, config: config.onCommand, produkt: shop.onProductCommand, ticket: tickets.onCommand,
  giveaway: giveaway.onCommand, rollen: roles.onCommand, stats: stats.onCommand,
  rabatt: shop.onDiscountCommand, invites: invites.onCommand, backup: backup.onCommand, rechte: onPermsCommand,
};
const MOD = new Set(['warn', 'warns', 'unwarn', 'timeout', 'untimeout', 'kick', 'ban', 'unban', 'clear', 'lock', 'unlock', 'slowmode', 'raidmode']);

async function route(i) {
  if (!i.inGuild()) return null;
  // "ephemeral" (flag 64) only belongs to the first reply – editing a deferred reply must not send it again
  if (i.editReply) { const edit = i.editReply.bind(i); i.editReply = (p) => edit(p && typeof p === 'object' ? { ...p, flags: undefined } : p); }
  if (i.isAutocomplete()) return i.commandName === 'rabatt' ? shop.onDiscountAutocomplete(i, ctx) : i.commandName === 'produkt' ? shop.onAutocomplete(i, ctx) : i.commandName === 'giveaway' ? (giveaway.mayHost(i.member, ctx.store.guild(i.guildId)) ? giveaway.onAutocomplete(i, ctx) : i.respond([]))  : null;
  if (i.isChatInputCommand()) {
    if (COMMAND_HANDLERS[i.commandName]) return COMMAND_HANDLERS[i.commandName](i, ctx);
    if (MOD.has(i.commandName)) return moderation.onCommand(i, ctx);
    return null;
  }
  if (i.isButton()) {
    if (BUTTONS[i.customId]) return BUTTONS[i.customId](i, ctx);
    if (i.customId.startsWith('gw:')) return giveaway.onJoin(i, ctx);
    if (i.customId.startsWith('role:')) return roles.onButton(i, ctx);
    if (i.customId.startsWith('fb:')) return shop.onFeedbackButton(i, ctx);
    if (i.customId.startsWith('restock:')) return shop.onRestock(i, ctx);
    return null;
  }
  if (i.isStringSelectMenu()) return SELECTS[i.customId]?.(i, ctx);
  if (i.isModalSubmit()) {
    if (i.customId === 'verify:captcha') return verify.onModal(i, ctx);
    if (i.customId.startsWith('ticket:create:')) return tickets.onCreate(i, ctx);
    if (i.customId === 'shop:order') return shop.onOrder(i, ctx);
    if (i.customId.startsWith('fbm:')) return shop.onFeedbackModal(i, ctx);
  }
  return null;
}

client.on(Events.InteractionCreate, async (i) => {
  try {
    await route(i);
  } catch (e) {
    console.error('❌ Interaktion fehlgeschlagen:', i.customId || i.commandName, e);
    if (i.isAutocomplete?.()) return;
    const g = i.guildId ? store.guild(i.guildId) : { config: { color: 0xe74c3c, name: 'XVY Kaiserreich' } };
    const payload = fail(g, `Da ist etwas schiefgelaufen: ${String(e.message || e).slice(0, 300)}`);
    try {
      if (i.deferred || i.replied) await i.followUp(payload); else await i.reply(payload);
    } catch { /* interaction expired */ }
  }
});

// ── members
client.on(Events.GuildMemberAdd, async (member) => {
  try {
    const inv = await invites.onJoin(member, ctx).catch((e) => { console.error('invites', e); return null; });
    if (await moderation.onJoin(member, ctx)) return;
    await verify.welcome(member, ctx, inv);
    await log(member.guild, { title: '📥 Beigetreten', description: `<@${member.id}> (${member.user.tag}) – Account erstellt <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>\n${invites.joinText(inv)}\nMitglieder: ${member.guild.memberCount}`, color: 0x2ecc71 });
  } catch (e) { console.error('memberAdd', e); }
});
const safe = (name, p) => Promise.resolve(p).catch((e) => console.error(name, e));
client.on(Events.GuildMemberUpdate, (before, after) => {
  if (memberlist.relevantChange(before, after)) memberlist.schedule(after.guild, ctx);
  safe('audit member', audit.onMemberUpdate(before, after, ctx));
});
client.on(Events.GuildRoleCreate, (r) => { memberlist.schedule(r.guild, ctx); safe('audit role', audit.onRole(r, true, ctx)); });
client.on(Events.GuildRoleDelete, (r) => { memberlist.schedule(r.guild, ctx); safe('audit role', audit.onRole(r, false, ctx)); });
client.on(Events.GuildRoleUpdate, (a, b) => {
  if (a.name !== b.name || a.hoist !== b.hoist || a.position !== b.position || a.color !== b.color) memberlist.schedule(b.guild, ctx);
  safe('audit role', audit.onRoleUpdate(a, b, ctx));
});
client.on(Events.ChannelCreate, (c) => safe('audit channel', audit.onChannel(c, true, ctx)));
client.on(Events.ChannelDelete, (c) => safe('audit channel', audit.onChannel(c, false, ctx)));
client.on(Events.InviteCreate, (inv) => invites.onCreate(inv));
client.on(Events.InviteDelete, (inv) => invites.onDelete(inv));
client.on(Events.GuildMemberRemove, (member) => {
  memberlist.schedule(member.guild, ctx);
  const inviter = invites.onLeave(member, ctx);
  log(member.guild, { title: '📤 Verlassen', description: `<@${member.id}> (${member.user?.tag ?? member.id})${inviter ? `\nEingeladen von <@${inviter}>` : ''}`, color: 0x95a5a6 }).catch(() => {});
});

// ── messages
client.on(Events.MessageCreate, (m) => {
  tickets.onMessage(m, ctx);
  moderation.onMessage(m, ctx).catch((e) => console.error('automod', e));
});
client.on(Events.MessageDelete, async (m) => {
  if (!m.guild || m.author?.bot || !m.content) return;
  const g = store.guild(m.guild.id);
  if (m.channelId === g.config.modLogChannelId) return;
  await log(m.guild, { title: '🗑️ Nachricht gelöscht', description: `<@${m.author.id}> in <#${m.channelId}>\n${m.content.slice(0, 1500)}`, color: 0x95a5a6 });
});
client.on(Events.MessageUpdate, async (before, after) => {
  if (!after.guild || after.author?.bot || before.content == null || before.content === after.content) return;
  await log(after.guild, { title: '✏️ Nachricht bearbeitet', description: `<@${after.author.id}> in <#${after.channelId}> · [Zur Nachricht](${after.url})\n**Vorher:** ${before.content.slice(0, 700)}\n**Nachher:** ${String(after.content).slice(0, 700)}`, color: 0x3498db });
});
client.on(Events.GuildBanAdd, async (ban) => {
  // bans from Discord's own menu (the bot's own bans are logged by the command)
  const entry = await ban.guild.fetchAuditLogs({ type: AuditLogEvent.MemberBanAdd, limit: 1 }).then((l) => l.entries.first()).catch(() => null);
  if (entry?.executorId === client.user.id) return;
  await log(ban.guild, { title: '🔨 Gebannt', description: `<@${ban.user.id}> (${ban.user.tag})${entry?.executorId ? `\n**Von:** <@${entry.executorId}>` : ''}${ban.reason ? `\n**Grund:** ${ban.reason}` : ''}`, color: 0xe74c3c });
});

// ── health endpoint (Railway) and shutdown
const server = http.createServer((req, res) => {
  const ready = client.isReady();
  // always 200: the process is alive; "discord" says whether the bot is logged in (a missing token must not fail deploys)
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, discord: ready, guilds: ready ? client.guilds.cache.size : 0 }));
});
server.listen(Number(process.env.PORT) || 8080, () => console.log(`🌐 Health-Check auf Port ${Number(process.env.PORT) || 8080}`));

function shutdown() {
  try { store.flush(); } catch (e) { console.error(e); }
  client.destroy().finally(() => process.exit(0));
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('unhandledRejection', (e) => console.error('unhandledRejection', e));

if (!TOKEN) {
  console.error('❌ DISCORD_TOKEN fehlt. Setze die Variable in Railway (Bot-Token aus dem Discord Developer Portal).');
} else {
  client.login(TOKEN).catch((e) => {
    console.error('❌ Login fehlgeschlagen:', e.message);
    if (/disallowed intents/i.test(e.message)) console.error('➡️ Im Developer Portal unter Bot → „Server Members Intent“ und „Message Content Intent“ einschalten.');
    process.exitCode = 1;
  });
}
