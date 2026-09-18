'use strict';

const fs = require('fs');
const path = require('path');

const root = process.cwd();
const indexPath = path.join(root, 'index.js');
const sellingPath = path.join(root, 'selling-entry.js');

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function replaceOnceIn(text, oldText, newText, label) {
  const first = text.indexOf(oldText);
  if (first === -1) return { text, changed: false, missing: true };
  const second = text.indexOf(oldText, first + oldText.length);
  if (second !== -1) throw new Error(`Fix "${label}" ist nicht eindeutig.`);
  return {
    text: text.slice(0, first) + newText + text.slice(first + oldText.length),
    changed: true,
    missing: false,
  };
}

if (!fs.existsSync(indexPath)) fail('index.js nicht gefunden. Starte die Datei im Root deines Bot-Repositories.');
if (!fs.existsSync(sellingPath)) fail('selling-entry.js nicht gefunden. Starte die Datei im Root deines Bot-Repositories.');

let index = fs.readFileSync(indexPath, 'utf8');
let selling = fs.readFileSync(sellingPath, 'utf8');

// Backups des aktuellen Push-Stands anlegen.
if (!fs.existsSync(`${indexPath}.bak-merged-update`)) fs.copyFileSync(indexPath, `${indexPath}.bak-merged-update`);
if (!fs.existsSync(`${sellingPath}.bak-merged-update`)) fs.copyFileSync(sellingPath, `${sellingPath}.bak-merged-update`);

let shopChanges = 0;
let bugChanges = 0;

// ============================================================
// A) SHOP COMMANDLISTEN + /HELP
// ============================================================

if (!selling.includes("process.env.TURBO_SHOP_MODE = '1';")) {
  const marker = "'use strict';\n";
  if (!selling.startsWith(marker)) fail("selling-entry.js hat nicht den erwarteten Kopf ('use strict').");
  selling = selling.replace(
    marker,
    `${marker}\n// Shop entry: command panels and /help only show Turbo Designs shop functions.\nprocess.env.TURBO_SHOP_MODE = '1';\n`
  );
  shopChanges++;
}

