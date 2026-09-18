const fs = require('fs');
const path = require('path');

const inputPath = path.resolve(process.argv[2] || 'selling-entry.js');
const outputPath = path.resolve(process.argv[3] || 'selling-entry-fixed.js');

if (!fs.existsSync(inputPath)) {
  console.error(`❌ Datei nicht gefunden: ${inputPath}`);
  console.error('Lege FIX_SELLING_BUG.js in denselben Ordner wie selling-entry.js und starte:');
  console.error('node FIX_SELLING_BUG.js');
  process.exit(1);
}

let content = fs.readFileSync(inputPath, 'utf8');
let changes = 0;

function replaceOnce(oldText, newText, label) {
  const first = content.indexOf(oldText);
  if (first === -1) {
    throw new Error(`Fix "${label}" konnte nicht angewendet werden: Stelle nicht gefunden.`);
  }
  const second = content.indexOf(oldText, first + oldText.length);
  if (second !== -1) {
    throw new Error(`Fix "${label}" ist nicht eindeutig. Datei wurde nicht geschrieben.`);
  }
  content = content.slice(0, first) + newText + content.slice(first + oldText.length);
  changes++;
  console.log(`✅ ${label}`);
}

function editSection(startMarker, endMarker, editFn) {
  const start = content.indexOf(startMarker);
  if (start === -1) throw new Error(`Abschnitt nicht gefunden: ${startMarker}`);
  const end = content.indexOf(endMarker, start + startMarker.length);
  if (end === -1) throw new Error(`Abschnittsende nicht gefunden: ${endMarker}`);

  const before = content.slice(0, start);
  let section = content.slice(start, end);
  const after = content.slice(end);

  const oldGlobal = content;
  content = section;
  editFn();
  section = content;
  content = before + section + after;

  if (content === oldGlobal) {
    throw new Error(`Im Abschnitt ${startMarker} wurde nichts geändert.`);
  }
}

