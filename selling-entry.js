'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  PermissionFlagsBits,
  REST,
  Routes,
} = require('discord.js');

const SELLING = {
  color: 0x8b5cf6,
  categories: {
    info: '╭━━〔 INFORMATION 〕━━╮',
    shop: '┣━━〔 SHOP 〕━━┫',
    buy: '┣━━〔 BESTELLEN 〕━━┫',
    community: '┣━━〔 COMMUNITY 〕━━┫',
    support: '┣━━〔 SUPPORT 〕━━┫',
    orders: '┣━━〔 TICKETS 〕━━┫',
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
    { name: '🔔・SHOP UPDATES', key: 'updates', color: 0x95a5a6, hoist: false, permissions: [] },
    { name: '🎁・GIVEAWAYS', key: 'giveaways', color: 0xe67e22, hoist: false, permissions: [] },
    { name: '✅・VERIFIZIERT', key: 'verified', color: 0x2ecc71, hoist: false, permissions: [] },
  ],
};

const PRODUCT_TYPES = {
  thumbnail: { label: 'Thumbnail', emoji: '🖼️' },
  nve: { label: 'NVE Preset / Grafik-Setup', emoji: '🌆' },
  soundpack: { label: 'Soundpack', emoji: '🔊' },
  grafik: { label: 'Grafik / Design', emoji: '🎨' },
  fivem: { label: 'FiveM Asset', emoji: '🚗' },
};

function isSellingInteraction(interaction) {
  try {
    if (interaction.isChatInputCommand?.()) {
      return interaction.commandName === 'setup'
        && interaction.options.getSubcommandGroup(false) === 'server'
        && interaction.options.getSubcommand(false) === 'selling';
    }
    if (interaction.isButton?.()) return String(interaction.customId || '').startsWith('selling_');
  } catch (_) {}
  return false;
}

let cachedSellingCommandBody = null;
let sellingLoginToken = null;

function addSellingSetupCommand(body) {
  if (!Array.isArray(body)) return body;
  return body.map(command => {
    if (!command || command.name !== 'setup') return command;
    const patched = JSON.parse(JSON.stringify(command));
    patched.options = Array.isArray(patched.options) ? patched.options : [];
    let serverGroup = patched.options.find(option => option?.type === 2 && option?.name === 'server');
    if (!serverGroup) {
      serverGroup = {
        type: 2,
        name: 'server',
        description: 'Erstellt komplette Server-Designs.',
        options: [],
      };
      patched.options.push(serverGroup);
    }
    serverGroup.options = Array.isArray(serverGroup.options) ? serverGroup.options : [];
    if (!serverGroup.options.some(option => option?.type === 1 && option?.name === 'selling')) {
      serverGroup.options.push({
        type: 1,
        name: 'selling',
        description: 'Erstellt einen kompletten Verkaufsserver für digitale Produkte.',
      });
    }
    return patched;
  });
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
  if (eventName !== Events.InteractionCreate) return originalClientOn.call(this, eventName, listener);
  return originalClientOn.call(this, eventName, async function wrappedInteraction(interaction, ...args) {
    if (isSellingInteraction(interaction)) return;
    return listener.call(this, interaction, ...args);
  });
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

  channels.order = await ensureChannel(guild, categories.buy, '🛒・bestellen', { readOnly: true, roleMap, topic: 'Hier kannst du ein privates Kauf-Ticket öffnen.' });
  channels.payment = await ensureChannel(guild, categories.buy, '💳・zahlung', { readOnly: true, roleMap, topic: 'Zahlungsinformationen werden vom Shop-Team gepflegt.' });
  channels.reviews = await ensureChannel(guild, categories.buy, '⭐・bewertungen', { roleMap, topic: 'Bewertungen von Kunden.' });
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
  channels.teamVoice = await ensureChannel(guild, categories.team, '🔊・Team Talk', { type: ChannelType.GuildVoice, privateForStaff: true, roleMap });

  return { roleMap, categories, channels };
}