if (!index.includes("const TURBO_SHOP_MODE = process.env.TURBO_SHOP_MODE === '1';")) {
  const fieldsStart = index.indexOf('const USER_COMMAND_FIELDS = [');
  const fieldsEnd = index.indexOf('function commandPanelEmbed(guild, type) {', fieldsStart);
  if (fieldsStart < 0 || fieldsEnd < 0) fail('Commandlisten-Block in index.js nicht gefunden.');

  const commandFields = `const TURBO_SHOP_MODE = process.env.TURBO_SHOP_MODE === '1';

const USER_COMMAND_FIELDS = TURBO_SHOP_MODE ? [
  { name: '🛒 Shop & Kundenmenü', value: '\`/help\` zeigt die Shop-Hilfe. **Shop, Warenkorb, eigene Käufe und Lizenzen** laufen über die Buttons im Kundenmenü.' },
  { name: '🎫 Support & Anfragen', value: '**Support, Geschenkbestellung, Partnerschaft, Refund und Leak-Meldung** werden direkt über das Kundenmenü geöffnet. Dafür brauchst du keine weiteren Slash-Commands.' },
] : [
  { name: 'ℹ️ Allgemein', value: '\`/help\` \`/ping\` \`/serverinfo\` \`/userinfo\` \`/avatar\` \`/regelwerk anzeigen\`' },
  { name: '💰 Aktivität', value: '\`/daily\` \`/coins balance\` \`/coins leaderboard\` \`/missions view\` \`/missions claim\` \`/season\` \`/seasonleaderboard\` \`/shop list\` \`/shop buy\`' },
  { name: '🏆 Level & Community', value: '\`/rank\` \`/leaderboard\` \`/invites\` \`/inviteleaderboard\` \`/rep\` \`/reps\` \`/communityrank\` \`/communityleaderboard\` \`/badges\`' },
  { name: '🎮 Gemeinsam', value: '\`/event list\` \`/clip submit\` \`/clip top\` \`/mitspieler create\` \`/mitspieler list\` \`/challenge list\` \`/game\`' },
  { name: '👤 Profil & Socials', value: '\`/profil\` \`/profilset\` \`/interessen\` \`/mysocials\` \`/socialinfo\` \`/sociallist\`' },
  { name: '💬 Community', value: '\`/suggest\` \`/anonymouspanel\` \`/anonymousinfo\`' },
];

const TEAM_COMMAND_FIELDS = TURBO_SHOP_MODE ? [
  { name: '📦 Bestellungen', value: '\`/sell dashboard\` \`/sell order\` \`/sell queue\` \`/sell deliver\` \`/sell receipt\` \`/sell watermark\`' },
  { name: '👤 Kunden & Lizenzen', value: '\`/sell search\` \`/sell profile\` \`/sell license\` \`/sell loyalty\`' },
  { name: '🛒 Shop-Verwaltung', value: '\`/sell product\` \`/sell portfolio\` \`/sell update\` \`/sell availability\` \`/sell coupon\` \`/sell blacklist\`' },
  { name: '🤖 Automation & Sicherheit', value: '\`/sell automation\` \`/sell wizard\` \`/sell panel\` \`/sell audit\` \`/sell diagnose\` \`/sell verify\` \`/sell antinuke\`' },
  { name: '💳 Zahlung', value: '\`/sell paypal\` setzt/zeigt die PayPal-Adresse. \`/paypal\` sendet die Zahlungsdaten im Bestell- oder Support-Ticket.' },
  { name: '🧰 Erweiterte Tools', value: '\`/sell tools offer\` \`priority\` \`calendar\` \`staffstats\` \`teamlist\` \`productstats\` \`finance\` \`voucher\` \`release\` \`refund\` \`partner\` \`testmode\` \`export\` \`import\` \`note\` \`extra\` \`pricing\` \`workload\` \`weeklyreport\` \`summary\`' },
  { name: '⚙️ Setup & Listen', value: '\`/setup server selling\` \`/command user\` \`/command team\` \`/help\`' },
] : [
  { name: '👑 Owner / Setup', value: '\`/setupserver\` \`/backupserver\` \`/restoreserver\` \`/dashboard\` \`/servercheck\` \`/permissionscan\` \`/modules\` \`/autobackup\` \`/botstatus\`' },
  { name: '🛡️ Sicherheit', value: '\`/antinuke\` \`/selfheal\` \`/automod\` \`/case\` \`/warn\` \`/warnings\` \`/clearwarnings\` \`/timeout\` \`/untimeout\` \`/kick\` \`/ban\` \`/unban\` \`/unbanall\`' },
  { name: '🎫 Support', value: '\`/ticketpanel\` \`/ticket\` \`/ticketsla\` \`/applicationpanel\` \`/applicationlist\` \`/staffstats\`' },
  { name: '📢 Verwaltung', value: '\`/announce\` \`/embed\` \`/poll\` \`/giveaway\` \`/purge\` \`/clear\` \`/slowmode\` \`/lock\` \`/unlock\` \`/rolepanel\`' },
  { name: '⚙️ Bot-Systeme', value: '\`/setup\` \`/verificationpanel\` \`/tempvoice\` \`/voice\` \`/levelrole\` \`/levelsystem\` \`/duty\` \`/dutystats\` \`/dutyleaderboard\` \`/customcommand\`' },
  { name: '📊 Community-Systeme', value: '\`/engagement\` \`/frage\` \`/communitypoll\` \`/memberofthemonth\` \`/clip\` \`/challenge\` \`/analytics\` \`/weeklyreport\`' },
  { name: '📚 Permanente Listen', value: '\`/command user\` erstellt/aktualisiert die User-Liste. \`/command team\` erstellt/aktualisiert die Team-Liste.' },
];

`;
  index = index.slice(0, fieldsStart) + commandFields + index.slice(fieldsEnd);
  shopChanges++;
}

