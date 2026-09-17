'use strict';

const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  ModalBuilder,
  PermissionFlagsBits,
  REST,
  Routes,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const fs = require('fs');
const path = require('path');

const SELLING = {
  color: 0x8b5cf6,
  categories: {
    info: '╭━━〔 INFORMATION 〕━━╮',
    shop: '┣━━〔 SHOP 〕━━┫',
    buy: '┣━━〔 BESTELLEN 〕━━┫',
    community: '┣━━〔 COMMUNITY 〕━━┫',
    support: '┣━━〔 SUPPORT 〕━━┫',
    orders: '┣━━〔 TICKETS 〕━━┫',
    delivery: '┣━━〔 KUNDENBEREICH 〕━━┫',
    team: '╰━━〔 TEAM INTERN 〕━━╯',
  },
  roles: [
    { name: '👑・INHABER', key: 'owner', color: 0x8b5cf6, hoist: true, permissions: [PermissionFlagsBits.Administrator] },
    { name: '⚜️・MANAGEMENT', key: 'management', color: 0x6d5dd3, hoist: true, permissions: [PermissionFlagsBits.ManageGuild, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.KickMembers, PermissionFlagsBits.BanMembers, PermissionFlagsBits.ModerateMembers] },
    { name: '🎫・SUPPORT', key: 'support', color: 0x5865f2, hoist: true, permissions: [PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ModerateMembers] },
    { name: '🎨・DESIGNER', key: 'designer', color: 0xeb459e, hoist: true, permissions: [] },
    { name: '🎧・SOUND DESIGNER', key: 'sound', color: 0x57f287, hoist: true, permissions: [] },
    { name: '🛠️・DEVELOPER', key: 'developer', color: 0xfee75c, hoist: true, permissions: [] },
    { name: '🤝・PARTNER', key: 'partner', color: 0x3498db, hoist: false, permissions: [] },
    { name: '💎・KUNDE', key: 'customer', color: 0x9b59b6, hoist: false, permissions: [] },
    { name: '🖼️・THUMBNAIL KÄUFER', key: 'buyer_thumbnail', color: 0x7289da, hoist: false, permissions: [] },
    { name: '🌆・NVE KÄUFER', key: 'buyer_nve', color: 0x1abc9c, hoist: false, permissions: [] },
    { name: '🔊・SOUNDPACK KÄUFER', key: 'buyer_soundpack', color: 0x57f287, hoist: false, permissions: [] },
    { name: '🎨・DESIGN KÄUFER', key: 'buyer_grafik', color: 0xeb459e, hoist: false, permissions: [] },
    { name: '🚗・FIVEM KÄUFER', key: 'buyer_fivem', color: 0xfee75c, hoist: false, permissions: [] },
    { name: '📦・BUNDLE KÄUFER', key: 'buyer_bundle', color: 0xe67e22, hoist: false, permissions: [] },
    { name: '🔔・SHOP UPDATES', key: 'updates', color: 0x95a5a6, hoist: false, permissions: [] },
    { name: '🎁・GIVEAWAYS', key: 'giveaways', color: 0xe67e22, hoist: false, permissions: [] },
    { name: '✅・VERIFIZIERT', key: 'verified', color: 0x2ecc71, hoist: false, permissions: [] },
  ],
};

const PRODUCT_TYPES = {
  thumbnail: { label: 'Thumbnail', emoji: '🖼️', roleKey: 'buyer_thumbnail', revisions: 2, delivery: '1–3 Tage' },
  nve: { label: 'NVE Preset / Grafik-Setup', emoji: '🌆', roleKey: 'buyer_nve', revisions: 1, delivery: '1–3 Tage' },
  soundpack: { label: 'Soundpack', emoji: '🔊', roleKey: 'buyer_soundpack', revisions: 1, delivery: '1–2 Tage' },
  grafik: { label: 'Grafik / Design', emoji: '🎨', roleKey: 'buyer_grafik', revisions: 2, delivery: '1–4 Tage' },
  fivem: { label: 'FiveM Asset', emoji: '🚗', roleKey: 'buyer_fivem', revisions: 1, delivery: 'nach Umfang' },
  bundle: { label: 'Bundle / Komplettpaket', emoji: '📦', roleKey: 'buyer_bundle', revisions: 2, delivery: 'nach Umfang' },
};

const SUPPORT_TYPES = {
  general: { label: 'Allgemeiner Support', emoji: '🎫' },
  installation: { label: 'Installation / Einrichtung', emoji: '🛠️' },
  order: { label: 'Bestellung / Lieferung', emoji: '📦' },
  payment: { label: 'Zahlung / PayPal', emoji: '💳' },
};

function isSellingInteraction(interaction) {
  try {
    if (interaction.isChatInputCommand?.()) {
      if (interaction.commandName === 'sell') return true;
      return interaction.commandName === 'setup'
        && interaction.options.getSubcommandGroup(false) === 'server'
        && interaction.options.getSubcommand(false) === 'selling';
    }
    if (interaction.isButton?.() || interaction.isModalSubmit?.()) {
      return String(interaction.customId || '').startsWith('selling_');
    }
  } catch (_) {}
  return false;
}
let cachedSellingCommandBody = null;
let sellingLoginToken = null;
const sellingResetGuilds = new Set();

const sellingStorageDir = process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.DATA_DIR || __dirname;
if (!fs.existsSync(sellingStorageDir)) fs.mkdirSync(sellingStorageDir, { recursive: true });
const sellingDataPath = path.join(sellingStorageDir, 'selling-data.json');

function blankGuildShopData() {
  return {
    nextOrder: 1,
    nextLicense: 1,
    nextPortfolio: 1,
    orders: {},
    licenses: {},
    blacklist: {},
    coupons: {},
    portfolio: {},
    reviews: {},
    config: {
      paypalEmail: null,
      availability: 'open',
      availabilityNote: null,
      channelIds: {},
      roleIds: {},
    },
  };
}

