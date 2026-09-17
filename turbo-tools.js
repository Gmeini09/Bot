'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  ModalBuilder,
  PermissionFlagsBits,
  REST,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ADVANCED_VERSION = 1;
const ADVANCED_COMMANDS = new Set(['tools']);
const PRODUCT_LABELS = {
  thumbnail: 'Thumbnail',
  nve: 'NVE Preset / Grafik-Setup',
  soundpack: 'Soundpack',
  grafik: 'Grafik / Design',
  fivem: 'FiveM Asset',
  bot: 'Custom Discord Bot',
  bundle: 'Bundle / Komplettpaket',
};
const DEFAULT_COLOR = 0x8b5cf6;
const storageDir = process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.DATA_DIR || __dirname;
const advancedDataPath = path.join(storageDir, 'advanced-features.json');
const sellingDataPath = path.join(storageDir, 'selling-data.json');
const pendingPanelModals = new Map();

function defaultGuildData() {
  return {
    config: {
      brandColor: '#8b5cf6',
      logChannelId: null,
      panelDefaultChannelId: null,
      staffRoleId: null,
      supportRoleId: null,
      libraryPublic: false,
    },
    panels: {},
    setupSnapshot: null,
  };
}

function defaultStore() {
  return { version: ADVANCED_VERSION, guilds: {} };
}