// Panel-Block nur ersetzen, wenn er noch die alte Community-Variante ist.
if (!index.includes('🛠️ TURBO DESIGNS • TEAM COMMANDS')) {
  const panelStart = index.indexOf('function commandPanelEmbed(guild, type) {');
  const panelEnd = index.indexOf('\nasync function publishCommandPanel(', panelStart);
  if (panelStart < 0 || panelEnd < 0) fail('commandPanelEmbed-Block nicht gefunden.');
  const panelBlock = `function commandPanelEmbed(guild, type) {
  const team = type === 'team';
  return new EmbedBuilder()
    .setColor(team ? 0xe67e22 : 0x5865f2)
    .setTitle(TURBO_SHOP_MODE
      ? (team ? '🛠️ TURBO DESIGNS • TEAM COMMANDS' : '🛒 TURBO DESIGNS • USER COMMANDS')
      : (team ? '🛠️ TEAM COMMANDS' : '📚 USER COMMANDS'))
    .setDescription(TURBO_SHOP_MODE
      ? (team
        ? 'Nur die Befehle für den **Turbo Designs Shop**, Support, Bestellungen und Management.'
        : 'Nur die Funktionen, die Kunden im **Turbo Designs Shop** wirklich brauchen.')
      : (team
        ? 'Permanente Übersicht der wichtigsten Team-, Support- und Management-Befehle.'
        : 'Permanente Übersicht der Commands, die Community-Mitglieder regelmäßig brauchen.'))
    .addFields(...(team ? TEAM_COMMAND_FIELDS : USER_COMMAND_FIELDS))
    .setFooter({ text: \`\${guild.name} • wird nach Bot-Updates automatisch aktualisiert\` })
    .setTimestamp();
}
`;
  index = index.slice(0, panelStart) + panelBlock + index.slice(panelEnd);
  shopChanges++;
}