function loadSellingStore() {
  try {
    if (!fs.existsSync(sellingDataPath)) return { version: 1, guilds: {} };
    const parsed = JSON.parse(fs.readFileSync(sellingDataPath, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return { version: 1, guilds: {} };
    parsed.version = 1;
    parsed.guilds = parsed.guilds && typeof parsed.guilds === 'object' ? parsed.guilds : {};
    return parsed;
  } catch (error) {
    console.error('❌ selling-data.json konnte nicht gelesen werden:', error);
    return { version: 1, guilds: {} };
  }
}

function saveSellingStore(store) {
  const tmp = `${sellingDataPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(tmp, sellingDataPath);
}

function ensureGuildShopData(store, guildId) {
  if (!store.guilds[guildId] || typeof store.guilds[guildId] !== 'object') {
    store.guilds[guildId] = blankGuildShopData();
  }
  const data = store.guilds[guildId];
  data.nextOrder = Number(data.nextOrder || 1);
  data.nextLicense = Number(data.nextLicense || 1);
  data.nextPortfolio = Number(data.nextPortfolio || 1);
  data.orders = data.orders && typeof data.orders === 'object' ? data.orders : {};
  data.licenses = data.licenses && typeof data.licenses === 'object' ? data.licenses : {};
  data.blacklist = data.blacklist && typeof data.blacklist === 'object' ? data.blacklist : {};
  data.coupons = data.coupons && typeof data.coupons === 'object' ? data.coupons : {};
  data.portfolio = data.portfolio && typeof data.portfolio === 'object' ? data.portfolio : {};
  data.reviews = data.reviews && typeof data.reviews === 'object' ? data.reviews : {};
  data.config = { ...blankGuildShopData().config, ...(data.config || {}) };
  data.config.channelIds = data.config.channelIds && typeof data.config.channelIds === 'object' ? data.config.channelIds : {};
  data.config.roleIds = data.config.roleIds && typeof data.config.roleIds === 'object' ? data.config.roleIds : {};
  return data;
}

function getGuildShopData(guildId) {
  const store = loadSellingStore();
  const data = ensureGuildShopData(store, guildId);
  return { store, data };
}

function persistSellingStructure(guildId, structure, reset = false) {
  const store = loadSellingStore();
  if (reset || !store.guilds[guildId]) store.guilds[guildId] = blankGuildShopData();
  const data = ensureGuildShopData(store, guildId);
  data.config.channelIds = Object.fromEntries(Object.entries(structure.channels || {}).map(([key, channel]) => [key, channel.id]));
  data.config.roleIds = Object.fromEntries(Object.entries(structure.roleMap || {}).map(([key, role]) => [key, role.id]));
  saveSellingStore(store);
  return data;
}

function nextOrderId(data) {
  const number = Math.max(1, Number(data.nextOrder || 1));
  data.nextOrder = number + 1;
  return `UF-${String(number).padStart(4, '0')}`;
}

function createLicenseId(data, orderId) {
  const number = Math.max(1, Number(data.nextLicense || 1));
  data.nextLicense = number + 1;
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `LIC-${orderId}-${String(number).padStart(3, '0')}-${suffix}`;
}

function formatEuro(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 'Nicht gesetzt';
  return new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR' }).format(amount);
}

function orderStatusLabel(status) {
  return {
    pending: '🟡 Zahlung offen',
    paid: '🟢 Bezahlt',
    processing: '🔵 In Bearbeitung',
    delivered: '✅ Geliefert',
    disputed: '🔴 Streitfall',
  }[status] || '🟡 Zahlung offen';
}

function availabilityLabel(status) {
  return {
    open: '🟢 Bestellungen offen',
    busy: '🟠 Hohe Auslastung',
    closed: '🔴 Bestellungen geschlossen',
  }[status] || '🟢 Bestellungen offen';
}

function getCouponState(data, rawCode) {
  const code = String(rawCode || '').trim().toUpperCase();
  if (!code) return { code: null, coupon: null, error: null };
  const coupon = data.coupons[code];
  if (!coupon) return { code, coupon: null, error: 'Der Rabattcode existiert nicht.' };
  if (coupon.expiresAt && coupon.expiresAt <= Date.now()) return { code, coupon: null, error: 'Der Rabattcode ist abgelaufen.' };
  if (coupon.maxUses > 0 && coupon.uses >= coupon.maxUses) return { code, coupon: null, error: 'Der Rabattcode wurde bereits vollständig eingelöst.' };
  return { code, coupon, error: null };
}

function findSellingTextChannel(guild, name) {
  return guild.channels.cache.find(channel => channel.type === ChannelType.GuildText && channel.name === name) || null;
}

function findSellingCategory(guild, name) {
  return guild.channels.cache.find(channel => channel.type === ChannelType.GuildCategory && channel.name === name) || null;
}

function findSellingRole(guild, key) {
  const definition = SELLING.roles.find(role => role.key === key);
  return definition ? guild.roles.cache.find(role => role.name === definition.name) || null : null;
}


function buildSellCommandDefinition() {
  const productChoices = Object.entries(PRODUCT_TYPES).map(([value, info]) => ({ name: info.label, value }));
  return {
    name: 'sell',
    description: 'Verwaltet den professionellen Unfugstifter Shop.',
    type: 1,
    options: [
      { type: 1, name: 'dashboard', description: 'Zeigt das interne Shop-Dashboard.' },
      {
        type: 1, name: 'order', description: 'Verwaltet eine Bestellung.', options: [
          { type: 3, name: 'order', description: 'Bestellnummer, z. B. UF-0001', required: true },
          { type: 3, name: 'action', description: 'Aktion', required: true, choices: [
            { name: 'Info anzeigen', value: 'info' }, { name: 'Preis setzen', value: 'price' },
            { name: 'Revisionen setzen', value: 'revisions' }, { name: 'Mir zuweisen', value: 'assign' },
            { name: 'Zahlung offen', value: 'pending' }, { name: 'Bezahlt', value: 'paid' },
            { name: 'In Bearbeitung', value: 'processing' }, { name: 'Geliefert', value: 'delivered' },
            { name: 'Streitfall', value: 'disputed' },
          ] },
          { type: 10, name: 'betrag', description: 'Preis in EUR', required: false, min_value: 0 },
          { type: 4, name: 'anzahl', description: 'Anzahl Revisionen', required: false, min_value: 0, max_value: 99 },
        ],
      },
      {
        type: 1, name: 'license', description: 'Prüft Käuferlizenzen.', options: [
          { type: 6, name: 'user', description: 'Kunde', required: false },
          { type: 3, name: 'id', description: 'Lizenz-ID', required: false },
        ],
      },
      {
        type: 1, name: 'blacklist', description: 'Verwaltet die Shop-Blacklist.', options: [
          { type: 3, name: 'action', description: 'Aktion', required: true, choices: [
            { name: 'Hinzufügen', value: 'add' }, { name: 'Entfernen', value: 'remove' }, { name: 'Liste', value: 'list' },
          ] },
          { type: 6, name: 'user', description: 'Nutzer', required: false },
          { type: 3, name: 'grund', description: 'Grund der Sperre', required: false, max_length: 500 },
        ],
      },
      {
        type: 1, name: 'coupon', description: 'Verwaltet Rabattcodes.', options: [
          { type: 3, name: 'action', description: 'Aktion', required: true, choices: [
            { name: 'Hinzufügen', value: 'add' }, { name: 'Entfernen', value: 'remove' }, { name: 'Liste', value: 'list' },
          ] },
          { type: 3, name: 'code', description: 'Rabattcode', required: false, max_length: 30 },
          { type: 4, name: 'prozent', description: 'Rabatt in Prozent', required: false, min_value: 1, max_value: 90 },
          { type: 4, name: 'nutzungen', description: 'Maximale Nutzungen, 0 = unbegrenzt', required: false, min_value: 0, max_value: 100000 },
          { type: 4, name: 'tage', description: 'Gültigkeit in Tagen, 0 = unbegrenzt', required: false, min_value: 0, max_value: 3650 },
        ],
      },
      {
        type: 1, name: 'portfolio', description: 'Verwaltet das öffentliche Portfolio.', options: [
          { type: 3, name: 'action', description: 'Aktion', required: true, choices: [
            { name: 'Hinzufügen', value: 'add' }, { name: 'Entfernen', value: 'remove' }, { name: 'Liste', value: 'list' },
          ] },
          { type: 3, name: 'id', description: 'Portfolio-ID', required: false },
          { type: 3, name: 'titel', description: 'Titel', required: false, max_length: 100 },
          { type: 3, name: 'url', description: 'Bild-/Projekt-Link', required: false, max_length: 1000 },
          { type: 3, name: 'kategorie', description: 'Kategorie', required: false, max_length: 50 },
        ],
      },
      {
        type: 1, name: 'availability', description: 'Setzt den aktuellen Bestellstatus.', options: [
          { type: 3, name: 'status', description: 'Status', required: true, choices: [
            { name: 'Offen', value: 'open' }, { name: 'Ausgelastet', value: 'busy' }, { name: 'Geschlossen', value: 'closed' },
          ] },
          { type: 3, name: 'hinweis', description: 'Optionaler Hinweis', required: false, max_length: 300 },
        ],
      },
      {
        type: 1, name: 'update', description: 'Postet ein Update an Käufer eines Produkts.', options: [
          { type: 3, name: 'produkt', description: 'Produkt', required: true, choices: productChoices },
          { type: 3, name: 'text', description: 'Update-Text', required: true, max_length: 1500 },
        ],
      },
      {
        type: 1, name: 'paypal', description: 'Setzt oder zeigt die PayPal-Empfängeradresse.', options: [
          { type: 3, name: 'email', description: 'PayPal E-Mail; leer = aktuellen Wert anzeigen', required: false, max_length: 200 },
        ],
      },
    ],
  };
}

function addSellingSetupCommand(body) {
  if (!Array.isArray(body)) return body;
  const patchedBody = body.map(command => {
    if (!command || command.name !== 'setup') return command;
    const patched = JSON.parse(JSON.stringify(command));
    patched.options = Array.isArray(patched.options) ? patched.options : [];
    let serverGroup = patched.options.find(option => option?.type === 2 && option?.name === 'server');
    if (!serverGroup) {
      serverGroup = { type: 2, name: 'server', description: 'Erstellt komplette Server-Designs.', options: [] };
      patched.options.push(serverGroup);
    }
    serverGroup.options = Array.isArray(serverGroup.options) ? serverGroup.options : [];
    if (!serverGroup.options.some(option => option?.type === 1 && option?.name === 'selling')) {
      serverGroup.options.push({ type: 1, name: 'selling', description: 'Erstellt einen kompletten professionellen Verkaufsserver.' });
    }
    return patched;
  });
  if (!patchedBody.some(command => command?.name === 'sell')) patchedBody.push(buildSellCommandDefinition());
  return patchedBody;
}
// Der Hauptbot registriert seine Commands selbst. Wir ergänzen dabei nur
// /setup server selling, ohne die restliche Command-Liste zu verändern.
const originalRestPut = REST.prototype.put;
REST.prototype.put = function patchedPut(route, options = {}) {
  const nextOptions = Array.isArray(options?.body)
    ? { ...options, body: addSellingSetupCommand(options.body) }
    : options;
  if (Array.isArray(nextOptions?.body) && nextOptions.body.some(command => command?.name === 'setup')) {
    cachedSellingCommandBody = JSON.parse(JSON.stringify(nextOptions.body));
  }
  return originalRestPut.call(this, route, nextOptions);
};

// Der bestehende /setup-Handler kennt "selling" nicht. Deshalb lassen wir
// genau diese Interaktionen ausschließlich von diesem Modul verarbeiten.
const originalClientOn = Client.prototype.on;
Client.prototype.on = function patchedOn(eventName, listener) {
  if (eventName === Events.InteractionCreate) {
    return originalClientOn.call(this, eventName, async function wrappedInteraction(interaction, ...args) {
      if (isSellingInteraction(interaction)) return;
      return listener.call(this, interaction, ...args);
    });
  }

  // Während des Full-Resets sollen die normalen Self-Heal-/Security-Handler des
  // Hauptbots die absichtlich gelöschten Rollen/Channels nicht wiederherstellen.
  if (eventName === Events.ChannelDelete || eventName === Events.GuildRoleDelete) {
    return originalClientOn.call(this, eventName, async function wrappedSellingResetDelete(entity, ...args) {
      const guildId = entity?.guild?.id || entity?.guildId || null;
      if (guildId && sellingResetGuilds.has(guildId)) return;
      return listener.call(this, entity, ...args);
    });
  }

  return originalClientOn.call(this, eventName, listener);
};

function staffRoleIds(roleMap) {
  return ['owner', 'management', 'support', 'designer', 'sound', 'developer']
    .map(key => roleMap[key]?.id)
    .filter(Boolean);
}

function staffOverwrites(guild, roleMap, extra = []) {
  return [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    ...staffRoleIds(roleMap).map(id => ({
      id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks],
    })),
    ...extra,
  ];
}

function readOnlyOverwrites(guild, roleMap) {
  return [
    { id: guild.roles.everyone.id, allow: [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.SendMessages] },
    ...staffRoleIds(roleMap).map(id => ({ id, allow: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] })),
  ];
}

async function ensureRole(guild, definition) {
  let role = guild.roles.cache.find(item => item.name === definition.name && !item.managed) || null;
  if (!role) {
    role = await guild.roles.create({
      name: definition.name,
      color: definition.color,
      hoist: definition.hoist,
      permissions: definition.permissions,
      reason: 'Unfugstifter Selling Server Setup',
    });
  }
  return role;
}

async function ensureCategory(guild, name, permissionOverwrites = undefined) {
  let category = guild.channels.cache.find(channel => channel.type === ChannelType.GuildCategory && channel.name === name) || null;
  if (!category) {
    category = await guild.channels.create({
      name,
      type: ChannelType.GuildCategory,
      permissionOverwrites,
      reason: 'Unfugstifter Selling Server Setup',
    });
  }
  return category;
}

async function ensureChannel(guild, parent, name, { type = ChannelType.GuildText, topic = null, readOnly = false, privateForStaff = false, roleMap = {} } = {}) {
  let channel = guild.channels.cache.find(item => item.type === type && item.name === name && item.parentId === parent.id) || null;
  if (!channel) {
    const permissionOverwrites = privateForStaff
      ? staffOverwrites(guild, roleMap)
      : readOnly
        ? readOnlyOverwrites(guild, roleMap)
        : undefined;
    channel = await guild.channels.create({
      name,
      type,
      parent: parent.id,
      topic: type === ChannelType.GuildText ? topic : undefined,
      permissionOverwrites,
      reason: 'Unfugstifter Selling Server Setup',
    });
  }
  return channel;
}

async function seedIfEmpty(channel, payload) {
  if (!channel?.isTextBased?.()) return null;
  const latest = await channel.messages.fetch({ limit: 1 }).catch(() => null);
  if (latest?.size) return latest.first();
  return channel.send(payload).catch(() => null);
}

function shopEmbed(title, description, fields = []) {
  const embed = new EmbedBuilder()
    .setColor(SELLING.color)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: 'Unfugstifter Shop • Digitale Produkte' })
    .setTimestamp();
  if (fields.length) embed.addFields(fields);
  return embed;
}

async function sellingResetPreflight(guild) {
  await guild.roles.fetch();
  await guild.channels.fetch();

  const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
  if (!me) return { ok: false, reason: 'Bot-Mitglied konnte nicht geladen werden.', blockers: [] };

  const blockers = guild.roles.cache
    .filter(role => role.id !== guild.id && !role.managed && !role.editable)
    .sort((a, b) => b.position - a.position)
    .map(role => role.name);

  if (blockers.length) {
    return {
      ok: false,
      reason: 'Mindestens eine normale Rolle liegt auf oder über der höchsten Bot-Rolle und kann deshalb nicht gelöscht werden.',
      blockers,
    };
  }

  return { ok: true, reason: null, blockers: [] };
}

async function deleteExistingSellingServer(guild, keepChannelId) {
  await guild.channels.fetch();
  await guild.roles.fetch();

  const result = {
    deletedChannels: 0,
    deletedRoles: 0,
    failedChannels: [],
    failedRoles: [],
    skippedManagedRoles: [],
  };

  const channels = [...guild.channels.cache.values()]
    .filter(channel => channel.id !== keepChannelId)
    // Erst normale Channels/Threads, Kategorien zuletzt.
    .sort((a, b) => Number(a.type === ChannelType.GuildCategory) - Number(b.type === ChannelType.GuildCategory));

  for (const channel of channels) {
    try {
      await channel.delete('Unfugstifter Selling Setup: Full Reset');
      result.deletedChannels += 1;
    } catch (error) {
      result.failedChannels.push(channel.name || channel.id);
      console.error(`❌ Selling Full Reset: Channel ${channel.id} konnte nicht gelöscht werden:`, error);
    }
  }

  const roles = [...guild.roles.cache.values()]
    .filter(role => role.id !== guild.id)
    .sort((a, b) => b.position - a.position);

  for (const role of roles) {
    if (role.managed) {
      result.skippedManagedRoles.push(role.name);
      continue;
    }
    try {
      await role.delete('Unfugstifter Selling Setup: Full Reset');
      result.deletedRoles += 1;
    } catch (error) {
      result.failedRoles.push(role.name || role.id);
      console.error(`❌ Selling Full Reset: Rolle ${role.id} konnte nicht gelöscht werden:`, error);
    }
  }

  return result;
}

async function createSellingStructure(guild) {
  await guild.roles.fetch().catch(() => {});
  await guild.channels.fetch().catch(() => {});

  const roleMap = {};
  for (const definition of SELLING.roles) {
    roleMap[definition.key] = await ensureRole(guild, definition);
  }

  const ownerMember = await guild.members.fetch(guild.ownerId).catch(() => null);
  if (ownerMember && roleMap.owner && !ownerMember.roles.cache.has(roleMap.owner.id)) {
    await ownerMember.roles.add(roleMap.owner, 'Selling Setup: Server-Inhaber').catch(() => {});
  }

  const categories = {};
  categories.info = await ensureCategory(guild, SELLING.categories.info);
  categories.shop = await ensureCategory(guild, SELLING.categories.shop);
  categories.buy = await ensureCategory(guild, SELLING.categories.buy);
  categories.community = await ensureCategory(guild, SELLING.categories.community);
  categories.support = await ensureCategory(guild, SELLING.categories.support);
  categories.orders = await ensureCategory(guild, SELLING.categories.orders, staffOverwrites(guild, roleMap));
  categories.delivery = await ensureCategory(guild, SELLING.categories.delivery, staffOverwrites(guild, roleMap));
  categories.team = await ensureCategory(guild, SELLING.categories.team, staffOverwrites(guild, roleMap));

  const channels = {};
  channels.welcome = await ensureChannel(guild, categories.info, '👋・willkommen', { readOnly: true, roleMap, topic: 'Willkommen im Unfugstifter Shop.' });
  channels.rules = await ensureChannel(guild, categories.info, '📜・regelwerk', { readOnly: true, roleMap, topic: 'Regeln und Lizenzhinweise für den Shop.' });
  channels.news = await ensureChannel(guild, categories.info, '📢・ankündigungen', { readOnly: true, roleMap, topic: 'Shop-News, Releases und Updates.' });
  channels.faq = await ensureChannel(guild, categories.info, '❓・faq', { readOnly: true, roleMap, topic: 'Häufig gestellte Fragen.' });

  channels.thumbnails = await ensureChannel(guild, categories.shop, '🖼️・thumbnails', { readOnly: true, roleMap, topic: 'Thumbnail-Angebote, Beispiele und Pakete.' });
  channels.nve = await ensureChannel(guild, categories.shop, '🌆・nve-presets', { readOnly: true, roleMap, topic: 'Eigene oder lizenzierte NVE-Presets, Grafik-Setups und Anpassungen.' });
  channels.soundpacks = await ensureChannel(guild, categories.shop, '🔊・soundpacks', { readOnly: true, roleMap, topic: 'Eigene Soundpacks und Audio-Pakete.' });
  channels.graphics = await ensureChannel(guild, categories.shop, '🎨・grafik-designs', { readOnly: true, roleMap, topic: 'Logos, Banner, Thumbnails und weitere Designs.' });
  channels.fivem = await ensureChannel(guild, categories.shop, '🚗・fivem-assets', { readOnly: true, roleMap, topic: 'Eigene oder lizenzierte FiveM-Assets und Setups.' });
  channels.bundles = await ensureChannel(guild, categories.shop, '📦・bundles', { readOnly: true, roleMap, topic: 'Produkt-Bundles und Pakete.' });
  channels.newProducts = await ensureChannel(guild, categories.shop, '🆕・neuheiten', { readOnly: true, roleMap, topic: 'Neue Produkte und Updates.' });
  channels.productUpdates = await ensureChannel(guild, categories.shop, '🔄・produkt-updates', { readOnly: true, roleMap, topic: 'Updates für bereits gekaufte Produkte.' });
  channels.portfolio = await ensureChannel(guild, categories.shop, '🖼️・portfolio', { readOnly: true, roleMap, topic: 'Portfolio, Referenzen und ausgewählte Arbeiten.' });

  channels.order = await ensureChannel(guild, categories.buy, '🛒・bestellen', { readOnly: true, roleMap, topic: 'Hier kannst du ein privates Kauf-Ticket öffnen.' });
  channels.orderStatus = await ensureChannel(guild, categories.buy, '📊・bestellstatus', { readOnly: true, roleMap, topic: 'Aktueller Bestellstatus und Auslastung des Shops.' });
  channels.payment = await ensureChannel(guild, categories.buy, '💳・zahlung', { readOnly: true, roleMap, topic: 'Zahlungsinformationen werden vom Shop-Team gepflegt.' });
  channels.reviews = await ensureChannel(guild, categories.buy, '⭐・bewertungen', { readOnly: true, roleMap, topic: 'Verifizierte Bewertungen aus abgeschlossenen Bestellungen.' });
  channels.results = await ensureChannel(guild, categories.buy, '📸・kunden-ergebnisse', { roleMap, topic: 'Ergebnisse und Showcase von Kunden.' });
  channels.requests = await ensureChannel(guild, categories.buy, '💡・produkt-wünsche', { roleMap, topic: 'Wünsche für neue Produkte oder individuelle Aufträge.' });

  channels.chat = await ensureChannel(guild, categories.community, '💬・shop-chat', { roleMap, topic: 'Allgemeiner Community-Chat.' });
  channels.giveaways = await ensureChannel(guild, categories.community, '🎁・giveaways', { roleMap, topic: 'Giveaways und Aktionen.' });
  channels.partners = await ensureChannel(guild, categories.community, '🤝・partner', { readOnly: true, roleMap, topic: 'Partner und Empfehlungen.' });

  channels.support = await ensureChannel(guild, categories.support, '❓・support-chat', { roleMap, topic: 'Kurze Fragen vor oder nach dem Kauf.' });
  channels.supportTicket = await ensureChannel(guild, categories.support, '🎫・support-ticket', { readOnly: true, roleMap, topic: 'Öffne hier ein privates Support-Ticket.' });
  channels.ticketInfo = await ensureChannel(guild, categories.support, '📋・ticket-info', { readOnly: true, roleMap, topic: 'Informationen zu Kauf- und Support-Tickets.' });
  channels.supportVoice = await ensureChannel(guild, categories.support, '📞・Support Warteraum', { type: ChannelType.GuildVoice, roleMap });

  channels.teamChat = await ensureChannel(guild, categories.team, '🛠️・team-chat', { privateForStaff: true, roleMap, topic: 'Interner Team-Chat.' });
  channels.ordersInternal = await ensureChannel(guild, categories.team, '📦・bestellungen', { privateForStaff: true, roleMap, topic: 'Interne Übersicht zu Bestellungen.' });
  channels.sales = await ensureChannel(guild, categories.team, '💰・verkäufe', { privateForStaff: true, roleMap, topic: 'Interne Verkaufsübersicht.' });
  channels.productUpload = await ensureChannel(guild, categories.team, '🗂️・produkt-upload', { privateForStaff: true, roleMap, topic: 'Produktdateien, Entwürfe und interne Uploads.' });
  channels.logs = await ensureChannel(guild, categories.team, '📋・logs', { privateForStaff: true, roleMap, topic: 'Selling-System Logs.' });
  channels.transcripts = await ensureChannel(guild, categories.team, '📄・transkripte', { privateForStaff: true, roleMap, topic: 'Automatisch gespeicherte Ticket-Transkripte.' });
  channels.blacklist = await ensureChannel(guild, categories.team, '🚫・blacklist', { privateForStaff: true, roleMap, topic: 'Interne Shop-Blacklist und Sperrprotokoll.' });
  channels.dashboard = await ensureChannel(guild, categories.team, '📊・shop-dashboard', { privateForStaff: true, roleMap, topic: 'Interne Kennzahlen und Shop-Übersicht.' });
  channels.teamVoice = await ensureChannel(guild, categories.team, '🔊・Team Talk', { type: ChannelType.GuildVoice, privateForStaff: true, roleMap });

  return { roleMap, categories, channels };
}

async function seedSellingServer(structure) {
  const { channels } = structure;

  await seedIfEmpty(channels.welcome, {
    embeds: [shopEmbed('🛒 Willkommen im Unfugstifter Shop', 'Willkommen im offiziellen **Unfugstifter Shop** für digitale Produkte und individuelle Aufträge.\n\nInformiere dich zuerst in **📜・regelwerk**, sieh dir anschließend die Produktbereiche an und starte deine Bestellung ausschließlich über **🛒・bestellen**. Preise, Lieferumfang und Zahlung werden immer im privaten Ticket bestätigt.')],
  });

  await seedIfEmpty(channels.rules, {
    embeds: [
      shopEmbed('📜 01 • Shop-Regeln & Vertragsablauf', [
        '**1. Geltungsbereich**\nDiese Regeln gelten für den Discord-Shop, alle Bestellungen, individuellen Aufträge, digitalen Lieferungen sowie Support-Leistungen des Unfugstifter Shops.',
        '**2. Verbindliche Bestellungen nur im Ticket**\nPreis, Produktumfang, Anpassungen, Lieferform und Zahlungsdetails gelten erst dann als bestätigt, wenn sie im offiziellen privaten Kauf-Ticket durch das Shop-Team festgehalten wurden. Absprachen außerhalb des Tickets sind nicht verbindlich.',
        '**3. Richtige Angaben**\nDer Käufer muss die für den Auftrag notwendigen Angaben vollständig und wahrheitsgemäß machen. Falsche Angaben, Identitätstäuschung, manipulierte Nachweise oder absichtliche Irreführung können zur sofortigen Beendigung der Bestellung führen.',
        '**4. Zahlung ausschließlich über PayPal**\nDie gültige PayPal-Empfängeradresse und der endgültige Betrag werden ausschließlich im jeweiligen Kauf-Ticket bestätigt. Zahlungen an Adressen aus privaten DMs, Screenshots oder Nachrichten Dritter erfolgen auf eigenes Risiko.',
        '**5. Keine Zahlung vor Bestätigung**\nBezahle erst, nachdem Preis, Lieferumfang und PayPal-Empfänger im Ticket bestätigt wurden. Das Team verlangt niemals dein PayPal-Passwort, 2FA-Codes, Login-Codes oder Zugriff auf dein Konto.',
        '**6. Zahlungsnachweis**\nNach der Zahlung kann zur Zuordnung ein geeigneter Zahlungsnachweis oder eine Transaktionsreferenz verlangt werden. Sensible Kontodaten, Passwörter oder vollständige Login-Daten sollen dabei nicht geteilt werden.',
        '**7. Verhalten im Shop**\nBeleidigungen, Drohungen, Spam, absichtliche Störungen, Betrugsversuche, manipulierte Zahlungsbelege oder das Umgehen von Shop-Sperren werden nicht toleriert und können zum Ausschluss führen.',
      ].join('\n\n')),
      shopEmbed('🔐 02 • Lizenz, Weitergabe & Anti-Leak', [
        '**8. Persönliche Nutzungslizenz**\nSofern im Angebot oder Ticket nichts anderes vereinbart wurde, erhält ausschließlich der Käufer eine persönliche, nicht übertragbare Nutzungslizenz für den vereinbarten Zweck. Der Kauf überträgt keine Weiterverkaufs-, Unterlizenzierungs- oder Eigentumsrechte am zugrunde liegenden Werk.',
        '**9. Weiterverkauf strikt verboten**\nProdukte oder Bestandteile davon dürfen ohne ausdrückliche schriftliche Genehmigung weder direkt noch indirekt verkauft, vermietet, getauscht, verschenkt, gebündelt oder gegen andere Leistungen weitergegeben werden.',
        '**10. Leaken und Teilen strikt verboten**\nDas Hochladen, Spiegeln, Veröffentlichen, Leaken, Versenden oder sonstige Zugänglichmachen an Freunde, andere Discords, FiveM-Server, Communities, Cloud-Ordner, Foren, Telegram-Gruppen, Download-Seiten oder sonstige Dritte ist untersagt.',
        '**11. Keine Reuploads / Reskins / Kopien**\nProdukte dürfen nicht unter anderem Namen neu hochgeladen, geringfügig verändert und als eigenes Werk ausgegeben, in öffentliche Packs eingebaut oder als Grundlage für einen konkurrierenden Verkauf verwendet werden.',
        '**12. Keine Umgehung von Schutzmaßnahmen**\nCredits, Lizenzhinweise, Käuferkennzeichnungen, Wasserzeichen oder sonstige legitime Schutzmechanismen dürfen nicht entfernt, manipuliert oder umgangen werden, wenn dies der unerlaubten Weitergabe, Verschleierung oder Weiterverwertung dient.',
        '**13. Nutzung nur im vereinbarten Umfang**\nEine Server-, Team-, Agentur- oder Mehrnutzerlizenz besteht nur dann, wenn sie ausdrücklich im Ticket vereinbart wurde. Eine normale Einzelbestellung berechtigt nicht automatisch zur Nutzung durch weitere Personen oder Projekte.',
        '**14. Fremdrechte bleiben geschützt**\nDer Shop verkauft nur eigene oder rechtmäßig nutzbare Inhalte. Käufer dürfen mit gelieferten Dateien ebenfalls keine Marken-, Urheber-, Persönlichkeits- oder sonstigen Rechte Dritter verletzen.',
      ].join('\n\n')),
      shopEmbed('⚖️ 03 • Verstöße, Support, Rückerstattung & Nachweise', [
        '**15. Konsequenzen bei Leak / Weiterverkauf**\nBei nachvollziehbar belegtem Leak, unerlaubter Weitergabe, Weiterverkauf oder Lizenzmissbrauch kann die Nutzungslizenz beendet, weiterer Support verweigert und der Nutzer dauerhaft vom Shop ausgeschlossen werden. Mögliche weitere Ansprüche richten sich nach dem anwendbaren Recht.',
        '**16. Dokumentation und Nachvollziehbarkeit**\nZur Bearbeitung, Betrugsprävention und Durchsetzung der Shop-Regeln können Bestell- und Ticketdaten dokumentiert werden, insbesondere Discord-ID, Ticket-ID, Produkt, Zeitstempel, Bearbeitungsstatus, zuständiges Teammitglied und relevante Kommunikationsverläufe. Es wird nicht behauptet, dass außerhalb dieser Systeme „alles gesehen“ werden kann.',
        '**17. Supportumfang**\nSupport umfasst grundsätzlich Fehler oder Fragen innerhalb des vereinbarten Lieferumfangs. Neue Wünsche, größere Umbauten, zusätzliche Varianten, fremdverursachte Fehler oder Änderungen an Drittsoftware können als zusätzlicher Auftrag behandelt werden.',
        '**18. Mitwirkungspflicht beim Support**\nFür eine schnelle Bearbeitung sollen Produktname, ungefähres Kaufdatum, Fehlerbeschreibung, relevante Screenshots/Logs und bereits getestete Schritte bereitgestellt werden. Zugangsdaten oder Passwörter werden nicht verlangt.',
        '**19. Lieferung digitaler Inhalte**\nLieferzeit und Lieferform richten sich nach dem jeweiligen Produkt bzw. der individuellen Vereinbarung im Ticket. Bei Sonderanfertigungen können Zwischenabnahmen oder Rückfragen erforderlich sein.',
        '**20. Rückerstattung und Widerruf**\nRückerstattungen, Widerruf und Gewährleistung werden nicht pauschal ausgeschlossen. Es gelten die im konkreten Auftrag getroffenen Vereinbarungen sowie zwingende gesetzliche Verbraucherrechte, soweit diese anwendbar sind.',
        '**21. Regelverstöße und Sperren**\nBei schweren oder wiederholten Verstößen kann der Zugang zu Shop, Support, Downloads und zukünftigen Bestellungen eingeschränkt oder gesperrt werden. Bereits bestehende gesetzliche Rechte bleiben davon unberührt.',
        '**22. Zustimmung**\nMit Abschluss einer Bestellung bestätigst du, dass du das zu diesem Zeitpunkt veröffentlichte Regelwerk sowie die konkreten Produkt- und Lizenzbedingungen im Ticket zur Kenntnis genommen hast.',
      ].join('\n\n')),
    ],
  });

  await seedIfEmpty(channels.faq, {
    embeds: [shopEmbed('❓ FAQ', '**Wie bestelle ich?**\nWähle in **🛒・bestellen** dein Produkt. Der Bot erstellt ein privates Kauf-Ticket.\n\n**Wann ist ein Preis verbindlich?**\nErst wenn Preis und Lieferumfang im privaten Ticket bestätigt wurden.\n\n**Wie bezahle ich?**\nAusschließlich über **PayPal** an die im Ticket bestätigte Empfängeradresse.\n\n**Wo bekomme ich Support?**\nNutze **🎫・support-ticket** und wähle den passenden Bereich.\n\n**Darf ich gekaufte Dateien weitergeben?**\nNein. Weiterverkauf, Leaks, Reuploads und Weitergabe an Dritte sind ohne ausdrückliche Erlaubnis untersagt.')],
  });

  const productSeeds = [
    [channels.thumbnails, '🖼️ Thumbnails', 'Individuelle Thumbnails für FiveM, YouTube, Twitch und Social Media.\n\nHier können Beispiele, Pakete und Preise eingetragen werden.'],
    [channels.nve, '🌆 NVE Presets / Grafik-Setups', 'Eigene oder lizenzierte Presets, Grafik-Setups und Anpassungen für dein GTA/FiveM-Setup.\n\nKeine unerlaubte Weitergabe fremder Premium-Dateien.'],
    [channels.soundpacks, '🔊 Soundpacks', 'Eigene Soundpacks für Waffen-, Reload-, UI- oder Fahrzeug-Sounds.\n\nHier können Vorschauen und Produktvarianten gepostet werden.'],
    [channels.graphics, '🎨 Grafik & Designs', 'Logos, Banner, Discord-Grafiken, Stream-Assets und individuelle Designs.'],
    [channels.fivem, '🚗 FiveM Assets', 'Eigene oder lizenzierte FiveM-Ressourcen, Setups und weitere digitale Assets.'],
    [channels.bundles, '📦 Bundles', 'Mehrere Produkte als Paket – ideal für komplette FiveM-, Stream- oder Community-Setups.'],
  ];
  for (const [channel, title, description] of productSeeds) {
    await seedIfEmpty(channel, { embeds: [shopEmbed(title, description)] });
  }

  const orderRow1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('selling_order:thumbnail').setLabel('Thumbnail').setEmoji('🖼️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('selling_order:nve').setLabel('NVE / Grafik').setEmoji('🌆').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('selling_order:soundpack').setLabel('Soundpack').setEmoji('🔊').setStyle(ButtonStyle.Primary),
  );
  const orderRow2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('selling_order:grafik').setLabel('Design').setEmoji('🎨').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('selling_order:fivem').setLabel('FiveM Asset').setEmoji('🚗').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('selling_order:bundle').setLabel('Bundle').setEmoji('📦').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('selling_support:general').setLabel('Support').setEmoji('🎫').setStyle(ButtonStyle.Success),
  );
  await seedIfEmpty(channels.order, {
    embeds: [shopEmbed('🛒 Bestellung starten', 'Wähle das gewünschte Produkt. Der Bot erstellt ein **privates Kauf-Ticket**, in dem Preis, Lieferumfang, Bearbeitung und PayPal-Zahlung verbindlich geklärt werden.\n\nMit einer Bestellung akzeptierst du die jeweils geltenden **Shop- und Lizenzbedingungen** in 📜・regelwerk.')],
    components: [orderRow1, orderRow2],
  });

  await seedIfEmpty(channels.payment, {
    embeds: [shopEmbed('💳 Zahlung • PayPal', '**Akzeptierte Zahlungsart: PayPal**\n\n1. Öffne zuerst ein Kauf-Ticket.\n2. Das Shop-Team bestätigt dort **Produkt, Gesamtpreis und Empfängeradresse**.\n3. Bezahle erst nach dieser Bestätigung.\n4. Sende anschließend nur den zur Zuordnung benötigten Zahlungsnachweis bzw. die Transaktionsreferenz im Ticket.\n\n⚠️ **Sicherheit:** Wir verlangen niemals PayPal-Passwörter, 2FA-Codes, Login-Codes oder Fernzugriff auf dein Konto. Zahlungen an nicht im Ticket bestätigte Empfänger werden dem Shop nicht automatisch zugerechnet.')],
  });

  const supportRow1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('selling_support:general').setLabel('Allgemeiner Support').setEmoji('🎫').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('selling_support:installation').setLabel('Installation').setEmoji('🛠️').setStyle(ButtonStyle.Primary),
  );
  const supportRow2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('selling_support:order').setLabel('Bestellung / Lieferung').setEmoji('📦').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('selling_support:payment').setLabel('Zahlung / PayPal').setEmoji('💳').setStyle(ButtonStyle.Secondary),
  );
  await seedIfEmpty(channels.supportTicket, {
    embeds: [shopEmbed('🎫 Professioneller Support', 'Wähle den passenden Support-Bereich. Der Bot erstellt ein **privates Ticket**, das nur du und das Shop-Team sehen können.\n\nBitte halte Produktname, Kaufdatum, eine genaue Fehlerbeschreibung und – falls relevant – Screenshots oder Logs bereit. **Keine Passwörter oder Login-Codes senden.**')],
    components: [supportRow1, supportRow2],
  });

  await seedIfEmpty(channels.ticketInfo, {
    embeds: [shopEmbed('📋 Ticket-System & Ablauf', '**Kauf-Ticket**\nFür neue Bestellungen. Dort werden Produkt, Umfang, Preis, PayPal-Zahlung und Lieferung verbindlich abgestimmt.\n\n**Support-Ticket**\nFür allgemeine Hilfe, Installation, Lieferprobleme oder Zahlungsfragen.\n\n**Nachvollziehbarkeit**\nTicket-Erstellung, Zuständigkeit, Status und relevante Bearbeitungsschritte können für Support, Betrugsprävention und interne Dokumentation protokolliert werden.')],
  });


  const faqButtons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('selling_faq:payment').setLabel('Zahlung').setEmoji('💳').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('selling_faq:delivery').setLabel('Lieferung').setEmoji('📦').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('selling_faq:license').setLabel('Lizenz').setEmoji('🔐').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('selling_faq:support').setLabel('Support').setEmoji('🎫').setStyle(ButtonStyle.Secondary),
  );
  await channels.faq.send({ content: '**Schnellhilfe:**', components: [faqButtons] }).catch(() => {});

  await seedIfEmpty(channels.productUpdates, { embeds: [shopEmbed('🔄 Produkt-Updates', 'Hier erscheinen neue Versionen und wichtige Hinweise für bereits gekaufte Produkte. Käufer können über ihre jeweilige Produktrolle gezielt informiert werden.')] });
  await seedIfEmpty(channels.portfolio, { embeds: [shopEmbed('🖼️ Portfolio', 'Ausgewählte Arbeiten und Referenzen werden hier automatisch über `/sell portfolio` gepflegt.')] });
  await seedIfEmpty(channels.orderStatus, { embeds: [shopEmbed('📊 Bestellstatus', '🟢 **Bestellungen offen**\nNeue Aufträge können aktuell angenommen werden.')] });
  await seedIfEmpty(channels.dashboard, { embeds: [shopEmbed('📊 Shop-Dashboard', 'Interne Shop-Kennzahlen können mit `/sell dashboard` abgerufen werden.')] });
}

function sanitizeName(value) {
  return String(value || 'kunde')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24) || 'kunde';
}

function canHandleSellingTicket(member) {
  if (!member) return false;
  if (member.guild.ownerId === member.id) return true;
  if (member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageChannels)) return true;
  const staffNames = new Set(['👑・INHABER', '⚜️・MANAGEMENT', '🎫・SUPPORT', '🎨・DESIGNER', '🎧・SOUND DESIGNER', '🛠️・DEVELOPER']);
  return member.roles.cache.some(role => staffNames.has(role.name));
}

async function logSelling(guild, title, text) {
  const log = guild.channels.cache.find(channel => channel.type === ChannelType.GuildText && channel.name === '📋・logs');
  if (!log) return;
  await log.send({ embeds: [shopEmbed(title, text)] }).catch(() => {});
}


function sellingStaffRoles(guild) {
  const names = new Set(['👑・INHABER', '⚜️・MANAGEMENT', '🎫・SUPPORT', '🎨・DESIGNER', '🎧・SOUND DESIGNER', '🛠️・DEVELOPER']);
  return guild.roles.cache.filter(role => names.has(role.name));
}

function sellingTicketOverwrites(guild, userId) {
  return [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: userId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
      ],
    },
    ...sellingStaffRoles(guild).map(role => ({
      id: role.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.ManageMessages,
      ],
    })),
  ];
}

function orderActionRows(order) {
  const id = order.id;
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`selling_claim:${id}`).setLabel('Übernehmen').setEmoji('🙋').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`selling_status:${id}:paid`).setLabel('Bezahlt').setEmoji('💳').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`selling_status:${id}:processing`).setLabel('Bearbeitung').setEmoji('🛠️').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`selling_status:${id}:delivered`).setLabel('Geliefert').setEmoji('📦').setStyle(ButtonStyle.Success),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`selling_revision:${id}`).setLabel(`Revision (${Math.max(0, Number(order.revisionsRemaining || 0))})`).setEmoji('🔄').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`selling_dispute:${id}`).setLabel('Problem / Streitfall').setEmoji('⚠️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`selling_close:${id}`).setLabel('Ticket schließen').setEmoji('🔒').setStyle(ButtonStyle.Danger),
    ),
  ];
}

function supportActionRows() {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('selling_support_claim').setLabel('Übernehmen').setEmoji('🙋').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('selling_support_close').setLabel('Ticket schließen').setEmoji('🔒').setStyle(ButtonStyle.Danger),
  )];
}

function orderInfoEmbed(order) {
  const product = PRODUCT_TYPES[order.productKey] || { label: order.productKey || 'Unbekannt', emoji: '📦', delivery: 'nach Umfang' };
  const assigned = order.assignedTo ? `<@${order.assignedTo}>` : 'Noch niemand';
  const basePrice = Number.isFinite(Number(order.basePrice)) ? formatEuro(order.basePrice) : 'Noch offen';
  const finalPrice = Number.isFinite(Number(order.finalPrice)) ? formatEuro(order.finalPrice) : basePrice;
  const coupon = order.couponCode ? `\`${order.couponCode}\` (${order.discountPercent || 0} %)` : 'Keiner';
  const license = order.licenseId ? `\`${order.licenseId}\`` : 'Noch nicht ausgestellt';

  return shopEmbed(`${product.emoji} Bestellung ${order.id} • ${product.label}`, [
    `**Status:** ${orderStatusLabel(order.status)}`,
    `**Kunde:** <@${order.userId}>`,
    `**Zuständig:** ${assigned}`,
    `**Preis:** ${basePrice}${order.discountPercent ? ` → **${finalPrice}**` : ''}`,
    `**Rabatt:** ${coupon}`,
    `**Revisionen:** ${Math.max(0, Number(order.revisionsRemaining || 0))}`,
    `**Richtwert Lieferung:** ${product.delivery || 'nach Umfang'}`,
    `**Lizenz:** ${license}`,
  ].join('\n'), [
    { name: 'Auftrag', value: String(order.details || 'Keine Angaben').slice(0, 1024) },
    { name: 'Referenzen', value: String(order.references || '—').slice(0, 1024) },
    { name: 'Wunschtermin', value: String(order.deadline || '—').slice(0, 1024), inline: true },
    { name: 'Zusatz', value: String(order.notes || '—').slice(0, 1024), inline: true },
  ]);
}

function dashboardEmbed(guild, data) {
  const orders = Object.values(data.orders || {});
  const paidOrders = orders.filter(order => order.paidAt);
  const delivered = orders.filter(order => order.deliveredAt);
  const revenue = paidOrders.reduce((sum, order) => sum + Number(order.finalPrice ?? order.basePrice ?? 0), 0);
  const open = orders.filter(order => !order.closedAt).length;
  const disputed = orders.filter(order => order.status === 'disputed' && !order.closedAt).length;
  const productCounts = {};
  for (const order of orders) productCounts[order.productKey] = (productCounts[order.productKey] || 0) + 1;
  const topProducts = Object.entries(productCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([key, count]) => `${PRODUCT_TYPES[key]?.emoji || '📦'} ${PRODUCT_TYPES[key]?.label || key}: **${count}**`)
    .join('\n') || 'Noch keine Bestellungen';

  const deliveryMs = delivered
    .filter(order => Number(order.deliveredAt) > Number(order.createdAt))
    .map(order => Number(order.deliveredAt) - Number(order.createdAt));
  const avgDelivery = deliveryMs.length
    ? `${(deliveryMs.reduce((sum, value) => sum + value, 0) / deliveryMs.length / 3600000).toFixed(1)} Std.`
    : 'Noch keine Daten';

  const reviews = Object.values(data.reviews || {});
  const avgRating = reviews.length
    ? `${(reviews.reduce((sum, review) => sum + Number(review.stars || 0), 0) / reviews.length).toFixed(1)} / 5`
    : 'Noch keine Bewertungen';

  return shopEmbed('📊 Owner Shop-Dashboard', `Interne Live-Übersicht für **${guild.name}**.`, [
    { name: 'Bestellungen', value: `Gesamt: **${orders.length}**\nOffen: **${open}**\nStreitfälle: **${disputed}**`, inline: true },
    { name: 'Verkäufe', value: `Bezahlt: **${paidOrders.length}**\nGeliefert: **${delivered.length}**\nUmsatz erfasst: **${formatEuro(revenue)}**`, inline: true },
    { name: 'Service', value: `Ø Lieferung: **${avgDelivery}**\nBewertungen: **${reviews.length}**\nØ Rating: **${avgRating}**`, inline: true },
    { name: 'Top-Produkte', value: topProducts },
    { name: 'Shop-Status', value: `${availabilityLabel(data.config.availability)}${data.config.availabilityNote ? `\n${data.config.availabilityNote}` : ''}` },
  ]);
}

async function showOrderModal(interaction, productKey) {
  const product = PRODUCT_TYPES[productKey];
  if (!product || !interaction.inGuild()) return;

  const { data } = getGuildShopData(interaction.guildId);
  if (data.blacklist[interaction.user.id]) {
    const entry = data.blacklist[interaction.user.id];
    await interaction.reply({
      content: `🚫 Du bist für neue Bestellungen gesperrt.${entry.reason ? `\n**Grund:** ${entry.reason}` : ''}\nBei Rückfragen kannst du ein Support-Ticket öffnen.`,
      ephemeral: true,
    });
    return;
  }
  if (data.config.availability === 'closed') {
    await interaction.reply({
      content: `🔴 Neue Bestellungen sind aktuell geschlossen.${data.config.availabilityNote ? `\n${data.config.availabilityNote}` : ''}`,
      ephemeral: true,
    });
    return;
  }
  const duplicate = Object.values(data.orders).find(order => order.userId === interaction.user.id && !order.closedAt);
  if (duplicate) {
    const channelText = duplicate.channelId ? `<#${duplicate.channelId}>` : `Bestellung **${duplicate.id}**`;
    await interaction.reply({ content: `❌ Du hast bereits eine offene Bestellung: ${channelText}`, ephemeral: true });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`selling_order_modal:${productKey}`)
    .setTitle(`${product.label} bestellen`.slice(0, 45));

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('details')
        .setLabel('Was genau möchtest du?')
        .setPlaceholder('Produkt, Stil, Umfang, gewünschte Änderungen ...')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1500),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('references')
        .setLabel('Referenzen / Links')
        .setPlaceholder('Optional: Beispielbilder, Videos, Links ...')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(1000),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('deadline')
        .setLabel('Wunschtermin')
        .setPlaceholder(`Optional • Richtwert: ${product.delivery}`)
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(100),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('coupon')
        .setLabel('Rabattcode')
        .setPlaceholder('Optional')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(30),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('notes')
        .setLabel('Zusätzliche Hinweise')
        .setPlaceholder('Format, Plattform, besondere Anforderungen ...')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(800),
    ),
  );

  await interaction.showModal(modal);
}

