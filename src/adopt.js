'use strict';
// One-time layout per server: use the owner's own channels and roles, and remove only what the first
// version of /setup created (matched by stored ID *and* its exact original name, so nothing else is touched).
const { postAll, postPanel } = require('./setup');
const { embed } = require('./ui');
const { isEveryoneRole } = require('./memberlist');

const LAYOUTS = {
  // XVY Imerpium
  '1553861110866911253': {
    version: 1,
    // server name in embeds/panels – replaces only these old names, never one chosen with /config name
    name: 'XVY Kaiserreich', renameFrom: ['XVY Imperium'],
    channels: {
      welcomeChannelId: '1553861111869083713', // ✋┇wilkommen
      verifyChannelId: '1553861111869083715', // 📋┇rules
      shopChannelId: '1559472148542918757', // ❗┇infos
      supportChannelId: '1559472808160010330', // 🥳┇wünsche
      modLogChannelId: '1553861111428939893', // mod-only
      ticketLogChannelId: '1553861111428939893', // mod-only
      ticketCategoryId: '1559472008423669791', // ।︱Shop︱।
      orderCategoryId: '1559472008423669791',
    },
    staffRoles: ['FOUNDER', 'OWNER'], // matched by name
    newStaffRole: '・MOD 𓇻',
    memberRole: '.gg/xvy',
    // channels filled in when still empty (applied on every start, never overwrites a choice made with /config kanal)
    fillChannels: { giveawayChannelId: '1559470988549431316', feedbackChannelId: '1559473176352923681', memberListChannelId: '1559471469627580447' }, // 🎁┇giveaways, 🤍┇feedback, member list
    // texts of the ticket types (by id) – applied on every start
    ticketTypes: { bewerbung: { description: 'Bewirb dich für XVY' } },
    // member list in 1559471469627580447: these roles in this order (set on every start unless changed in the code)
    memberListRoles: ['1553861110866911260', '1553861110866911259', '1559843998296965120', '1559489580212822062', '1559844247429972018', '1559844329638600754', '1559844394885054496', '1559844496861040661', '1559844549256552460'],
    // role that may run /giveaway – created once if missing (no Discord permissions of its own)
    giveawayRole: 'giveaway perms',
    // products for 🛒┇bestellen – added once each (not again if the owner removes one later)
    products: [
      { key: 'thumbnail', name: 'Thumbnail', price: 0, emoji: '📸', description: 'Individuelles Thumbnail' },
      { key: 'soundpack', name: 'Soundpack', price: 0.5, emoji: '🔊', description: 'Waffen-Soundpack für FiveM' },
      { key: 'nve', name: 'NVE', price: 3, emoji: '🌆', description: 'NVE Grafik-Preset für FiveM' },
      { key: 'xvy-tweaks', name: 'XV¥ Tweaks', price: 10, emoji: '🛠️', description: '' },
    ],
  },
};

// What the first /setup created – removed again only when ID and exact name match.
const OLD_CHANNELS = { welcomeChannelId: '👋・willkommen', verifyChannelId: '✅・verifizieren', shopChannelId: '🛍️・shop', supportChannelId: '🎫・support', modLogChannelId: '🛡️・mod-log', ticketLogChannelId: '📁・ticket-log', ticketCategoryId: '🎫 TICKETS', orderCategoryId: '📦 BESTELLUNGEN' };
const OLD_CATEGORIES = ['📌 START', '🛒 SHOP', '🔒 TEAM'];
const OLD_ROLES = { staffRoleId: '🛡️ Team', memberRoleId: '✅ Mitglied', customerRoleId: '💎 Kunde' };
// moderator rights for the new team role: kick, ban, timeout, manage messages, view audit log, manage nicknames
const MOD_PERMS = (1n << 1n) | (1n << 2n) | (1n << 40n) | (1n << 13n) | (1n << 7n) | (1n << 27n);

const findRole = (guild, part) => guild.roles.cache.find((r) => r.name.includes(part) && !r.managed);

