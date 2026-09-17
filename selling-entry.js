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

const SUPPORT_TYPES = {
  general: { label: 'Allgemeiner Support', emoji: '🎫' },
  installation: { label: 'Installation / Einrichtung', emoji: '🛠️' },
  order: { label: 'Bestellung / Lieferung', emoji: '📦' },
  payment: { label: 'Zahlung / PayPal', emoji: '💳' },
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
const sellingResetGuilds = new Set();

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
    embeds: [shopEmbed(`${product.emoji} Kauf-Ticket • ${product.label}`, `Hallo <@${interaction.user.id}>!\n\nBitte sende uns für eine schnelle Bearbeitung:\n• gewünschtes Produkt / Paket\n• genaue Wünsche und Änderungen\n• Referenzen oder Beispiele (falls vorhanden)\n• gewünschtes Format / Einsatzzweck\n• gewünschten Termin, falls relevant\n\nDas Shop-Team bestätigt anschließend **Leistungsumfang, Gesamtpreis, Lieferzeit und PayPal-Empfänger** direkt in diesem Ticket.\n\n💳 **Bitte erst danach bezahlen.** Mit Abschluss der Bestellung gelten die veröffentlichten Shop- und Lizenzbedingungen.`, [
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
    name: `support-${supportKey}-${sanitizeName(interaction.user.username)}`.slice(0, 95),
    type: ChannelType.GuildText,
    parent: category.id,
    topic: `selling-owner:${interaction.user.id}|selling-kind:support|selling-support:${supportKey}|selling-status:open`,
    permissionOverwrites: overwrites,
    reason: `Selling Support von ${interaction.user.tag}`,
  });

  const actions = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('selling_claim').setLabel('Übernehmen').setEmoji('🙋').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('selling_close').setLabel('Ticket schließen').setEmoji('🔒').setStyle(ButtonStyle.Danger),
  );
  await channel.send({
    content: `<@${interaction.user.id}>`,
    embeds: [shopEmbed(`${supportType.emoji} Support • ${supportType.label}`, `Hallo <@${interaction.user.id}>!\n\nBitte beschreibe dein Anliegen strukturiert und vollständig. Hilfreich sind:\n• betroffenes Produkt / Bestellung\n• ungefähres Kaufdatum\n• genaue Fehlerbeschreibung oder Frage\n• Screenshots / Logs, falls vorhanden\n• bereits getestete Schritte\n\n**Keine Passwörter, PayPal-Login-Codes, 2FA-Codes oder sonstige Zugangsdaten senden.**`, [
      { name: 'Kunde', value: `<@${interaction.user.id}>`, inline: true },
      { name: 'Bereich', value: supportType.label, inline: true },
      { name: 'Status', value: 'Offen', inline: true },
    ])],
    components: [actions],
    allowedMentions: { users: [interaction.user.id] },
  });

  await interaction.reply({ content: `✅ Dein **${supportType.label}**-Ticket wurde erstellt: <#${channel.id}>`, ephemeral: true });
  await logSelling(interaction.guild, '🎫 Neues Support-Ticket', `<@${interaction.user.id}> hat **${supportType.label}** erstellt: <#${channel.id}>`);
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
    await seedSellingServer(structure);

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

  if (interaction.isButton?.() && String(interaction.customId || '').startsWith('selling_order:')) {
    await openSellingTicket(interaction, interaction.customId.split(':')[1]);
    return true;
  }

  if (interaction.isButton?.() && String(interaction.customId || '').startsWith('selling_support:')) {
    await openSupportTicket(interaction, interaction.customId.split(':')[1] || 'general');
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