async function createOrderFromModal(interaction, productKey) {
  const product = PRODUCT_TYPES[productKey];
  if (!product || !interaction.inGuild()) return;

  const { store, data } = getGuildShopData(interaction.guildId);
  if (data.blacklist[interaction.user.id]) {
    await interaction.reply({ content: '🚫 Du bist aktuell für neue Bestellungen gesperrt.', ephemeral: true });
    return;
  }
  if (data.config.availability === 'closed') {
    await interaction.reply({ content: '🔴 Neue Bestellungen sind aktuell geschlossen.', ephemeral: true });
    return;
  }
  const duplicate = Object.values(data.orders).find(order => order.userId === interaction.user.id && !order.closedAt);
  if (duplicate) {
    await interaction.reply({ content: `❌ Du hast bereits eine offene Bestellung **${duplicate.id}**.`, ephemeral: true });
    return;
  }

  const couponState = getCouponState(data, interaction.fields.getTextInputValue('coupon'));
  if (couponState.error) {
    await interaction.reply({ content: `❌ Rabattcode ungültig: ${couponState.error}`, ephemeral: true });
    return;
  }

  const orderId = nextOrderId(data);
  const order = {
    id: orderId,
    userId: interaction.user.id,
    productKey,
    details: interaction.fields.getTextInputValue('details').trim(),
    references: interaction.fields.getTextInputValue('references').trim(),
    deadline: interaction.fields.getTextInputValue('deadline').trim(),
    notes: interaction.fields.getTextInputValue('notes').trim(),
    couponCode: couponState.code,
    discountPercent: couponState.coupon ? Number(couponState.coupon.percent || 0) : 0,
    basePrice: null,
    finalPrice: null,
    status: 'pending',
    revisionsRemaining: Number(product.revisions || 0),
    assignedTo: null,
    createdAt: Date.now(),
    paidAt: null,
    deliveredAt: null,
    closedAt: null,
    channelId: null,
    deliveryChannelId: null,
    licenseId: null,
    reviewSubmitted: false,
  };
  data.orders[orderId] = order;
  if (couponState.coupon) couponState.coupon.uses = Number(couponState.coupon.uses || 0) + 1;
  saveSellingStore(store);

  const category = findSellingCategory(interaction.guild, SELLING.categories.orders);
  if (!category) {
    order.closedAt = Date.now();
    saveSellingStore(store);
    await interaction.reply({ content: '❌ Die Kauf-Ticket-Kategorie fehlt. Führe `/setup server selling` erneut aus.', ephemeral: true });
    return;
  }

  let channel;
  try {
    channel = await interaction.guild.channels.create({
      name: `${orderId.toLowerCase()}-${productKey}-${sanitizeName(interaction.user.username)}`.slice(0, 95),
      type: ChannelType.GuildText,
      parent: category.id,
      topic: `selling-owner:${interaction.user.id}|selling-kind:order|selling-order:${orderId}|selling-product:${productKey}|selling-status:open`,
      permissionOverwrites: sellingTicketOverwrites(interaction.guild, interaction.user.id),
      reason: `Selling Bestellung ${orderId} von ${interaction.user.tag}`,
    });
  } catch (error) {
    order.closedAt = Date.now();
    order.failedAt = Date.now();
    if (couponState.coupon) couponState.coupon.uses = Math.max(0, Number(couponState.coupon.uses || 0) - 1);
    saveSellingStore(store);
    throw error;
  }

  order.channelId = channel.id;
  saveSellingStore(store);

  await channel.send({
    content: `<@${interaction.user.id}>`,
    embeds: [orderInfoEmbed(order)],
    components: orderActionRows(order),
    allowedMentions: { users: [interaction.user.id] },
  });

  const internal = findSellingTextChannel(interaction.guild, '📦・bestellungen');
  if (internal) {
    await internal.send({
      embeds: [shopEmbed(`🛒 Neue Bestellung ${orderId}`, `${product.emoji} **${product.label}** von <@${interaction.user.id}>\nTicket: <#${channel.id}>${order.couponCode ? `\nRabattcode: \`${order.couponCode}\` (${order.discountPercent} %)` : ''}`)],
      allowedMentions: { parse: [] },
    }).catch(() => {});
  }

  await interaction.reply({
    content: `✅ Bestellung **${orderId}** wurde erstellt: <#${channel.id}>\nDas Team bestätigt dort Preis, Lieferumfang und PayPal-Zahlung.`,
    ephemeral: true,
  });
  await logSelling(interaction.guild, '🛒 Neue Bestellung', `<@${interaction.user.id}> hat **${orderId} • ${product.label}** erstellt: <#${channel.id}>`);
}

async function openSupportTicket(interaction, supportKey = 'general') {
  if (!interaction.inGuild()) return;
  const supportType = SUPPORT_TYPES[supportKey] || SUPPORT_TYPES.general;

  const duplicate = interaction.guild.channels.cache.find(channel =>
    channel.type === ChannelType.GuildText
      && String(channel.topic || '').includes(`selling-owner:${interaction.user.id}`)
      && String(channel.topic || '').includes('selling-kind:support')
      && String(channel.topic || '').includes('selling-status:open'));
  if (duplicate) {
    await interaction.reply({ content: `❌ Du hast bereits ein offenes Support-Ticket: <#${duplicate.id}>`, ephemeral: true });
    return;
  }

  const category = findSellingCategory(interaction.guild, SELLING.categories.orders);
  if (!category) {
    await interaction.reply({ content: '❌ Die Ticket-Kategorie fehlt. Der Server-Inhaber soll `/setup server selling` erneut ausführen.', ephemeral: true });
    return;
  }

  const channel = await interaction.guild.channels.create({
    name: `support-${supportKey}-${sanitizeName(interaction.user.username)}`.slice(0, 95),
    type: ChannelType.GuildText,
    parent: category.id,
    topic: `selling-owner:${interaction.user.id}|selling-kind:support|selling-support:${supportKey}|selling-status:open`,
    permissionOverwrites: sellingTicketOverwrites(interaction.guild, interaction.user.id),
    reason: `Selling Support von ${interaction.user.tag}`,
  });

  await channel.send({
    content: `<@${interaction.user.id}>`,
    embeds: [shopEmbed(`${supportType.emoji} Support • ${supportType.label}`, `Hallo <@${interaction.user.id}>!\n\nBitte beschreibe dein Anliegen strukturiert und vollständig. Hilfreich sind:\n• betroffenes Produkt / Bestellung\n• ungefähres Kaufdatum oder Bestellnummer\n• genaue Fehlerbeschreibung oder Frage\n• Screenshots / Logs, falls vorhanden\n• bereits getestete Schritte\n\n**Keine Passwörter, PayPal-Login-Codes, 2FA-Codes oder sonstige Zugangsdaten senden.**`, [
      { name: 'Kunde', value: `<@${interaction.user.id}>`, inline: true },
      { name: 'Bereich', value: supportType.label, inline: true },
      { name: 'Status', value: 'Offen', inline: true },
    ])],
    components: supportActionRows(),
    allowedMentions: { users: [interaction.user.id] },
  });

  await interaction.reply({ content: `✅ Dein **${supportType.label}**-Ticket wurde erstellt: <#${channel.id}>`, ephemeral: true });
  await logSelling(interaction.guild, '🎫 Neues Support-Ticket', `<@${interaction.user.id}> hat **${supportType.label}** erstellt: <#${channel.id}>`);
}

async function buildTicketTranscript(channel) {
  const messages = [];
  let before = null;
  while (messages.length < 1000) {
    const batch = await channel.messages.fetch({ limit: 100, before: before || undefined }).catch(() => null);
    if (!batch?.size) break;
    messages.push(...batch.values());
    before = batch.last().id;
    if (batch.size < 100) break;
  }
  messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

  const lines = [
    `UNFUGSTIFTER SHOP TRANSKRIPT`,
    `Channel: #${channel.name} (${channel.id})`,
    `Server: ${channel.guild.name} (${channel.guild.id})`,
    `Erstellt: ${new Date().toISOString()}`,
    '============================================================',
    '',
  ];

  for (const message of messages) {
    const author = message.author ? `${message.author.tag} (${message.author.id})` : 'Unbekannt';
    const time = new Date(message.createdTimestamp).toISOString();
    const content = String(message.content || '').replace(/\r/g, '').slice(0, 6000);
    lines.push(`[${time}] ${author}`);
    if (content) lines.push(content);
    for (const embed of message.embeds || []) {
      if (embed.title) lines.push(`[EMBED] ${embed.title}`);
      if (embed.description) lines.push(String(embed.description).slice(0, 6000));
      for (const field of embed.fields || []) lines.push(`${field.name}: ${field.value}`);
    }
    for (const attachment of message.attachments.values()) lines.push(`[DATEI] ${attachment.name || 'Datei'}: ${attachment.url}`);
    lines.push('');
  }

  return lines.join('\n').slice(0, 1_900_000);
}

async function archiveSellingTranscript(channel, title, extra = '') {
  const transcriptChannel = findSellingTextChannel(channel.guild, '📄・transkripte');
  if (!transcriptChannel) return null;
  const text = await buildTicketTranscript(channel);
  const filename = `transcript-${sanitizeName(channel.name)}-${Date.now()}.txt`;
  const attachment = new AttachmentBuilder(Buffer.from(text, 'utf8'), { name: filename });
  return transcriptChannel.send({
    embeds: [shopEmbed(`📄 ${title}`, `**Channel:** ${channel.name}\n**ID:** \`${channel.id}\`${extra ? `\n${extra}` : ''}`)],
    files: [attachment],
  }).catch(() => null);
}

async function grantBuyerRoles(guild, order) {
  const member = await guild.members.fetch(order.userId).catch(() => null);
  if (!member) return;
  const customer = findSellingRole(guild, 'customer');
  const productRole = findSellingRole(guild, PRODUCT_TYPES[order.productKey]?.roleKey);
  const roles = [customer, productRole].filter(Boolean);
  if (roles.length) await member.roles.add(roles, `Selling Bestellung ${order.id} geliefert`).catch(() => {});
}

function licenseText(guild, order, license) {
  return [
    'UNFUGSTIFTER SHOP • DIGITALE LIZENZ',
    '=====================================',
    `Lizenz-ID: ${license.id}`,
    `Bestellung: ${order.id}`,
    `Käufer Discord-ID: ${order.userId}`,
    `Produkt: ${PRODUCT_TYPES[order.productKey]?.label || order.productKey}`,
    `Ausgestellt: ${new Date(license.issuedAt).toISOString()}`,
    `Käuferkennzeichnung: ${license.buyerMarker}`,
    '',
    'Lizenz:',
    'Persönliche, nicht übertragbare Nutzungslizenz im im Ticket vereinbarten Umfang.',
    'Weiterverkauf, Leak, Reupload, unerlaubte Weitergabe oder Unterlizenzierung sind nicht gestattet.',
    '',
    'Diese Datei ist eine Zuordnungs-/Lizenzdatei. Der Bot verändert Produktdateien nicht automatisch.',
    'Die Käuferkennzeichnung kann vom Shop-Team bei eigenen Dateien zusätzlich als Wasserzeichen/Marker eingebettet werden.',
    '',
    `Server: ${guild.name} (${guild.id})`,
  ].join('\n');
}

async function deliverOrder(guild, orderId, actorId = null) {
  const { store, data } = getGuildShopData(guild.id);
  const order = data.orders[orderId];
  if (!order) throw new Error('Bestellung nicht gefunden.');

  const product = PRODUCT_TYPES[order.productKey] || { label: order.productKey, emoji: '📦' };
  if (!order.licenseId) {
    const id = createLicenseId(data, order.id);
    const license = {
      id,
      orderId: order.id,
      userId: order.userId,
      productKey: order.productKey,
      issuedAt: Date.now(),
      active: true,
      buyerMarker: `UFBUY-${guild.id.slice(-5)}-${order.userId}-${order.id}`,
    };
    data.licenses[id] = license;
    order.licenseId = id;
  }
  order.status = 'delivered';
  order.deliveredAt ||= Date.now();

  await grantBuyerRoles(guild, order);

  let deliveryChannel = order.deliveryChannelId
    ? await guild.channels.fetch(order.deliveryChannelId).catch(() => null)
    : null;
  if (!deliveryChannel) {
    const category = findSellingCategory(guild, SELLING.categories.delivery);
    if (!category) throw new Error('Kundenbereich-Kategorie fehlt.');
    deliveryChannel = await guild.channels.create({
      name: `delivery-${order.id.toLowerCase()}-${sanitizeName((await guild.members.fetch(order.userId).catch(() => null))?.user?.username || 'kunde')}`.slice(0, 95),
      type: ChannelType.GuildText,
      parent: category.id,
      topic: `selling-delivery:${order.id}|selling-owner:${order.userId}|selling-license:${order.licenseId}`,
      permissionOverwrites: sellingTicketOverwrites(guild, order.userId),
      reason: `Selling Delivery ${order.id}`,
    });
    order.deliveryChannelId = deliveryChannel.id;
  }

  const license = data.licenses[order.licenseId];
  const attachment = new AttachmentBuilder(Buffer.from(licenseText(guild, order, license), 'utf8'), { name: `${license.id}.txt` });
  const reviewRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`selling_review_open:${order.id}`).setLabel('Bewertung abgeben').setEmoji('⭐').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`selling_revision:${order.id}`).setLabel(`Revision anfragen (${Math.max(0, Number(order.revisionsRemaining || 0))})`).setEmoji('🔄').setStyle(ButtonStyle.Secondary),
  );

  if (!order.deliveryPostedAt) {
    await deliveryChannel.send({
      content: `<@${order.userId}>`,
      embeds: [shopEmbed(`${product.emoji} Lieferung • ${order.id}`, `Deine Bestellung wurde als **geliefert** markiert.\n\n**Produkt:** ${product.label}\n**Lizenz:** \`${order.licenseId}\`\n**Käuferkennzeichnung:** \`${license.buyerMarker}\`\n\nDie eigentlichen Produktdateien werden hier vom Shop-Team bereitgestellt. Bewahre deine Lizenz-ID für Support und Updates auf.`)],
      files: [attachment],
      components: [reviewRow],
      allowedMentions: { users: [order.userId] },
    });
    order.deliveryPostedAt = Date.now();
  }

  const ticket = order.channelId ? await guild.channels.fetch(order.channelId).catch(() => null) : null;
  if (ticket?.isTextBased()) {
    await ticket.send({
      content: `<@${order.userId}>`,
      embeds: [shopEmbed('✅ Bestellung geliefert', `Bestellung **${order.id}** wurde geliefert.\nPrivater Kundenbereich: <#${deliveryChannel.id}>\nLizenz-ID: \`${order.licenseId}\``)],
      components: [reviewRow],
      allowedMentions: { users: [order.userId] },
    }).catch(() => {});
  }

  const sales = findSellingTextChannel(guild, '💰・verkäufe');
  if (sales && !order.saleLoggedAt) {
    await sales.send({
      embeds: [shopEmbed(`💰 Verkauf • ${order.id}`, `<@${order.userId}> • **${product.label}**\nPreis: **${formatEuro(order.finalPrice ?? order.basePrice)}**\nLizenz: \`${order.licenseId}\`${actorId ? `\nGeliefert von: <@${actorId}>` : ''}`)],
      allowedMentions: { parse: [] },
    }).catch(() => {});
    order.saleLoggedAt = Date.now();
  }

  saveSellingStore(store);
  return { order, deliveryChannel, license };
}