function loadAdvancedStore() {
  try {
    if (!fs.existsSync(advancedDataPath)) return defaultStore();
    const parsed = JSON.parse(fs.readFileSync(advancedDataPath, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return defaultStore();
    parsed.version = ADVANCED_VERSION;
    parsed.guilds = parsed.guilds && typeof parsed.guilds === 'object' ? parsed.guilds : {};
    return parsed;
  } catch (error) {
    console.error('❌ advanced-features.json konnte nicht gelesen werden:', error);
    return defaultStore();
  }
}

function saveAdvancedStore(store) {
  if (!fs.existsSync(storageDir)) fs.mkdirSync(storageDir, { recursive: true });
  const temp = `${advancedDataPath}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(temp, advancedDataPath);
}

function getAdvancedGuildData(guildId) {
  const store = loadAdvancedStore();
  const existing = store.guilds[guildId] && typeof store.guilds[guildId] === 'object' ? store.guilds[guildId] : {};
  store.guilds[guildId] = {
    ...defaultGuildData(),
    ...existing,
    config: { ...defaultGuildData().config, ...(existing.config || {}) },
    panels: existing.panels && typeof existing.panels === 'object' ? existing.panels : {},
    setupSnapshot: existing.setupSnapshot || null,
  };
  return { store, data: store.guilds[guildId] };
}

function readSellingStore() {
  try {
    if (!fs.existsSync(sellingDataPath)) return null;
    const parsed = JSON.parse(fs.readFileSync(sellingDataPath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    return null;
  }
}

function isAdvancedInteraction(interaction) {
  if (interaction?.isChatInputCommand?.()) return ADVANCED_COMMANDS.has(interaction.commandName);
  if (interaction?.isModalSubmit?.()) return String(interaction.customId || '').startsWith('adv:');
  return false;
}

function parseColor(value, fallback = DEFAULT_COLOR) {
  const raw = String(value || '').trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return fallback;
  return Number.parseInt(raw, 16);
}

function normalizeHexColor(value) {
  const raw = String(value || '').trim().replace(/^#/, '');
  return /^[0-9a-fA-F]{6}$/.test(raw) ? `#${raw.toLowerCase()}` : null;
}

function truncate(value, max = 1000) {
  const text = String(value ?? '');
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

function advEmbed(guildId, title, description) {
  const { data } = getAdvancedGuildData(guildId);
  return new EmbedBuilder()
    .setColor(parseColor(data.config.brandColor))
    .setTitle(title)
    .setDescription(description)
    .setTimestamp();
}

function hasManagePermission(interaction) {
  return Boolean(
    interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
    || interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
  );
}

function isGuildOwner(interaction) {
  return Boolean(interaction.guild && interaction.guild.ownerId === interaction.user.id);
}

async function replyEphemeral(interaction, payload) {
  const body = typeof payload === 'string' ? { content: payload } : payload;
  body.ephemeral = true;
  if (interaction.deferred || interaction.replied) return interaction.followUp(body).catch(() => null);
  return interaction.reply(body).catch(() => null);
}

async function logAdvanced(guild, text) {
  try {
    const { data } = getAdvancedGuildData(guild.id);
    const channel = data.config.logChannelId ? guild.channels.cache.get(data.config.logChannelId) : null;
    if (channel && typeof channel.send === 'function') {
      await channel.send({ embeds: [advEmbed(guild.id, '⚙️ Advanced Log', truncate(text, 3900))] }).catch(() => null);
    }
  } catch (_) {}
}

function buildAdvancedCommandDefinitions() {
  return [
    {
      name: 'tools',
      description: 'Turbo Designs Tools: Panels, Config, Library, Setup-Diff und Systemcheck.',
      type: 1,
      options: [
        {
          type: 2,
          name: 'panel',
          description: 'Eigene Discord-Panels verwalten.',
          options: [
            {
              type: 1,
              name: 'create',
              description: 'Erstellt ein neues Embed-Panel über ein Formular.',
              options: [
                { type: 7, name: 'channel', description: 'Ziel-Channel; leer = aktueller/default Channel', required: false, channel_types: [0, 5] },
              ],
            },
            { type: 1, name: 'list', description: 'Zeigt die gespeicherten Panels.' },
            {
              type: 1,
              name: 'delete',
              description: 'Löscht ein gespeichertes Panel und seine Nachricht.',
              options: [{ type: 3, name: 'id', description: 'Panel-ID, z. B. PNL-ABC123', required: true }],
            },
          ],
        },
        {
          type: 2,
          name: 'config',
          description: 'Zentrale Einstellungen für die erweiterten Funktionen.',
          options: [
            { type: 1, name: 'show', description: 'Zeigt die aktuelle Konfiguration.' },
            {
              type: 1,
              name: 'channel',
              description: 'Setzt einen Channel für die erweiterten Funktionen.',
              options: [
                { type: 3, name: 'bereich', description: 'Konfigurationsbereich', required: true, choices: [
                  { name: 'Log-Channel', value: 'log' },
                  { name: 'Standard-Channel für Panels', value: 'panel_default' },
                ] },
                { type: 7, name: 'channel', description: 'Discord-Channel', required: true, channel_types: [0, 5] },
              ],
            },
            {
              type: 1,
              name: 'role',
              description: 'Setzt eine Staff-/Support-Rolle.',
              options: [
                { type: 3, name: 'bereich', description: 'Konfigurationsbereich', required: true, choices: [
                  { name: 'Staff-Rolle', value: 'staff' },
                  { name: 'Support-Rolle', value: 'support' },
                ] },
                { type: 8, name: 'rolle', description: 'Discord-Rolle', required: true },
              ],
            },
            {
              type: 1,
              name: 'color',
              description: 'Setzt die Embed-Farbe, z. B. #8b5cf6.',
              options: [{ type: 3, name: 'hex', description: 'HEX-Farbe', required: true, min_length: 6, max_length: 7 }],
            },
            {
              type: 1,
              name: 'library',
              description: 'Legt fest, ob andere Kundenprofile öffentlich aufrufbar sind.',
              options: [{ type: 5, name: 'public', description: 'Öffentlich erlauben?', required: true }],
            },
          ],
        },
        {
          type: 2,
          name: 'setup',
          description: 'Server-Snapshot vergleichen und reparieren.',
          options: [
            { type: 1, name: 'save', description: 'Speichert den aktuellen Server als Referenz-Snapshot.' },
            { type: 1, name: 'check', description: 'Zeigt Änderungen seit dem gespeicherten Snapshot.' },
            { type: 1, name: 'repair', description: 'Stellt Snapshot-Rollen/Channels wieder her; Extras bleiben unangetastet.' },
          ],
        },
        {
          type: 1,
          name: 'library',
          description: 'Zeigt gekaufte Produkte, Bestellungen und Lizenzen.',
          options: [{ type: 6, name: 'user', description: 'Optional: Kunde anzeigen', required: false }],
        },
        {
          type: 1,
          name: 'systemcheck',
          description: 'Prüft Selling-Konfiguration, Railway-Speicher, IDs, Commands, Intents und Rechte.',
        },
      ],
    },
  ];
}

function addAdvancedCommands(body) {
  if (!Array.isArray(body)) return body;
  const next = JSON.parse(JSON.stringify(body));
  const definitions = buildAdvancedCommandDefinitions();
  for (const definition of definitions) {
    const index = next.findIndex(command => command?.name === definition.name);
    if (index >= 0) next[index] = definition;
    else next.push(definition);
  }
  return next;
}

// Preload-Hook: erweitert die bestehende globale Command-Registrierung, ohne andere Commands zu löschen.
const nativeRestPut = REST.prototype.put;
REST.prototype.put = function advancedCommandPut(route, options = {}) {
  const nextOptions = Array.isArray(options?.body) ? { ...options, body: addAdvancedCommands(options.body) } : options;
  return nativeRestPut.call(this, route, nextOptions);
};

// Verhindert, dass der bestehende Core-Handler unsere neuen Commands als "unbekannt" behandelt.
const nativeClientOn = Client.prototype.on;
Client.prototype.on = function advancedClientOn(eventName, listener) {
  if (eventName === Events.InteractionCreate) {
    return nativeClientOn.call(this, eventName, async function advancedFilteredInteraction(interaction, ...args) {
      if (isAdvancedInteraction(interaction)) return;
      return listener.call(this, interaction, ...args);
    });
  }
  return nativeClientOn.call(this, eventName, listener);
};

function panelId() {
  return `PNL-${Date.now().toString(36).slice(-6).toUpperCase()}${crypto.randomBytes(1).toString('hex').toUpperCase()}`;
}

async function handlePanelBuilder(interaction) {
  if (!hasManagePermission(interaction)) return replyEphemeral(interaction, '❌ Dafür brauchst du **Server verwalten** oder **Administrator**.');
  const sub = interaction.options.getSubcommand();
  const { store, data } = getAdvancedGuildData(interaction.guild.id);

  if (sub === 'create') {
    const selected = interaction.options.getChannel('channel', false);
    const fallback = data.config.panelDefaultChannelId ? interaction.guild.channels.cache.get(data.config.panelDefaultChannelId) : interaction.channel;
    const target = selected || fallback;
    if (!target || typeof target.send !== 'function') return replyEphemeral(interaction, '❌ Es wurde kein beschreibbarer Text-Channel gefunden.');

    const token = crypto.randomBytes(6).toString('hex');
    pendingPanelModals.set(token, {
      guildId: interaction.guild.id,
      userId: interaction.user.id,
      channelId: target.id,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

    const modal = new ModalBuilder().setCustomId(`adv:panel:${token}`).setTitle('Neues Discord Panel');
    const title = new TextInputBuilder().setCustomId('title').setLabel('Titel').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(256);
    const description = new TextInputBuilder().setCustomId('description').setLabel('Text / Beschreibung').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(3800);
    const color = new TextInputBuilder().setCustomId('color').setLabel('Farbe (optional, z. B. #8b5cf6)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(7);
    const buttonLabel = new TextInputBuilder().setCustomId('button_label').setLabel('Link-Button Text (optional)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(80);
    const buttonUrl = new TextInputBuilder().setCustomId('button_url').setLabel('Link-Button URL (optional)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(400);
    modal.addComponents(
      new ActionRowBuilder().addComponents(title),
      new ActionRowBuilder().addComponents(description),
      new ActionRowBuilder().addComponents(color),
      new ActionRowBuilder().addComponents(buttonLabel),
      new ActionRowBuilder().addComponents(buttonUrl),
    );
    return interaction.showModal(modal);
  }

  if (sub === 'list') {
    const panels = Object.values(data.panels || {}).sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    const lines = panels.slice(0, 20).map(panel => `• **${panel.id}** — ${truncate(panel.title, 60)} — <#${panel.channelId}>`);
    return replyEphemeral(interaction, { embeds: [advEmbed(interaction.guild.id, '🧩 Panel Builder', lines.length ? lines.join('\n') : '*Noch keine Panels gespeichert.*')] });
  }

  if (sub === 'delete') {
    const id = interaction.options.getString('id', true).trim().toUpperCase();
    const panel = data.panels[id];
    if (!panel) return replyEphemeral(interaction, `❌ Panel **${id}** wurde nicht gefunden.`);
    const channel = interaction.guild.channels.cache.get(panel.channelId) || await interaction.guild.channels.fetch(panel.channelId).catch(() => null);
    if (channel && typeof channel.messages?.fetch === 'function') {
      const message = await channel.messages.fetch(panel.messageId).catch(() => null);
      if (message) await message.delete().catch(() => null);
    }
    delete data.panels[id];
    saveAdvancedStore(store);
    await logAdvanced(interaction.guild, `${interaction.user.tag} hat Panel ${id} gelöscht.`);
    return replyEphemeral(interaction, `✅ Panel **${id}** wurde gelöscht.`);
  }
}

async function handlePanelModal(interaction) {
  const token = String(interaction.customId || '').split(':')[2];
  const pending = pendingPanelModals.get(token);
  pendingPanelModals.delete(token);
  if (!pending || pending.expiresAt < Date.now()) return replyEphemeral(interaction, '❌ Dieses Panel-Formular ist abgelaufen. Bitte `/tools panel create` erneut ausführen.');
  if (pending.guildId !== interaction.guildId || pending.userId !== interaction.user.id) return replyEphemeral(interaction, '❌ Dieses Formular gehört nicht zu dir.');
  if (!hasManagePermission(interaction)) return replyEphemeral(interaction, '❌ Dir fehlen inzwischen die nötigen Rechte.');

  const channel = interaction.guild.channels.cache.get(pending.channelId) || await interaction.guild.channels.fetch(pending.channelId).catch(() => null);
  if (!channel || typeof channel.send !== 'function') return replyEphemeral(interaction, '❌ Der Ziel-Channel existiert nicht mehr.');

  const title = interaction.fields.getTextInputValue('title').trim();
  const description = interaction.fields.getTextInputValue('description').trim();
  const colorInput = interaction.fields.getTextInputValue('color').trim();
  const buttonLabel = interaction.fields.getTextInputValue('button_label').trim();
  const buttonUrl = interaction.fields.getTextInputValue('button_url').trim();
  const { store, data } = getAdvancedGuildData(interaction.guild.id);
  const hex = normalizeHexColor(colorInput) || data.config.brandColor;

  const embed = new EmbedBuilder().setColor(parseColor(hex)).setTitle(title).setDescription(description).setTimestamp();
  const components = [];
  if (buttonLabel || buttonUrl) {
    let validUrl = null;
    try {
      const url = new URL(buttonUrl);
      if (url.protocol === 'https:' || url.protocol === 'http:') validUrl = url.toString();
    } catch (_) {}
    if (!buttonLabel || !validUrl) return replyEphemeral(interaction, '❌ Für einen Link-Button müssen **Button-Text und eine gültige http/https URL** angegeben werden.');
    components.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(buttonLabel).setURL(validUrl)));
  }

  const message = await channel.send({ embeds: [embed], components }).catch(() => null);
  if (!message) return replyEphemeral(interaction, '❌ Das Panel konnte im Ziel-Channel nicht gesendet werden.');
  const id = panelId();
  data.panels[id] = {
    id,
    channelId: channel.id,
    messageId: message.id,
    title,
    createdBy: interaction.user.id,
    createdAt: Date.now(),
  };
  saveAdvancedStore(store);
  await logAdvanced(interaction.guild, `${interaction.user.tag} hat Panel ${id} in #${channel.name} erstellt.`);
  return replyEphemeral(interaction, `✅ Panel **${id}** wurde in ${channel} erstellt.`);
}

async function handleConfigCenter(interaction) {
  if (!hasManagePermission(interaction)) return replyEphemeral(interaction, '❌ Dafür brauchst du **Server verwalten** oder **Administrator**.');
  const sub = interaction.options.getSubcommand();
  const { store, data } = getAdvancedGuildData(interaction.guild.id);

  if (sub === 'show') {
    const selling = readSellingStore()?.guilds?.[interaction.guild.id] || null;
    const config = data.config;
    const description = [
      `**Brand-Farbe:** \`${config.brandColor}\``,
      `**Log-Channel:** ${config.logChannelId ? `<#${config.logChannelId}>` : 'Nicht gesetzt'}`,
      `**Panel-Standard:** ${config.panelDefaultChannelId ? `<#${config.panelDefaultChannelId}>` : 'Aktueller Channel'}`,
      `**Staff-Rolle:** ${config.staffRoleId ? `<@&${config.staffRoleId}>` : 'Nicht gesetzt'}`,
      `**Support-Rolle:** ${config.supportRoleId ? `<@&${config.supportRoleId}>` : 'Nicht gesetzt'}`,
      `**Andere Kunden-Libraries:** ${config.libraryPublic ? 'Erlaubt' : 'Nur Staff'}`,
      '',
      `**Selling-Status:** ${selling?.config?.availability || 'nicht initialisiert'}`,
      `**Selling-Channels gespeichert:** ${Object.keys(selling?.config?.channelIds || {}).length}`,
      `**Selling-Rollen gespeichert:** ${Object.keys(selling?.config?.roleIds || {}).length}`,
      `**PayPal:** ${selling?.config?.paypalEmail ? 'gesetzt' : 'nicht gesetzt'}`,
    ].join('\n');
    return replyEphemeral(interaction, { embeds: [advEmbed(interaction.guild.id, '⚙️ Config Center', description)] });
  }

  if (sub === 'channel') {
    const area = interaction.options.getString('bereich', true);
    const channel = interaction.options.getChannel('channel', true);
    if (typeof channel.send !== 'function') return replyEphemeral(interaction, '❌ Dieser Channel kann keine Nachrichten empfangen.');
    if (area === 'log') data.config.logChannelId = channel.id;
    if (area === 'panel_default') data.config.panelDefaultChannelId = channel.id;
    saveAdvancedStore(store);
    await logAdvanced(interaction.guild, `${interaction.user.tag} änderte Config-Channel ${area} auf #${channel.name}.`);
    return replyEphemeral(interaction, `✅ **${area}** wurde auf ${channel} gesetzt.`);
  }

  if (sub === 'role') {
    const area = interaction.options.getString('bereich', true);
    const role = interaction.options.getRole('rolle', true);
    if (area === 'staff') data.config.staffRoleId = role.id;
    if (area === 'support') data.config.supportRoleId = role.id;
    saveAdvancedStore(store);
    await logAdvanced(interaction.guild, `${interaction.user.tag} änderte Config-Rolle ${area} auf ${role.name}.`);
    return replyEphemeral(interaction, `✅ **${area}** wurde auf ${role} gesetzt.`);
  }

  if (sub === 'color') {
    const value = normalizeHexColor(interaction.options.getString('hex', true));
    if (!value) return replyEphemeral(interaction, '❌ Ungültige Farbe. Beispiel: `#8b5cf6`.');
    data.config.brandColor = value;
    saveAdvancedStore(store);
    await logAdvanced(interaction.guild, `${interaction.user.tag} änderte die Brand-Farbe auf ${value}.`);
    return replyEphemeral(interaction, `✅ Embed-Farbe wurde auf **${value}** gesetzt.`);
  }

  if (sub === 'library') {
    data.config.libraryPublic = interaction.options.getBoolean('public', true);
    saveAdvancedStore(store);
    await logAdvanced(interaction.guild, `${interaction.user.tag} setzte libraryPublic=${data.config.libraryPublic}.`);
    return replyEphemeral(interaction, `✅ Andere Kunden-Libraries sind jetzt **${data.config.libraryPublic ? 'öffentlich erlaubt' : 'nur für Staff sichtbar'}**.`);
  }
}

function productLabel(order) {
  const keys = Array.isArray(order?.cartItems) && order.cartItems.length
    ? order.cartItems
    : Array.isArray(order?.productKeys) && order.productKeys.length
      ? order.productKeys
      : [order?.productKey].filter(Boolean);
  if (!keys.length) return 'Unbekanntes Produkt';
  return keys.map(key => PRODUCT_LABELS[key] || key).join(' + ');
}

async function handleLibrary(interaction) {
  const { data: adv } = getAdvancedGuildData(interaction.guild.id);
  const target = interaction.options.getUser('user', false) || interaction.user;
  const viewingOther = target.id !== interaction.user.id;
  if (viewingOther && !adv.config.libraryPublic && !hasManagePermission(interaction)) {
    return replyEphemeral(interaction, '❌ Andere Kunden-Libraries sind nicht öffentlich.');
  }

  const sellingGuild = readSellingStore()?.guilds?.[interaction.guild.id] || null;
  if (!sellingGuild) return replyEphemeral(interaction, { embeds: [advEmbed(interaction.guild.id, '📚 Kundenbibliothek', 'Der Selling-Shop wurde für diesen Server noch nicht initialisiert.')] });

  const orders = Object.values(sellingGuild.orders || {})
    .filter(order => (order?.userId === target.id || order?.giftRecipientId === target.id) && (order.deliveryReadyAt || order.deliveredAt))
    .sort((a, b) => Number(b.deliveredAt || b.deliveryReadyAt || b.createdAt || 0) - Number(a.deliveredAt || a.deliveryReadyAt || a.createdAt || 0));
  const licenses = Object.values(sellingGuild.licenses || {})
    .filter(license => license?.userId === target.id)
    .sort((a, b) => Number(b.issuedAt || 0) - Number(a.issuedAt || 0));

  const orderLines = orders.slice(0, 10).map(order => {
    const date = order.deliveredAt || order.deliveryReadyAt || order.createdAt;
    return `• **${order.id || '—'}** — ${truncate(productLabel(order), 80)} — <t:${Math.floor(Number(date) / 1000)}:d>`;
  });
  const licenseLines = licenses.slice(0, 10).map(license => {
    const products = Array.isArray(license.productKeys) && license.productKeys.length ? license.productKeys.map(key => PRODUCT_LABELS[key] || key).join(' + ') : (PRODUCT_LABELS[license.productKey] || license.productKey || 'Produkt');
    return `• \`${license.id || '—'}\` — ${truncate(products, 70)} — ${license.active === false ? '🔴 inaktiv' : '🟢 aktiv'}`;
  });

  const embed = advEmbed(interaction.guild.id, `📚 Kundenbibliothek — ${target.username}`, [
    `**Ausgelieferte Bestellungen:** ${orders.length}`,
    `**Lizenzen:** ${licenses.length}`,
    '',
    '**Letzte Bestellungen**',
    orderLines.length ? orderLines.join('\n') : '*Keine ausgelieferten Bestellungen.*',
    '',
    '**Lizenzen**',
    licenseLines.length ? licenseLines.join('\n') : '*Keine Lizenzen.*',
  ].join('\n')).setThumbnail(target.displayAvatarURL({ size: 128 }));
  return replyEphemeral(interaction, { embeds: [embed] });
}

function serializeOverwrites(channel) {
  return channel.permissionOverwrites?.cache?.map(overwrite => ({
    id: overwrite.id,
    type: overwrite.type,
    allow: overwrite.allow.bitfield.toString(),
    deny: overwrite.deny.bitfield.toString(),
  })) || [];
}

function snapshotGuild(guild) {
  const roles = guild.roles.cache
    .filter(role => role.id !== guild.roles.everyone.id && !role.managed)
    .map(role => ({
      id: role.id,
      name: role.name,
      color: role.color,
      hoist: role.hoist,
      mentionable: role.mentionable,
      permissions: role.permissions.bitfield.toString(),
      position: role.position,
    }))
    .sort((a, b) => a.position - b.position);

  const channels = guild.channels.cache
    .filter(channel => !channel.isThread?.())
    .map(channel => ({
      id: channel.id,
      name: channel.name,
      type: channel.type,
      parentId: channel.parentId || null,
      position: Number(channel.rawPosition ?? channel.position ?? 0),
      topic: typeof channel.topic === 'string' ? channel.topic : null,
      nsfw: Boolean(channel.nsfw),
      rateLimitPerUser: Number(channel.rateLimitPerUser || 0),
      bitrate: Number(channel.bitrate || 0),
      userLimit: Number(channel.userLimit || 0),
      permissionOverwrites: serializeOverwrites(channel),
    }))
    .sort((a, b) => a.position - b.position);

  return { createdAt: Date.now(), guildName: guild.name, roles, channels };
}

function compareSnapshot(guild, snapshot) {
  const missingRoles = [];
  const changedRoles = [];
  for (const saved of snapshot.roles || []) {
    const current = guild.roles.cache.get(saved.id);
    if (!current) missingRoles.push(saved);
    else if (
      current.name !== saved.name
      || current.color !== Number(saved.color || 0)
      || current.hoist !== Boolean(saved.hoist)
      || current.mentionable !== Boolean(saved.mentionable)
      || current.permissions.bitfield.toString() !== String(saved.permissions)
    ) changedRoles.push({ saved, current });
  }

  const missingChannels = [];
  const changedChannels = [];
  for (const saved of snapshot.channels || []) {
    const current = guild.channels.cache.get(saved.id);
    if (!current) missingChannels.push(saved);
    else if (
      current.name !== saved.name
      || current.type !== saved.type
      || (current.parentId || null) !== (saved.parentId || null)
      || JSON.stringify(serializeOverwrites(current)) !== JSON.stringify(saved.permissionOverwrites || [])
    ) changedChannels.push({ saved, current });
  }
  return { missingRoles, changedRoles, missingChannels, changedChannels };
}

function mappedOverwrites(saved, roleMap, guild) {
  return (saved.permissionOverwrites || []).map(overwrite => {
    let id = overwrite.id;
    if (roleMap.has(id)) id = roleMap.get(id);
    if (overwrite.type === 0 && id !== guild.roles.everyone.id && !guild.roles.cache.has(id)) return null;
    return { id, type: overwrite.type, allow: BigInt(overwrite.allow || '0'), deny: BigInt(overwrite.deny || '0') };
  }).filter(Boolean);
}

async function repairSnapshot(guild, snapshot) {
  const roleMap = new Map();
  const channelMap = new Map();
  let createdRoles = 0;
  let updatedRoles = 0;
  let createdChannels = 0;
  let updatedChannels = 0;
  let skippedChannels = 0;

  const savedRoles = [...(snapshot.roles || [])].sort((a, b) => a.position - b.position);
  for (const saved of savedRoles) {
    let role = guild.roles.cache.get(saved.id) || null;
    if (!role) {
      role = await guild.roles.create({
        name: saved.name,
        color: saved.color,
        hoist: saved.hoist,
        mentionable: saved.mentionable,
        permissions: BigInt(saved.permissions || '0'),
        reason: 'Setup-Diff Snapshot Reparatur',
      }).catch(() => null);
      if (role) {
        createdRoles += 1;
        roleMap.set(saved.id, role.id);
        await role.setPosition(saved.position).catch(() => null);
      }
      continue;
    }
    roleMap.set(saved.id, role.id);
    if (role.editable && (
      role.name !== saved.name
      || role.color !== Number(saved.color || 0)
      || role.hoist !== Boolean(saved.hoist)
      || role.mentionable !== Boolean(saved.mentionable)
      || role.permissions.bitfield.toString() !== String(saved.permissions)
    )) {
      const edited = await role.edit({
        name: saved.name,
        color: saved.color,
        hoist: saved.hoist,
        mentionable: saved.mentionable,
        permissions: BigInt(saved.permissions || '0'),
        reason: 'Setup-Diff Snapshot Reparatur',
      }).catch(() => null);
      if (edited) updatedRoles += 1;
    }
  }

  const supportedTypes = new Set([
    ChannelType.GuildCategory,
    ChannelType.GuildText,
    ChannelType.GuildAnnouncement,
    ChannelType.GuildVoice,
    ChannelType.GuildStageVoice,
  ]);
  const savedChannels = [...(snapshot.channels || [])].sort((a, b) => {
    const ac = a.type === ChannelType.GuildCategory ? 0 : 1;
    const bc = b.type === ChannelType.GuildCategory ? 0 : 1;
    return ac - bc || a.position - b.position;
  });

  for (const saved of savedChannels) {
    let channel = guild.channels.cache.get(saved.id) || null;
    if (!supportedTypes.has(saved.type)) {
      if (!channel) skippedChannels += 1;
      continue;
    }
    const parentId = saved.parentId ? (channelMap.get(saved.parentId) || saved.parentId) : null;
    const permissionOverwrites = mappedOverwrites(saved, roleMap, guild);

    if (!channel) {
      const options = {
        name: saved.name,
        type: saved.type,
        parent: parentId || undefined,
        position: saved.position,
        permissionOverwrites,
        reason: 'Setup-Diff Snapshot Reparatur',
      };
      if ([ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(saved.type)) {
        options.topic = saved.topic || undefined;
        options.nsfw = saved.nsfw;
        options.rateLimitPerUser = saved.rateLimitPerUser || 0;
      }
      if ([ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(saved.type)) {
        if (saved.bitrate) options.bitrate = saved.bitrate;
        options.userLimit = saved.userLimit || 0;
      }
      channel = await guild.channels.create(options).catch(() => null);
      if (channel) {
        createdChannels += 1;
        channelMap.set(saved.id, channel.id);
      }
      continue;
    }

    channelMap.set(saved.id, channel.id);
    const editOptions = { name: saved.name, parent: parentId, position: saved.position, reason: 'Setup-Diff Snapshot Reparatur' };
    if ([ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(saved.type)) {
      editOptions.topic = saved.topic || null;
      editOptions.nsfw = saved.nsfw;
      editOptions.rateLimitPerUser = saved.rateLimitPerUser || 0;
    }
    const edited = await channel.edit(editOptions).catch(() => null);
    if (edited) {
      await edited.permissionOverwrites.set(permissionOverwrites, 'Setup-Diff Snapshot Reparatur').catch(() => null);
      updatedChannels += 1;
    }
  }

  return { createdRoles, updatedRoles, createdChannels, updatedChannels, skippedChannels };
}

async function handleSetupDiff(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'check' && !hasManagePermission(interaction)) return replyEphemeral(interaction, '❌ Dafür brauchst du **Server verwalten** oder **Administrator**.');
  if ((sub === 'save' || sub === 'repair') && !isGuildOwner(interaction)) return replyEphemeral(interaction, '❌ **Snapshot speichern/reparieren kann nur der Server-Inhaber.**');

  const { store, data } = getAdvancedGuildData(interaction.guild.id);
  if (sub === 'save') {
    data.setupSnapshot = snapshotGuild(interaction.guild);
    saveAdvancedStore(store);
    await logAdvanced(interaction.guild, `${interaction.user.tag} hat einen Setup-Snapshot gespeichert.`);
    return replyEphemeral(interaction, `✅ Snapshot gespeichert: **${data.setupSnapshot.roles.length} Rollen** und **${data.setupSnapshot.channels.length} Channels**.`);
  }

  if (!data.setupSnapshot) return replyEphemeral(interaction, '❌ Noch kein Snapshot vorhanden. Nutze zuerst `/tools setup save`.');
  const diff = compareSnapshot(interaction.guild, data.setupSnapshot);

  if (sub === 'check') {
    const details = [
      ...diff.missingRoles.slice(0, 6).map(item => `🔴 Rolle fehlt: **${item.name}**`),
      ...diff.changedRoles.slice(0, 6).map(item => `🟠 Rolle geändert: **${item.saved.name}**`),
      ...diff.missingChannels.slice(0, 6).map(item => `🔴 Channel fehlt: **${item.name}**`),
      ...diff.changedChannels.slice(0, 6).map(item => `🟠 Channel geändert: **${item.saved.name}**`),
    ];
    const total = diff.missingRoles.length + diff.changedRoles.length + diff.missingChannels.length + diff.changedChannels.length;
    const embed = advEmbed(interaction.guild.id, '🧬 Setup-Diff', [
      `Snapshot: <t:${Math.floor(data.setupSnapshot.createdAt / 1000)}:F>`,
      `**Fehlende Rollen:** ${diff.missingRoles.length}`,
      `**Geänderte Rollen:** ${diff.changedRoles.length}`,
      `**Fehlende Channels:** ${diff.missingChannels.length}`,
      `**Geänderte Channels:** ${diff.changedChannels.length}`,
      '',
      total ? details.join('\n') : '✅ **Keine Abweichungen gefunden.**',
      total > details.length ? `\n… und **${total - details.length}** weitere Änderungen.` : '',
    ].join('\n'));
    return replyEphemeral(interaction, { embeds: [embed] });
  }

  if (sub === 'repair') {
    await interaction.deferReply({ ephemeral: true });
    const result = await repairSnapshot(interaction.guild, data.setupSnapshot);
    await logAdvanced(interaction.guild, `${interaction.user.tag} hat Setup-Diff Repair ausgeführt: ${JSON.stringify(result)}.`);
    return interaction.editReply({ embeds: [advEmbed(interaction.guild.id, '🛠️ Setup-Diff Reparatur', [
      `**Rollen neu erstellt:** ${result.createdRoles}`,
      `**Rollen zurückgesetzt:** ${result.updatedRoles}`,
      `**Channels neu erstellt:** ${result.createdChannels}`,
      `**Channels zurückgesetzt:** ${result.updatedChannels}`,
      `**Nicht unterstützte fehlende Channel-Typen:** ${result.skippedChannels}`,
      '',
      'Zusätzliche Rollen/Channels werden absichtlich **nicht gelöscht**.',
    ].join('\n'))] });
  }
}

async function handleSystemCheck(interaction, client) {
  if (!hasManagePermission(interaction)) return replyEphemeral(interaction, '❌ Dafür brauchst du **Server verwalten** oder **Administrator**.');
  await interaction.deferReply({ ephemeral: true });
  const guild = interaction.guild;
  const checks = [];
  const ok = text => checks.push({ status: '✅', text });
  const warn = text => checks.push({ status: '⚠️', text });
  const fail = text => checks.push({ status: '❌', text });

  const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
  if (!me) fail('Bot-Member konnte nicht geladen werden.');
  else {
    if (me.permissions.has(PermissionFlagsBits.Administrator)) ok('Bot besitzt Administrator-Rechte.');
    else warn('Bot besitzt kein Administrator-Recht; Full-Setup/Self-Heal kann eingeschränkt sein.');
    const highest = me.roles.highest?.position || 0;
    const blocking = guild.roles.cache.filter(role => !role.managed && role.id !== guild.roles.everyone.id && role.position >= highest && role.id !== me.roles.highest.id);
    if (blocking.size) warn(`${blocking.size} Rollen liegen auf/über der höchsten Bot-Rolle.`);
    else ok('Rollen-Hierarchie blockiert den Bot nicht offensichtlich.');
  }

  try {
    fs.accessSync(storageDir, fs.constants.R_OK | fs.constants.W_OK);
    ok(`Railway/Data-Verzeichnis ist les- und beschreibbar: ${storageDir}`);
  } catch (_) {
    fail(`Railway/Data-Verzeichnis ist nicht beschreibbar: ${storageDir}`);
  }

  try {
    const advanced = loadAdvancedStore();
    if (advanced?.guilds) ok('advanced-features.json ist lesbar.');
    else fail('advanced-features.json hat ein ungültiges Format.');
  } catch (_) { fail('advanced-features.json konnte nicht gelesen werden.'); }

  const selling = readSellingStore();
  const sellingGuild = selling?.guilds?.[guild.id] || null;
  if (!selling) fail('selling-data.json fehlt oder ist nicht lesbar.');
  else if (!sellingGuild) warn('Für diesen Server existiert noch kein Selling-Datensatz.');
  else {
    ok('Selling-Datenspeicher ist lesbar.');
    const roleIds = Object.values(sellingGuild.config?.roleIds || {}).filter(Boolean);
    const channelIds = Object.values(sellingGuild.config?.channelIds || {}).filter(Boolean);
    const staleRoles = roleIds.filter(id => !guild.roles.cache.has(id));
    const staleChannels = channelIds.filter(id => !guild.channels.cache.has(id));
    if (staleRoles.length) warn(`${staleRoles.length} gespeicherte Selling-Rollen-IDs zeigen auf keine vorhandene Rolle.`); else ok(`${roleIds.length} gespeicherte Selling-Rollen-IDs sind gültig.`);
    if (staleChannels.length) warn(`${staleChannels.length} gespeicherte Selling-Channel-IDs zeigen auf keinen vorhandenen Channel.`); else ok(`${channelIds.length} gespeicherte Selling-Channel-IDs sind gültig.`);
    if (sellingGuild.config?.paypalEmail) ok('PayPal-Empfänger ist konfiguriert.'); else warn('PayPal-Empfänger ist noch nicht gesetzt.');
  }

  const intentChecks = [
    [GatewayIntentBits.Guilds, 'Guilds'],
    [GatewayIntentBits.GuildMembers, 'GuildMembers'],
    [GatewayIntentBits.GuildMessages, 'GuildMessages'],
    [GatewayIntentBits.MessageContent, 'MessageContent'],
  ];
  for (const [intent, name] of intentChecks) {
    if (client.options.intents?.has(intent)) ok(`Intent ${name} ist im Client aktiviert.`);
    else warn(`Intent ${name} ist im Client nicht aktiviert.`);
  }

  try {
    const globalCommands = await client.application.commands.fetch();
    const guildCommands = await guild.commands.fetch();
    const names = new Set([...globalCommands.values(), ...guildCommands.values()].map(command => command.name));
    const missing = [...ADVANCED_COMMANDS].filter(name => !names.has(name));
    if (missing.length) warn(`Neue Commands noch nicht registriert: ${missing.map(name => `/${name}`).join(', ')}`);
    else ok('Alle neuen Advanced-Commands sind bei Discord registriert.');
  } catch (_) {
    warn('Discord-Commandliste konnte nicht geprüft werden.');
  }

  const { data } = getAdvancedGuildData(guild.id);
  if (data.setupSnapshot) ok(`Setup-Diff Snapshot vorhanden (${new Date(data.setupSnapshot.createdAt).toLocaleString('de-AT')}).`);
  else warn('Noch kein Setup-Diff Snapshot vorhanden.');

  const successCount = checks.filter(item => item.status === '✅').length;
  const warningCount = checks.filter(item => item.status === '⚠️').length;
  const failCount = checks.filter(item => item.status === '❌').length;
  const lines = checks.slice(0, 22).map(item => `${item.status} ${item.text}`);
  const embed = advEmbed(guild.id, '🩺 Systemcheck', [
    `**OK:** ${successCount}  •  **Warnungen:** ${warningCount}  •  **Fehler:** ${failCount}`,
    '',
    ...lines,
    checks.length > lines.length ? `\n… ${checks.length - lines.length} weitere Prüfungen.` : '',
  ].join('\n'));
  return interaction.editReply({ embeds: [embed] });
}

async function advancedInteractionHandler(interaction, client) {
  try {
    if (!interaction.inGuild?.()) return;

    // Nach einem kompletten Selling-Setup automatisch eine neue Referenz erzeugen.
    if (interaction.isChatInputCommand?.() && interaction.commandName === 'setup') {
      let group = null;
      let sub = null;
      try {
        group = interaction.options.getSubcommandGroup(false);
        sub = interaction.options.getSubcommand(false);
      } catch (_) {}
      if (group === 'server' && sub === 'selling') {
        setTimeout(() => {
          try {
            const { store, data } = getAdvancedGuildData(interaction.guildId);
            const guild = client.guilds.cache.get(interaction.guildId);
            if (!guild) return;
            data.setupSnapshot = snapshotGuild(guild);
            saveAdvancedStore(store);
            logAdvanced(guild, 'Automatischer Setup-Diff Snapshot nach /setup server selling gespeichert.').catch(() => null);
          } catch (_) {}
        }, 120000).unref?.();
      }
      return;
    }

    if (interaction.isModalSubmit?.() && String(interaction.customId || '').startsWith('adv:panel:')) return handlePanelModal(interaction);
    if (!interaction.isChatInputCommand?.() || interaction.commandName !== 'tools') return;

    let group = null;
    let sub = null;
    try {
      group = interaction.options.getSubcommandGroup(false);
      sub = interaction.options.getSubcommand(false);
    } catch (_) {}

    if (group === 'panel') return handlePanelBuilder(interaction);
    if (group === 'config') return handleConfigCenter(interaction);
    if (group === 'setup') return handleSetupDiff(interaction);
    if (!group && sub === 'library') return handleLibrary(interaction);
    if (!group && sub === 'systemcheck') return handleSystemCheck(interaction, client);
  } catch (error) {
    console.error('❌ Advanced feature interaction error:', error);
    return replyEphemeral(interaction, `❌ Fehler in der erweiterten Funktion: ${truncate(error?.message || error, 1500)}`);
  }
}

function cleanupPendingPanels() {
  const now = Date.now();
  for (const [token, pending] of pendingPanelModals) if (!pending || pending.expiresAt < now) pendingPanelModals.delete(token);
}

function installAdvancedFeatures(client) {
  if (client.__turboAdvancedFeaturesInstalled) return;
  client.__turboAdvancedFeaturesInstalled = true;
  nativeClientOn.call(client, Events.InteractionCreate, interaction => advancedInteractionHandler(interaction, client));
  nativeClientOn.call(client, Events.ClientReady, () => {
    console.log('✅ Turbo Tools v5.9.3 aktiv: /tools (Panel, Config, Library, Setup-Diff, Systemcheck)');
    setInterval(cleanupPendingPanels, 5 * 60 * 1000).unref?.();
  });
}

// Der Bot erzeugt seinen Client im bestehenden selling-entry.js. Wir hängen uns vor dem echten Login ein.
const nativeLogin = Client.prototype.login;
Client.prototype.login = function advancedLogin(token) {
  installAdvancedFeatures(this);
  return nativeLogin.call(this, token);
};

module.exports = {
  buildAdvancedCommandDefinitions,
  snapshotGuild,
  compareSnapshot,
};