if (!index.includes('🛒 Turbo Designs • Shop Hilfe')) {
  const helpStart = index.indexOf("    if (command === 'help') {");
  const helpEnd = index.indexOf("    if (command === 'ping') {", helpStart);
  if (helpStart < 0 || helpEnd < 0) fail('/help-Block in index.js nicht gefunden.');
  const helpBlock = `    if (command === 'help') {
      const embed = new EmbedBuilder()
        .setColor(TURBO_SHOP_MODE ? 0x8b5cf6 : 0x111111)
        .setTitle(TURBO_SHOP_MODE ? '🛒 Turbo Designs • Shop Hilfe' : '🤖 Community Bot • Hilfe')
        .setDescription(TURBO_SHOP_MODE
          ? 'Nur die Funktionen für den **Turbo Designs Shop**. Kunden nutzen hauptsächlich die Buttons im Kundenmenü; \`/sell\` und \`/paypal\` sind für das Shop-Team.'
          : 'Die wichtigsten Funktionen des Bots:')
        .addFields(...(TURBO_SHOP_MODE ? [
          { name: '👤 Kunden', value: '\`/help\` zeigt diese Übersicht. Shop, Warenkorb, Käufe, Lizenzen, Support, Geschenkbestellungen, Partnerschaften, Refunds und Leak-Meldungen laufen über das **Kundenmenü**.' },
          { name: '📦 Bestellungen', value: '\`/sell dashboard\` \`/sell order\` \`/sell queue\` \`/sell deliver\` \`/sell receipt\` \`/sell watermark\`' },
          { name: '🛒 Shop & Kunden', value: '\`/sell product\` \`/sell portfolio\` \`/sell update\` \`/sell availability\` \`/sell coupon\` \`/sell blacklist\` \`/sell search\` \`/sell profile\` \`/sell license\` \`/sell loyalty\`' },
          { name: '🤖 Automation & Sicherheit', value: '\`/sell automation\` \`/sell wizard\` \`/sell panel\` \`/sell audit\` \`/sell diagnose\` \`/sell verify\` \`/sell antinuke\`' },
          { name: '💳 Zahlung', value: '\`/sell paypal\` verwaltet die PayPal-Adresse. \`/paypal\` sendet die Zahlungsdaten im privaten Bestell- oder Support-Ticket.' },
          { name: '🧰 Erweiterte Tools', value: 'Unter \`/sell tools\`: \`offer\`, \`priority\`, \`calendar\`, \`staffstats\`, \`teamlist\`, \`productstats\`, \`finance\`, \`voucher\`, \`release\`, \`refund\`, \`partner\`, \`testmode\`, \`export\`, \`import\`, \`note\`, \`extra\`, \`pricing\`, \`workload\`, \`weeklyreport\`, \`summary\`.' },
          { name: '⚙️ Setup & Commandlisten', value: '\`/setup server selling\` \`/command user\` \`/command team\`' },
        ] : [
          { name: '🌐 Socials', value: '\`/socials\` \`/editsocials\` \`/removesocial\` \`/deletesocials\` \`/socialinfo\` \`/sociallist\` \`/mysocials\` \`/refreshsocials\`' },
          { name: '🎫 Tickets & Verify', value: '\`/ticketpanel\` \`/ticket\` \`/verificationpanel\`' },
          { name: '🛡️ Moderation', value: '\`/warn\` \`/warnings\` \`/clearwarnings\` \`/timeout\` \`/untimeout\` \`/kick\` \`/ban\` \`/unban\` \`/unbanall\` \`/clear\` \`/purge\` \`/slowmode\` \`/lock\` \`/unlock\`' },
          { name: '📣 Community', value: '\`/regelwerk\` \`/announce\` \`/embed\` \`/poll\` \`/suggest\` \`/giveaway\`' },
          { name: 'ℹ️ Info', value: '\`/serverinfo\` \`/userinfo\` \`/avatar\` \`/ping\`' },
          { name: '📨 Bewerbungen & Rollen', value: '\`/applicationpanel\` \`/applicationlist\` \`/rolepanel\`' },
          { name: '🛡️ Schutz & Voice', value: '\`/automod\` \`/antinuke\` \`/selfheal\` \`/servercheck\` \`/permissionscan\` \`/tempvoice\` \`/voice\`' },
          { name: '🏆 Level & Invites', value: '\`/rank\` \`/leaderboard\` \`/levelrole\` \`/levelsystem\` \`/invites\` \`/inviteleaderboard\`' },
          { name: '📅 Events & Team', value: '\`/event\` \`/duty\` \`/dutystats\` \`/dutyleaderboard\`' },
          { name: '💬 Community-Aktivität', value: '\`/frage\` \`/communitypoll\` \`/memberofthemonth\` \`/rep\` \`/reps\` \`/communityrank\` \`/communityleaderboard\`' },
          { name: '⚡ Coins & Aktivität', value: '\`/daily\` \`/coins\` \`/missions\` \`/shop\` \`/season\` \`/seasonleaderboard\` \`/engagement\`' },
          { name: '🎮 Gemeinsam', value: '\`/clip\` \`/mitspieler\` \`/challenge\` \`/game\` \`/badges\`' },
          { name: '👤 Profile & Willkommen', value: '\`/profil\` \`/profilset\` \`/interessen\` \`/anonymouspanel\` \`/anonymousinfo\`' },
          { name: '🧩 Eigene Commands', value: '\`/customcommand\` oder gespeicherte Befehle mit \`!name\`' },
          { name: '⚙️ Einrichtung', value: '\`/dashboard\` \`/setupserver\` \`/backupserver\` \`/restoreserver\` \`/setup channel\` \`/setup role\` \`/setup tickets\` \`/setup show\` \`/command user\` \`/command team\`' },
          { name: '🧰 Management Pro', value: '\`/analytics\` \`/weeklyreport\` \`/staffstats\` \`/modules\` \`/ticketsla\` \`/botstatus\` \`/autobackup\`' },
        ]));
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

`;
  index = index.slice(0, helpStart) + helpBlock + index.slice(helpEnd);
  shopChanges++;
}