async function setOrderStatus(guild, orderId, status, actorId) {
  const allowed = new Set(['pending', 'paid', 'processing', 'delivered', 'disputed']);
  if (!allowed.has(status)) throw new Error('Ungültiger Bestellstatus.');

  if (status === 'delivered') return deliverOrder(guild, orderId, actorId);

  const { store, data } = getGuildShopData(guild.id);
  const order = data.orders[orderId];
  if (!order) throw new Error('Bestellung nicht gefunden.');
  order.status = status;
  if (status === 'paid') {
    order.paidAt ||= Date.now();
    await grantBuyerRoles(guild, order);
  }
  if (status === 'processing') order.processingAt ||= Date.now();
  if (status === 'disputed') order.disputedAt ||= Date.now();
  order.updatedAt = Date.now();
  saveSellingStore(store);

  const channel = order.channelId ? await guild.channels.fetch(order.channelId).catch(() => null) : null;
  if (channel?.isTextBased()) {
    await channel.send({
      embeds: [shopEmbed(`📊 Status aktualisiert • ${order.id}`, `Neuer Status: **${orderStatusLabel(status)}**\nGeändert von <@${actorId}>.`)],
      allowedMentions: { parse: [] },
    }).catch(() => {});
  }
  await logSelling(guild, `📊 ${order.id} • ${orderStatusLabel(status)}`, `<@${actorId}> hat den Bestellstatus geändert.`);
  return { order };
}