async function seedSellingServer(structure) {
  const { channels } = structure;

  await seedIfEmpty(channels.welcome, {
    embeds: [shopEmbed('🛒 Willkommen im Unfugstifter Shop', 'Hier findest du digitale Produkte rund um **FiveM, GTA, Content und Designs**.\n\nSchau dir die Produkt-Channels an und öffne anschließend in **🛒・bestellen** ein privates Kauf-Ticket.')],
  });

  await seedIfEmpty(channels.rules, {
    embeds: [shopEmbed('📜 Shop-Regelwerk & Nutzungsbedingungen', [
      '**1. Respekt & Verhalten**\nBehandle Kunden, Teammitglieder und andere Nutzer respektvoll. Beleidigungen, Spam, Provokationen oder absichtliche Störungen können zum Ausschluss führen.',
      '**2. Bestellungen nur über offizielle Tickets**\nBestellungen, Preisabsprachen und Zahlungsbestätigungen werden ausschließlich über die vorgesehenen Kauf-Tickets abgewickelt.',
      '**3. Zahlung ausschließlich per PayPal**\nDie aktuell gültige PayPal-Adresse und der endgültige Preis werden dir vom Team im privaten Ticket bestätigt. Sende kein Geld an Adressen aus fremden Nachrichten oder Screenshots.',
      '**4. Weiterverkauf verboten**\nGekaufte Produkte dürfen ohne ausdrückliche schriftliche Erlaubnis nicht weiterverkauft, vermietet, getauscht oder gegen andere Leistungen weitergegeben werden.',
      '**5. Leaken / Teilen verboten**\nDas Hochladen, Veröffentlichen, Leaken, Versenden oder Teilen der Dateien mit Freunden, anderen Communities, Servern oder Download-Seiten ist untersagt.',
      '**6. Keine Reuploads oder Kopien**\nProdukte dürfen nicht unter anderem Namen erneut hochgeladen, gespiegelt, als eigenes Werk ausgegeben oder in öffentliche Packs eingebaut werden.',
      '**7. Lizenz gilt nur für den Käufer**\nSofern beim Produkt nichts anderes angegeben ist, erhält nur der Käufer das vereinbarte Nutzungsrecht. Ein Kauf überträgt nicht automatisch Eigentums- oder Weitervertriebsrechte.',
      '**8. Schutz der Shop-Dateien**\nDas Entfernen von Credits, Schutzmechanismen oder Lizenzhinweisen mit dem Ziel einer unerlaubten Weitergabe ist untersagt.',
      '**9. Nachweise & Protokollierung**\nZur Abwicklung und zum Schutz vor Missbrauch können Bestellungen und Ticket-Aktionen protokolliert werden – z. B. Discord-ID, Produkt, Ticket, Zeitstempel, zuständiges Teammitglied und Bestellstatus. PayPal-Passwörter oder andere Zugangsdaten werden niemals verlangt.',
      '**10. Falsche Zahlungsnachweise**\nGefälschte PayPal-Screenshots, manipulierte Belege oder falsche Angaben führen zur Ablehnung der Bestellung und können zum Ausschluss aus dem Shop führen.',
      '**11. Support & Änderungen**\nSupport bezieht sich auf den vereinbarten Lieferumfang. Größere nachträgliche Änderungen oder neue Wünsche können als neuer Auftrag behandelt werden.',
      '**12. Verstöße gegen die Lizenz**\nBei nachgewiesenem Weiterverkauf, Leak oder unerlaubter Weitergabe kann die Nutzungslizenz entzogen und weiterer Support verweigert werden. Weitere Schritte richten sich nach dem anwendbaren Recht.',
      '**13. Rückerstattung / Widerruf**\nRückerstattungen und gesetzliche Widerrufsrechte richten sich nach dem jeweiligen Auftrag und dem anwendbaren Recht. Individuelle Vereinbarungen werden im Ticket festgehalten.',
      '**14. Mit dem Kauf akzeptiert**\nMit Abschluss einer Bestellung bestätigst du, dass du diese Regeln und die im Ticket genannten Produktbedingungen zur Kenntnis genommen hast.',
    ].join('\n\n'))],
  });

  await seedIfEmpty(channels.faq, {
    embeds: [shopEmbed('❓ FAQ', '**Wie bestelle ich?**\nÖffne in **🛒・bestellen** ein Ticket für dein gewünschtes Produkt.\n\n**Wo stehen Preise?**\nPreise können direkt in den Produkt-Channels oder im Ticket genannt werden.\n\n**Wo bekomme ich Support?**\nFür kurze Fragen in **❓・support-chat** oder über **🎫・support-ticket** als privates Support-Ticket.')],
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
    new ButtonBuilder().setCustomId('selling_support_open').setLabel('Support').setEmoji('🎫').setStyle(ButtonStyle.Success),
  );
  await seedIfEmpty(channels.order, {
    embeds: [shopEmbed('🛒 Bestellung starten', 'Wähle unten aus was du kaufen möchtest. Der Bot erstellt automatisch ein **privates Kauf-Ticket** für dich und das Shop-Team.')],
    components: [orderRow1, orderRow2],
  });

  await seedIfEmpty(channels.payment, {
    embeds: [shopEmbed('💳 Zahlung • PayPal', '**Zahlungsart: PayPal**\n\nDie korrekte **PayPal-Adresse und der endgültige Betrag** werden dir ausschließlich im privaten Kauf-Ticket vom Shop-Team bestätigt.\n\n**Bitte nicht vorher bezahlen.** Nach der Zahlung sendest du die Bestätigung im Ticket. Teile niemals PayPal-Passwörter, Login-Codes oder andere Zugangsdaten.')],
  });

  const supportRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('selling_support_open').setLabel('Support-Ticket öffnen').setEmoji('🎫').setStyle(ButtonStyle.Primary),
  );
  await seedIfEmpty(channels.supportTicket, {
    embeds: [shopEmbed('🎫 Privater Support', 'Du hast ein Problem mit einem Produkt, einer Bestellung, Installation oder Lieferung?\n\nDrücke unten auf **Support-Ticket öffnen**. Nur du und das Shop-Team können das Ticket sehen.')],
    components: [supportRow],
  });

  await seedIfEmpty(channels.ticketInfo, {
    embeds: [shopEmbed('📋 Ticket-System', '**Kauf-Ticket:** über **🛒・bestellen** für neue Bestellungen.\n\n**Support-Ticket:** über **🎫・support-ticket** für Probleme, Installation, Lieferung oder Fragen nach dem Kauf.\n\nTicket-Aktionen werden für die Bearbeitung und Nachvollziehbarkeit protokolliert.')],
  });
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

async function openSellingTicket(interaction, productKey) {
  const product = PRODUCT_TYPES[productKey];
  if (!product || !interaction.inGuild()) return;

  const duplicate = interaction.guild.channels.cache.find(channel =>
    channel.type === ChannelType.GuildText
      && String(channel.topic || '').includes(`selling-owner:${interaction.user.id}`)
      && String(channel.topic || '').includes('selling-kind:order')
      && String(channel.topic || '').includes('selling-status:open'));
  if (duplicate) {
    await interaction.reply({ content: `❌ Du hast bereits ein offenes Kauf-Ticket: <#${duplicate.id}>`, ephemeral: true });
    return;
  }

  const category = interaction.guild.channels.cache.find(channel => channel.type === ChannelType.GuildCategory && channel.name === SELLING.categories.orders);
  if (!category) {
    await interaction.reply({ content: '❌ Die Kauf-Ticket-Kategorie fehlt. Der Server-Inhaber soll `/setup server selling` erneut ausführen.', ephemeral: true });
    return;
  }

  const staffRoles = interaction.guild.roles.cache.filter(role =>
    ['👑・INHABER', '⚜️・MANAGEMENT', '🎫・SUPPORT', '🎨・DESIGNER', '🎧・SOUND DESIGNER', '🛠️・DEVELOPER'].includes(role.name));
  const overwrites = [
    { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks] },
    ...staffRoles.map(role => ({ id: role.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages] })),
  ];

  const channel = await interaction.guild.channels.create({
    name: `order-${productKey}-${sanitizeName(interaction.user.username)}`.slice(0, 95),
    type: ChannelType.GuildText,
    parent: category.id,
    topic: `selling-owner:${interaction.user.id}|selling-kind:order|selling-product:${productKey}|selling-status:open`,
    permissionOverwrites: overwrites,
    reason: `Selling Bestellung von ${interaction.user.tag}`,
  });

  const actions = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('selling_claim').setLabel('Übernehmen').setEmoji('🙋').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('selling_close').setLabel('Ticket schließen').setEmoji('🔒').setStyle(ButtonStyle.Danger),
  );
  await channel.send({
    content: `<@${interaction.user.id}>`,
    embeds: [shopEmbed(`${product.emoji} Kauf-Ticket • ${product.label}`, `Hallo <@${interaction.user.id}>!\n\nBeschreibe bitte genau was du möchtest. Das Shop-Team klärt anschließend **Preis, Umfang, Lieferzeit und Anpassungen** mit dir.\n\n💳 **Zahlung: PayPal** – bitte erst bezahlen, nachdem dir Preis und PayPal-Adresse hier im Ticket bestätigt wurden.`, [
      { name: 'Produkt', value: product.label, inline: true },
      { name: 'Kunde', value: `<@${interaction.user.id}>`, inline: true },
      { name: 'Zahlung', value: 'PayPal', inline: true },
    ])],
    components: [actions],
    allowedMentions: { users: [interaction.user.id] },
  });

  await interaction.reply({ content: `✅ Dein **${product.label}**-Ticket wurde erstellt: <#${channel.id}>`, ephemeral: true });
  await logSelling(interaction.guild, '🛒 Neue Bestellung', `<@${interaction.user.id}> hat ein **${product.label}**-Ticket erstellt: <#${channel.id}>`);
}

