'use strict';
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits: P } = require('discord.js');

const TOOL_PLANS = Object.freeze({ week: { label: 'Woche', price: 10 }, month: { label: 'Monat', price: 15 }, lifetime: { label: 'Lifetime', price: 20 } });
class ShopRequestError extends Error {
  constructor(code, ticketUrl) { super(code); this.code = code; this.ticketUrl = ticketUrl; }
}
const ticketUrl = channel => `https://discord.com/channels/${channel.guild.id}/${channel.id}`;

// The same controls are used for Discord checkout and website checkout.
function orderActionRows(order) {
  const id = order.id;
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`selling_claim:${id}`).setLabel('Übernehmen').setEmoji('🙋').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`selling_price:${id}`).setLabel('Preis').setEmoji('💶').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`selling_status:${id}:paid`).setLabel('Bezahlt').setEmoji('💳').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`selling_status:${id}:processing`).setLabel('Bearbeitung').setEmoji('🛠️').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`selling_deliver_start:${id}`).setLabel('Produkt liefern').setEmoji('📤').setStyle(ButtonStyle.Success),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`selling_offer_start:${id}`).setLabel('Angebot').setEmoji('🧾').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`selling_priority_cycle:${id}`).setLabel('Priorität').setEmoji('🚦').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`selling_revision:${id}`).setLabel(`Revision (${Math.max(0, Number(order.revisionsRemaining || 0))})`).setEmoji('🔄').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`selling_dispute:${id}`).setLabel('Problem / Streitfall').setEmoji('⚠️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`selling_close:${id}`).setLabel('Ticket schließen').setEmoji('🔒').setStyle(ButtonStyle.Danger),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`selling_express:${id}`).setLabel(order.expressRequested ? 'Express angefragt' : 'Express anfragen').setEmoji('⚡').setStyle(ButtonStyle.Danger).setDisabled(Boolean(order.expressRequested || order.paidAt || order.closedAt)),
    ),
  ];
}