async function requestRevision(interaction, orderId) {
  const { store, data } = getGuildShopData(interaction.guildId);
  const order = data.orders[orderId];
  if (!order) {
    await interaction.reply({ content: '❌ Bestellung nicht gefunden.', ephemeral: true });
    return;
  }
  if (interaction.user.id !== order.userId && !canHandleSellingTicket(interaction.member)) {
    await interaction.reply({ content: '❌ Du darfst für diese Bestellung keine Revision anfragen.', ephemeral: true });
    return;
  }
  if (Number(order.revisionsRemaining || 0) <= 0) {
    await interaction.reply({ content: '❌ Für diese Bestellung sind keine inkludierten Revisionen mehr übrig. Weitere Änderungen können als Zusatzauftrag berechnet werden.', ephemeral: true });
    return;
  }
  order.revisionsRemaining = Number(order.revisionsRemaining || 0) - 1;
  order.status = 'processing';
  order.lastRevisionAt = Date.now();
  saveSellingStore(store);
  await interaction.reply({
    content: `🔄 Revision für **${order.id}** wurde registriert. Verbleibend: **${order.revisionsRemaining}**.\nBitte beschreibe die gewünschte Änderung jetzt möglichst genau im Ticket.`,
  });
  await logSelling(interaction.guild, `🔄 Revision • ${order.id}`, `<@${interaction.user.id}> hat eine Revision angefordert. Verbleibend: **${order.revisionsRemaining}**.`);
}