async function removeOld(guild, g, report) {
  const c = g.config;
  const oldIds = { ...c, staffRoleId: c.staffRoleId ?? (c.staffRoleIds || [])[0] };
  const parents = new Set();
  for (const [key, name] of Object.entries(OLD_CHANNELS)) {
    const ch = oldIds[key] && guild.channels.cache.get(oldIds[key]);
    if (!ch || ch.name !== name) continue;
    if (ch.parentId) parents.add(ch.parentId);
    await ch.delete('XVY-Bot: eigene Setup-Kanäle entfernt (Server-Layout übernommen)').then(() => report.push(`🗑️ Kanal ${name}`)).catch((e) => report.push(`⚠️ ${name}: ${e.message}`));
  }
  for (const cat of guild.channels.cache.filter((x) => x.type === 4 && OLD_CATEGORIES.includes(x.name) && (parents.has(x.id))).values()) {
    if (guild.channels.cache.some((x) => x.parentId === cat.id)) { report.push(`⚠️ Kategorie ${cat.name} nicht leer – bleibt`); continue; }
    await cat.delete('XVY-Bot: eigene Setup-Kategorie entfernt').then(() => report.push(`🗑️ Kategorie ${cat.name}`)).catch((e) => report.push(`⚠️ ${cat.name}: ${e.message}`));
  }
  for (const [key, name] of Object.entries(OLD_ROLES)) {
    const role = oldIds[key] && guild.roles.cache.get(oldIds[key]);
    if (!role || role.name !== name) continue;
    await role.delete('XVY-Bot: eigene Setup-Rolle entfernt').then(() => report.push(`🗑️ Rolle ${name}`)).catch((e) => report.push(`⚠️ ${name}: ${e.message}`));
  }
  g.panels = {};
}

/** Adds the layout's products once each; returns how many were added. */
async function seedProducts(guild, g, layout, ctx) {
  g.seededProducts ||= [];
  let added = 0;
  for (const p of layout.products || []) {
    if (g.seededProducts.includes(p.key)) continue;
    g.seededProducts.push(p.key);
    if (Object.values(g.products).some((x) => x.name.toLowerCase() === p.name.toLowerCase())) continue;
    if (Object.keys(g.products).length >= 25) break;
    const id = `p${++g.productCounter}`;
    g.products[id] = { id, name: p.name, price: p.price, description: p.description || '', emoji: p.emoji || '', enabled: true, createdAt: Date.now() + added };
    added++;
  }
  if (added) {
    ctx.store.save();
    await ctx.shop.refreshPanel(guild, g);
    await ctx.log(guild, { title: '🛒 Produkte angelegt', description: (layout.products || []).map((p) => `${p.emoji} ${p.name}`).join(' · '), color: 0x2ecc71 });
  }
  return added;
}

/** Applies the layout's ticket-type texts; refreshes the ticket panel when something changed. */
async function applyTicketTypes(guild, g, layout, ctx) {
  let changed = false;
  for (const [id, patch] of Object.entries(layout.ticketTypes || {})) {
    const t = g.config.ticketTypes.find((x) => x.id === id);
    if (!t) { console.log(`ℹ️ Ticket-Art ${id} nicht gefunden (vorhanden: ${g.config.ticketTypes.map((x) => x.id).join(', ')})`); continue; }
    for (const [k, v] of Object.entries(patch)) if (t[k] !== v) { t[k] = v; changed = true; }
  }
  if (changed) {
    g.config.ticketTypes = g.config.ticketTypes.map((t) => ({ ...t })); // own copy, not the shared default
    ctx.store.save();
    const m = await postPanel(guild, g, 'tickets', g.config.supportChannelId, ctx.tickets.panel(g)).catch((e) => { console.error('❌ Ticket-Panel nicht aktualisiert:', e.message); return null; });
    console.log(`🎫 Ticket-Arten aktualisiert${m ? ` – Panel: ${m.url}` : ''}`);
  }
  return changed;
}

/** Renames the server in embeds once (e.g. XVY Imperium → XVY Kaiserreich) and refreshes the panels. */
async function applyName(guild, g, layout, ctx) {
  if (!layout.name || !(layout.renameFrom || []).includes(g.config.name)) return false;
  const old = g.config.name;
  g.config.name = layout.name;
  ctx.store.save();
  await ctx.refreshPanels(guild, g);
  console.log(`✏️ Name geändert: ${old} → ${layout.name}`);
  return true;
}

/** Finds or creates the giveaway role and remembers it; never touches a role chosen otherwise. */
async function ensureGiveawayRole(guild, g, layout, ctx) {
  if (!layout.giveawayRole) return null;
  const known = g.config.giveawayRoleId && guild.roles.cache.get(g.config.giveawayRoleId);
  if (known) return known;
  await guild.roles.fetch?.().catch(() => {});
  let role = guild.roles.cache.find((r) => r.name.toLowerCase() === layout.giveawayRole.toLowerCase() && !r.managed);
  if (!role) {
    role = await guild.roles.create({ name: layout.giveawayRole, permissions: 0n, reason: 'XVY-Bot: darf /giveaway nutzen' }).catch((e) => { console.error(`❌ Rolle ${layout.giveawayRole}:`, e.message); return null; });
    if (role) await ctx.log(guild, { title: '🎉 Rolle angelegt', description: `<@&${role.id}> darf jetzt \`/giveaway\` nutzen.`, color: 0xf1c40f });
  }
  if (role) { g.config.giveawayRoleId = role.id; ctx.store.save(); console.log(`🎉 Giveaway-Rolle: ${role.name} (${role.id})`); }
  return role;
}

