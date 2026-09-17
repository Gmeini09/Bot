'use strict';

const {
  ActionRowBuilder,
  AuditLogEvent,
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
const PDFDocument = require('pdfkit');
const sharp = require('sharp');

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
    { name: '🥉・STAMMKUNDE BRONZE', key: 'loyalty_bronze', color: 0xcd7f32, hoist: false, permissions: [] },
    { name: '🥈・STAMMKUNDE SILBER', key: 'loyalty_silver', color: 0xc0c0c0, hoist: false, permissions: [] },
    { name: '🥇・STAMMKUNDE GOLD', key: 'loyalty_gold', color: 0xffd700, hoist: true, permissions: [] },
    { name: '💠・VIP KUNDE', key: 'loyalty_vip', color: 0x00d9ff, hoist: true, permissions: [] },
    { name: '🔔・SHOP UPDATES', key: 'updates', color: 0x95a5a6, hoist: false, permissions: [] },
    { name: '🎁・GIVEAWAYS', key: 'giveaways', color: 0xe67e22, hoist: false, permissions: [] },
    { name: '⏳・NICHT VERIFIZIERT', key: 'unverified', color: 0x95a5a6, hoist: false, permissions: [] },
    { name: '✅・VERIFIZIERT', key: 'verified', color: 0x2ecc71, hoist: false, permissions: [] },
  ],
};

const PRODUCT_TYPES = {
  thumbnail: { label: 'Thumbnail', emoji: '🖼️', roleKey: 'buyer_thumbnail', revisions: 2, delivery: '1–3 Tage', etaDays: 2 },
  nve: { label: 'NVE Preset / Grafik-Setup', emoji: '🌆', roleKey: 'buyer_nve', revisions: 1, delivery: '1–3 Tage', etaDays: 2 },
  soundpack: { label: 'Soundpack', emoji: '🔊', roleKey: 'buyer_soundpack', revisions: 1, delivery: '1–2 Tage', etaDays: 2 },
  grafik: { label: 'Grafik / Design', emoji: '🎨', roleKey: 'buyer_grafik', revisions: 2, delivery: '1–4 Tage', etaDays: 3 },
  fivem: { label: 'FiveM Asset', emoji: '🚗', roleKey: 'buyer_fivem', revisions: 1, delivery: 'nach Umfang', etaDays: 4 },
  bundle: { label: 'Bundle / Komplettpaket', emoji: '📦', roleKey: 'buyer_bundle', revisions: 2, delivery: 'nach Umfang', etaDays: 4 },
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
const sellingVerifyChallenges = new Map();
const sellingAntiNukeActions = new Map();
const SELLING_VERIFY_TTL_MS = 5 * 60 * 1000;

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
    carts: {},
    config: {
      paypalEmail: null,
      availability: 'open',
      availabilityNote: null,
      channelIds: {},
      roleIds: {},
    },
    security: {
      antiNuke: {
        enabled: true,
        threshold: 4,
        windowMs: 10000,
        whitelist: [],
        quarantineMinutes: 1440,
      },
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
  data.carts = data.carts && typeof data.carts === 'object' ? data.carts : {};
  data.config = { ...blankGuildShopData().config, ...(data.config || {}) };
  data.config.channelIds = data.config.channelIds && typeof data.config.channelIds === 'object' ? data.config.channelIds : {};
  data.config.roleIds = data.config.roleIds && typeof data.config.roleIds === 'object' ? data.config.roleIds : {};
  data.security = data.security && typeof data.security === 'object' ? data.security : {};
  data.security.antiNuke = {
    ...blankGuildShopData().security.antiNuke,
    ...(data.security.antiNuke && typeof data.security.antiNuke === 'object' ? data.security.antiNuke : {}),
  };
  data.security.antiNuke.whitelist = Array.isArray(data.security.antiNuke.whitelist) ? data.security.antiNuke.whitelist : [];
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


const LOYALTY_LEVELS = [
  { key: 'vip', label: 'VIP', roleKey: 'loyalty_vip', minOrders: 20, discount: 15 },
  { key: 'gold', label: 'Gold', roleKey: 'loyalty_gold', minOrders: 10, discount: 12 },
  { key: 'silver', label: 'Silber', roleKey: 'loyalty_silver', minOrders: 5, discount: 8 },
  { key: 'bronze', label: 'Bronze', roleKey: 'loyalty_bronze', minOrders: 3, discount: 5 },
];

function completedOrdersForUser(data, userId) {
  return Object.values(data.orders || {}).filter(order => order.userId === userId && Number(order.deliveredAt) > 0);
}

function loyaltyForUser(data, userId) {
  const count = completedOrdersForUser(data, userId).length;
  const level = LOYALTY_LEVELS.find(entry => count >= entry.minOrders) || null;
  return { count, level, discount: level?.discount || 0 };
}

function orderProductKeys(order) {
  if (Array.isArray(order.cartItems) && order.cartItems.length) return [...new Set(order.cartItems.filter(key => PRODUCT_TYPES[key]))];
  return PRODUCT_TYPES[order.productKey] ? [order.productKey] : [];
}

function orderProductLabel(order) {
  const keys = orderProductKeys(order);
  if (!keys.length) return order.productKey || 'Unbekannt';
  if (keys.length === 1) return PRODUCT_TYPES[keys[0]].label;
  return keys.map(key => PRODUCT_TYPES[key].label).join(' + ');
}

function orderProductEmoji(order) {
  const keys = orderProductKeys(order);
  return keys.length === 1 ? PRODUCT_TYPES[keys[0]].emoji : '🛒';
}

function orderEtaDays(order) {
  const keys = orderProductKeys(order);
  if (!keys.length) return 3;
  return Math.max(...keys.map(key => Number(PRODUCT_TYPES[key]?.etaDays || 3)));
}

function activeQueue(data) {
  return Object.values(data.orders || {})
    .filter(order => !order.closedAt && !order.deliveredAt && order.status !== 'disputed')
    .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
}

function queueInfoForOrder(data, order) {
  const queue = activeQueue(data);
  const index = queue.findIndex(item => item.id === order.id);
  if (index < 0) return { position: null, total: queue.length, etaStart: null, etaFinish: null };
  const dailyCapacity = data.config.availability === 'busy' ? 0.5 : 1;
  const waitDays = Math.ceil(index / dailyCapacity);
  const etaDays = orderEtaDays(order);
  const etaStart = Date.now() + waitDays * 86400000;
  const etaFinish = etaStart + etaDays * 86400000;
  return { position: index + 1, total: queue.length, etaStart, etaFinish };
}

function effectiveDiscountForOrder(order) {
  return Math.max(0, Math.min(90, Math.max(Number(order.discountPercent || 0), Number(order.loyaltyDiscountPercent || 0))));
}

function safeAscii(value) {
  return String(value ?? '').replace(/[^\x20-\x7E]/g, '?');
}

function buildReceiptPdf(guild, order, license) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 54, info: { Title: `Bestellbeleg ${order.id}`, Author: 'Unfugstifter Shop' } });
      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.font('Helvetica-Bold').fontSize(20).text('UNFUGSTIFTER SHOP');
      doc.font('Helvetica').fontSize(10).text('Bestell- / Zahlungsbeleg fuer digitale Produkte');
      doc.moveDown();
      doc.moveTo(54, doc.y).lineTo(541, doc.y).stroke();
      doc.moveDown();

      const rows = [
        ['Belegnummer', order.id],
        ['Discord-Server', guild.name],
        ['Kaeufer Discord-ID', order.userId],
        ['Produkt(e)', orderProductLabel(order)],
        ['Zahlungsart', 'PayPal'],
        ['Status', order.deliveredAt ? 'Geliefert' : orderStatusLabel(order.status).replace(/[^\x20-\x7E]/g, '')],
        ['Betrag', Number.isFinite(Number(order.finalPrice ?? order.basePrice)) ? `${Number(order.finalPrice ?? order.basePrice).toFixed(2)} EUR` : 'Nicht gesetzt'],
        ['Bestellt am', new Date(order.createdAt).toLocaleString('de-AT')],
        ['Bezahlt am', order.paidAt ? new Date(order.paidAt).toLocaleString('de-AT') : '-'],
        ['Geliefert am', order.deliveredAt ? new Date(order.deliveredAt).toLocaleString('de-AT') : '-'],
        ['Lizenz-ID', license?.id || order.licenseId || '-'],
        ['Kaeuferkennung', license?.buyerMarker || '-'],
      ];
      for (const [label, value] of rows) {
        doc.font('Helvetica-Bold').fontSize(10).text(`${safeAscii(label)}:`, { continued: true, width: 150 });
        doc.font('Helvetica').text(` ${safeAscii(value)}`);
      }

      doc.moveDown();
      doc.font('Helvetica-Bold').text('Hinweis');
      doc.font('Helvetica').fontSize(9).text(
        'Dieser PDF-Beleg dokumentiert die im Discord-Shop erfasste Bestellung und Zahlung. Er ersetzt nicht automatisch eine gesetzlich vorgeschriebene steuerliche Rechnung. Massgeblich fuer Leistungsumfang, Lizenz und weitere Vereinbarungen sind das Regelwerk sowie die schriftlichen Angaben im zugehoerigen Bestell-Ticket.'
      );
      doc.moveDown();
      doc.text(`Erstellt: ${new Date().toLocaleString('de-AT')}`);
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