async function openReviewModal(interaction, orderId) {
  const { data } = getGuildShopData(interaction.guildId);
  const order = data.orders[orderId];
  if (!order || order.userId !== interaction.user.id || !order.deliveredAt) {
    await interaction.reply({ content: '❌ Du kannst diese Bestellung nicht bewerten.', ephemeral: true });
    return;
  }
  if (order.reviewSubmitted || data.reviews[orderId]) {
    await interaction.reply({ content: '✅ Für diese Bestellung wurde bereits eine Bewertung abgegeben.', ephemeral: true });
    return;
  }

  const modal = new ModalBuilder().setCustomId(`selling_review_submit:${orderId}`).setTitle(`Bewertung • ${orderId}`);
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('stars')
        .setLabel('Sterne von 1 bis 5')
        .setPlaceholder('5')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(1),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('text')
        .setLabel('Deine Bewertung')
        .setPlaceholder('Wie zufrieden bist du mit Produkt, Lieferung und Support?')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1200),
    ),
  );
  await interaction.showModal(modal);
}

async function submitReview(interaction, orderId) {
  const stars = Number(interaction.fields.getTextInputValue('stars'));
  const text = interaction.fields.getTextInputValue('text').trim();
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    await interaction.reply({ content: '❌ Bitte gib bei Sterne eine Zahl von **1 bis 5** ein.', ephemeral: true });
    return;
  }

  const { store, data } = getGuildShopData(interaction.guildId);
  const order = data.orders[orderId];
  if (!order || order.userId !== interaction.user.id || !order.deliveredAt) {
    await interaction.reply({ content: '❌ Bestellung nicht gefunden oder nicht bewertbar.', ephemeral: true });
    return;
  }
  if (order.reviewSubmitted || data.reviews[orderId]) {
    await interaction.reply({ content: '✅ Diese Bestellung wurde bereits bewertet.', ephemeral: true });
    return;
  }

  const review = {
    orderId,
    userId: interaction.user.id,
    productKey: order.productKey,
    stars,
    text,
    createdAt: Date.now(),
  };
  data.reviews[orderId] = review;
  order.reviewSubmitted = true;
  saveSellingStore(store);

  const reviewsChannel = findSellingTextChannel(interaction.guild, '⭐・bewertungen');
  if (reviewsChannel) {
    const product = PRODUCT_TYPES[order.productKey] || { label: order.productKey, emoji: '📦' };
    await reviewsChannel.send({
      embeds: [shopEmbed(`${'⭐'.repeat(stars)} Bewertung • ${product.label}`, text, [
        { name: 'Kunde', value: `<@${interaction.user.id}>`, inline: true },
        { name: 'Bestellung', value: `\`${order.id}\``, inline: true },
        { name: 'Bewertung', value: `**${stars}/5**`, inline: true },
      ])],
      allowedMentions: { parse: [] },
    }).catch(() => {});
  }
  await interaction.reply({ content: '⭐ Danke! Deine Bewertung wurde veröffentlicht.', ephemeral: true });
}

async function handleFaqButton(interaction, key) {
  const answers = {
    payment: '**Zahlung:** Ausschließlich PayPal. Der exakte Betrag und die gültige Empfängeradresse werden in deinem privaten Kauf-Ticket bestätigt. Bezahle niemals nur aufgrund einer DM.',
    delivery: '**Lieferung:** Die Richtwerte hängen vom Produkt ab. Im Ticket bestätigt das Team den konkreten Umfang und die erwartete Lieferzeit. Nach Lieferung erhältst du einen privaten Kundenbereich.',
    license: '**Lizenz:** Standardmäßig erhält nur der Käufer eine persönliche, nicht übertragbare Nutzungslizenz. Weiterverkauf, Leak, Reupload und unerlaubte Weitergabe sind verboten.',
    support: '**Support:** Nutze den Support-Ticket-Bereich für Installation, Zahlungsfragen, Lieferprobleme oder allgemeine Hilfe. Sende niemals Passwörter oder 2FA-Codes.',
  };
  await interaction.reply({ content: answers[key] || 'Keine FAQ-Information gefunden.', ephemeral: true });
}

async function archiveAndCloseSupport(interaction) {
  if (!interaction.inGuild() || !interaction.channel) return;
  const ownerMatch = String(interaction.channel.topic || '').match(/selling-owner:(\d+)/);
  const ownerId = ownerMatch?.[1] || null;
  if (interaction.user.id !== ownerId && !canHandleSellingTicket(interaction.member)) {
    await interaction.reply({ content: '❌ Du darfst dieses Support-Ticket nicht schließen.', ephemeral: true });
    return;
  }
  await interaction.reply({ content: '📄 Transcript wird gespeichert. Danach wird das Ticket geschlossen …' });
  await archiveSellingTranscript(interaction.channel, 'Support-Transcript', `Geschlossen von <@${interaction.user.id}>`).catch(() => {});
  await logSelling(interaction.guild, '🔒 Support geschlossen', `<@${interaction.user.id}> hat <#${interaction.channel.id}> geschlossen.`);
  setTimeout(() => interaction.channel.delete(`Selling Support geschlossen von ${interaction.user.tag}`).catch(() => {}), 2500);
}

async function handleOrderTicketButton(interaction) {
  if (!interaction.inGuild() || !interaction.channel) return;
  const id = String(interaction.customId || '').split(':')[1];
  if (!id) return;

  const { store, data } = getGuildShopData(interaction.guildId);
  const order = data.orders[id];
  if (!order) {
    await interaction.reply({ content: '❌ Bestellung nicht gefunden.', ephemeral: true });
    return;
  }

  if (interaction.customId.startsWith('selling_claim:')) {
    if (!canHandleSellingTicket(interaction.member)) {
      await interaction.reply({ content: '❌ Nur das Shop-Team kann Bestellungen übernehmen.', ephemeral: true });
      return;
    }
    order.assignedTo = interaction.user.id;
    order.claimedAt = Date.now();
    saveSellingStore(store);
    await interaction.reply({ content: `🙋 Bestellung **${id}** wurde von <@${interaction.user.id}> übernommen.` });
    await logSelling(interaction.guild, `🙋 Bestellung übernommen • ${id}`, `<@${interaction.user.id}> ist jetzt zuständig.`);
    return;
  }

  if (interaction.customId.startsWith('selling_status:')) {
    if (!canHandleSellingTicket(interaction.member)) {
      await interaction.reply({ content: '❌ Nur das Shop-Team kann Bestellstatus ändern.', ephemeral: true });
      return;
    }
    const status = String(interaction.customId).split(':')[2];
    await interaction.deferReply({ ephemeral: true });
    await setOrderStatus(interaction.guild, id, status, interaction.user.id);
    await interaction.editReply(`✅ **${id}** ist jetzt **${orderStatusLabel(status)}**.`);
    return;
  }

  if (interaction.customId.startsWith('selling_revision:')) {
    await requestRevision(interaction, id);
    return;
  }

  if (interaction.customId.startsWith('selling_dispute:')) {
    if (interaction.user.id !== order.userId && !canHandleSellingTicket(interaction.member)) {
      await interaction.reply({ content: '❌ Keine Berechtigung für diese Bestellung.', ephemeral: true });
      return;
    }
    order.status = 'disputed';
    order.disputedAt = Date.now();
    saveSellingStore(store);
    await interaction.reply({ content: `⚠️ Bestellung **${id}** wurde als **Streitfall / Problem** markiert. Das Management kann den Vorgang nun gezielt prüfen.` });
    const internal = findSellingTextChannel(interaction.guild, '📦・bestellungen');
    if (internal) await internal.send({ embeds: [shopEmbed(`⚠️ Streitfall • ${id}`, `Ausgelöst von <@${interaction.user.id}>\nTicket: <#${interaction.channelId}>`)], allowedMentions: { parse: [] } }).catch(() => {});
    await logSelling(interaction.guild, `⚠️ Streitfall • ${id}`, `<@${interaction.user.id}> hat die Bestellung als Problem markiert.`);
    return;
  }

  if (interaction.customId.startsWith('selling_close:')) {
    if (interaction.user.id !== order.userId && !canHandleSellingTicket(interaction.member)) {
      await interaction.reply({ content: '❌ Du darfst dieses Ticket nicht schließen.', ephemeral: true });
      return;
    }
    await interaction.reply({ content: '📄 Transcript wird gespeichert. Danach wird das Ticket geschlossen …' });
    await archiveSellingTranscript(interaction.channel, `Bestellung ${id}`, `Kunde: <@${order.userId}>\nStatus: ${orderStatusLabel(order.status)}`).catch(() => {});
    order.closedAt = Date.now();
    order.channelId = null;
    saveSellingStore(store);
    await logSelling(interaction.guild, `🔒 Bestellung geschlossen • ${id}`, `<@${interaction.user.id}> hat das Ticket geschlossen.`);
    setTimeout(() => interaction.channel.delete(`Selling Bestellung ${id} geschlossen`).catch(() => {}), 2500);
  }
}