/** Sets the member-list roles and logs which ones are used or skipped. */
function applyMemberListRoles(guild, g, layout, ctx) {
  const ids = layout.memberListRoles;
  if (JSON.stringify(g.config.memberListRoleIds) !== JSON.stringify(ids)) { g.config.memberListRoleIds = [...ids]; ctx.store.save(); }
  const lines = ids.map((id) => {
    const r = guild.roles.cache.get(id);
    if (!r) return `⚠️ ${id}: Rolle nicht gefunden`;
    const n = guild.members.cache.filter((m) => !m.user?.bot && m.roles.cache.has(id)).size;
    return `${isEveryoneRole(guild, g, r) ? '⛔ übersprungen (Mitgliederrolle)' : '✅'} ${r.name}: ${n}`;
  });
  console.log(`👥 Mitgliederliste – Rollen:\n${lines.join('\n')}`);
}

async function applyLayout(guild, ctx) {
  const layout = LAYOUTS[guild.id];
  const g = ctx.store.guild(guild.id);
  if (!layout) return false;
  if (g.layoutVersion === layout.version) await applyName(guild, g, layout, ctx);
  else if (layout.name && (layout.renameFrom || []).includes(g.config.name)) g.config.name = layout.name; // panels are posted below
  for (const [key, id] of Object.entries(layout.fillChannels || {})) if (!g.config[key] && guild.channels.cache.get(id)) { g.config[key] = id; ctx.store.save(); }
  await ensureGiveawayRole(guild, g, layout, ctx);
  if (layout.memberListRoles) applyMemberListRoles(guild, g, layout, ctx);
  if (g.layoutVersion === layout.version) {
    await seedProducts(guild, g, layout, ctx);
    await applyTicketTypes(guild, g, layout, ctx);
    return false;
  }
  await guild.roles.fetch().catch(() => {});
  await guild.channels.fetch().catch(() => {});
  const report = [];
  await removeOld(guild, g, report);

  const c = g.config;
  for (const [key, id] of Object.entries(layout.channels)) c[key] = guild.channels.cache.get(id) ? id : null;
  const staff = layout.staffRoles.map((n) => findRole(guild, n)).filter(Boolean);
  let mod = guild.roles.cache.find((r) => r.name === layout.newStaffRole);
  if (!mod) {
    mod = await guild.roles.create({ name: layout.newStaffRole, permissions: MOD_PERMS, hoist: true, reason: 'XVY-Bot: Team-Rolle MOD' }).catch((e) => { report.push(`⚠️ ${layout.newStaffRole}: ${e.message}`); return null; });
    if (mod) {
      report.push(`➕ Rolle ${layout.newStaffRole}`);
      // directly below the lowest of the owner's team roles, if the bot may move it there
      const below = staff.length ? Math.min(...staff.map((r) => r.position)) : null;
      if (below && below > 1) await mod.setPosition(below - 1).catch(() => {});
    }
  }
  c.staffRoleIds = [...staff, mod].filter(Boolean).map((r) => r.id);
  delete c.staffRoleId;
  c.memberRoleId = findRole(guild, layout.memberRole)?.id ?? null;
  c.customerRoleId = null;

  g.layoutVersion = layout.version;
  await seedProducts(guild, g, layout, ctx);
  await applyTicketTypes(guild, g, layout, ctx);
  const panels = await postAll(guild, g, ctx);
  ctx.store.save();
  const summary = [
    '**Bot an deinen Server angepasst** – er nutzt jetzt nur deine Kanäle und Rollen.',
    `Team: ${c.staffRoleIds.map((id) => `<@&${id}>`).join(' ')} · Verifiziert: ${c.memberRoleId ? `<@&${c.memberRoleId}>` : '–'}`,
    '', ...panels, '', ...report,
  ].join('\n');
  console.log(summary.replace(/<[@#&!]+(\d+)>/g, '$1'));
  await ctx.log(guild, { title: '⚙️ XVY-Bot eingerichtet', description: summary.slice(0, 4000), color: 0x2ecc71 });
  return true;
}

module.exports = { applyLayout, applyName, seedProducts, ensureGiveawayRole, LAYOUTS, OLD_CHANNELS, OLD_ROLES };