function ensureOrderLicense(data, order) {
  if (order.licenseId && data.licenses[order.licenseId]) return data.licenses[order.licenseId];
  const id = createLicenseId(data, order.id);
  const license = {
    id,
    orderId: order.id,
    userId: order.userId,
    productKey: order.productKey,
    productKeys: orderProductKeys(order),
    issuedAt: Date.now(),
    active: true,
    buyerMarker: `UFBUY-${order.userId.slice(-6)}-${order.id}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
  };
  data.licenses[id] = license;
  order.licenseId = id;
  return license;
}

async function applyLoyaltyRole(guild, data, userId) {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return null;
  const { level, count, discount } = loyaltyForUser(data, userId);
  const loyaltyRoles = LOYALTY_LEVELS.map(entry => findSellingRole(guild, entry.roleKey)).filter(Boolean);
  const targetRole = level ? findSellingRole(guild, level.roleKey) : null;
  for (const role of loyaltyRoles) {
    if (role.id !== targetRole?.id && member.roles.cache.has(role.id)) await member.roles.remove(role, 'Selling Loyalty Status aktualisiert').catch(() => {});
  }
  if (targetRole && !member.roles.cache.has(targetRole.id)) await member.roles.add(targetRole, `Selling Loyalty: ${level.label}`).catch(() => {});
  return { level, count, discount, role: targetRole };
}

async function watermarkOrderImage(guild, data, order, attachment) {
  const contentType = String(attachment?.contentType || '').toLowerCase();
  if (!contentType.startsWith('image/')) throw new Error('Watermarking ist aktuell fuer Bilddateien (PNG/JPG/WEBP) vorgesehen.');
  if (Number(attachment.size || 0) > 20 * 1024 * 1024) throw new Error('Die Bilddatei ist groesser als 20 MB.');
  const response = await fetch(attachment.url);
  if (!response.ok) throw new Error('Die hochgeladene Datei konnte nicht geladen werden.');
  const input = Buffer.from(await response.arrayBuffer());
  const image = sharp(input, { failOn: 'none' });
  const meta = await image.metadata();
  if (!meta.width || !meta.height) throw new Error('Bildgroesse konnte nicht erkannt werden.');
  const license = ensureOrderLicense(data, order);
  const marker = `${order.id} | ${license.id} | ${license.buyerMarker}`;
  const tileW = Math.max(360, Math.floor(meta.width / 2));
  const tileH = Math.max(180, Math.floor(meta.height / 3));
  const fontSize = Math.max(18, Math.min(44, Math.floor(meta.width / 32)));
  const escaped = marker.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const svg = Buffer.from(`<svg width="${meta.width}" height="${meta.height}" xmlns="http://www.w3.org/2000/svg">
    <defs><pattern id="p" width="${tileW}" height="${tileH}" patternUnits="userSpaceOnUse" patternTransform="rotate(-28)">
      <text x="20" y="${Math.floor(tileH/2)}" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="700" fill="white" fill-opacity="0.15" stroke="black" stroke-opacity="0.10" stroke-width="1">${escaped}</text>
    </pattern></defs>
    <rect width="100%" height="100%" fill="url(#p)"/>
    <rect x="0" y="${Math.max(0, meta.height-52)}" width="100%" height="52" fill="black" fill-opacity="0.40"/>
    <text x="${Math.max(16, meta.width-16)}" y="${Math.max(30, meta.height-18)}" text-anchor="end" font-family="Arial, sans-serif" font-size="${Math.max(14, Math.floor(fontSize*0.7))}" font-weight="700" fill="white">${escaped}</text>
  </svg>`);
  const output = await image.composite([{ input: svg, top: 0, left: 0 }]).png({ compressionLevel: 9 }).toBuffer();
  return { buffer: output, license, marker, fileName: `${order.id}-${path.parse(attachment.name || 'delivery').name}-watermarked.png` };
}

function cartForUser(data, userId) {
  const cart = data.carts[userId] && typeof data.carts[userId] === 'object' ? data.carts[userId] : { items: [], updatedAt: Date.now() };
  cart.items = Array.isArray(cart.items) ? cart.items.filter(key => PRODUCT_TYPES[key]) : [];
  data.carts[userId] = cart;
  return cart;
}

function cartEmbed(data, userId) {
  const cart = cartForUser(data, userId);
  const lines = cart.items.length
    ? cart.items.map((key, index) => `${index + 1}. ${PRODUCT_TYPES[key].emoji} **${PRODUCT_TYPES[key].label}**`).join('\n')
    : '*Dein Warenkorb ist leer.*';
  return shopEmbed('🛒 Dein Warenkorb', `${lines}\n\nBeim Checkout wird **eine gemeinsame UF-Bestellung** angelegt. Preis, Lieferumfang und PayPal-Zahlung werden im privaten Ticket final bestaetigt.`);
}

function cartActionRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('selling_cart_checkout').setLabel('Checkout').setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('selling_cart_clear').setLabel('Leeren').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
  );
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
      { type: 1, name: 'queue', description: 'Zeigt die aktuelle automatische Auftrags-Warteschlange.' },
      {
        type: 1, name: 'receipt', description: 'Erstellt einen PDF-Bestellbeleg erneut.', options: [
          { type: 3, name: 'order', description: 'Bestellnummer, z. B. UF-0001', required: true },
        ],
      },
      {
        type: 1, name: 'watermark', description: 'Versieht eine Liefergrafik mit Käufer-/Lizenz-Wasserzeichen.', options: [
          { type: 3, name: 'order', description: 'Bestellnummer, z. B. UF-0001', required: true },
          { type: 11, name: 'datei', description: 'PNG/JPG/WEBP Datei', required: true },
        ],
      },
      {
        type: 1, name: 'loyalty', description: 'Zeigt Stammkunden-/VIP-Status eines Kunden.', options: [
          { type: 6, name: 'user', description: 'Kunde', required: true },
        ],
      },
      {
        type: 1, name: 'verify', description: 'Verwaltet das Verifizierungs-System.', options: [
          { type: 3, name: 'action', description: 'Aktion', required: true, choices: [
            { name: 'Status', value: 'status' }, { name: 'Panel neu posten', value: 'panel' },
          ] },
        ],
      },
      {
        type: 1, name: 'antinuke', description: 'Verwaltet den Anti-Nuke-Schutz.', options: [
          { type: 3, name: 'action', description: 'Aktion', required: true, choices: [
            { name: 'Status', value: 'status' }, { name: 'Aktivieren', value: 'enable' }, { name: 'Deaktivieren', value: 'disable' },
            { name: 'Whitelist hinzufügen', value: 'whitelist' }, { name: 'Whitelist entfernen', value: 'unwhitelist' },
          ] },
          { type: 6, name: 'user', description: 'Nutzer für Whitelist', required: false },
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

function verifiedCategoryOverwrites(guild, roleMap) {
  return [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    ...(roleMap.verified ? [{ id: roleMap.verified.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] }] : []),
    ...staffRoleIds(roleMap).map(id => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] })),
  ];
}

function readOnlyOverwrites(guild, roleMap, verifiedOnly = false) {
  if (verifiedOnly) {
    return [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
      ...(roleMap.verified ? [{ id: roleMap.verified.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.SendMessages] }] : []),
      ...staffRoleIds(roleMap).map(id => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] })),
    ];
  }
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

async function ensureChannel(guild, parent, name, { type = ChannelType.GuildText, topic = null, readOnly = false, privateForStaff = false, verifiedOnly = false, roleMap = {} } = {}) {
  let channel = guild.channels.cache.find(item => item.type === type && item.name === name && item.parentId === parent.id) || null;
  if (!channel) {
    const permissionOverwrites = privateForStaff
      ? staffOverwrites(guild, roleMap)
      : readOnly
        ? readOnlyOverwrites(guild, roleMap, verifiedOnly)
        : verifiedOnly
          ? verifiedCategoryOverwrites(guild, roleMap)
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
  categories.shop = await ensureCategory(guild, SELLING.categories.shop, verifiedCategoryOverwrites(guild, roleMap));
  categories.buy = await ensureCategory(guild, SELLING.categories.buy, verifiedCategoryOverwrites(guild, roleMap));
  categories.community = await ensureCategory(guild, SELLING.categories.community, verifiedCategoryOverwrites(guild, roleMap));
  categories.support = await ensureCategory(guild, SELLING.categories.support, verifiedCategoryOverwrites(guild, roleMap));
  categories.orders = await ensureCategory(guild, SELLING.categories.orders, staffOverwrites(guild, roleMap));
  categories.delivery = await ensureCategory(guild, SELLING.categories.delivery, staffOverwrites(guild, roleMap));
  categories.team = await ensureCategory(guild, SELLING.categories.team, staffOverwrites(guild, roleMap));

  const channels = {};
  channels.welcome = await ensureChannel(guild, categories.info, '👋・willkommen', { readOnly: true, roleMap, topic: 'Willkommen im Unfugstifter Shop.' });
  channels.rules = await ensureChannel(guild, categories.info, '📜・regelwerk', { readOnly: true, roleMap, topic: 'Regeln und Lizenzhinweise für den Shop.' });
  channels.verify = await ensureChannel(guild, categories.info, '✅・verifizierung', { readOnly: true, roleMap, topic: 'Verifiziere dich hier, um Zugriff auf Shop, Community und Support zu erhalten.' });
  channels.news = await ensureChannel(guild, categories.info, '📢・ankündigungen', { readOnly: true, roleMap, topic: 'Shop-News, Releases und Updates.' });
  channels.faq = await ensureChannel(guild, categories.info, '❓・faq', { readOnly: true, roleMap, topic: 'Häufig gestellte Fragen.' });

  channels.thumbnails = await ensureChannel(guild, categories.shop, '🖼️・thumbnails', { readOnly: true, roleMap, topic: 'Thumbnail-Angebote, Beispiele und Pakete.', verifiedOnly: true});
  channels.nve = await ensureChannel(guild, categories.shop, '🌆・nve-presets', { readOnly: true, roleMap, topic: 'Eigene oder lizenzierte NVE-Presets, Grafik-Setups und Anpassungen.', verifiedOnly: true});
  channels.soundpacks = await ensureChannel(guild, categories.shop, '🔊・soundpacks', { readOnly: true, roleMap, topic: 'Eigene Soundpacks und Audio-Pakete.', verifiedOnly: true});
  channels.graphics = await ensureChannel(guild, categories.shop, '🎨・grafik-designs', { readOnly: true, roleMap, topic: 'Logos, Banner, Thumbnails und weitere Designs.', verifiedOnly: true});
  channels.fivem = await ensureChannel(guild, categories.shop, '🚗・fivem-assets', { readOnly: true, roleMap, topic: 'Eigene oder lizenzierte FiveM-Assets und Setups.', verifiedOnly: true});
  channels.bundles = await ensureChannel(guild, categories.shop, '📦・bundles', { readOnly: true, roleMap, topic: 'Produkt-Bundles und Pakete.', verifiedOnly: true});
  channels.newProducts = await ensureChannel(guild, categories.shop, '🆕・neuheiten', { readOnly: true, roleMap, topic: 'Neue Produkte und Updates.', verifiedOnly: true});
  channels.productUpdates = await ensureChannel(guild, categories.shop, '🔄・produkt-updates', { readOnly: true, roleMap, topic: 'Updates für bereits gekaufte Produkte.', verifiedOnly: true});
  channels.portfolio = await ensureChannel(guild, categories.shop, '🖼️・portfolio', { readOnly: true, roleMap, topic: 'Portfolio, Referenzen und ausgewählte Arbeiten.', verifiedOnly: true});

  channels.order = await ensureChannel(guild, categories.buy, '🛒・bestellen', { readOnly: true, roleMap, topic: 'Hier kannst du ein privates Kauf-Ticket öffnen.', verifiedOnly: true});
  channels.orderStatus = await ensureChannel(guild, categories.buy, '📊・bestellstatus', { readOnly: true, roleMap, topic: 'Aktueller Bestellstatus und Auslastung des Shops.', verifiedOnly: true});
  channels.payment = await ensureChannel(guild, categories.buy, '💳・zahlung', { readOnly: true, roleMap, topic: 'Zahlungsinformationen werden vom Shop-Team gepflegt.', verifiedOnly: true});
  channels.reviews = await ensureChannel(guild, categories.buy, '⭐・bewertungen', { readOnly: true, roleMap, topic: 'Verifizierte Bewertungen aus abgeschlossenen Bestellungen.', verifiedOnly: true});
  channels.customerStatus = await ensureChannel(guild, categories.buy, '💠・kundenstatus', { readOnly: true, roleMap, topic: 'Stammkunden-, VIP- und Rabattvorteile.', verifiedOnly: true});
  channels.results = await ensureChannel(guild, categories.buy, '📸・kunden-ergebnisse', { roleMap, topic: 'Ergebnisse und Showcase von Kunden.', verifiedOnly: true});
  channels.requests = await ensureChannel(guild, categories.buy, '💡・produkt-wünsche', { roleMap, topic: 'Wünsche für neue Produkte oder individuelle Aufträge.', verifiedOnly: true});

  channels.chat = await ensureChannel(guild, categories.community, '💬・shop-chat', { roleMap, topic: 'Allgemeiner Community-Chat.', verifiedOnly: true});
  channels.giveaways = await ensureChannel(guild, categories.community, '🎁・giveaways', { roleMap, topic: 'Giveaways und Aktionen.', verifiedOnly: true});
  channels.partners = await ensureChannel(guild, categories.community, '🤝・partner', { readOnly: true, roleMap, topic: 'Partner und Empfehlungen.', verifiedOnly: true});

  channels.support = await ensureChannel(guild, categories.support, '❓・support-chat', { roleMap, topic: 'Kurze Fragen vor oder nach dem Kauf.', verifiedOnly: true});
  channels.supportTicket = await ensureChannel(guild, categories.support, '🎫・support-ticket', { readOnly: true, roleMap, topic: 'Öffne hier ein privates Support-Ticket.', verifiedOnly: true});
  channels.ticketInfo = await ensureChannel(guild, categories.support, '📋・ticket-info', { readOnly: true, roleMap, topic: 'Informationen zu Kauf- und Support-Tickets.', verifiedOnly: true});
  channels.supportVoice = await ensureChannel(guild, categories.support, '📞・Support Warteraum', { type: ChannelType.GuildVoice, roleMap, verifiedOnly: true});

  channels.teamChat = await ensureChannel(guild, categories.team, '🛠️・team-chat', { privateForStaff: true, roleMap, topic: 'Interner Team-Chat.' });
  channels.ordersInternal = await ensureChannel(guild, categories.team, '📦・bestellungen', { privateForStaff: true, roleMap, topic: 'Interne Übersicht zu Bestellungen.' });
  channels.sales = await ensureChannel(guild, categories.team, '💰・verkäufe', { privateForStaff: true, roleMap, topic: 'Interne Verkaufsübersicht.' });
  channels.productUpload = await ensureChannel(guild, categories.team, '🗂️・produkt-upload', { privateForStaff: true, roleMap, topic: 'Produktdateien, Entwürfe und interne Uploads.' });
  channels.logs = await ensureChannel(guild, categories.team, '📋・logs', { privateForStaff: true, roleMap, topic: 'Selling-System Logs.' });
  channels.securityLogs = await ensureChannel(guild, categories.team, '🛡️・security-logs', { privateForStaff: true, roleMap, topic: 'Anti-Nuke, Verifizierung und Sicherheitsereignisse.' });
  channels.transcripts = await ensureChannel(guild, categories.team, '📄・transkripte', { privateForStaff: true, roleMap, topic: 'Automatisch gespeicherte Ticket-Transkripte.' });
  channels.blacklist = await ensureChannel(guild, categories.team, '🚫・blacklist', { privateForStaff: true, roleMap, topic: 'Interne Shop-Blacklist und Sperrprotokoll.' });
  channels.dashboard = await ensureChannel(guild, categories.team, '📊・shop-dashboard', { privateForStaff: true, roleMap, topic: 'Interne Kennzahlen und Shop-Übersicht.' });
  channels.queue = await ensureChannel(guild, categories.team, '⏱️・auftrags-warteschlange', { privateForStaff: true, roleMap, topic: 'Automatische Auftragsreihenfolge, Positionen und ETA.' });
  channels.teamVoice = await ensureChannel(guild, categories.team, '🔊・Team Talk', { type: ChannelType.GuildVoice, privateForStaff: true, roleMap });

  return { roleMap, categories, channels };
}


async function seedCompleteRulebook(channel) {
  if (!channel?.isTextBased?.()) return;
  const latest = await channel.messages.fetch({ limit: 1 }).catch(() => null);
  if (latest?.size) return;
  const sections = [
    ['📜 01 • Geltung, Bestellung & Vertrag', [
      '**1. Geltungsbereich**\nDieses Regelwerk gilt für sämtliche Produkte, Warenkorb-Bestellungen, Custom-Aufträge, Supportleistungen, digitalen Lieferungen, Updates und Lizenzen des Unfugstifter Shops.',
      '**2. Verbindlichkeit nur im offiziellen Ticket**\nVerbindlich sind ausschließlich Angaben, die im zugehörigen Kauf-Ticket durch das Shop-Team bestätigt wurden. Dazu gehören Produktumfang, Preis, Rabatt, Lieferform, Revisionen, ETA und Zahlungsdaten.',
      '**3. Warenkorb ist noch kein Vertrag**\nDas Hinzufügen von Produkten zum Warenkorb oder das Absenden des Checkout-Formulars allein verpflichtet noch nicht zur Zahlung. Erst die Bestätigung von Preis und Leistungsumfang im Kauf-Ticket ist maßgeblich.',
      '**4. Wahrheitsgemäße Angaben**\nKäufer müssen erforderliche Angaben korrekt machen. Identitätstäuschung, falsche Referenzen, manipulierte Nachweise oder bewusst irreführende Angaben können zur sofortigen Beendigung und Sperre führen.',
      '**5. Individuelle Aufträge**\nBei Custom-Arbeiten sind Referenzen, gewünschter Stil, Format, Einsatzzweck und sonstige Anforderungen vor Beginn möglichst vollständig anzugeben. Nachträgliche grundlegende Änderungen können als neuer Zusatzauftrag berechnet werden.',
    ]],
    ['💳 02 • Preise, PayPal, Rabatte & Belege', [
      '**6. Zahlung ausschließlich über PayPal**\nDie gültige Empfängeradresse und der endgültige Betrag werden im privaten Bestell-Ticket bestätigt. Zahlungen an andere Adressen, die nur per DM, Screenshot oder durch Dritte genannt wurden, erfolgen auf eigenes Risiko.',
      '**7. Niemals Zugangsdaten senden**\nDer Shop verlangt niemals PayPal-Passwort, 2FA-Code, Login-Code, vollständige Zugangsdaten oder Fernzugriff auf dein Konto.',
      '**8. Zahlungszuordnung**\nZur Zuordnung kann eine Transaktionsreferenz oder ein geeigneter Zahlungsnachweis verlangt werden. Nicht erforderliche sensible Daten sollen geschwärzt werden.',
      '**9. Rabattcodes**\nRabattcodes können zeitlich, mengenmäßig oder auf bestimmte Aktionen beschränkt sein. Manipulation, Mehrfachnutzung trotz Begrenzung oder Umgehungsversuche können zur Stornierung des Rabatts führen.',
      '**10. Stammkunden- und VIP-Rabatte**\nBronze, Silber, Gold und VIP werden automatisch anhand gelieferter Bestellungen vergeben. Rabattcode und Stammkundenrabatt werden standardmäßig nicht addiert; automatisch gilt der höhere Rabatt, sofern im Ticket nichts anderes bestätigt wird.',
      '**11. PDF-Bestellbeleg**\nNach Lieferung kann ein PDF-Bestell-/Zahlungsbeleg erstellt werden. Dieser dokumentiert die im Shopsystem gespeicherte Bestellung; er wird nicht pauschal als steuerliche Rechnung bezeichnet.',
    ]],
    ['⏱️ 03 • Warteschlange, ETA, Lieferung & Revisionen', [
      '**12. Warteschlange**\nOffene Aufträge werden automatisiert in einer Warteschlange geführt. Die Position kann sich durch abgeschlossene, pausierte oder strittige Aufträge verändern.',
      '**13. ETA ist eine Schätzung**\nAngezeigte Start- und Lieferzeiten sind unverbindliche Schätzwerte auf Grundlage von Queue-Position, Auslastung und Produkttyp. Der konkret bestätigte Termin im Ticket hat Vorrang.',
      '**14. Mitwirkung des Käufers**\nFehlende Antworten, Dateien, Referenzen oder Freigaben können die Bearbeitung verzögern. Solche Verzögerungen werden nicht automatisch dem Shop zugerechnet.',
      '**15. Lieferung**\nDigitale Lieferungen erfolgen im privaten Kunden-/Delivery-Bereich. Der Käufer ist dafür verantwortlich, gelieferte Dateien innerhalb angemessener Zeit zu sichern.',
      '**16. Revisionen**\nInkludierte Revisionen werden pro Bestellung angezeigt. Eine Revision umfasst angemessene Änderungen innerhalb des vereinbarten Konzepts; ein vollständiger Richtungswechsel oder neuer Auftrag kann zusätzlich berechnet werden.',
      '**17. Abnahme und Fehler**\nOffensichtliche Fehler oder fehlende Bestandteile sollen zeitnah im Ticket oder Support gemeldet werden. Gesetzliche Rechte werden dadurch nicht ausgeschlossen.',
    ]],
    ['🔐 04 • Lizenz, Eigentum, Weiterverkauf & Weitergabe', [
      '**18. Persönliche Nutzungslizenz**\nSofern nicht ausdrücklich anders vereinbart, erhält ausschließlich der Käufer eine persönliche, nicht übertragbare Nutzungslizenz im bestätigten Umfang. Eigentums-, Quell-, Weiterverkaufs- oder Unterlizenzierungsrechte werden nicht automatisch übertragen.',
      '**19. Weiterverkauf strikt verboten**\nProdukte oder Teile davon dürfen ohne ausdrückliche schriftliche Freigabe nicht verkauft, vermietet, getauscht, verschenkt, gebündelt oder als Bonus zu eigenen Verkäufen weitergegeben werden.',
      '**20. Leaken / Teilen strikt verboten**\nDas Hochladen, Spiegeln, Veröffentlichen, Leaken oder Versenden an Freunde, andere Discords, FiveM-Server, Communities, Clouds, Foren, Telegram-Gruppen, Download-Seiten oder andere Dritte ist ohne Freigabe untersagt.',
      '**21. Reuploads / Reskins / Kopien verboten**\nEin Produkt darf nicht lediglich umbenannt, leicht verändert oder neu verpackt und anschließend als eigenes Produkt, Pack, Preset, Design oder Asset veröffentlicht bzw. verkauft werden.',
      '**22. Team-/Server-/Mehrnutzerlizenz**\nMehrere Nutzer, Teams, Agenturen oder Server dürfen ein Produkt nur gemeinsam verwenden, wenn eine entsprechende Lizenz ausdrücklich im Ticket bestätigt wurde.',
      '**23. Lizenztransfer**\nEin Transfer an einen anderen Discord-Account oder Betreiber ist nur mit vorheriger Freigabe des Managements gültig. Eigenmächtige Transfers sind nicht erlaubt.',
    ]],
    ['🕵️ 05 • Watermarking, Käuferkennung & Anti-Leak', [
      '**24. Käuferkennung**\nBestellungen können eine eindeutige Bestellnummer, Lizenz-ID und Käuferkennung erhalten. Diese Zuordnung dient Lizenzprüfung, Support, Update-Berechtigung und Anti-Leak-Nachverfolgung.',
      '**25. Echtes Bild-Watermarking**\nLiefergrafiken können mit sichtbaren, wiederholten Käufer-/Lizenz-Wasserzeichen versehen werden. Das Entfernen oder gezielte Unkenntlichmachen zur Verschleierung einer unerlaubten Weitergabe ist untersagt.',
      '**26. Keine falschen Überwachungsbehauptungen**\nDer Shop behauptet nicht, private Geräte, PayPal-Konten oder fremde Plattformen vollständig überwachen zu können. Dokumentiert werden nur Daten, die im Shop-/Discord-System oder im Rahmen zulässiger Nachweise tatsächlich vorliegen.',
      '**27. Leak-Nachweis**\nBei Verdacht können Lizenz-ID, Käuferkennung, Ticketverlauf, Zeitstempel, Dateikennzeichnung und öffentlich zugängliche Fundstellen zur Prüfung herangezogen werden.',
      '**28. Konsequenzen bei belegtem Missbrauch**\nBei nachvollziehbar belegtem Leak, Weiterverkauf, Umgehung von Lizenzschutz oder unerlaubter Verbreitung kann die Lizenz deaktiviert, Support beendet und der Nutzer vom Shop ausgeschlossen werden. Weitere zulässige Schritte richten sich nach dem anwendbaren Recht.',
    ]],
    ['🎫 06 • Support, Streitfälle, Refunds & Blacklist', [
      '**29. Support**\nSupport gilt für den vereinbarten Lieferumfang. Größere Erweiterungen, neue Varianten, fremdverursachte Fehler oder Änderungen an Drittsoftware können als neuer Auftrag behandelt werden.',
      '**30. Support-Tickets**\nFür allgemeine Hilfe, Installation, Bestellung/Lieferung und PayPal gibt es getrennte Support-Typen. Passwörter und 2FA-Codes dürfen nicht gesendet werden.',
      '**31. Streitfälle**\nProbleme sollen zuerst im offiziellen Ticket geklärt werden. Relevante Informationen werden nachvollziehbar dokumentiert; beide Seiten sollen Gelegenheit zur sachlichen Darstellung erhalten.',
      '**32. Rückerstattung / Widerruf / Gewährleistung**\nDiese Rechte werden nicht pauschal ausgeschlossen. Maßgeblich sind die konkrete Vereinbarung und zwingende gesetzliche Verbraucherrechte, soweit sie anwendbar sind.',
      '**33. Blacklist**\nBetrugsversuche, wiederholter Missbrauch, schwere Regelverstöße oder Umgehung bestehender Sperren können zu einer Sperre für neue Bestellungen führen. Support für bestehende Streitfälle kann weiterhin ermöglicht werden.',
      '**34. Chargebacks und falsche Zahlungsbehauptungen**\nBewusst falsche Zahlungsbehauptungen, gefälschte Belege oder missbräuchliche Rückbuchungen können zur Sperre und Dokumentation des Vorgangs führen. Berechtigte Zahlungsprobleme sollen über Support geklärt werden.',
    ]],
    ['📋 07 • Daten, Logs, Verhalten & Schlussbestimmungen', [
      '**35. Dokumentation**\nZur Auftragsbearbeitung, Sicherheit und Nachvollziehbarkeit können Discord-ID, Bestellnummer, Produkt, Status, Preis, Rabatt, Zeitstempel, zuständiges Teammitglied, Lizenzdaten und relevante Ticketkommunikation gespeichert werden.',
      '**36. Ticket-Transkripte**\nBeim Schließen können Transkripte im internen Team-Bereich gespeichert werden. Enthalten sein können Nachrichten, Embed-Inhalte und Verweise auf hochgeladene Dateien im technisch erfassten Umfang.',
      '**37. Respektvolles Verhalten**\nBeleidigungen, Drohungen, Spam, Doxxing, Erpressung, absichtliche Störungen oder Betrugsversuche werden nicht toleriert.',
      '**38. Rechte Dritter**\nKäufer dürfen gelieferte Inhalte nicht in einer Weise verwenden, die Urheber-, Marken-, Persönlichkeits- oder sonstige Rechte Dritter verletzt. Der Shop verkauft nur Inhalte, die er selbst erstellt hat oder rechtmäßig anbieten darf.',
      '**39. Produkt-Updates**\nUpdates können an aktive Käuferlizenzen und passende Käuferrollen gebunden sein. Ein Anspruch auf unbegrenzte zukünftige Erweiterungen entsteht nur, wenn dies ausdrücklich zugesagt wurde.',
      '**40. Änderungen des Regelwerks**\nDas Regelwerk kann für zukünftige Bestellungen angepasst werden. Für bereits abgeschlossene Bestellungen bleiben zwingende gesetzliche Rechte sowie individuell bestätigte Vereinbarungen maßgeblich.',
      '**41. Zustimmung**\nMit Abschluss einer Bestellung bestätigst du, dass du dieses Regelwerk und die im Kauf-Ticket bestätigten Produkt-, Preis- und Lizenzbedingungen zur Kenntnis genommen hast.',
    ]],
    ['🛡️ 08 • Verifizierung, Account-Sicherheit & Anti-Nuke', [
      '**42. Verifizierungspflicht**\nFür den Zugriff auf Shop, Bestellungen, Community und Support ist die Verifizierung über den offiziellen Verify-Channel erforderlich. Die Verifizierung dient dem Schutz vor Bots, Spam und automatisiertem Missbrauch.',
      '**43. Keine Umgehung der Verifizierung**\nDas Umgehen der Verifizierung durch Zweitaccounts, Automatisierung, fremde Accounts oder technische Tricks ist untersagt und kann zur Sperre führen.',
      '**44. Account-Verantwortung**\nJeder Nutzer ist für die Sicherheit seines Discord-Accounts verantwortlich. Bei Verdacht auf einen kompromittierten Account kann der Zugriff vorsorglich eingeschränkt werden.',
      '**45. Anti-Nuke-Schutz**\nDer Server verwendet einen Anti-Nuke-Schutz. Kritische Aktionen wie massenhaftes Löschen oder Erstellen von Channels/Rollen, auffällige Berechtigungsänderungen, Webhook-Missbrauch, Kicks oder Bans können protokolliert und automatisch bewertet werden.',
      '**46. Automatische Sicherheitsmaßnahmen**\nWird innerhalb kurzer Zeit ein festgelegter Schwellenwert kritischer Aktionen überschritten, kann der ausführende Account automatisch quarantänisiert werden. Dabei können entfernbare Rollen entzogen und eine zeitlich begrenzte Kommunikationssperre gesetzt werden. Der Server-Inhaber und ausdrücklich freigegebene Accounts sind ausgenommen.',
      '**47. Security-Logs und Whitelist**\nSicherheitsereignisse werden intern mit Discord-ID, Aktion und Zeitstempel dokumentiert. Die Anti-Nuke-Whitelist darf ausschließlich für vertrauenswürdige Accounts verwendet werden; sie hebt normale Shop- und Lizenzregeln nicht auf.',
    ]],
  ];
  for (const [title, rules] of sections) {
    await channel.send({ embeds: [shopEmbed(title, rules.join('\n\n'))] }).catch(() => {});
  }
}

async function seedSellingServer(structure) {
  const { channels } = structure;

  await seedIfEmpty(channels.welcome, {
    embeds: [shopEmbed('🛒 Willkommen im Unfugstifter Shop', 'Willkommen im offiziellen **Unfugstifter Shop** für digitale Produkte und individuelle Aufträge.\n\nLies zuerst **📜・regelwerk** und verifiziere dich anschließend in **✅・verifizierung**. Erst danach erhältst du Zugriff auf Shop, Bestellung, Community und Support. Preise, Lieferumfang und Zahlung werden immer im privaten Ticket bestätigt.')],
  });

  await seedCompleteRulebook(channels.rules);

  await seedVerificationPanel(channels.verify);

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

  await seedIfEmpty(channels.customerStatus, {
    embeds: [shopEmbed('💠 Stammkunden & VIP', '**Bronze:** ab 3 gelieferten Bestellungen • 5 % Stammkundenrabatt\n**Silber:** ab 5 • 8 %\n**Gold:** ab 10 • 12 %\n**VIP:** ab 20 • 15 %\n\nDer Status wird nach erfolgreichen Lieferungen automatisch aktualisiert. Rabattcodes und Stammkundenrabatte werden standardmäßig **nicht gestapelt**; automatisch gilt der höhere Rabatt. Der finale Preis wird immer im Kauf-Ticket bestätigt.')],
  });

  const orderRow1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('selling_cart_add:thumbnail').setLabel('Thumbnail +').setEmoji('🖼️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('selling_cart_add:nve').setLabel('NVE +').setEmoji('🌆').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('selling_cart_add:soundpack').setLabel('Soundpack +').setEmoji('🔊').setStyle(ButtonStyle.Primary),
  );
  const orderRow2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('selling_cart_add:grafik').setLabel('Design +').setEmoji('🎨').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('selling_cart_add:fivem').setLabel('FiveM +').setEmoji('🚗').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('selling_cart_add:bundle').setLabel('Bundle +').setEmoji('📦').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('selling_cart_view').setLabel('Warenkorb').setEmoji('🛒').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('selling_support:general').setLabel('Support').setEmoji('🎫').setStyle(ButtonStyle.Secondary),
  );
  await seedIfEmpty(channels.order, {
    embeds: [shopEmbed('🛒 Bestellung starten', 'Lege ein oder mehrere Produkte über die **+ Buttons** in deinen Warenkorb. Öffne danach **🛒 Warenkorb → Checkout**. Der Bot erstellt eine gemeinsame **UF-Bestellung** mit privatem Kauf-Ticket. Dort werden Preis, Rabatt, Queue/ETA, Lieferumfang, Revisionen und PayPal-Zahlung final bestätigt.\n\nMit Abschluss der Bestellung gelten die veröffentlichten **Shop- und Lizenzbedingungen** in 📜・regelwerk.')],
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
    embeds: [shopEmbed('📋 Ticket-System & Ablauf', '**Kauf-Ticket**\nFür Warenkorb- und Einzelbestellungen. Dort werden Produkte, Umfang, Preis, Rabatt/VIP-Status, Queue/ETA, PayPal-Zahlung, Revisionen und Lieferung abgestimmt.\n\n**PDF-Beleg & Lizenz**\nNach Lieferung erhält der Kundenbereich Lizenzdatei und PDF-Bestellbeleg. Bilddateien können vom Team mit Käufer-/Lizenz-Watermark versehen werden.\n\n**Support-Ticket**\nFür allgemeine Hilfe, Installation, Lieferprobleme oder Zahlungsfragen.\n\n**Nachvollziehbarkeit**\nTicket-Erstellung, Zuständigkeit, Status und relevante Bearbeitungsschritte können für Support, Betrugsprävention und interne Dokumentation protokolliert werden.')],
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
  await seedIfEmpty(channels.queue, { embeds: [shopEmbed('⏱️ Auftrags-Warteschlange', 'Die aktuelle interne Queue inklusive geschätzter ETA kann mit `/sell queue` angezeigt werden. Der öffentliche Überblick wird automatisch in 📊・bestellstatus aktualisiert.')] });
  await seedIfEmpty(channels.securityLogs, { embeds: [shopEmbed('🛡️ Security Center', 'Der **Anti-Nuke-Schutz ist standardmäßig aktiviert**. Kritische Audit-Log-Aktionen werden bewertet und bei Überschreitung des Schwellenwerts automatisch quarantänisiert.\n\nVerwaltung ausschließlich durch den Server-Inhaber über `/sell antinuke`. Verify-Ereignisse und Anti-Nuke-Maßnahmen werden in diesem Channel dokumentiert.')] });
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

function orderInfoEmbed(order, data = null) {
  const productLabel = orderProductLabel(order);
  const emoji = orderProductEmoji(order);
  const assigned = order.assignedTo ? `<@${order.assignedTo}>` : 'Noch niemand';
  const basePrice = Number.isFinite(Number(order.basePrice)) ? formatEuro(order.basePrice) : 'Noch offen';
  const finalPrice = Number.isFinite(Number(order.finalPrice)) ? formatEuro(order.finalPrice) : basePrice;
  const effectiveDiscount = effectiveDiscountForOrder(order);
  const discountParts = [];
  if (order.couponCode) discountParts.push(`Code \`${order.couponCode}\`: ${order.discountPercent || 0} %`);
  if (order.loyaltyDiscountPercent) discountParts.push(`${order.loyaltyLabel || 'Stammkunde'}: ${order.loyaltyDiscountPercent} %`);
  const license = order.licenseId ? `\`${order.licenseId}\`` : 'Noch nicht ausgestellt';
  const queue = data ? queueInfoForOrder(data, order) : null;
  const queueText = queue?.position
    ? `**Queue:** #${queue.position} von ${queue.total}\n**ETA Start:** <t:${Math.floor(queue.etaStart / 1000)}:R>\n**ETA Lieferung:** ca. <t:${Math.floor(queue.etaFinish / 1000)}:d>`
    : '**Queue:** nicht aktiv';

  return shopEmbed(`${emoji} Bestellung ${order.id} • ${productLabel}`.slice(0, 256), [
    `**Status:** ${orderStatusLabel(order.status)}`,
    `**Kunde:** <@${order.userId}>`,
    `**Zuständig:** ${assigned}`,
    `**Preis:** ${basePrice}${effectiveDiscount ? ` → **${finalPrice}**` : ''}`,
    `**Rabatt:** ${discountParts.length ? discountParts.join(' • ') : 'Keiner'}`,
    `**Revisionen:** ${Math.max(0, Number(order.revisionsRemaining || 0))}`,
    `**Richtwert Lieferung:** ${orderEtaDays(order)} Tag(e) / nach Umfang`,
    `**Lizenz:** ${license}`,
    queueText,
  ].join('\n'), [
    { name: 'Auftrag', value: String(order.details || 'Keine Angaben').slice(0, 1024) },
    { name: 'Produkte', value: orderProductKeys(order).map(key => `${PRODUCT_TYPES[key].emoji} ${PRODUCT_TYPES[key].label}`).join('\n').slice(0, 1024) || productLabel },
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
  for (const order of orders) {
    for (const key of orderProductKeys(order)) productCounts[key] = (productCounts[key] || 0) + 1;
  }
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

  const queue = activeQueue(data);
  const loyaltyCounts = Object.values(data.orders || {}).filter(order => order.deliveredAt).reduce((acc, order) => { acc.add(order.userId); return acc; }, new Set()).size;

  return shopEmbed('📊 Owner Shop-Dashboard', `Interne Live-Übersicht für **${guild.name}**.`, [
    { name: 'Bestellungen', value: `Gesamt: **${orders.length}**\nOffen: **${open}**\nStreitfälle: **${disputed}**`, inline: true },
    { name: 'Verkäufe', value: `Bezahlt: **${paidOrders.length}**\nGeliefert: **${delivered.length}**\nUmsatz erfasst: **${formatEuro(revenue)}**`, inline: true },
    { name: 'Service', value: `Ø Lieferung: **${avgDelivery}**\nBewertungen: **${reviews.length}**\nØ Rating: **${avgRating}**`, inline: true },
    { name: 'Top-Produkte', value: topProducts },
    { name: 'Warteschlange', value: `Aktiv: **${queue.length}**\nKunden mit Lieferung: **${loyaltyCounts}**`, inline: true },
    { name: 'Shop-Status', value: `${availabilityLabel(data.config.availability)}${data.config.availabilityNote ? `\n${data.config.availabilityNote}` : ''}` },
  ]);
}


async function handleCartButton(interaction) {
  if (!interaction.inGuild()) return;
  const { store, data } = getGuildShopData(interaction.guildId);
  if (data.blacklist[interaction.user.id]) {
    await interaction.reply({ content: '🚫 Du bist aktuell für neue Bestellungen gesperrt.', ephemeral: true });
    return;
  }
  const id = String(interaction.customId || '');
  if (id.startsWith('selling_cart_add:')) {
    const key = id.split(':')[1];
    if (!PRODUCT_TYPES[key]) return;
    const cart = cartForUser(data, interaction.user.id);
    if (!cart.items.includes(key)) cart.items.push(key);
    cart.updatedAt = Date.now();
    saveSellingStore(store);
    await interaction.reply({ embeds: [cartEmbed(data, interaction.user.id)], components: [cartActionRow()], ephemeral: true });
    return;
  }
  if (id === 'selling_cart_view') {
    await interaction.reply({ embeds: [cartEmbed(data, interaction.user.id)], components: [cartActionRow()], ephemeral: true });
    return;
  }
  if (id === 'selling_cart_clear') {
    data.carts[interaction.user.id] = { items: [], updatedAt: Date.now() };
    saveSellingStore(store);
    await interaction.update({ embeds: [cartEmbed(data, interaction.user.id)], components: [cartActionRow()] });
    return;
  }
  if (id === 'selling_cart_checkout') {
    const cart = cartForUser(data, interaction.user.id);
    if (!cart.items.length) {
      await interaction.reply({ content: '🛒 Dein Warenkorb ist leer.', ephemeral: true });
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
    const modal = new ModalBuilder().setCustomId('selling_cart_checkout_modal').setTitle('Warenkorb bestellen');
    modal.addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('details').setLabel('Auftrag / Wünsche').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1500)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('references').setLabel('Referenzen / Links').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('deadline').setLabel('Wunschtermin').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(100)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('coupon').setLabel('Rabattcode').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(30)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('notes').setLabel('Zusätzliche Hinweise').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(800)),
    );
    await interaction.showModal(modal);
  }
}