// ============================================================
// B) BUG FIX AUS AKTUELLEM PUSH bdfd488 (direkt anwenden)
// ============================================================

function applySellingReplace(oldText, newText, label, alreadyMarker) {
  if (alreadyMarker && selling.includes(alreadyMarker)) return;
  const result = replaceOnceIn(selling, oldText, newText, label);
  if (result.changed) {
    selling = result.text;
    bugChanges++;
    console.log(`✅ ${label}`);
    return;
  }
  if (!alreadyMarker || !selling.includes(alreadyMarker)) {
    throw new Error(`Bugfix "${label}" konnte nicht angewendet werden: Stelle nicht gefunden.`);
  }
}

function editSellingSection(startMarker, endMarker, editFn) {
  const start = selling.indexOf(startMarker);
  if (start === -1) throw new Error(`Abschnitt nicht gefunden: ${startMarker}`);
  const end = selling.indexOf(endMarker, start + startMarker.length);
  if (end === -1) throw new Error(`Abschnittsende nicht gefunden: ${endMarker}`);
  const before = selling.slice(0, start);
  let section = selling.slice(start, end);
  const after = selling.slice(end);
  section = editFn(section);
  selling = before + section + after;
}

function sectionReplace(section, oldText, newText, label, alreadyMarker) {
  if (alreadyMarker && section.includes(alreadyMarker)) return section;
  const result = replaceOnceIn(section, oldText, newText, label);
  if (!result.changed) throw new Error(`Bugfix "${label}" konnte nicht angewendet werden: Stelle nicht gefunden.`);
  bugChanges++;
  console.log(`✅ ${label}`);
  return result.text;
}

// Angebot-Button nach Zahlung/Abschluss deaktivieren.
applySellingReplace(
  "new ButtonBuilder().setCustomId(`selling_offer_start:${id}`).setLabel('Angebot').setEmoji('🧾').setStyle(ButtonStyle.Secondary),",
  "new ButtonBuilder().setCustomId(`selling_offer_start:${id}`).setLabel('Angebot').setEmoji('🧾').setStyle(ButtonStyle.Secondary).setDisabled(Boolean(order.paidAt || order.closedAt)),",
  'Angebot-Button nach Zahlung deaktivieren',
  ".setDisabled(Boolean(order.paidAt || order.closedAt))"
);

// Warenkorb-Checkout: Interaction rechtzeitig bestätigen.
editSellingSection('async function createCartOrderFromModal(interaction) {', '\nasync function showOrderModal', section => {
  section = sectionReplace(
    section,
    "  if (!consumeSellingRateLimit(`order-create:${interaction.guildId}:${interaction.user.id}`, 2, 5 * 60 * 1000)) {\n    await interaction.reply({ content: '⏳ Zu viele Bestellversuche in kurzer Zeit. Bitte warte einige Minuten.', ephemeral: true });\n    return;\n  }\n  const loyalty = loyaltyForUser(data, interaction.user.id);",
    "  if (!consumeSellingRateLimit(`order-create:${interaction.guildId}:${interaction.user.id}`, 2, 5 * 60 * 1000)) {\n    await interaction.reply({ content: '⏳ Zu viele Bestellversuche in kurzer Zeit. Bitte warte einige Minuten.', ephemeral: true });\n    return;\n  }\n  await interaction.deferReply({ ephemeral: true });\n  const loyalty = loyaltyForUser(data, interaction.user.id);",
    'Warenkorb deferReply',
    'await interaction.deferReply({ ephemeral: true });'
  );
  section = sectionReplace(
    section,
    "    await interaction.reply({ content: '❌ Die Kauf-Ticket-Kategorie fehlt. Führe `/setup server selling` erneut aus.', ephemeral: true });",
    "    await interaction.editReply({ content: '❌ Die Kauf-Ticket-Kategorie fehlt. Führe `/setup server selling` erneut aus.' });",
    'Warenkorb Kategorie-Fehler',
    "await interaction.editReply({ content: '❌ Die Kauf-Ticket-Kategorie fehlt."
  );
  section = sectionReplace(
    section,
    "  await interaction.reply({ content: `✅ Warenkorb-Bestellung **${orderId}** erstellt: <#${channel.id}>${q.position ? `\\nQueue-Position: **#${q.position} von ${q.total}**` : ''}`, ephemeral: true });",
    "  await interaction.editReply({ content: `✅ Warenkorb-Bestellung **${orderId}** erstellt: <#${channel.id}>${q.position ? `\\nQueue-Position: **#${q.position} von ${q.total}**` : ''}` });",
    'Warenkorb Abschlussantwort',
    'await interaction.editReply({ content: `✅ Warenkorb-Bestellung'
  );
  return section;
});

