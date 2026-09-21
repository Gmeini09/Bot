'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const sourcePath = path.join(__dirname, 'selling-entry.js');
let source = fs.readFileSync(sourcePath, 'utf8');

function sectionBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  if (start === -1) throw new Error(`Turbo runtime patch: start marker not found: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  if (end === -1) throw new Error(`Turbo runtime patch: end marker not found: ${endMarker}`);
  return { start, end, text: source.slice(start, end) };
}

function replaceSection(startMarker, endMarker, transform) {
  const { start, end, text } = sectionBetween(startMarker, endMarker);
  const next = transform(text);
  source = source.slice(0, start) + next + source.slice(end);
}

/*
 * FIX 1
 * Discord modal submits expire quickly. The original cart checkout performed
 * channel creation and other work before acknowledging the interaction.
 * Acknowledge it immediately, then use editReply for the final result.
 */
replaceSection(
  'async function createCartOrderFromModal(interaction) {',
  '\nasync function showOrderModal(interaction, productKey) {',
  section => {
    section = section.replace(/interaction\.reply\(/g, 'replyCart(');

    const fnStart = 'async function createCartOrderFromModal(interaction) {\n';
    const helper = `async function createCartOrderFromModal(interaction) {
  const replyCart = async payload => {
    if (interaction.deferred) {
      if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        const clean = { ...payload };
        delete clean.ephemeral;
        return interaction.editReply(clean);
      }
      return interaction.editReply(payload);
    }
    if (interaction.replied) {
      return interaction.followUp(payload);
    }
    return interaction.reply(payload);
  };
`;
    if (!section.startsWith(fnStart)) throw new Error('Turbo runtime patch: cart function signature changed');
    section = helper + section.slice(fnStart.length);

    const tryMarker = '  try {\n  if (!interaction.inGuild()) return;';
    const deferBlock = `  try {
  if (!interaction.inGuild()) return;
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ ephemeral: true });
  }`;
    if (!section.includes(tryMarker)) throw new Error('Turbo runtime patch: cart try marker changed');
    section = section.replace(tryMarker, deferBlock);

    return section;
  }
);

/*
 * FIX 2
 * Review modal submit can also do network work before replying.
 * Defer immediately, then edit the deferred response.
 */
replaceSection(
  'async function submitReview(interaction, orderId) {',
  '\nasync function handleFaqButton(interaction, key) {',
  section => {
    section = section.replace(/interaction\.reply\(/g, 'replyReview(');

    const fnStart = 'async function submitReview(interaction, orderId) {\n';
    const helper = `async function submitReview(interaction, orderId) {
  const replyReview = async payload => {
    if (interaction.deferred) {
      if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        const clean = { ...payload };
        delete clean.ephemeral;
        return interaction.editReply(clean);
      }
      return interaction.editReply(payload);
    }
    if (interaction.replied) {
      return interaction.followUp(payload);
    }
    return interaction.reply(payload);
  };

  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ ephemeral: true });
  }