async function createCartOrderFromModal(interaction) {
  if (!interaction.inGuild()) return;
  const { store, data } = getGuildShopData(interaction.guildId);
  const cart = cartForUser(data, interaction.user.id);
  if (!cart.items.length) {
    await interaction.reply({ content: '🛒 Dein Warenkorb ist leer.', ephemeral: true });
    return;
  }
  if (data.blacklist[interaction.user.id] || data.config.availability === 'closed') {
    await interaction.reply({ content: '❌ Checkout ist aktuell nicht möglich.', ephemeral: true });
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
  const loyalty = loyaltyForUser(data, interaction.user.id);
  const orderId = nextOrderId(data);
  const keys = [...new Set(cart.items)];
  const revisions = Math.max(...keys.map(key => Number(PRODUCT_TYPES[key]?.revisions || 0)), 0);
  const order = {
    id: orderId, userId: interaction.user.id, productKey: keys.length === 1 ? keys[0] : 'cart', cartItems: keys,
    details: interaction.fields.getTextInputValue('details').trim(), references: interaction.fields.getTextInputValue('references').trim(),
    deadline: interaction.fields.getTextInputValue('deadline').trim(), notes: interaction.fields.getTextInputValue('notes').trim(),
    couponCode: couponState.code, discountPercent: couponState.coupon ? Number(couponState.coupon.percent || 0) : 0,
    loyaltyDiscountPercent: loyalty.discount, loyaltyLabel: loyalty.level?.label || null,
    basePrice: null, finalPrice: null, status: 'pending', revisionsRemaining: revisions, assignedTo: null,
    createdAt: Date.now(), paidAt: null, deliveredAt: null, closedAt: null, channelId: null, deliveryChannelId: null,
    licenseId: null, reviewSubmitted: false,
  };
  data.orders[orderId] = order;
  if (couponState.coupon) couponState.coupon.uses = Number(couponState.coupon.uses || 0) + 1;
  data.carts[interaction.user.id] = { items: [], updatedAt: Date.now() };
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
      name: `${orderId.toLowerCase()}-cart-${sanitizeName(interaction.user.username)}`.slice(0, 95),
      type: ChannelType.GuildText, parent: category.id,
      topic: `selling-owner:${interaction.user.id}|selling-kind:order|selling-order:${orderId}|selling-product:cart|selling-status:open`,
      permissionOverwrites: sellingTicketOverwrites(interaction.guild, interaction.user.id),
      reason: `Selling Warenkorb ${orderId} von ${interaction.user.tag}`,
    });
  } catch (error) {
    order.closedAt = Date.now(); order.failedAt = Date.now();
    data.carts[interaction.user.id] = { items: keys, updatedAt: Date.now() };
    if (couponState.coupon) couponState.coupon.uses = Math.max(0, Number(couponState.coupon.uses || 0) - 1);
    saveSellingStore(store); throw error;
  }
  order.channelId = channel.id;
  saveSellingStore(store);
  await channel.send({ content: `<@${interaction.user.id}>`, embeds: [orderInfoEmbed(order, data)], components: orderActionRows(order), allowedMentions: { users: [interaction.user.id] } });
  const internal = findSellingTextChannel(interaction.guild, '📦・bestellungen');
  if (internal) await internal.send({ embeds: [shopEmbed(`🛒 Neue Warenkorb-Bestellung ${orderId}`, `<@${interaction.user.id}>\n${keys.map(key => `${PRODUCT_TYPES[key].emoji} ${PRODUCT_TYPES[key].label}`).join('\n')}\nTicket: <#${channel.id}>`)], allowedMentions: { parse: [] } }).catch(() => {});
  await refreshOrderStatusPanel(interaction.guild, data).catch(() => {});
  const q = queueInfoForOrder(data, order);
  await interaction.reply({ content: `✅ Warenkorb-Bestellung **${orderId}** erstellt: <#${channel.id}>${q.position ? `\nQueue-Position: **#${q.position} von ${q.total}**` : ''}`, ephemeral: true });
  await logSelling(interaction.guild, '🛒 Neue Warenkorb-Bestellung', `<@${interaction.user.id}> hat **${orderId}** erstellt: <#${channel.id}>`);
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

  const loyalty = loyaltyForUser(data, interaction.user.id);
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
    loyaltyDiscountPercent: loyalty.discount,
    loyaltyLabel: loyalty.level?.label || null,
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
    embeds: [orderInfoEmbed(order, data)],
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

  await refreshOrderStatusPanel(interaction.guild, data).catch(() => {});
  const queue = queueInfoForOrder(data, order);
  await interaction.reply({
    content: `✅ Bestellung **${orderId}** wurde erstellt: <#${channel.id}>\nDas Team bestätigt dort Preis, Lieferumfang und PayPal-Zahlung.${queue.position ? `\nQueue-Position: **#${queue.position} von ${queue.total}**` : ''}`,
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
  const customerRole = findSellingRole(guild, 'customer');
  if (customerRole) await member.roles.add(customerRole, `Selling Bestellung ${order.id}`).catch(() => {});
  for (const key of orderProductKeys(order)) {
    const product = PRODUCT_TYPES[key];
    const productRole = product?.roleKey ? findSellingRole(guild, product.roleKey) : null;
    if (productRole) await member.roles.add(productRole, `Selling Kauf ${order.id}`).catch(() => {});
  }
}

function licenseText(guild, order, license) {
  return [
    'UNFUGSTIFTER SHOP • DIGITALE LIZENZ',
    '=====================================',
    `Lizenz-ID: ${license.id}`,
    `Bestellung: ${order.id}`,
    `Käufer Discord-ID: ${order.userId}`,
    `Produkt(e): ${orderProductLabel(order)}`,
    `Ausgestellt: ${new Date(license.issuedAt).toISOString()}`,
    `Käuferkennzeichnung: ${license.buyerMarker}`,
    '',
    'Lizenz:',
    'Persönliche, nicht übertragbare Nutzungslizenz im im Ticket vereinbarten Umfang.',
    'Weiterverkauf, Leak, Reupload, unerlaubte Weitergabe oder Unterlizenzierung sind nicht gestattet.',
    '',
    'Diese Datei ist eine Zuordnungs-/Lizenzdatei.',
    'Bildlieferungen können mit /sell watermark sichtbar und wiederholt mit Bestell-, Lizenz- und Käuferkennung markiert werden.',
    'Andere Dateitypen werden nicht als unsichtbar wassergezeichnet ausgegeben, sofern dafür kein gesonderter Prozess vereinbart wurde.',
    '',
    `Server: ${guild.name} (${guild.id})`,
  ].join('\n');
}

async function deliverOrder(guild, orderId, actorId = null) {
  const { store, data } = getGuildShopData(guild.id);
  const order = data.orders[orderId];
  if (!order) throw new Error('Bestellung nicht gefunden.');

  const product = { label: orderProductLabel(order), emoji: orderProductEmoji(order) };
  ensureOrderLicense(data, order);
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
  const receiptBuffer = await buildReceiptPdf(guild, order, license);
  const receiptAttachment = new AttachmentBuilder(receiptBuffer, { name: `${order.id}-Bestellbeleg.pdf` });
  const reviewRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`selling_review_open:${order.id}`).setLabel('Bewertung abgeben').setEmoji('⭐').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`selling_revision:${order.id}`).setLabel(`Revision anfragen (${Math.max(0, Number(order.revisionsRemaining || 0))})`).setEmoji('🔄').setStyle(ButtonStyle.Secondary),
  );

  if (!order.deliveryPostedAt) {
    await deliveryChannel.send({
      content: `<@${order.userId}>`,
      embeds: [shopEmbed(`${product.emoji} Lieferung • ${order.id}`, `Deine Bestellung wurde als **geliefert** markiert.\n\n**Produkt:** ${product.label}\n**Lizenz:** \`${order.licenseId}\`\n**Käuferkennzeichnung:** \`${license.buyerMarker}\`\n\nDie eigentlichen Produktdateien werden hier vom Shop-Team bereitgestellt. Bewahre deine Lizenz-ID für Support und Updates auf.`)],
      files: [attachment, receiptAttachment],
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
  const loyaltyStatus = await applyLoyaltyRole(guild, data, order.userId).catch(() => null);
  saveSellingStore(store);
  await refreshOrderStatusPanel(guild, data).catch(() => {});
  if (loyaltyStatus?.level && deliveryChannel?.isTextBased()) {
    await deliveryChannel.send({ embeds: [shopEmbed('💠 Kundenstatus aktualisiert', `Du hast jetzt **${loyaltyStatus.level.label}** mit **${loyaltyStatus.discount}% Stammkundenrabatt** für zukünftige Bestellungen.`)] }).catch(() => {});
  }
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
  await refreshOrderStatusPanel(guild, data).catch(() => {});

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
    const product = { label: orderProductLabel(order), emoji: orderProductEmoji(order) };
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
    delivery: '**Lieferung:** Deine Bestellung läuft in einer automatischen Warteschlange. Queue-Position und ETA sind Schätzwerte. Nach Lieferung erhältst du einen privaten Kundenbereich mit Lizenzdatei und PDF-Bestellbeleg.',
    license: '**Lizenz:** Standardmäßig erhält nur der Käufer eine persönliche, nicht übertragbare Nutzungslizenz. Bildlieferungen können eine eindeutige Käufer-/Lizenz-Watermark tragen. Weiterverkauf, Leak, Reupload und unerlaubte Weitergabe sind verboten.',
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
    await refreshOrderStatusPanel(interaction.guild, data).catch(() => {});
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
  const queue = activeQueue(data);
  const nextLines = queue.slice(0, 5).map((order, index) => `**#${index + 1}** • ${order.id} • ${orderProductLabel(order)}`).join('\n') || '*Keine aktiven Aufträge.*';
  const embed = shopEmbed('📊 Bestellstatus & Lieferzeiten', `${availabilityLabel(data.config.availability)}${data.config.availabilityNote ? `\n${data.config.availabilityNote}` : ''}\n\n**Aktive Warteschlange:** ${queue.length} Auftrag/Aufträge\n${nextLines}\n\n**Ungefähre Richtwerte**\n${deliveryLines}\n\nETA-Angaben sind Schätzwerte. Der konkret bestätigte Termin im Kauf-Ticket hat Vorrang.`);
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


async function seedVerificationPanel(channel, force = false) {
  if (!channel?.isTextBased?.()) return null;
  if (!force) {
    const messages = await channel.messages.fetch({ limit: 25 }).catch(() => null);
    const existing = messages?.find(message =>
      message.author.id === channel.guild.members.me?.id
      && message.components?.some(row => row.components?.some(component => component.customId === 'selling_verify_start'))
    );
    if (existing) return existing;
  }
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('selling_verify_start')
      .setLabel('Jetzt verifizieren')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success),
  );
  return channel.send({
    embeds: [shopEmbed(
      '✅ Verifizierung',
      'Um **Shop, Bestellungen, Community und Support** sehen zu können, musst du dich einmal verifizieren.\n\nKlicke auf **Jetzt verifizieren** und löse die kleine Rechenaufgabe. Dadurch werden einfache Bot-/Spam-Accounts abgefangen.\n\n**Wichtig:** Der Bot fragt dabei niemals nach Passwort, Token, E-Mail-Code oder 2FA-Code.',
    )],
    components: [row],
  });
}

async function initializeVerificationMembers(guild, structure) {
  const unverified = structure?.roleMap?.unverified;
  const verified = structure?.roleMap?.verified;
  if (!unverified || !verified) return;
  const members = await guild.members.fetch().catch(() => guild.members.cache);
  const targets = [...members.values()].filter(member =>
    !member.user.bot
    && member.id !== guild.ownerId
    && !member.roles.cache.has(verified.id)
    && !member.roles.cache.has(unverified.id)
  );
  for (const member of targets) {
    await member.roles.add(unverified, 'Selling Verify: noch nicht verifiziert').catch(() => {});
  }
}

async function handleVerifyStart(interaction) {
  if (!interaction.inGuild()) return;
  const { data } = getGuildShopData(interaction.guildId);
  const verifiedId = data.config.roleIds.verified || findSellingRole(interaction.guild, 'verified')?.id;
  if (verifiedId && interaction.member.roles.cache.has(verifiedId)) {
    await interaction.reply({ content: '✅ Du bist bereits verifiziert.', ephemeral: true });
    return;
  }

  const a = Math.floor(Math.random() * 18) + 3;
  const b = Math.floor(Math.random() * 18) + 3;
  sellingVerifyChallenges.set(`${interaction.guildId}:${interaction.user.id}`, {
    answer: a + b,
    expiresAt: Date.now() + SELLING_VERIFY_TTL_MS,
  });

  const modal = new ModalBuilder().setCustomId('selling_verify_modal').setTitle('Unfugstifter Verifizierung');
  const input = new TextInputBuilder()
    .setCustomId('answer')
    .setLabel(`Wie viel ist ${a} + ${b}?`)
    .setPlaceholder('Nur die Zahl eingeben')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(5);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  await interaction.showModal(modal);
}

async function handleVerifyModal(interaction) {
  if (!interaction.inGuild()) return;
  const key = `${interaction.guildId}:${interaction.user.id}`;
  const challenge = sellingVerifyChallenges.get(key);
  sellingVerifyChallenges.delete(key);
  if (!challenge || challenge.expiresAt < Date.now()) {
    await interaction.reply({ content: '❌ Die Verifizierung ist abgelaufen. Klicke erneut auf **Jetzt verifizieren**.', ephemeral: true });
    return;
  }
  const answer = Number(String(interaction.fields.getTextInputValue('answer') || '').trim());
  if (!Number.isFinite(answer) || answer !== challenge.answer) {
    await interaction.reply({ content: '❌ Falsche Antwort. Klicke erneut auf **Jetzt verifizieren** und versuche es noch einmal.', ephemeral: true });
    return;
  }

  const { data } = getGuildShopData(interaction.guildId);
  const verified = data.config.roleIds.verified
    ? await interaction.guild.roles.fetch(data.config.roleIds.verified).catch(() => null)
    : findSellingRole(interaction.guild, 'verified');
  const unverified = data.config.roleIds.unverified
    ? await interaction.guild.roles.fetch(data.config.roleIds.unverified).catch(() => null)
    : findSellingRole(interaction.guild, 'unverified');
  if (!verified) {
    await interaction.reply({ content: '❌ Die Verified-Rolle fehlt. Bitte melde dich beim Support.', ephemeral: true });
    return;
  }

  await interaction.member.roles.add(verified, 'Selling Verify erfolgreich').catch(() => null);
  if (!interaction.member.roles.cache.has(verified.id)) await interaction.member.fetch().catch(() => {});
  if (!interaction.member.roles.cache.has(verified.id)) {
    await interaction.reply({ content: '❌ Die Rolle konnte nicht vergeben werden. Prüfe bitte die Bot-Rollenhierarchie.', ephemeral: true });
    return;
  }
  if (unverified && interaction.member.roles.cache.has(unverified.id)) {
    await interaction.member.roles.remove(unverified, 'Selling Verify erfolgreich').catch(() => {});
  }
  await logSecurity(interaction.guild, '✅ Verifizierung erfolgreich', `<@${interaction.user.id}> wurde erfolgreich verifiziert.`);
  await interaction.reply({ content: '✅ **Verifizierung erfolgreich.** Du hast jetzt Zugriff auf Shop, Bestellungen, Community und Support.', ephemeral: true });
}

async function logSecurity(guild, title, text) {
  const { data } = getGuildShopData(guild.id);
  const channelId = data.config.channelIds.securityLogs;
  const channel = channelId
    ? await guild.channels.fetch(channelId).catch(() => null)
    : findSellingTextChannel(guild, '🛡️・security-logs');
  if (!channel?.isTextBased()) return;
  await channel.send({ embeds: [shopEmbed(title, text)], allowedMentions: { parse: [] } }).catch(() => {});
}

function antiNukeIsExempt(guild, data, executorId) {
  if (!executorId) return true;
  if (executorId === guild.ownerId) return true;
  if (executorId === guild.members.me?.id) return true;
  return (data.security?.antiNuke?.whitelist || []).includes(executorId);
}

async function recentAuditEntry(guild, types, { targetId = null, channelId = null, maxAgeMs = 7000 } = {}) {
  for (const type of types) {
    const logs = await guild.fetchAuditLogs({ type, limit: 8 }).catch(() => null);
    if (!logs) continue;
    const entry = logs.entries.find(item => {
      if (Date.now() - item.createdTimestamp > maxAgeMs) return false;
      if (targetId && item.targetId !== targetId) return false;
      if (channelId) {
        const extraChannelId = item.extra?.channel?.id || item.extra?.channelId || null;
        if (extraChannelId && extraChannelId !== channelId) return false;
      }
      return true;
    });
    if (entry) return entry;
  }
  return null;
}

async function quarantineAntiNukeExecutor(guild, data, executorId, triggerText) {
  const member = await guild.members.fetch(executorId).catch(() => null);
  if (!member) {
    await logSecurity(guild, '🚨 Anti-Nuke ausgelöst', `Ausführer: <@${executorId}>\nAuslöser: **${triggerText}**\nDer Account ist nicht mehr auf dem Server und konnte nicht quarantänisiert werden.`);
    return;
  }

  if (member.user.bot) {
    let kicked = false;
    if (member.kickable) {
      await member.kick(`Anti-Nuke: ${triggerText}`).then(() => { kicked = true; }).catch(() => {});
    }
    await logSecurity(guild, '🚨 Anti-Nuke • Bot erkannt', `Bot: <@${executorId}>\nAuslöser: **${triggerText}**\nMaßnahme: **${kicked ? 'Bot automatisch gekickt' : 'Konnte nicht automatisch gekickt werden'}**`);
    return;
  }

  const removable = member.roles.cache.filter(role => role.id !== guild.id && !role.managed && role.editable);
  let removedCount = 0;
  if (removable.size) {
    const ids = [...removable.keys()];
    await member.roles.remove(ids, `Anti-Nuke Quarantäne: ${triggerText}`).then(() => { removedCount = ids.length; }).catch(() => {});
  }
  const minutes = Math.max(1, Number(data.security.antiNuke.quarantineMinutes || 1440));
  let timedOut = false;
  if (member.moderatable) {
    await member.timeout(minutes * 60 * 1000, `Anti-Nuke Quarantäne: ${triggerText}`).then(() => { timedOut = true; }).catch(() => {});
  }

  await logSecurity(guild, '🚨 Anti-Nuke • Quarantäne', [
    `Account: <@${executorId}>`,
    `Auslöser: **${triggerText}**`,
    `Entfernte Rollen: **${removedCount}**`,
    `Timeout: **${timedOut ? `${minutes} Minuten` : 'technisch nicht möglich'}**`,
    '',
    'Bitte prüfe anschließend die Discord-Audit-Logs und stelle berechtigte Rollen nur manuell wieder her.',
  ].join('\n'));
}

async function recordAntiNukeAction(guild, executorId, label, targetText = '—') {
  if (sellingResetGuilds.has(guild.id)) return;
  const { store, data } = getGuildShopData(guild.id);
  const cfg = data.security.antiNuke;
  if (!cfg.enabled || antiNukeIsExempt(guild, data, executorId)) return;

  const now = Date.now();
  const key = `${guild.id}:${executorId}`;
  const recent = (sellingAntiNukeActions.get(key) || []).filter(ts => now - ts <= Number(cfg.windowMs || 10000));
  recent.push(now);
  sellingAntiNukeActions.set(key, recent);

  await logSecurity(guild, '🛡️ Sicherheitsaktion erkannt', `Ausführer: <@${executorId}>\nAktion: **${label}**\nZiel: ${targetText}\nZähler: **${recent.length}/${cfg.threshold}** innerhalb von ${Math.round(cfg.windowMs / 1000)} Sekunden.`);

  if (recent.length >= Number(cfg.threshold || 3)) {
    sellingAntiNukeActions.set(key, []);
    await quarantineAntiNukeExecutor(guild, data, executorId, `${label} • ${targetText}`);
    saveSellingStore(store);
  }
}

async function handleAntiNukeAuditEvent(guild, label, types, options = {}) {
  if (!guild || sellingResetGuilds.has(guild.id)) return;
  const { data } = getGuildShopData(guild.id);
  if (!data.security.antiNuke.enabled) return;
  const entry = await recentAuditEntry(guild, types, options);
  if (!entry?.executorId) return;
  const target = options.targetText || (entry.targetId ? `<@${entry.targetId}> / \`${entry.targetId}\`` : '—');
  await recordAntiNukeAction(guild, entry.executorId, label, target);
}

async function handleSellingMemberJoin(member) {
  if (!member || member.user.bot) return;
  const { data } = getGuildShopData(member.guild.id);
  const unverifiedId = data.config.roleIds.unverified;
  const verifiedId = data.config.roleIds.verified;
  if (!unverifiedId || (verifiedId && member.roles.cache.has(verifiedId))) return;
  const role = await member.guild.roles.fetch(unverifiedId).catch(() => null);
  if (role) await member.roles.add(role, 'Selling Verify: neues Mitglied').catch(() => {});
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
      await interaction.reply({ embeds: [orderInfoEmbed(order, data)], ephemeral: true, allowedMentions: { parse: [] } });
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
      const discount = effectiveDiscountForOrder(order);
      order.finalPrice = Math.round(order.basePrice * (1 - discount / 100) * 100) / 100;
      saveSellingStore(store);
      const channel = order.channelId ? await interaction.guild.channels.fetch(order.channelId).catch(() => null) : null;
      if (channel?.isTextBased()) {
        const paypal = data.config.paypalEmail ? `\n**PayPal-Empfänger:** \`${data.config.paypalEmail}\`` : '\n**PayPal-Empfänger:** wird vom Team im Ticket bestätigt';
        await channel.send({
          embeds: [shopEmbed(`💳 Preis bestätigt • ${id}`, `Grundpreis: **${formatEuro(order.basePrice)}**${discount ? `\nAngewendeter Rabatt: **${discount} %**\nEndpreis: **${formatEuro(order.finalPrice)}**` : ''}${paypal}\n\nBitte erst nach dieser Bestätigung bezahlen.`)],
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
      const keys = Array.isArray(license.productKeys) && license.productKeys.length ? license.productKeys : [license.productKey].filter(Boolean);
      const product = keys.map(key => PRODUCT_TYPES[key]?.label || key).join(' + ') || 'Unbekannt';
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


  if (sub === 'queue') {
    const queue = activeQueue(data);
    const text = queue.length ? queue.slice(0, 25).map((order, index) => {
      const q = queueInfoForOrder(data, order);
      return `**#${index + 1}** • ${order.id} • <@${order.userId}> • ${orderProductLabel(order)}\nStatus: ${orderStatusLabel(order.status)} • ETA: <t:${Math.floor(q.etaFinish / 1000)}:d>`;
    }).join('\n\n') : 'Keine aktiven Aufträge.';
    await interaction.reply({ embeds: [shopEmbed('⏱️ Auftrags-Warteschlange', text)], ephemeral: true, allowedMentions: { parse: [] } });
    return;
  }

  if (sub === 'receipt') {
    const id = String(interaction.options.getString('order') || '').trim().toUpperCase();
    const order = data.orders[id];
    if (!order) { await interaction.reply({ content: '❌ Bestellung nicht gefunden.', ephemeral: true }); return; }
    const license = ensureOrderLicense(data, order);
    saveSellingStore(store);
    const buffer = await buildReceiptPdf(interaction.guild, order, license);
    await interaction.reply({ content: `📄 Bestellbeleg für **${id}**`, files: [new AttachmentBuilder(buffer, { name: `${id}-Bestellbeleg.pdf` })], ephemeral: true });
    return;
  }

  if (sub === 'watermark') {
    const id = String(interaction.options.getString('order') || '').trim().toUpperCase();
    const attachment = interaction.options.getAttachment('datei');
    const order = data.orders[id];
    if (!order) { await interaction.reply({ content: '❌ Bestellung nicht gefunden.', ephemeral: true }); return; }
    await interaction.deferReply({ ephemeral: true });
    const result = await watermarkOrderImage(interaction.guild, data, order, attachment);
    saveSellingStore(store);
    await interaction.editReply({ content: `🕵️ Watermark erstellt für **${id}**. Marker: \`${result.marker}\``, files: [new AttachmentBuilder(result.buffer, { name: result.fileName })] });
    await logSelling(interaction.guild, `🕵️ Watermark • ${id}`, `<@${interaction.user.id}> hat eine Liefergrafik für <@${order.userId}> mit Lizenz-/Käuferkennung versehen.`);
    return;
  }

  if (sub === 'loyalty') {
    const user = interaction.options.getUser('user');
    const status = loyaltyForUser(data, user.id);
    const next = [...LOYALTY_LEVELS].reverse().find(entry => status.count < entry.minOrders);
    await interaction.reply({ embeds: [shopEmbed(`💠 Kundenstatus • ${user.username}`, `Gelieferte Bestellungen: **${status.count}**\nAktueller Status: **${status.level?.label || 'Standard'}**\nStammkundenrabatt: **${status.discount}%**${next ? `\nNächste Stufe: **${next.label}** ab ${next.minOrders} Lieferungen` : '\nHöchste Stufe erreicht.'}`)], ephemeral: true });
    return;
  }

  if (sub === 'verify') {
    const action = interaction.options.getString('action');
    if (action === 'status') {
      const verified = findSellingRole(interaction.guild, 'verified');
      const unverified = findSellingRole(interaction.guild, 'unverified');
      await interaction.reply({ content: `✅ Verify-System: **aktiv**\nVerified: ${verified ? `<@&${verified.id}>` : 'fehlt'}\nUnverified: ${unverified ? `<@&${unverified.id}>` : 'fehlt'}`, ephemeral: true, allowedMentions: { parse: [] } });
      return;
    }
    const channel = data.config.channelIds.verify ? await interaction.guild.channels.fetch(data.config.channelIds.verify).catch(() => null) : findSellingTextChannel(interaction.guild, '✅・verifizierung');
    if (!channel?.isTextBased()) { await interaction.reply({ content: '❌ Verify-Channel fehlt. Führe `/setup server selling` erneut aus.', ephemeral: true }); return; }
    await seedVerificationPanel(channel, true);
    await interaction.reply({ content: `✅ Verify-Panel wurde in <#${channel.id}> neu gepostet.`, ephemeral: true });
    return;
  }

  if (sub === 'antinuke') {
    if (interaction.guild.ownerId !== interaction.user.id) { await interaction.reply({ content: '❌ Anti-Nuke kann nur der **Server-Inhaber** verwalten.', ephemeral: true }); return; }
    const action = interaction.options.getString('action');
    const cfg = data.security.antiNuke;
    if (action === 'enable') cfg.enabled = true;
    if (action === 'disable') cfg.enabled = false;
    if (action === 'whitelist' || action === 'unwhitelist') {
      const user = interaction.options.getUser('user');
      if (!user) { await interaction.reply({ content: '❌ Gib für diese Aktion einen `user` an.', ephemeral: true }); return; }
      const list = new Set(cfg.whitelist || []);
      if (action === 'whitelist') list.add(user.id); else list.delete(user.id);
      cfg.whitelist = [...list];
    }
    saveSellingStore(store);
    await interaction.reply({ embeds: [shopEmbed('🛡️ Anti-Nuke', `Status: **${cfg.enabled ? 'Aktiv' : 'Inaktiv'}**\nSchwelle: **${cfg.threshold} kritische Aktionen / ${Math.round(cfg.windowMs / 1000)} Sekunden**\nQuarantäne: **${cfg.quarantineMinutes} Minuten**\nWhitelist: **${(cfg.whitelist || []).length} Nutzer**\n\nBei Überschreitung werden entfernbare Rollen des ausführenden Accounts entzogen und – sofern technisch möglich – eine zeitlich begrenzte Sperre gesetzt.`)], ephemeral: true });
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
    await initializeVerificationMembers(interaction.guild, structure);
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
      'Neu erstellt wurden professionelle Bereiche für **Thumbnails, NVE/Grafik-Setups, Soundpacks, Designs, FiveM-Assets, Bundles, Warenkorb, PayPal, PDF-Belege, Käufer-Watermarking, Lizenzen, Stammkunden/VIP, Queue/ETA, Verify-System, Anti-Nuke, Support, Kauf-Tickets und Team-Verwaltung**.',
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

  if (interaction.isButton?.() && interaction.customId === 'selling_verify_start') {
    await handleVerifyStart(interaction);
    return true;
  }

  if (interaction.isModalSubmit?.() && interaction.customId === 'selling_verify_modal') {
    await handleVerifyModal(interaction);
    return true;
  }

  if (interaction.isButton?.() && (
    String(interaction.customId || '').startsWith('selling_cart_add:')
    || interaction.customId === 'selling_cart_view'
    || interaction.customId === 'selling_cart_checkout'
    || interaction.customId === 'selling_cart_clear'
  )) {
    await handleCartButton(interaction);
    return true;
  }

  if (interaction.isModalSubmit?.() && interaction.customId === 'selling_cart_checkout_modal') {
    await createCartOrderFromModal(interaction);
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


    this.on(Events.GuildMemberAdd, async member => {
      await handleSellingMemberJoin(member).catch(error => console.error('❌ Verify Join Fehler:', error));
    });

    this.on(Events.ChannelCreate, async channel => {
      await handleAntiNukeAuditEvent(channel.guild, 'Channel erstellt', [AuditLogEvent.ChannelCreate], { targetId: channel.id, targetText: `#${channel.name}` }).catch(() => {});
    });
    this.on(Events.ChannelDelete, async channel => {
      await handleAntiNukeAuditEvent(channel.guild, 'Channel gelöscht', [AuditLogEvent.ChannelDelete], { targetId: channel.id, targetText: `#${channel.name}` }).catch(() => {});
    });
    this.on(Events.ChannelUpdate, async (oldChannel, newChannel) => {
      if (sellingResetGuilds.has(newChannel.guild.id)) return;
      const permissionsChanged = oldChannel.permissionOverwrites?.cache && newChannel.permissionOverwrites?.cache
        ? JSON.stringify(oldChannel.permissionOverwrites.cache.map(x => [x.id, x.allow.bitfield.toString(), x.deny.bitfield.toString()]).sort())
          !== JSON.stringify(newChannel.permissionOverwrites.cache.map(x => [x.id, x.allow.bitfield.toString(), x.deny.bitfield.toString()]).sort())
        : false;
      if (!permissionsChanged && oldChannel.name === newChannel.name) return;
      await handleAntiNukeAuditEvent(newChannel.guild, permissionsChanged ? 'Channel-Berechtigungen geändert' : 'Channel geändert', [AuditLogEvent.ChannelUpdate], { targetId: newChannel.id, targetText: `#${newChannel.name}` }).catch(() => {});
    });
    this.on(Events.GuildRoleCreate, async role => {
      await handleAntiNukeAuditEvent(role.guild, 'Rolle erstellt', [AuditLogEvent.RoleCreate], { targetId: role.id, targetText: `@${role.name}` }).catch(() => {});
    });
    this.on(Events.GuildRoleDelete, async role => {
      await handleAntiNukeAuditEvent(role.guild, 'Rolle gelöscht', [AuditLogEvent.RoleDelete], { targetId: role.id, targetText: `@${role.name}` }).catch(() => {});
    });
    this.on(Events.GuildRoleUpdate, async (oldRole, newRole) => {
      if (sellingResetGuilds.has(newRole.guild.id)) return;
      const permsChanged = oldRole.permissions.bitfield !== newRole.permissions.bitfield;
      if (!permsChanged && oldRole.name === newRole.name) return;
      await handleAntiNukeAuditEvent(newRole.guild, permsChanged ? 'Rollen-Berechtigungen geändert' : 'Rolle geändert', [AuditLogEvent.RoleUpdate], { targetId: newRole.id, targetText: `@${newRole.name}` }).catch(() => {});
    });
    this.on(Events.GuildBanAdd, async ban => {
      await handleAntiNukeAuditEvent(ban.guild, 'Mitglied gebannt', [AuditLogEvent.MemberBanAdd], { targetId: ban.user.id, targetText: `<@${ban.user.id}>` }).catch(() => {});
    });
    this.on(Events.GuildMemberRemove, async member => {
      await handleAntiNukeAuditEvent(member.guild, 'Mitglied gekickt', [AuditLogEvent.MemberKick], { targetId: member.id, targetText: `<@${member.id}>`, maxAgeMs: 4000 }).catch(() => {});
    });
    this.on(Events.WebhooksUpdate, async channel => {
      await handleAntiNukeAuditEvent(channel.guild, 'Webhook geändert', [AuditLogEvent.WebhookCreate, AuditLogEvent.WebhookUpdate, AuditLogEvent.WebhookDelete], { channelId: channel.id, targetText: `#${channel.name}` }).catch(() => {});
    });
  }
  return originalLogin.apply(this, args);
};

require('./index.js');