function createSellingOrderService(deps) {
  function categoryFor(guild) { return deps.findSellingCategory(guild, deps.ordersCategory); }
  async function ready(guild) {
    await guild.channels.fetch(); await guild.roles.fetch();
    if (!categoryFor(guild)) throw new ShopRequestError('TICKET_UNAVAILABLE');
    const me = guild.members.me || await guild.members.fetchMe();
    if (!me.permissions.has(P.ManageChannels)) throw new ShopRequestError('TICKET_UNAVAILABLE');
    return true;
  }
  function verifyRecovered(record, website, user) {
    if (record.userId !== user.id || record.websiteFingerprint !== website.fingerprint) throw new ShopRequestError('INVALID_REQUEST');
  }
  async function createOrder({ guild, user, productKey, input, website }) {
    const lock = `order-create-lock:${guild.id}:${user.id}`;
    if (!deps.acquireSellingActionLock(lock)) throw new ShopRequestError('ORDER_BUSY');
    let pendingOrder, pendingStore;
    try {
      const product = deps.products[productKey];
      if (!product) throw new ShopRequestError('INVALID_REQUEST');
      const { store, data } = deps.getGuildShopData(guild.id);
      let order = website && Object.values(data.orders).find(item => item.websiteRequestId === website.requestId);
      if (order) verifyRecovered(order, website, user);
      if (!order) {
        if (data.blacklist[user.id]) throw new ShopRequestError('BLACKLISTED');
        if (data.config.availability === 'closed') throw new ShopRequestError('SHOP_CLOSED');
        const duplicate = Object.values(data.orders).find(item => item.userId === user.id && !item.closedAt);
        if (duplicate) throw new ShopRequestError('ORDER_EXISTS', duplicate.channelId ? `https://discord.com/channels/${guild.id}/${duplicate.channelId}` : undefined);
        if (!deps.productConfig(data, productKey)?.enabled) throw new ShopRequestError('PRODUCT_UNAVAILABLE');
        const coupon = deps.getDiscountCodeState(data, input.coupon || '');
        if (coupon.error) throw new ShopRequestError('INVALID_DISCOUNT');
        if (!deps.consumeSellingRateLimit(`order-create:${guild.id}:${user.id}`, 2, 5 * 60 * 1000)) throw new ShopRequestError('RATE_LIMITED');
        const plan = productKey === 'sptool' && Object.hasOwn(TOOL_PLANS, input.plan) ? TOOL_PLANS[input.plan] : null;
        if (website && productKey === 'sptool' && !plan) throw new ShopRequestError('INVALID_REQUEST');
        const loyalty = deps.loyaltyForUser(data, user.id), createdAt = Date.now();
        order = {
          id: deps.nextOrderId(data), userId: user.id, productKey,
          details: input.details.trim(), style: (input.style || '').trim(), references: input.references || '',
          referenceUploadUrl: input.referenceUploads?.[0]?.url || null, referenceUploads: input.referenceUploads || [],
          deadline: (input.deadline || '').trim(), dueAt: deps.parseDeadlineToTimestamp(input.deadline || '', product.etaDays),
          notes: [input.notes, plan ? `Soundpack Tool • ${plan.label} • ${plan.price} €` : null].filter(Boolean).join('\n'),
          couponCode: coupon.coupon ? coupon.code : null, voucherCode: coupon.voucher ? coupon.code : null,
          voucherAmount: coupon.voucher ? Number(coupon.voucher.remainingAmount ?? coupon.voucher.amount ?? 0) : 0,
          discountPercent: coupon.coupon ? Number(coupon.coupon.percent || 0) : 0,
          loyaltyDiscountPercent: plan ? 0 : loyalty.discount, loyaltyLabel: plan ? null : loyalty.level?.label || null,
          basePrice: plan?.price ?? null, finalPrice: plan?.price ?? null,
          status: 'pending', revisionsRemaining: Number(product.revisions || 0), initialRevisions: Number(product.revisions || 0),
          assignedTo: null, createdAt, paidAt: null, deliveredAt: null, closedAt: null,
          channelId: null, deliveryChannelId: null, licenseId: null, reviewSubmitted: false,
          couponRedeemedAt: null, voucherRedeemedAt: null, priority: 'normal', waitingOn: 'staff',
          lastActivityAt: createdAt, lastCustomerAt: createdAt, testMode: Boolean(data.config.testMode),
          extraCharges: [], expressRequested: false, expressApproved: false,
          ...(website ? { source: 'website', websiteRequestId: website.requestId, websiteFingerprint: website.fingerprint, websitePlan: input.plan || null } : {}),
        };
        data.orders[order.id] = order;
        pendingOrder = order; pendingStore = store;
        deps.saveSellingStore(store);
      }
      if (order.closedAt) throw new ShopRequestError('ORDER_CLOSED');
      await guild.channels.fetch();
      const category = categoryFor(guild);
      if (!category) throw new ShopRequestError('TICKET_UNAVAILABLE');
      let channel = order.channelId ? await guild.channels.fetch(order.channelId).catch(() => null) : null;
      if (!channel && website) {
        channel = guild.channels.cache.find(item => item.topic?.includes(`|website-request:${website.requestId}|`));
        if (channel && (!channel.topic.includes(`|website-fingerprint:${website.fingerprint}|`) || !channel.topic.startsWith(`selling-owner:${user.id}|`) || !channel.topic.includes(`|selling-order:${order.id}|`))) throw new ShopRequestError('INVALID_REQUEST');
      }
      if (channel && website && (!channel.topic?.includes(`|website-request:${website.requestId}|`) || !channel.topic.includes(`|website-fingerprint:${website.fingerprint}|`))) throw new ShopRequestError('INVALID_REQUEST');
      if (!channel) {
        const topic = `selling-owner:${user.id}|selling-kind:order|selling-order:${order.id}|selling-product:${productKey}|selling-status:open` + (website ? `|website-request:${website.requestId}|website-fingerprint:${website.fingerprint}|` : '');
        channel = await guild.channels.create({
          name: `${order.id.toLowerCase()}-${productKey}-${deps.sanitizeName(user.username)}`.slice(0, 95),
          type: ChannelType.GuildText, parent: category.id, topic,
          permissionOverwrites: deps.sellingOrderTicketOverwrites(guild, user.id, [productKey]),
          reason: `Selling Bestellung ${order.id} von ${user.tag || user.username}`,
        });
      }
      if (website) await deps.assertPrivateOrderChannel(channel, guild, user.id, productKey);
      order.channelId = channel.id;
      if (productKey !== 'sptool' || !order.websitePlan) {
        const autoPrice = deps.configuredOrderPrice(data, [productKey]);
        if (autoPrice !== null && !order.creationCompletedAt) { order.basePrice = autoPrice; order.finalPrice = deps.calculateOrderFinalPrice(order); }
      }
      deps.saveSellingStore(store);
      let message = order.initialMessageId ? await channel.messages.fetch(order.initialMessageId).catch(() => null) : null;
      const marker = website ? `Turbo Designs • Order Center • ${order.id} • ${website.requestId} • ${website.fingerprint}` : null;
      if (message && website && (message.author?.id !== guild.members.me?.id || !message.embeds?.some(embed => embed.footer?.text === marker))) message = null;
      if (!message && website) {
        const messages = await channel.messages.fetch({ limit: 100, cache: false });
        message = messages.find(item => item.author?.id === guild.members.me?.id && item.embeds?.some(embed => embed.footer?.text === marker));
      }
      if (!message) {
        const embed = deps.orderInfoEmbed(order, data);
        if (marker) embed.setFooter({ text: marker });
        message = await channel.send({ content: `<@${user.id}>`, embeds: [embed], components: orderActionRows(order), allowedMentions: { users: [user.id], roles: [], parse: [] }, ...(website ? { nonce: website.requestId.replaceAll('-', '').slice(0, 24), enforceNonce: true } : {}) });
        order.initialMessageId = message.id;
        deps.saveSellingStore(store);
      }
      if (!order.creationCompletedAt) {
        await deps.automateNewOrder(guild, data, order, channel).catch(() => {});
        deps.saveSellingStore(store);
        await deps.syncOrderWorkflow(guild, data, order).catch(() => {});
        await deps.notifyNewOrder(guild, data, order, channel).catch(() => {});
        await deps.refreshOrderStatusPanel(guild, data).catch(() => {});
        await deps.logSelling(guild, '🛒 Neue Bestellung', `<@${user.id}> hat **${order.id} • ${product.label}** erstellt: <#${channel.id}>`).catch(() => {});
        order.creationCompletedAt = Date.now();
        deps.saveSellingStore(store);
      }
      return { order, channel, message, reference: order.id, ticketUrl: ticketUrl(channel), queue: deps.queueInfoForOrder(data, order) };
    } catch (error) {
      // Discord checkout keeps its existing failed-order lifecycle. Website
      // checkout retains its reserved order ID so a network retry can resume.
      if (!website && pendingOrder && !pendingOrder.creationCompletedAt) {
        pendingOrder.closedAt = Date.now(); pendingOrder.failedAt = Date.now();
        deps.saveSellingStore(pendingStore);
      }
      throw error;
    } finally { deps.releaseSellingActionLock(lock); }
  }

  async function createPartnerApplication({ guild, user, input, website }) {
    const lock = `partner-create:${guild.id}:${user.id}`;
    if (!deps.acquireSellingActionLock(lock)) throw new ShopRequestError('ORDER_BUSY');
    try {
      const { store, data } = deps.getGuildShopData(guild.id);
      let app = website && Object.values(data.partnerApplications).find(item => item.websiteRequestId === website.requestId);
      if (app) verifyRecovered(app, website, user);
      if (!app) {
        if (!deps.consumeSellingRateLimit(`partner:${guild.id}:${user.id}`, 2, 24 * 3600000)) throw new ShopRequestError('RATE_LIMITED');
        app = { id: deps.nextAdvancedId(data, 'nextPartner', 'PA'), userId: user.id, ...input, status: 'pending', createdAt: Date.now(), ...(website ? { source: 'website', websiteRequestId: website.requestId, websiteFingerprint: website.fingerprint } : {}) };
        data.partnerApplications[app.id] = app;
        deps.saveSellingStore(store);
      }
      const channel = deps.findSellingTextChannel(guild, '🤝・partner-anfragen');
      if (!channel) throw new ShopRequestError('TICKET_UNAVAILABLE');
      if (website) await deps.assertPrivatePartnerChannel(channel, guild);
      const marker = website ? `${app.id} • ${website.requestId} • ${website.fingerprint}` : null;
      let existing = app.messageId ? await channel.messages.fetch(app.messageId).catch(() => null) : null;
      if (existing && website && (existing.author?.id !== guild.members.me?.id || !existing.embeds?.some(embed => embed.footer?.text === marker))) existing = null;
      if (!existing && website) {
        const messages = await channel.messages.fetch({ limit: 100, cache: false });
        existing = messages.find(message => message.author?.id === guild.members.me?.id && message.embeds?.some(embed => embed.footer?.text === marker));
      }
      if (!existing) {
        const embed = deps.shopEmbed(`🤝 Partnerschaft ${app.id}`, `**Antragsteller:** <@${app.userId}>\n**Projekt:** ${app.project}\n**Reichweite:** ${app.members || '—'}\n**Link:** ${app.invite || '—'}\n\n**Grund:**\n${app.reason}\n\n**Ad:**\n${app.ad || '—'}`);
        if (marker) embed.setFooter({ text: marker });
        const sent = await channel.send({ embeds: [embed], allowedMentions: { parse: [] }, ...(website ? { nonce: website.requestId.replaceAll('-', '').slice(0, 24), enforceNonce: true } : {}) });
        app.messageId = sent.id;
        deps.saveSellingStore(store);
      }
      return { reference: app.id, requestType: 'partnership' };
    } finally { deps.releaseSellingActionLock(lock); }
  }
  async function createWebsiteRequest(guild, user, request, fingerprint) {
    const website = { requestId: request.requestId, fingerprint };
    if (request.product === 'partnership') return createPartnerApplication({
      guild, user, website,
      input: { project: request.project.split('\n')[0].slice(0,150), members: request.assets, invite: '', reason: request.project, ad: '' },
    });
    const result = await createOrder({
      guild, user, productKey: request.product==='soundpack-tool'?'sptool':request.product, website,
      input: { details: request.project, style: '', references: request.reference, deadline: request.deadline, notes: request.assets, coupon: '', plan: request.plan },
    });
    return { reference: result.reference, messageId: result.message.id, ticketUrl: result.ticketUrl };
  }
  return { ready, createOrder, createPartnerApplication, createWebsiteRequest };
}

module.exports = { createSellingOrderService, orderActionRows, TOOL_PLANS, ShopRequestError };