`;
    if (!section.startsWith(fnStart)) throw new Error('Turbo runtime patch: review function signature changed');
    section = helper + section.slice(fnStart.length);

    // After a successful review, refresh visible delivery buttons so the
    // "Bewertung abgeben" button becomes disabled immediately.
    const savedMarker = `  order.reviewSubmitted = true;
  saveSellingStore(store);`;
    const refreshBlock = `  order.reviewSubmitted = true;
  saveSellingStore(store);

  const deliveryForReview = order.deliveryChannelId
    ? await interaction.guild.channels.fetch(order.deliveryChannelId).catch(() => null)
    : null;
  if (deliveryForReview?.isTextBased()) {
    const recent = await deliveryForReview.messages.fetch({ limit: 35 }).catch(() => null);
    if (recent) {
      for (const msg of recent.values()) {
        if (msg.author?.id !== interaction.guild.members.me?.id) continue;
        const hasOrderControls = msg.components?.some(row =>
          row.components?.some(component =>
            component.customId === \`selling_review_open:\${orderId}\`
            || component.customId === \`selling_accept:\${orderId}\`
            || component.customId === \`selling_accept_review:\${orderId}\`
          )
        );
        if (hasOrderControls) {
          await msg.edit({ components: customerDeliveryRows(order, true) }).catch(() => {});
        }
      }
    }
  }`;
    if (!section.includes(savedMarker)) throw new Error('Turbo runtime patch: review save marker changed');
    section = section.replace(savedMarker, refreshBlock);

    return section;
  }
);

/*
 * FIX 3
 * Give the customer a one-click "Akzeptieren & bewerten" path directly in the
 * delivery area. Normal "Produkt akzeptieren" stays available as well.
 */
replaceSection(
  'function customerDeliveryRows(order, includeReview = true) {',
  '\nasync function openReviewModal(interaction, orderId) {',
  section => {
    const oldReviewButton = `      new ButtonBuilder().setCustomId(\`selling_review_open:\${order.id}\`).setLabel(order.reviewSubmitted ? 'Bereits bewertet' : 'Bewertung abgeben').setEmoji('⭐').setStyle(ButtonStyle.Success).setDisabled(!accepted || Boolean(order.reviewSubmitted)),`;
    const newReviewButtons = `      new ButtonBuilder().setCustomId(\`selling_accept_review:\${order.id}\`).setLabel(accepted ? 'Produkt akzeptiert' : 'Akzeptieren & bewerten').setEmoji('⭐').setStyle(ButtonStyle.Primary).setDisabled(!ready || accepted),
      new ButtonBuilder().setCustomId(\`selling_review_open:\${order.id}\`).setLabel(order.reviewSubmitted ? 'Bereits bewertet' : 'Bewertung abgeben').setEmoji('⭐').setStyle(ButtonStyle.Success).setDisabled(!accepted || Boolean(order.reviewSubmitted)),`;
    if (!section.includes(oldReviewButton)) throw new Error('Turbo runtime patch: delivery review button changed');
    return section.replace(oldReviewButton, newReviewButtons);
  }
);

/*
 * Combined action: mark the delivered product as accepted and open the rating
 * modal immediately from the same click.
 */
const portfolioMarker = '\nasync function portfolioConsent(interaction, orderId) {';
const portfolioIndex = source.indexOf(portfolioMarker);
if (portfolioIndex === -1) throw new Error('Turbo runtime patch: portfolio marker not found');

const acceptAndReviewFunction = String.raw`
async function acceptAndReviewDeliveredOrder(interaction, orderId) {
  const lockKey = \`accept-review:\${interaction.guildId}:\${orderId}\`;
  if (!acquireSellingActionLock(lockKey)) {
    await interaction.reply({ content: '⏳ Die Annahme wird bereits verarbeitet.', ephemeral: true }).catch(() => {});
    return;
  }

  try {
    const { store, data } = getGuildShopData(interaction.guildId);
    const order = data.orders[orderId];

    if (
      !order
      || !isOrderCustomer(interaction, order)
      || !isOrderDeliveryContext(interaction, order)
      || !order.deliveredAt
      || order.status !== 'delivered'
      || !orderHasDeliveredFile(order)
    ) {
      await interaction.reply({
        content: '❌ Diese Lieferung ist noch nicht bereit. Nutze den Button im privaten Kundenbereich, sobald die Produktdatei vollständig geliefert wurde.',
        ephemeral: true,
      });
      return;
    }

    if (order.reviewSubmitted || data.reviews[orderId]) {
      await interaction.reply({ content: '✅ Dieses Produkt wurde bereits bewertet.', ephemeral: true });
      return;
    }

    if (isSellingActionLocked(\`delivery:\${interaction.guildId}:\${orderId}\`)) {
      await interaction.reply({
        content: '⏳ Die Produktdatei wird gerade noch verarbeitet. Bitte versuche es gleich erneut.',
        ephemeral: true,
      });
      return;
    }

    if (!order.acceptedAt) {
      order.acceptedAt = Date.now();
      order.status = 'delivered';
      order.waitingOn = null;
      order.updatedAt = Date.now();
      addOrderTimeline(
        order,
        'accepted',
        'Produkt vom Kunden abgenommen und Bewertung geöffnet',
        interaction.user.id,
        order.acceptedAt,
      );
      saveSellingStore(store);
    }

    // The modal is the interaction response, so it opens immediately.
    await openReviewModal(interaction, orderId);

    // Update the delivery message: acceptance disabled, normal rating button enabled.
    if (interaction.message?.editable) {
      await interaction.message.edit({ components: customerDeliveryRows(order, true) }).catch(() => {});
    }

    // Same completion workflow as the normal accept button.
    const ticket = order.channelId
      ? await interaction.guild.channels.fetch(order.channelId).catch(() => null)
      : null;

    if (ticket?.isTextBased()) {
      await archiveSellingTranscript(
        ticket,
        \`Bestellung \${orderId}\`,
        'Automatisch nach Kunden-Abnahme archiviert.',
      ).catch(() => {});
      order.closedAt ||= Date.now();
      order.channelId = null;
      saveSellingStore(store);
      setTimeout(
        () => ticket.delete(\`Bestellung \${orderId} vom Kunden akzeptiert\`).catch(() => {}),
        5000,
      );
    }

    await archiveCompletedProject(interaction.guild, order).catch(() => {});
    await refreshStaffDashboard(interaction.guild, data).catch(() => {});
    await refreshCalendarPanel(interaction.guild, data).catch(() => {});
    saveSellingStore(store);
  } finally {
    releaseSellingActionLock(lockKey);
  }
}
`;

source = source.slice(0, portfolioIndex) + '\n' + acceptAndReviewFunction + source.slice(portfolioIndex);

/*
 * Route the new button before the existing selling_accept handler.
 */
const acceptRoute = `  if (interaction.isButton?.() && String(interaction.customId || '').startsWith('selling_accept:')) {
    await acceptDeliveredOrder(interaction, String(interaction.customId).split(':')[1]); return true;
  }`;

const combinedRoute = `  if (interaction.isButton?.() && String(interaction.customId || '').startsWith('selling_accept_review:')) {
    await acceptAndReviewDeliveredOrder(interaction, String(interaction.customId).split(':')[1]); return true;
  }
${acceptRoute}`;

if (!source.includes(acceptRoute)) throw new Error('Turbo runtime patch: accept route changed');
source = source.replace(acceptRoute, combinedRoute);

console.log('✅ Turbo Designs runtime fixes aktiv: Checkout-Timeout + direkte Produktannahme/Bewertung');

// Execute the patched selling-entry.js as a normal CommonJS module.
const runtimeFilename = path.join(__dirname, 'selling-entry.runtime.js');
const runtimeModule = new Module(runtimeFilename, module.parent);
runtimeModule.filename = runtimeFilename;
runtimeModule.paths = Module._nodeModulePaths(__dirname);
runtimeModule._compile(source, runtimeFilename);