async function handleSupportButton(interaction) {
  if (!interaction.inGuild() || !interaction.channel) return;
  if (interaction.customId === 'selling_support_claim') {
    if (!canHandleSellingTicket(interaction.member)) {
      await interaction.reply({ content: '❌ Nur das Shop-Team kann Support-Tickets übernehmen.', ephemeral: true });
      return;
    }
    await interaction.reply({ content: `🙋 <@${interaction.user.id}> hat dieses Support-Ticket übernommen.` });
    await logSelling(interaction.guild, '🙋 Support übernommen', `<@${interaction.user.id}> hat <#${interaction.channel.id}> übernommen.`);
    return;
  }
  if (interaction.customId === 'selling_support_close') {
    await archiveAndCloseSupport(interaction);
  }
}

async function refreshOrderStatusPanel(guild, data) {
  const channel = findSellingTextChannel(guild, '📊・bestellstatus');
  if (!channel) return null;
  const deliveryLines = Object.values(PRODUCT_TYPES)
    .map(product => `${product.emoji} **${product.label}:** ${product.delivery}`)
    .join('\n');
  const embed = shopEmbed('📊 Bestellstatus & Lieferzeiten', `${availabilityLabel(data.config.availability)}${data.config.availabilityNote ? `\n${data.config.availabilityNote}` : ''}\n\n**Ungefähre Richtwerte**\n${deliveryLines}\n\nDer konkrete Termin wird immer im Kauf-Ticket bestätigt.`);
  const messages = await channel.messages.fetch({ limit: 25 }).catch(() => null);
  const existing = messages?.find(message => message.author.id === guild.members.me?.id && message.embeds?.[0]?.title?.startsWith('📊 Bestellstatus'));
  if (existing) return existing.edit({ embeds: [embed] }).catch(() => null);
  return channel.send({ embeds: [embed] }).catch(() => null);
}

async function refreshPaymentPanel(guild, data) {
  const channel = findSellingTextChannel(guild, '💳・zahlung');
  if (!channel) return null;
  const configured = data.config.paypalEmail
    ? '✅ **PayPal ist für den Shop konfiguriert.** Die konkrete Empfängeradresse wird aus Sicherheitsgründen zusätzlich im jeweiligen Kauf-Ticket bestätigt.'
    : '⚠️ **PayPal-Empfänger noch nicht intern hinterlegt.** Das Management kann ihn mit `/sell paypal` setzen.';
  const embed = shopEmbed('💳 Zahlung • PayPal', `${configured}\n\n1. Kauf-Ticket öffnen.\n2. Produkt, Gesamtpreis und Empfänger im Ticket bestätigen lassen.\n3. Erst dann bezahlen.\n4. Zur Zuordnung nur die erforderliche Transaktionsreferenz / einen geeigneten Nachweis senden.\n\n**Niemals** Passwort, 2FA-Code oder Login-Code senden.`);
  const messages = await channel.messages.fetch({ limit: 25 }).catch(() => null);
  const existing = messages?.find(message => message.author.id === guild.members.me?.id && message.embeds?.[0]?.title?.startsWith('💳 Zahlung'));
  if (existing) return existing.edit({ embeds: [embed] }).catch(() => null);
  return channel.send({ embeds: [embed] }).catch(() => null);
}

async function handleSellCommand(interaction) {
  if (!interaction.inGuild()) return;
  if (!canHandleSellingTicket(interaction.member)) {
    await interaction.reply({ content: '❌ Dieser Verwaltungsbefehl ist nur für das Shop-Team.', ephemeral: true });
    return;
  }

  const sub = interaction.options.getSubcommand();
  const { store, data } = getGuildShopData(interaction.guildId);

  if (sub === 'dashboard') {
    await interaction.reply({ embeds: [dashboardEmbed(interaction.guild, data)], ephemeral: true, allowedMentions: { parse: [] } });
    return;
  }

  if (sub === 'order') {
    const id = String(interaction.options.getString('order') || '').trim().toUpperCase();
    const action = interaction.options.getString('action');
    const order = data.orders[id];
    if (!order) {
      await interaction.reply({ content: `❌ Bestellung \`${id}\` wurde nicht gefunden.`, ephemeral: true });
      return;
    }

    if (action === 'info') {
      await interaction.reply({ embeds: [orderInfoEmbed(order)], ephemeral: true, allowedMentions: { parse: [] } });
      return;
    }
    if (action === 'assign') {
      order.assignedTo = interaction.user.id;
      order.claimedAt = Date.now();
      saveSellingStore(store);
      await interaction.reply({ content: `✅ **${id}** wurde dir zugewiesen.`, ephemeral: true });
      return;
    }
    if (action === 'price') {
      const amount = interaction.options.getNumber('betrag');
      if (amount === null) {
        await interaction.reply({ content: '❌ Für **Preis setzen** musst du `betrag` angeben.', ephemeral: true });
        return;
      }
      order.basePrice = Math.round(Number(amount) * 100) / 100;
      const discount = Math.max(0, Math.min(90, Number(order.discountPercent || 0)));
      order.finalPrice = Math.round(order.basePrice * (1 - discount / 100) * 100) / 100;
      saveSellingStore(store);
      const channel = order.channelId ? await interaction.guild.channels.fetch(order.channelId).catch(() => null) : null;
      if (channel?.isTextBased()) {
        const paypal = data.config.paypalEmail ? `\n**PayPal-Empfänger:** \`${data.config.paypalEmail}\`` : '\n**PayPal-Empfänger:** wird vom Team im Ticket bestätigt';
        await channel.send({
          embeds: [shopEmbed(`💳 Preis bestätigt • ${id}`, `Grundpreis: **${formatEuro(order.basePrice)}**${discount ? `\nRabatt: **${discount} %**\nEndpreis: **${formatEuro(order.finalPrice)}**` : ''}${paypal}\n\nBitte erst nach dieser Bestätigung bezahlen.`)],
        }).catch(() => {});
      }
      await interaction.reply({ content: `✅ Preis für **${id}**: **${formatEuro(order.finalPrice)}**.`, ephemeral: true });
      return;
    }
    if (action === 'revisions') {
      const amount = interaction.options.getInteger('anzahl');
      if (amount === null) {
        await interaction.reply({ content: '❌ Für **Revisionen setzen** musst du `anzahl` angeben.', ephemeral: true });
        return;
      }
      order.revisionsRemaining = amount;
      saveSellingStore(store);
      await interaction.reply({ content: `✅ **${id}** hat jetzt **${amount}** inkludierte Revision(en).`, ephemeral: true });
      return;
    }

    const statusMap = { pending: 'pending', paid: 'paid', processing: 'processing', delivered: 'delivered', disputed: 'disputed' };
    if (statusMap[action]) {
      await interaction.deferReply({ ephemeral: true });
      await setOrderStatus(interaction.guild, id, statusMap[action], interaction.user.id);
      await interaction.editReply(`✅ **${id}** ist jetzt **${orderStatusLabel(statusMap[action])}**.`);
      return;
    }
  }

  if (sub === 'license') {
    const licenseId = String(interaction.options.getString('id') || '').trim();
    const user = interaction.options.getUser('user');
    let licenses = [];
    if (licenseId) {
      if (data.licenses[licenseId]) licenses = [data.licenses[licenseId]];
    } else if (user) {
      licenses = Object.values(data.licenses).filter(license => license.userId === user.id);
    } else {
      await interaction.reply({ content: '❌ Gib `user` oder `id` an.', ephemeral: true });
      return;
    }
    if (!licenses.length) {
      await interaction.reply({ content: '❌ Keine passende Lizenz gefunden.', ephemeral: true });
      return;
    }
    const text = licenses.slice(0, 10).map(license => {
      const product = PRODUCT_TYPES[license.productKey]?.label || license.productKey;
      return `🔐 \`${license.id}\`\nBestellung: **${license.orderId}** • ${product}\nKunde: <@${license.userId}> • Status: **${license.active ? 'Aktiv' : 'Inaktiv'}**\nMarker: \`${license.buyerMarker}\``;
    }).join('\n\n');
    await interaction.reply({ embeds: [shopEmbed('🔐 Lizenzprüfung', text)], ephemeral: true, allowedMentions: { parse: [] } });
    return;
  }

  if (sub === 'blacklist') {
    const action = interaction.options.getString('action');
    if (action === 'list') {
      const entries = Object.entries(data.blacklist);
      const text = entries.length
        ? entries.slice(0, 30).map(([userId, entry]) => `• <@${userId}> — ${entry.reason || 'Kein Grund'} — <t:${Math.floor(entry.at / 1000)}:d>`).join('\n')
        : 'Blacklist ist leer.';
      await interaction.reply({ embeds: [shopEmbed('🚫 Shop-Blacklist', text)], ephemeral: true, allowedMentions: { parse: [] } });
      return;
    }
    const user = interaction.options.getUser('user');
    if (!user) {
      await interaction.reply({ content: '❌ Für diese Aktion musst du `user` angeben.', ephemeral: true });
      return;
    }
    if (action === 'add') {
      const reason = interaction.options.getString('grund') || 'Kein Grund angegeben';
      data.blacklist[user.id] = { reason, by: interaction.user.id, at: Date.now() };
      saveSellingStore(store);
      const blacklistChannel = findSellingTextChannel(interaction.guild, '🚫・blacklist');
      if (blacklistChannel) await blacklistChannel.send({ embeds: [shopEmbed('🚫 Nutzer gesperrt', `<@${user.id}> wurde von <@${interaction.user.id}> für neue Bestellungen gesperrt.\n**Grund:** ${reason}`)], allowedMentions: { parse: [] } }).catch(() => {});
      await interaction.reply({ content: `🚫 <@${user.id}> wurde für neue Bestellungen gesperrt.`, ephemeral: true, allowedMentions: { parse: [] } });
      return;
    }
    delete data.blacklist[user.id];
    saveSellingStore(store);
    await interaction.reply({ content: `✅ <@${user.id}> wurde von der Shop-Blacklist entfernt.`, ephemeral: true, allowedMentions: { parse: [] } });
    return;
  }

  if (sub === 'coupon') {
    const action = interaction.options.getString('action');
    if (action === 'list') {
      const entries = Object.entries(data.coupons);
      const text = entries.length
        ? entries.map(([code, coupon]) => `• \`${code}\` — **${coupon.percent}%** — ${coupon.maxUses ? `${coupon.uses}/${coupon.maxUses}` : `${coupon.uses} Nutzungen / ∞`}${coupon.expiresAt ? ` — bis <t:${Math.floor(coupon.expiresAt / 1000)}:d>` : ''}`).join('\n')
        : 'Keine Rabattcodes angelegt.';
      await interaction.reply({ embeds: [shopEmbed('🏷️ Rabattcodes', text)], ephemeral: true });
      return;
    }
    const code = String(interaction.options.getString('code') || '').trim().toUpperCase();
    if (!code) {
      await interaction.reply({ content: '❌ `code` fehlt.', ephemeral: true });
      return;
    }
    if (action === 'remove') {
      delete data.coupons[code];
      saveSellingStore(store);
      await interaction.reply({ content: `✅ Rabattcode \`${code}\` entfernt.`, ephemeral: true });
      return;
    }
    const percent = interaction.options.getInteger('prozent');
    if (percent === null) {
      await interaction.reply({ content: '❌ Für **Hinzufügen** musst du `prozent` angeben.', ephemeral: true });
      return;
    }
    const maxUses = interaction.options.getInteger('nutzungen') ?? 0;
    const days = interaction.options.getInteger('tage') ?? 0;
    data.coupons[code] = {
      percent,
      maxUses,
      uses: 0,
      expiresAt: days > 0 ? Date.now() + days * 86400000 : null,
      createdBy: interaction.user.id,
      createdAt: Date.now(),
    };
    saveSellingStore(store);
    await interaction.reply({ content: `✅ Rabattcode \`${code}\` mit **${percent}%** wurde erstellt.`, ephemeral: true });
    return;
  }

  if (sub === 'portfolio') {
    const action = interaction.options.getString('action');
    if (action === 'list') {
      const entries = Object.values(data.portfolio);
      const text = entries.length
        ? entries.map(item => `• \`${item.id}\` **${item.title}** • ${item.category || 'Sonstiges'}\n${item.url}`).join('\n')
        : 'Portfolio ist noch leer.';
      await interaction.reply({ embeds: [shopEmbed('🖼️ Portfolio-Verwaltung', text.slice(0, 4000))], ephemeral: true });
      return;
    }
    if (action === 'remove') {
      const id = String(interaction.options.getString('id') || '').trim().toUpperCase();
      if (!id || !data.portfolio[id]) {
        await interaction.reply({ content: '❌ Portfolio-ID nicht gefunden.', ephemeral: true });
        return;
      }
      delete data.portfolio[id];
      saveSellingStore(store);
      await interaction.reply({ content: `✅ Portfolio-Eintrag \`${id}\` entfernt.`, ephemeral: true });
      return;
    }
    const title = interaction.options.getString('titel');
    const url = interaction.options.getString('url');
    const category = interaction.options.getString('kategorie') || 'Sonstiges';
    if (!title || !url) {
      await interaction.reply({ content: '❌ Für **Hinzufügen** brauchst du `titel` und `url`.', ephemeral: true });
      return;
    }
    const id = `PF-${String(data.nextPortfolio++).padStart(4, '0')}`;
    data.portfolio[id] = { id, title, url, category, createdAt: Date.now(), createdBy: interaction.user.id };
    saveSellingStore(store);
    const publicChannel = findSellingTextChannel(interaction.guild, '🖼️・portfolio');
    if (publicChannel) {
      await publicChannel.send({ embeds: [shopEmbed(`🖼️ ${title}`, `**Kategorie:** ${category}\n**Referenz:** ${url}\n\nPortfolio-ID: \`${id}\``)] }).catch(() => {});
    }
    await interaction.reply({ content: `✅ Portfolio-Eintrag \`${id}\` veröffentlicht.`, ephemeral: true });
    return;
  }

  if (sub === 'availability') {
    data.config.availability = interaction.options.getString('status');
    data.config.availabilityNote = interaction.options.getString('hinweis') || null;
    saveSellingStore(store);
    await refreshOrderStatusPanel(interaction.guild, data);
    await interaction.reply({ content: `✅ Shop-Status: **${availabilityLabel(data.config.availability)}**.`, ephemeral: true });
    return;
  }

  if (sub === 'update') {
    const productKey = interaction.options.getString('produkt');
    const text = interaction.options.getString('text');
    const product = PRODUCT_TYPES[productKey];
    const role = findSellingRole(interaction.guild, product?.roleKey);
    const channel = findSellingTextChannel(interaction.guild, '🔄・produkt-updates');
    if (!channel || !product) {
      await interaction.reply({ content: '❌ Produkt-Update-Channel oder Produkt fehlt.', ephemeral: true });
      return;
    }
    await channel.send({
      content: role ? `<@&${role.id}>` : '',
      embeds: [shopEmbed(`${product.emoji} Produkt-Update • ${product.label}`, text)],
      allowedMentions: role ? { roles: [role.id] } : { parse: [] },
    });
    await interaction.reply({ content: `✅ Update für **${product.label}** veröffentlicht.`, ephemeral: true });
    return;
  }

  if (sub === 'paypal') {
    const email = interaction.options.getString('email');
    if (email) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        await interaction.reply({ content: '❌ Bitte gib eine gültige PayPal-E-Mail-Adresse an.', ephemeral: true });
        return;
      }
      data.config.paypalEmail = email.trim();
      saveSellingStore(store);
      await refreshPaymentPanel(interaction.guild, data);
      await interaction.reply({ content: `✅ PayPal-Empfänger intern gesetzt auf \`${data.config.paypalEmail}\`.\nEr wird Kunden weiterhin nur im jeweiligen Kauf-Ticket bestätigt.`, ephemeral: true });
      return;
    }
    await interaction.reply({ content: data.config.paypalEmail ? `💳 Aktueller PayPal-Empfänger: \`${data.config.paypalEmail}\`` : '⚠️ Noch keine PayPal-Adresse hinterlegt.', ephemeral: true });
  }
}