async function openSupportTicket(interaction) {
  if (!interaction.inGuild()) return;

  const duplicate = interaction.guild.channels.cache.find(channel =>
    channel.type === ChannelType.GuildText
      && String(channel.topic || '').includes(`selling-owner:${interaction.user.id}`)
      && String(channel.topic || '').includes('selling-kind:support')
      && String(channel.topic || '').includes('selling-status:open'));
  if (duplicate) {
    await interaction.reply({ content: `❌ Du hast bereits ein offenes Support-Ticket: <#${duplicate.id}>`, ephemeral: true });
    return;
  }

  const category = interaction.guild.channels.cache.find(channel => channel.type === ChannelType.GuildCategory && channel.name === SELLING.categories.orders);
  if (!category) {
    await interaction.reply({ content: '❌ Die Ticket-Kategorie fehlt. Der Server-Inhaber soll `/setup server selling` erneut ausführen.', ephemeral: true });
    return;
  }

  const staffRoles = interaction.guild.roles.cache.filter(role =>
    ['👑・INHABER', '⚜️・MANAGEMENT', '🎫・SUPPORT', '🎨・DESIGNER', '🎧・SOUND DESIGNER', '🛠️・DEVELOPER'].includes(role.name));
  const overwrites = [
    { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks] },
    ...staffRoles.map(role => ({ id: role.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages] })),
  ];

  const channel = await interaction.guild.channels.create({
    name: `support-${sanitizeName(interaction.user.username)}`.slice(0, 95),
    type: ChannelType.GuildText,
    parent: category.id,
    topic: `selling-owner:${interaction.user.id}|selling-kind:support|selling-status:open`,
    permissionOverwrites: overwrites,
    reason: `Selling Support von ${interaction.user.tag}`,
  });

  const actions = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('selling_claim').setLabel('Übernehmen').setEmoji('🙋').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('selling_close').setLabel('Ticket schließen').setEmoji('🔒').setStyle(ButtonStyle.Danger),
  );
  await channel.send({
    content: `<@${interaction.user.id}>`,
    embeds: [shopEmbed('🎫 Support-Ticket', `Hallo <@${interaction.user.id}>!\n\nBeschreibe bitte dein Problem so genau wie möglich. Wenn es um einen Kauf geht, nenne **Produkt, ungefähres Kaufdatum und was genau nicht funktioniert**.\n\nBitte sende keine Passwörter, PayPal-Login-Codes oder andere Zugangsdaten.`, [
      { name: 'Kunde', value: `<@${interaction.user.id}>`, inline: true },
      { name: 'Typ', value: 'Support', inline: true },
    ])],
    components: [actions],
    allowedMentions: { users: [interaction.user.id] },
  });

  await interaction.reply({ content: `✅ Dein Support-Ticket wurde erstellt: <#${channel.id}>`, ephemeral: true });
  await logSelling(interaction.guild, '🎫 Neues Support-Ticket', `<@${interaction.user.id}> hat ein Support-Ticket erstellt: <#${channel.id}>`);
}