// Einzelbestellung: gleicher Timeout-Schutz.
editSellingSection('async function createOrderFromModal(interaction, productKey) {', '\nasync function openSupportTicket', section => {
  section = sectionReplace(
    section,
    "  if (!consumeSellingRateLimit(`order-create:${interaction.guildId}:${interaction.user.id}`, 2, 5 * 60 * 1000)) {\n    await interaction.reply({ content: '⏳ Zu viele Bestellversuche in kurzer Zeit. Bitte warte einige Minuten.', ephemeral: true });\n    return;\n  }\n\n  const loyalty = loyaltyForUser(data, interaction.user.id);",
    "  if (!consumeSellingRateLimit(`order-create:${interaction.guildId}:${interaction.user.id}`, 2, 5 * 60 * 1000)) {\n    await interaction.reply({ content: '⏳ Zu viele Bestellversuche in kurzer Zeit. Bitte warte einige Minuten.', ephemeral: true });\n    return;\n  }\n\n  await interaction.deferReply({ ephemeral: true });\n  const loyalty = loyaltyForUser(data, interaction.user.id);",
    'Einzelbestellung deferReply',
    'await interaction.deferReply({ ephemeral: true });'
  );
  section = sectionReplace(
    section,
    "    await interaction.reply({ content: '❌ Die Kauf-Ticket-Kategorie fehlt. Führe `/setup server selling` erneut aus.', ephemeral: true });",
    "    await interaction.editReply({ content: '❌ Die Kauf-Ticket-Kategorie fehlt. Führe `/setup server selling` erneut aus.' });",
    'Einzelbestellung Kategorie-Fehler',
    "await interaction.editReply({ content: '❌ Die Kauf-Ticket-Kategorie fehlt."
  );
  section = sectionReplace(
    section,
    "  await interaction.reply({\n    content: `✅ Bestellung **${orderId}** wurde erstellt: <#${channel.id}>\\nDas Team bestätigt dort Preis, Lieferumfang und PayPal-Zahlung.${queue.position ? `\\nQueue-Position: **#${queue.position} von ${queue.total}**` : ''}`,\n    ephemeral: true,\n  });",
    "  await interaction.editReply({\n    content: `✅ Bestellung **${orderId}** wurde erstellt: <#${channel.id}>\\nDas Team bestätigt dort Preis, Lieferumfang und PayPal-Zahlung.${queue.position ? `\\nQueue-Position: **#${queue.position} von ${queue.total}**` : ''}`,\n  });",
    'Einzelbestellung Abschlussantwort',
    'await interaction.editReply({\n    content: `✅ Bestellung'
  );
  return section;
});