async function runSellingSetup(interaction) {
  if (!interaction.inGuild()) return;
  if (interaction.guild.ownerId !== interaction.user.id) {
    await interaction.reply({ content: '❌ `/setup server selling` kann nur der **Server-Inhaber** ausführen.', ephemeral: true });
    return;
  }

  const botMember = interaction.guild.members.me || await interaction.guild.members.fetchMe().catch(() => null);
  if (!botMember?.permissions.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({ content: '❌ Der Bot braucht **Administrator**, damit der komplette Server sicher zurückgesetzt und neu aufgebaut werden kann.', ephemeral: true });
    return;
  }

  const preflight = await sellingResetPreflight(interaction.guild).catch(error => {
    console.error('❌ Selling Full Reset Preflight Fehler:', error);
    return { ok: false, reason: 'Die Rollen-/Channel-Prüfung ist fehlgeschlagen.', blockers: [] };
  });

  if (!preflight.ok) {
    const blockerText = preflight.blockers.length
      ? `\n\n**Blockierende Rollen:**\n${preflight.blockers.slice(0, 15).map(name => `• ${name}`).join('\n')}`
      : '';
    await interaction.reply({
      content: `❌ **Full Reset nicht gestartet.**\n${preflight.reason}\n\nVerschiebe die Bot-Rolle im Discord-Rollenmenü ganz nach oben über alle normalen Rollen und führe den Command erneut aus.${blockerText}`,
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  await interaction.editReply([
    '⚠️ **FULL RESET gestartet.**',
    'Alle normalen alten Rollen und alle alten Channels werden jetzt entfernt.',
    'Discord-Systemrollen, Bot-/Integrationsrollen und `@everyone` können technisch nicht gelöscht werden und bleiben bestehen.',
  ].join('\n'));

  const keepChannelId = interaction.channelId;
  const guildId = interaction.guild.id;
  sellingResetGuilds.add(guildId);

  let cleanupScheduled = false;
  try {
    const deleted = await deleteExistingSellingServer(interaction.guild, keepChannelId);

    if (deleted.failedChannels.length || deleted.failedRoles.length) {
      const failures = [
        deleted.failedChannels.length ? `Channels: ${deleted.failedChannels.slice(0, 10).join(', ')}` : null,
        deleted.failedRoles.length ? `Rollen: ${deleted.failedRoles.slice(0, 10).join(', ')}` : null,
      ].filter(Boolean).join('\n');
      throw new Error(`Der Full Reset konnte nicht vollständig ausgeführt werden. ${failures}`);
    }

    await interaction.editReply('🧱 **Alter Server entfernt.** Der professionelle Selling-Server wird jetzt komplett neu erstellt …');

    const structure = await createSellingStructure(interaction.guild);
    const freshShopData = persistSellingStructure(guildId, structure, true);
    await seedSellingServer(structure);
    await refreshOrderStatusPanel(interaction.guild, freshShopData).catch(() => {});
    await refreshPaymentPanel(interaction.guild, freshShopData).catch(() => {});

    await interaction.editReply([
      '✅ **FULL RESET abgeschlossen – Selling Server wurde komplett neu erstellt.**',
      '',
      `🗑️ Gelöschte alte Channels: **${deleted.deletedChannels + 1}**`,
      `🗑️ Gelöschte alte normale Rollen: **${deleted.deletedRoles}**`,
      deleted.skippedManagedRoles.length ? `🔒 Nicht löschbare Discord-/Bot-Systemrollen: **${deleted.skippedManagedRoles.length}**` : null,
      '',
      'Neu erstellt wurden professionelle Bereiche für **Thumbnails, NVE/Grafik-Setups, Soundpacks, Designs, FiveM-Assets, Bundles, PayPal-Zahlungen, Lizenzregeln, Support, Kauf-Tickets und Team-Verwaltung**.',
      'Der bisherige Command-Channel wird als letzter alter Channel nach dieser Meldung ebenfalls entfernt.',
    ].filter(Boolean).join('\n'));

    // Den Channel, in dem der Command ausgeführt wurde, lassen wir nur bis zur
    // Abschlussmeldung bestehen. Danach ist wirklich die komplette alte
    // Channel-Struktur entfernt.
    const oldCommandChannel = await interaction.guild.channels.fetch(keepChannelId).catch(() => null);
    cleanupScheduled = true;
    setTimeout(async () => {
      if (oldCommandChannel && !Object.values(structure.channels).some(channel => channel.id === oldCommandChannel.id)) {
        await oldCommandChannel.delete('Unfugstifter Selling Setup: letzter alter Channel').catch(error => {
          console.error('❌ Letzter alter Selling-Setup-Channel konnte nicht gelöscht werden:', error);
        });
      }
      setTimeout(() => sellingResetGuilds.delete(guildId), 1500);
    }, 5000);
  } catch (error) {
    console.error('❌ Selling Full Reset Fehler:', error);
    await interaction.editReply({
      content: `❌ **Selling Full Reset ist fehlgeschlagen.**\n${String(error?.message || error).slice(0, 1500)}\n\nPrüfe die Rollen-Hierarchie des Bots und die Railway-Logs.`,
    }).catch(() => {});
  } finally {
    if (!cleanupScheduled) sellingResetGuilds.delete(guildId);
  }
}

async function handleSellingInteraction(interaction) {
  if (interaction.isChatInputCommand?.()
    && interaction.commandName === 'setup'
    && interaction.options.getSubcommandGroup(false) === 'server'
    && interaction.options.getSubcommand(false) === 'selling') {
    await runSellingSetup(interaction);
    return true;
  }

  if (interaction.isChatInputCommand?.() && interaction.commandName === 'sell') {
    await handleSellCommand(interaction);
    return true;
  }

  if (interaction.isButton?.() && String(interaction.customId || '').startsWith('selling_order:')) {
    await showOrderModal(interaction, interaction.customId.split(':')[1]);
    return true;
  }

  if (interaction.isModalSubmit?.() && String(interaction.customId || '').startsWith('selling_order_modal:')) {
    await createOrderFromModal(interaction, interaction.customId.split(':')[1]);
    return true;
  }

  if (interaction.isButton?.() && String(interaction.customId || '').startsWith('selling_support:')) {
    await openSupportTicket(interaction, interaction.customId.split(':')[1] || 'general');
    return true;
  }

  if (interaction.isButton?.() && (interaction.customId === 'selling_support_claim' || interaction.customId === 'selling_support_close')) {
    await handleSupportButton(interaction);
    return true;
  }

  if (interaction.isButton?.() && (
    String(interaction.customId || '').startsWith('selling_claim:')
    || String(interaction.customId || '').startsWith('selling_status:')
    || String(interaction.customId || '').startsWith('selling_revision:')
    || String(interaction.customId || '').startsWith('selling_dispute:')
    || String(interaction.customId || '').startsWith('selling_close:')
  )) {
    await handleOrderTicketButton(interaction);
    return true;
  }

  if (interaction.isButton?.() && String(interaction.customId || '').startsWith('selling_review_open:')) {
    await openReviewModal(interaction, interaction.customId.split(':')[1]);
    return true;
  }

  if (interaction.isModalSubmit?.() && String(interaction.customId || '').startsWith('selling_review_submit:')) {
    await submitReview(interaction, interaction.customId.split(':')[1]);
    return true;
  }

  if (interaction.isButton?.() && String(interaction.customId || '').startsWith('selling_faq:')) {
    await handleFaqButton(interaction, interaction.customId.split(':')[1]);
    return true;
  }

  return false;
}

const originalLogin = Client.prototype.login;
Client.prototype.login = function patchedLogin(...args) {
  sellingLoginToken = args[0] || sellingLoginToken;
  if (!this.__sellingSetupInstalled) {
    this.__sellingSetupInstalled = true;
    this.prependListener(Events.InteractionCreate, async interaction => {
      if (!isSellingInteraction(interaction)) return;
      try {
        await handleSellingInteraction(interaction);
      } catch (error) {
        console.error('❌ Selling Setup Fehler:', error);
        const payload = { content: '❌ Beim Selling-System ist ein Fehler aufgetreten. Prüfe die Bot-Rechte und Railway-Logs.', ephemeral: true };
        if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => {});
        else await interaction.reply(payload).catch(() => {});
      }
    });

    // Wenn der Bot später auf einen neuen Discord eingeladen wird, werden die
    // Slash-Commands dort automatisch registriert. Ein Railway-Neustart ist
    // dafür nicht mehr nötig.
    this.on(Events.GuildCreate, async guild => {
      if (!cachedSellingCommandBody || !sellingLoginToken || !this.application?.id) return;
      try {
        const rest = new REST({ version: '10' }).setToken(sellingLoginToken);
        await rest.put(Routes.applicationGuildCommands(this.application.id, guild.id), { body: cachedSellingCommandBody });
        console.log(`✅ ${cachedSellingCommandBody.length} Commands automatisch auf neuem Server ${guild.name} (${guild.id}) registriert.`);
      } catch (error) {
        console.error(`❌ Commands konnten auf neuem Server ${guild.name} nicht registriert werden:`, error);
      }
    });
  }
  return originalLogin.apply(this, args);
};

require('./index.js');