async function handleTicketButton(interaction) {
  if (!interaction.inGuild() || !interaction.channel) return;
  const ownerMatch = String(interaction.channel.topic || '').match(/selling-owner:(\d+)/);
  const ownerId = ownerMatch?.[1] || null;

  if (interaction.customId === 'selling_claim') {
    if (!canHandleSellingTicket(interaction.member)) {
      await interaction.reply({ content: '❌ Nur das Shop-Team kann Bestellungen übernehmen.', ephemeral: true });
      return;
    }
    const isSupport = String(interaction.channel.topic || '').includes('selling-kind:support');
    await interaction.reply({ content: `🙋 <@${interaction.user.id}> hat dieses ${isSupport ? 'Support-Ticket' : 'Kauf-Ticket'} übernommen.` });
    await logSelling(interaction.guild, isSupport ? '🙋 Support übernommen' : '🙋 Bestellung übernommen', `<@${interaction.user.id}> hat <#${interaction.channel.id}> übernommen.`);
    return;
  }

  if (interaction.customId === 'selling_close') {
    if (interaction.user.id !== ownerId && !canHandleSellingTicket(interaction.member)) {
      await interaction.reply({ content: '❌ Du darfst dieses Ticket nicht schließen.', ephemeral: true });
      return;
    }
    await interaction.reply({ content: '🔒 Ticket wird geschlossen …' });
    const isSupport = String(interaction.channel.topic || '').includes('selling-kind:support');
    await logSelling(interaction.guild, isSupport ? '🔒 Support geschlossen' : '🔒 Bestellung geschlossen', `<@${interaction.user.id}> hat <#${interaction.channel.id}> geschlossen.`);
    setTimeout(() => interaction.channel.delete(`Selling Ticket geschlossen von ${interaction.user.tag}`).catch(() => {}), 2500);
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
    await interaction.reply({ content: '❌ Der Bot braucht **Administrator**, damit Rollen, Kategorien, Channels und Ticket-Rechte korrekt erstellt werden können.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  await interaction.editReply('🛒 **Selling Server Setup läuft …** Rollen, Shop-Bereiche und Bestell-System werden eingerichtet.');

  const structure = await createSellingStructure(interaction.guild);
  await seedSellingServer(structure);

  await interaction.editReply([
    '✅ **Selling Server ist eingerichtet.**',
    '',
    'Erstellt wurden Bereiche für **Thumbnails, NVE-Presets/Grafik-Setups, Soundpacks, Designs, FiveM-Assets, Bundles, Bewertungen, PayPal-Zahlungen, Support und Team**.',
    'In **🛒・bestellen** gibt es private Kauf-Tickets und in **🎫・support-ticket** ein eigenes Support-Ticket-System.',
    '',
    'ℹ️ Bereits vorhandene fremde Channels/Rollen werden absichtlich **nicht gelöscht**. Der Command kann dadurch gefahrlos erneut ausgeführt werden und ergänzt fehlende Teile.',
  ].join('\n'));
}

async function handleSellingInteraction(interaction) {
  if (interaction.isChatInputCommand?.()
    && interaction.commandName === 'setup'
    && interaction.options.getSubcommandGroup(false) === 'server'
    && interaction.options.getSubcommand(false) === 'selling') {
    await runSellingSetup(interaction);
    return true;
  }

  if (interaction.isButton?.() && String(interaction.customId || '').startsWith('selling_order:')) {
    await openSellingTicket(interaction, interaction.customId.split(':')[1]);
    return true;
  }

  if (interaction.isButton?.() && interaction.customId === 'selling_support_open') {
    await openSupportTicket(interaction);
    return true;
  }

  if (interaction.isButton?.() && (interaction.customId === 'selling_claim' || interaction.customId === 'selling_close')) {
    await handleTicketButton(interaction);
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