try {
  // 1) Angebot-Button nach Zahlung/Abschluss deaktivieren
  replaceOnce(
    "new ButtonBuilder().setCustomId(`selling_offer_start:${id}`).setLabel('Angebot').setEmoji('🧾').setStyle(ButtonStyle.Secondary),",
    "new ButtonBuilder().setCustomId(`selling_offer_start:${id}`).setLabel('Angebot').setEmoji('🧾').setStyle(ButtonStyle.Secondary).setDisabled(Boolean(order.paidAt || order.closedAt)),",
    'Angebot-Button nach Zahlung deaktivieren'
  );

  // 2) Warenkorb-Checkout: Interaction sofort bestätigen
  editSection(
    'async function createCartOrderFromModal(interaction) {',
    '\nasync function showOrderModal',
    () => {
      replaceOnce(
        "  if (!consumeSellingRateLimit(`order-create:${interaction.guildId}:${interaction.user.id}`, 2, 5 * 60 * 1000)) {\n    await interaction.reply({ content: '⏳ Zu viele Bestellversuche in kurzer Zeit. Bitte warte einige Minuten.', ephemeral: true });\n    return;\n  }\n  const loyalty = loyaltyForUser(data, interaction.user.id);",
        "  if (!consumeSellingRateLimit(`order-create:${interaction.guildId}:${interaction.user.id}`, 2, 5 * 60 * 1000)) {\n    await interaction.reply({ content: '⏳ Zu viele Bestellversuche in kurzer Zeit. Bitte warte einige Minuten.', ephemeral: true });\n    return;\n  }\n  await interaction.deferReply({ ephemeral: true });\n  const loyalty = loyaltyForUser(data, interaction.user.id);",
        'Warenkorb deferReply'
      );

      replaceOnce(
        "    await interaction.reply({ content: '❌ Die Kauf-Ticket-Kategorie fehlt. Führe `/setup server selling` erneut aus.', ephemeral: true });",
        "    await interaction.editReply({ content: '❌ Die Kauf-Ticket-Kategorie fehlt. Führe `/setup server selling` erneut aus.' });",
        'Warenkorb Kategorie-Fehler'
      );

      replaceOnce(
        "  await interaction.reply({ content: `✅ Warenkorb-Bestellung **${orderId}** erstellt: <#${channel.id}>${q.position ? `\\nQueue-Position: **#${q.position} von ${q.total}**` : ''}`, ephemeral: true });",
        "  await interaction.editReply({ content: `✅ Warenkorb-Bestellung **${orderId}** erstellt: <#${channel.id}>${q.position ? `\\nQueue-Position: **#${q.position} von ${q.total}**` : ''}` });",
        'Warenkorb Abschlussantwort'
      );
    }
  );

  // 3) Einzelbestellung: gleicher Interaction-Timeout-Fix
  editSection(
    'async function createOrderFromModal(interaction, productKey) {',
    '\nasync function openSupportTicket',
    () => {
      replaceOnce(
        "  if (!consumeSellingRateLimit(`order-create:${interaction.guildId}:${interaction.user.id}`, 2, 5 * 60 * 1000)) {\n    await interaction.reply({ content: '⏳ Zu viele Bestellversuche in kurzer Zeit. Bitte warte einige Minuten.', ephemeral: true });\n    return;\n  }\n\n  const loyalty = loyaltyForUser(data, interaction.user.id);",
        "  if (!consumeSellingRateLimit(`order-create:${interaction.guildId}:${interaction.user.id}`, 2, 5 * 60 * 1000)) {\n    await interaction.reply({ content: '⏳ Zu viele Bestellversuche in kurzer Zeit. Bitte warte einige Minuten.', ephemeral: true });\n    return;\n  }\n\n  await interaction.deferReply({ ephemeral: true });\n  const loyalty = loyaltyForUser(data, interaction.user.id);",
        'Einzelbestellung deferReply'
      );

      replaceOnce(
        "    await interaction.reply({ content: '❌ Die Kauf-Ticket-Kategorie fehlt. Führe `/setup server selling` erneut aus.', ephemeral: true });",
        "    await interaction.editReply({ content: '❌ Die Kauf-Ticket-Kategorie fehlt. Führe `/setup server selling` erneut aus.' });",
        'Einzelbestellung Kategorie-Fehler'
      );

      replaceOnce(
        "  await interaction.reply({\n    content: `✅ Bestellung **${orderId}** wurde erstellt: <#${channel.id}>\\nDas Team bestätigt dort Preis, Lieferumfang und PayPal-Zahlung.${queue.position ? `\\nQueue-Position: **#${queue.position} von ${queue.total}**` : ''}`,\n    ephemeral: true,\n  });",
        "  await interaction.editReply({\n    content: `✅ Bestellung **${orderId}** wurde erstellt: <#${channel.id}>\\nDas Team bestätigt dort Preis, Lieferumfang und PayPal-Zahlung.${queue.position ? `\\nQueue-Position: **#${queue.position} von ${queue.total}**` : ''}`,\n  });",
        'Einzelbestellung Abschlussantwort'
      );
    }
  );

  // 4) Angebot gar nicht erst öffnen, wenn bereits bezahlt/abgeschlossen
  editSection(
    'async function openOfferModal(interaction, orderId) {',
    '\nasync function submitOfferModal',
    () => {
      replaceOnce(
        "  if (!isOrderTicketContext(interaction, order)) return interaction.reply({ content: '❌ Öffne das Angebot im zugehörigen Bestell-Ticket.', ephemeral: true });\n  const modal = new ModalBuilder()",
        "  if (!isOrderTicketContext(interaction, order)) return interaction.reply({ content: '❌ Öffne das Angebot im zugehörigen Bestell-Ticket.', ephemeral: true });\n  if (order.paidAt) return interaction.reply({ content: 'ℹ️ Die Zahlung ist bereits bestätigt. Für diese Bestellung kann kein neues Angebot mehr erstellt werden.', ephemeral: true });\n  if (order.closedAt || order.acceptedAt) return interaction.reply({ content: 'ℹ️ Diese Bestellung ist bereits abgeschlossen.', ephemeral: true });\n  const modal = new ModalBuilder()",
        'Angebot-Modal Statusprüfung'
      );
    }
  );

  // 5) Bereits offenes Modal nach Zahlung sauber abfangen + Timeout vermeiden
  editSection(
    'async function submitOfferModal(interaction, orderId) {',
    '\nasync function cycleOrderPriority',
    () => {
      replaceOnce(
        "  const order = data.orders?.[orderId];\n  if (!order || !canHandleOrder(interaction.member, order)) return interaction.reply({ content: '❌ Keine Berechtigung.', ephemeral: true });\n  const price = Number(String(interaction.fields.getTextInputValue('price')).replace(',', '.'));",
        "  const order = data.orders?.[orderId];\n  if (!order || !canHandleOrder(interaction.member, order)) return interaction.reply({ content: '❌ Keine Berechtigung.', ephemeral: true });\n  if (order.paidAt) return interaction.reply({ content: 'ℹ️ Die Zahlung ist bereits bestätigt. Für diese Bestellung kann kein neues Angebot mehr erstellt werden.', ephemeral: true });\n  if (order.closedAt || order.acceptedAt) return interaction.reply({ content: 'ℹ️ Diese Bestellung ist bereits abgeschlossen.', ephemeral: true });\n  const price = Number(String(interaction.fields.getTextInputValue('price')).replace(',', '.'));",
        'Angebot-Submit Statusprüfung'
      );

      replaceOnce(
        "  if (!Number.isFinite(price) || price < 0 || !Number.isFinite(days) || days < 1) return interaction.reply({ content: '❌ Preis oder Lieferzeit ungültig.', ephemeral: true });\n  const offer = await createOfferForOrder(interaction.guild, data, order, { price, days, scope, by: interaction.user.id });\n  saveSellingStore(store);\n  await interaction.reply({ content: `✅ Angebot **${offer.id}** wurde im Ticket gepostet.`, ephemeral: true });",
        "  if (!Number.isFinite(price) || price < 0 || !Number.isFinite(days) || days < 1) return interaction.reply({ content: '❌ Preis oder Lieferzeit ungültig.', ephemeral: true });\n  await interaction.deferReply({ ephemeral: true });\n  const offer = await createOfferForOrder(interaction.guild, data, order, { price, days, scope, by: interaction.user.id });\n  saveSellingStore(store);\n  await interaction.editReply({ content: `✅ Angebot **${offer.id}** wurde im Ticket gepostet.` });",
        'Angebot-Submit deferReply'
      );
    }
  );

  fs.writeFileSync(outputPath, content, 'utf8');
  console.log('');
  console.log(`✅ Fertig: ${outputPath}`);
  console.log(`✅ ${changes} Änderungen angewendet.`);
  console.log('Die Originaldatei wurde NICHT überschrieben.');
} catch (err) {
  console.error('');
  console.error(`❌ ${err.message}`);
  console.error('Es wurde keine Ausgabedatei geschrieben.');
  process.exit(1);
}