// Angebot nach Zahlung/Abschluss nicht mehr öffnen.
editSellingSection('async function openOfferModal(interaction, orderId) {', '\nasync function submitOfferModal', section => {
  section = sectionReplace(
    section,
    "  if (!isOrderTicketContext(interaction, order)) return interaction.reply({ content: '❌ Öffne das Angebot im zugehörigen Bestell-Ticket.', ephemeral: true });\n  const modal = new ModalBuilder()",
    "  if (!isOrderTicketContext(interaction, order)) return interaction.reply({ content: '❌ Öffne das Angebot im zugehörigen Bestell-Ticket.', ephemeral: true });\n  if (order.paidAt) return interaction.reply({ content: 'ℹ️ Die Zahlung ist bereits bestätigt. Für diese Bestellung kann kein neues Angebot mehr erstellt werden.', ephemeral: true });\n  if (order.closedAt || order.acceptedAt) return interaction.reply({ content: 'ℹ️ Diese Bestellung ist bereits abgeschlossen.', ephemeral: true });\n  const modal = new ModalBuilder()",
    'Angebot-Modal Statusprüfung',
    'Die Zahlung ist bereits bestätigt. Für diese Bestellung kann kein neues Angebot mehr erstellt werden.'
  );
  return section;
});

// Bereits offenes Angebotsformular sauber abfangen und Submit früh bestätigen.
editSellingSection('async function submitOfferModal(interaction, orderId) {', '\nasync function cycleOrderPriority', section => {
  section = sectionReplace(
    section,
    "  const order = data.orders?.[orderId];\n  if (!order || !canHandleOrder(interaction.member, order)) return interaction.reply({ content: '❌ Keine Berechtigung.', ephemeral: true });\n  const price = Number(String(interaction.fields.getTextInputValue('price')).replace(',', '.'));",
    "  const order = data.orders?.[orderId];\n  if (!order || !canHandleOrder(interaction.member, order)) return interaction.reply({ content: '❌ Keine Berechtigung.', ephemeral: true });\n  if (order.paidAt) return interaction.reply({ content: 'ℹ️ Die Zahlung ist bereits bestätigt. Für diese Bestellung kann kein neues Angebot mehr erstellt werden.', ephemeral: true });\n  if (order.closedAt || order.acceptedAt) return interaction.reply({ content: 'ℹ️ Diese Bestellung ist bereits abgeschlossen.', ephemeral: true });\n  const price = Number(String(interaction.fields.getTextInputValue('price')).replace(',', '.'));",
    'Angebot-Submit Statusprüfung',
    "if (order.paidAt) return interaction.reply({ content: 'ℹ️ Die Zahlung ist bereits bestätigt."
  );
  section = sectionReplace(
    section,
    "  if (!Number.isFinite(price) || price < 0 || !Number.isFinite(days) || days < 1) return interaction.reply({ content: '❌ Preis oder Lieferzeit ungültig.', ephemeral: true });\n  const offer = await createOfferForOrder(interaction.guild, data, order, { price, days, scope, by: interaction.user.id });\n  saveSellingStore(store);\n  await interaction.reply({ content: `✅ Angebot **${offer.id}** wurde im Ticket gepostet.`, ephemeral: true });",
    "  if (!Number.isFinite(price) || price < 0 || !Number.isFinite(days) || days < 1) return interaction.reply({ content: '❌ Preis oder Lieferzeit ungültig.', ephemeral: true });\n  await interaction.deferReply({ ephemeral: true });\n  const offer = await createOfferForOrder(interaction.guild, data, order, { price, days, scope, by: interaction.user.id });\n  saveSellingStore(store);\n  await interaction.editReply({ content: `✅ Angebot **${offer.id}** wurde im Ticket gepostet.` });",
    'Angebot-Submit deferReply',
    'await interaction.editReply({ content: `✅ Angebot **${offer.id}** wurde im Ticket gepostet.` });'
  );
  return section;
});

fs.writeFileSync(indexPath, index, 'utf8');
fs.writeFileSync(sellingPath, selling, 'utf8');

console.log('');
console.log('✅ MERGE FERTIG');
console.log(`✅ Shop-/Commandlisten-Änderungen: ${shopChanges}`);
console.log(`✅ Bugfix-Änderungen aus Commit bdfd488: ${bugChanges}`);
console.log('✅ index.js und selling-entry.js wurden direkt aktualisiert.');
console.log('ℹ️ Backups: index.js.bak-merged-update und selling-entry.js.bak-merged-update');
