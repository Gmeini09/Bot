'use strict';
// Shop: catalog panel with a product menu, cart, checkout → private order channel; the team sets the status.
const { embed, button, row, select, modal, ok, fail, BTN } = require('./ui');
const { money, parsePrice, cartLines, cartTotal, addToCart, slug, pad, validEmoji, ORDER_STATUS, transcript } = require('./logic');
const { privateChannel, isStaff, fetchAll, staffPing } = require('./tickets');
const { postPanel } = require('./setup');
const fs = require('fs');
const path = require('path');

// product pictures live on the volume (Discord attachment links expire), sent as files with the panel
let IMAGE_DIR = null;
const setImageDir = (dir) => { IMAGE_DIR = dir; fs.mkdirSync(dir, { recursive: true }); };
const imageFile = (p) => (IMAGE_DIR && p.image && fs.existsSync(path.join(IMAGE_DIR, p.image)) ? path.join(IMAGE_DIR, p.image) : null);
const IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

const enabledProducts = (g) => Object.values(g.products).filter((p) => p.enabled !== false).sort((a, b) => a.createdAt - b.createdAt);

function panel(g) {
  const list = enabledProducts(g);
  const cur = g.config.currency;
  const line = (p) => `${p.emoji ? `${p.emoji} ` : ''}**${p.name}** – ${money(p.price, cur)}${p.description ? `\n> ${p.description}` : ''}`;
  const pictured = list.filter((p) => imageFile(p)).slice(0, 9); // 10 embeds per message: header + 9 pictures
  const textOnly = list.filter((p) => !pictured.includes(p));
  const description = list.length
    ? (textOnly.length ? textOnly.map(line).join('\n\n') : '')
    : '*Noch keine Produkte – bald geht es los!*';
  const components = [];
  if (list.length) components.push(select('shop:add', '🛒 Produkt in den Warenkorb legen …', list.slice(0, 25).map((p) => ({ label: `${p.name} – ${money(p.price, cur)}`, value: p.id, description: p.description, emoji: p.emoji }))));
  components.push(row(button('shop:cart', 'Warenkorb', BTN.success, '🛒')));
  const embeds = [embed(g, {
    title: `🛍️ ${g.config.name} – Shop`,
    description: `${description ? `${description}\n\n` : ''}**So bestellst du:** Produkt auswählen → Warenkorb → Bestellen. Danach öffnet sich ein privates Bestell-Ticket mit den Zahlungsinfos.`,
    timestamp: false,
  })];
  for (const p of pictured) {
    embeds.push(embed(g, { title: `${p.emoji ? `${p.emoji} ` : ''}${p.name} – ${money(p.price, cur)}`, description: p.description || undefined, timestamp: false, footer: '' }));
    embeds[embeds.length - 1].image = { url: `attachment://${p.image}` };
    delete embeds[embeds.length - 1].footer;
  }
  // attachments: [] replaces the old pictures when the panel is edited
  return { embeds, components, files: pictured.map((p) => ({ attachment: imageFile(p), name: p.image })), attachments: [] };
}

const refreshPanel = (guild, g) => postPanel(guild, g, 'shop', g.config.shopChannelId, panel(g)).catch(() => null);

function cartView(g, userId) {
  const lines = cartLines(g.carts[userId], g.products);
  const cur = g.config.currency;
  if (!lines.length) return { embeds: [embed(g, { title: '🛒 Dein Warenkorb', description: 'Dein Warenkorb ist leer. Wähle im Shop ein Produkt aus.', timestamp: false })], components: [], flags: 64 };
  return {
    embeds: [embed(g, {
      title: '🛒 Dein Warenkorb',
      description: lines.map((l) => `${l.emoji ? `${l.emoji} ` : ''}**${l.name}** × ${l.qty} – ${money(l.sum, cur)}`).join('\n') + `\n\n**Summe: ${money(cartTotal(lines), cur)}**`,
      timestamp: false,
    })],
    components: [row(button('shop:checkout', 'Bestellen', BTN.success, '✅'), button('shop:clear', 'Leeren', BTN.secondary, '🗑️'))],
    flags: 64,
  };
}

async function onAdd(interaction, ctx) {
  const g = ctx.store.guild(interaction.guildId);
  const p = g.products[interaction.values[0]];
  if (!p || p.enabled === false) return interaction.reply(fail(g, 'Dieses Produkt ist gerade nicht verfügbar.'));
  g.carts[interaction.user.id] ||= { items: {} };
  addToCart(g.carts[interaction.user.id], p.id);
  ctx.store.save();
  return interaction.reply(cartView(g, interaction.user.id));
}

async function onCart(interaction, ctx) {
  return interaction.reply(cartView(ctx.store.guild(interaction.guildId), interaction.user.id));
}

async function onClear(interaction, ctx) {
  const g = ctx.store.guild(interaction.guildId);
  delete g.carts[interaction.user.id];
  ctx.store.save();
  const v = cartView(g, interaction.user.id);
  delete v.flags;
  return interaction.update(v);
}

const openOrderOf = (g, userId) => Object.values(g.orders).find((o) => o.userId === userId && !o.closedAt && interactionSafe(o));
const interactionSafe = (o) => o.status === 'open' || o.status === 'paid';

async function onCheckout(interaction, ctx) {
  const g = ctx.store.guild(interaction.guildId);
  if (!cartLines(g.carts[interaction.user.id], g.products).length) return interaction.reply(fail(g, 'Dein Warenkorb ist leer.'));
  const open = openOrderOf(g, interaction.user.id);
  if (open && interaction.guild.channels.cache.get(open.channelId)) return interaction.reply(fail(g, `Du hast schon eine offene Bestellung: <#${open.channelId}>`));
  return interaction.showModal(modal('shop:order', 'Bestellung abschließen', [
    { id: 'notes', label: 'Wünsche / Infos zur Bestellung', style: 'long', required: false, max: 1000, placeholder: 'Optional – z. B. Namen, Farben, Deadline' },
  ]));
}

function orderEmbed(g, o) {
  const cur = g.config.currency;
  const st = ORDER_STATUS[o.status] || ORDER_STATUS.open;
  return embed(g, {
    title: `📦 Bestellung #${pad(o.no)}`,
    description: o.items.map((l) => `${l.emoji ? `${l.emoji} ` : ''}**${l.name}** × ${l.qty} – ${money(l.sum, cur)}`).join('\n') + `\n\n**Summe: ${money(o.total, cur)}**`,
    fields: [
      { name: 'Status', value: `${st.emoji} ${st.label}`, inline: true },
      { name: 'Kunde', value: `<@${o.userId}>`, inline: true },
      ...(o.notes ? [{ name: 'Wünsche', value: o.notes }] : []),
      { name: '💳 Bezahlung', value: g.config.paymentInfo },
    ],
  });
}

function orderButtons(o) {
  const done = o.status === 'delivered' || o.status === 'cancelled';
  return [row(
    button('order:paid', 'Bezahlt', BTN.primary, '💶', o.status !== 'open'),
    button('order:delivered', 'Geliefert', BTN.success, '📦', done),
    button('order:cancel', 'Stornieren', BTN.danger, '✖️', done),
    button('order:close', 'Kanal schließen', BTN.secondary, '🔒'),
  )];
}

async function onOrder(interaction, ctx) {
  const g = ctx.store.guild(interaction.guildId);
  const lines = cartLines(g.carts[interaction.user.id], g.products);
  if (!lines.length) return interaction.reply(fail(g, 'Dein Warenkorb ist leer.'));
  await interaction.deferReply({ flags: 64 });
  const no = ++g.orderCounter;
  let ch;
  try {
    ch = await privateChannel(interaction.guild, g, g.config.orderCategoryId, `bestellung-${pad(no)}-${slug(interaction.user.username)}`, interaction.user.id, `Bestellung #${pad(no)} von ${interaction.user.tag} (${interaction.user.id})`);
  } catch (e) {
    return interaction.editReply(fail(g, `Bestellung konnte nicht erstellt werden: ${e.message}`));
  }
  const o = { no, id: `O${pad(no)}`, userId: interaction.user.id, items: lines, total: cartTotal(lines), notes: interaction.fields.getTextInputValue('notes')?.trim() || '', status: 'open', channelId: ch.id, createdAt: Date.now(), messageId: null };
  const ping = staffPing(g, interaction.guild);
  const msg = await ch.send({ content: `<@${o.userId}> ${ping.text}`.trim(), embeds: [orderEmbed(g, o)], components: orderButtons(o), allowedMentions: { users: [o.userId], roles: ping.roles } });
  o.messageId = msg.id;
  g.orders[o.id] = o;
  delete g.carts[interaction.user.id];
  ctx.store.save();
  await ctx.log(interaction.guild, { title: '🛒 Neue Bestellung', description: `#${pad(no)} von <@${o.userId}> – ${money(o.total, g.config.currency)} → ${ch}` });
  return interaction.editReply(ok(g, `Deine Bestellung ist eingegangen: ${ch}`));
}

const orderByChannel = (g, channelId) => Object.values(g.orders).find((o) => o.channelId === channelId && !o.closedAt);

async function onOrderButton(interaction, ctx) {
  const g = ctx.store.guild(interaction.guildId);
  const o = orderByChannel(g, interaction.channelId);
  if (!o) return interaction.reply(fail(g, 'Zu diesem Kanal gibt es keine offene Bestellung.'));
  if (!isStaff(interaction.member, g)) return interaction.reply(fail(g, 'Nur das Team kann den Status ändern.'));
  const action = interaction.customId.split(':')[1];
  if (action === 'close') {
    o.closedAt = Date.now();
    ctx.store.save();
    await interaction.reply({ embeds: [embed(g, { description: '🔒 Kanal wird in 5 Sekunden gelöscht – die Bestellung bleibt gespeichert.', timestamp: false })] });
    const text = transcript(interaction.channel.name, await fetchAll(interaction.channel).catch(() => []));
    const log = interaction.guild.channels.cache.get(g.config.ticketLogChannelId);
    if (log) await log.send({ embeds: [orderEmbed(g, o)], files: [{ attachment: Buffer.from(text, 'utf8'), name: `${interaction.channel.name}.txt` }] }).catch(() => {});
    setTimeout(() => interaction.channel.delete('Bestellung geschlossen').catch(() => {}), 5000);
    return undefined;
  }
  const next = { paid: 'paid', delivered: 'delivered', cancel: 'cancelled' }[action];
  if (!next) return undefined;
  o.status = next;
  o[`${next}At`] = Date.now();
  o[`${next}By`] = interaction.user.id;
  ctx.store.save();
  await interaction.update({ embeds: [orderEmbed(g, o)], components: orderButtons(o) });
  const st = ORDER_STATUS[next];
  await interaction.channel.send({ embeds: [embed(g, { description: `${st.emoji} Status: **${st.label}** (von <@${interaction.user.id}>)`, timestamp: false })] }).catch(() => {});
  if (next === 'delivered' && !o.feedback && !o.feedbackMessageId) {
    const fm = await interaction.channel.send({
      content: `<@${o.userId}>`,
      embeds: [embed(g, { title: '⭐ Wie zufrieden bist du?', description: 'Bewerte deine Bestellung mit 1 bis 5 Sternen – das hilft uns und anderen Kunden sehr!', timestamp: false })],
      components: [feedbackRow(o)], allowedMentions: { users: [o.userId] },
    }).catch(() => null);
    if (fm) { o.feedbackMessageId = fm.id; ctx.store.save(); }
  }
  if (next === 'delivered' && g.config.customerRoleId) {
    const m = await interaction.guild.members.fetch(o.userId).catch(() => null);
    if (m) await m.roles.add(g.config.customerRoleId, `Bestellung #${pad(o.no)} geliefert`).catch(() => {});
  }
  const u = await interaction.client.users.fetch(o.userId).catch(() => null);
  if (u) await u.send({ embeds: [embed(g, { title: `Bestellung #${pad(o.no)} bei ${g.config.name}`, description: `${st.emoji} Neuer Status: **${st.label}**${next === 'delivered' ? `\n\n⭐ Du kannst deine Bestellung jetzt in <#${o.channelId}> bewerten.` : ''}` })] }).catch(() => {});
  await ctx.log(interaction.guild, { title: `📦 Bestellung #${pad(o.no)}`, description: `${st.emoji} ${st.label} – von <@${interaction.user.id}>` });
  return undefined;
}

// ── feedback (customer rates a delivered order)
const STARS = (n) => '⭐'.repeat(n);
const feedbackRow = (o, done = false) => row(...[1, 2, 3, 4, 5].map((n) => button(`fb:${o.id}:${n}`, String(n), n >= 4 ? BTN.success : BTN.secondary, '⭐', done)));

async function onFeedbackButton(interaction, ctx) {
  const g = ctx.store.guild(interaction.guildId);
  const [, id, n] = interaction.customId.split(':');
  const o = g.orders[id];
  if (!o) return interaction.reply(fail(g, 'Diese Bestellung gibt es nicht mehr.'));
  if (o.userId !== interaction.user.id) return interaction.reply(fail(g, 'Nur der Kunde kann diese Bestellung bewerten.'));
  if (o.feedback) return interaction.reply(fail(g, 'Du hast diese Bestellung schon bewertet – danke!'));
  return interaction.showModal(modal(`fbm:${id}:${n}`, `Bewertung: ${STARS(Number(n))}`, [
    { id: 'comment', label: 'Dein Kommentar (optional)', style: 'long', required: false, max: 800, placeholder: 'Was hat dir gefallen? Was können wir besser machen?' },
  ]));
}

async function onFeedbackModal(interaction, ctx) {
  const g = ctx.store.guild(interaction.guildId);
  const [, id, n] = interaction.customId.split(':');
  const o = g.orders[id];
  const stars = Math.max(1, Math.min(5, Number(n) || 0));
  if (!o || o.userId !== interaction.user.id) return interaction.reply(fail(g, 'Diese Bewertung gehört nicht zu dir.'));
  if (o.feedback) return interaction.reply(fail(g, 'Du hast diese Bestellung schon bewertet – danke!'));
  const comment = interaction.fields.getTextInputValue('comment')?.trim() || '';
  o.feedback = { stars, comment, at: Date.now() };
  ctx.store.save();
  const ch = interaction.guild.channels.cache.get(g.config.feedbackChannelId);
  if (ch) {
    await ch.send({ embeds: [embed(g, {
      title: `${STARS(stars)} Neue Bewertung`,
      description: comment ? `> ${comment.replace(/\n/g, '\n> ')}` : '*Ohne Kommentar*',
      fields: [{ name: 'Kunde', value: `<@${o.userId}>`, inline: true }, { name: 'Bestellt', value: o.items.map((l) => `${l.emoji ? `${l.emoji} ` : ''}${l.name}${l.qty > 1 ? ` × ${l.qty}` : ''}`).join(', '), inline: true }],
      thumbnail: interaction.user.displayAvatarURL?.({ size: 64 }),
    })] }).catch(() => {});
  }
  if (o.feedbackMessageId && interaction.channel) {
    const m = await interaction.channel.messages.fetch(o.feedbackMessageId).catch(() => null);
    if (m) await m.edit({ embeds: [embed(g, { title: `${STARS(stars)} Danke für deine Bewertung!`, description: comment || 'Ohne Kommentar', timestamp: false })], components: [feedbackRow(o, true)] }).catch(() => {});
  }
  await ctx.log(interaction.guild, { title: `⭐ Bewertung #${pad(o.no)}`, description: `${STARS(stars)} von <@${o.userId}>${comment ? `\n${comment.slice(0, 500)}` : ''}`, color: 0xf1c40f });
  return interaction.reply(ok(g, `Danke für deine ${stars}-Sterne-Bewertung! 💛`));
}

// ── /produkt
function findProduct(g, q) {
  const s = String(q || '').trim().toLowerCase();
  return g.products[q] || Object.values(g.products).find((p) => p.name.toLowerCase() === s);
}

async function onProductCommand(interaction, ctx) {
  const g = ctx.store.guild(interaction.guildId);
  const sub = interaction.options.getSubcommand();
  const cur = g.config.currency;
  if (sub === 'liste') {
    const all = Object.values(g.products);
    return interaction.reply({ embeds: [embed(g, { title: '📋 Produkte', description: all.length ? all.map((p) => `\`${p.id}\` ${p.enabled === false ? '🔴' : '🟢'} ${p.emoji || ''} **${p.name}** – ${money(p.price, cur)}`).join('\n') : 'Noch keine Produkte. `/produkt hinzufuegen`' })], flags: 64 });
  }
  if (sub === 'hinzufuegen') {
    if (Object.keys(g.products).length >= 25) return interaction.reply(fail(g, 'Maximal 25 Produkte (Discord-Grenze für das Auswahlmenü).'));
    const price = parsePrice(interaction.options.getString('preis', true));
    if (price === null) return interaction.reply(fail(g, 'Ungültiger Preis – z. B. `9,99` oder `15`.'));
    const emoji = interaction.options.getString('emoji') || '';
    if (emoji && !validEmoji(emoji)) return interaction.reply(fail(g, 'Das Emoji wird nicht erkannt – nimm ein einzelnes Emoji wie 🔥.'));
    const id = `p${++g.productCounter}`;
    g.products[id] = { id, name: interaction.options.getString('name', true).trim(), price, description: interaction.options.getString('beschreibung')?.trim() || '', emoji, enabled: true, createdAt: Date.now() };
    ctx.store.save();
    await refreshPanel(interaction.guild, g);
    return interaction.reply(ok(g, `**${g.products[id].name}** (${money(price, cur)}) ist jetzt im Shop.`));
  }
  const p = findProduct(g, interaction.options.getString('produkt', true));
  if (!p) return interaction.reply(fail(g, 'Produkt nicht gefunden.'));
  if (sub === 'entfernen') {
    const img = imageFile(p);
    if (img) fs.rmSync(img, { force: true });
    delete g.products[p.id];
    ctx.store.save();
    await refreshPanel(interaction.guild, g);
    return interaction.reply(ok(g, `**${p.name}** wurde entfernt.`));
  }
  if (sub === 'bild') {
    const att = interaction.options.getAttachment('bild');
    const old = imageFile(p);
    if (!att) {
      if (old) fs.rmSync(old, { force: true });
      delete p.image;
      ctx.store.save();
      await refreshPanel(interaction.guild, g);
      return interaction.reply(ok(g, `Bild von **${p.name}** entfernt.`));
    }
    const ext = IMAGE_TYPES[String(att.contentType || '').split(';')[0].toLowerCase()];
    if (!ext) return interaction.reply(fail(g, 'Bitte ein Bild hochladen (PNG, JPG, GIF oder WebP).'));
    if (att.size > 8 * 1024 * 1024) return interaction.reply(fail(g, 'Das Bild ist größer als 8 MB.'));
    if (!IMAGE_DIR) return interaction.reply(fail(g, 'Bilder sind auf diesem Bot nicht eingerichtet.'));
    await interaction.deferReply({ flags: 64 });
    let buf;
    try {
      const res = await fetch(att.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      buf = Buffer.from(await res.arrayBuffer());
    } catch (e) {
      return interaction.editReply(fail(g, `Bild konnte nicht geladen werden: ${e.message}`));
    }
    const name = `${p.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`; // new name each time: Discord caches by name
    fs.writeFileSync(path.join(IMAGE_DIR, name), buf);
    if (old && old !== path.join(IMAGE_DIR, name)) fs.rmSync(old, { force: true });
    p.image = name;
    ctx.store.save();
    await refreshPanel(interaction.guild, g);
    return interaction.editReply(ok(g, `Bild für **${p.name}** gespeichert – es steht jetzt im Shop.`));
  }
  // bearbeiten
  const name = interaction.options.getString('name');
  const priceRaw = interaction.options.getString('preis');
  const desc = interaction.options.getString('beschreibung');
  const emoji = interaction.options.getString('emoji');
  const avail = interaction.options.getBoolean('verfuegbar');
  if (priceRaw !== null) {
    const price = parsePrice(priceRaw);
    if (price === null) return interaction.reply(fail(g, 'Ungültiger Preis.'));
    p.price = price;
  }
  if (emoji !== null) {
    if (emoji && !validEmoji(emoji)) return interaction.reply(fail(g, 'Das Emoji wird nicht erkannt.'));
    p.emoji = emoji;
  }
  if (name) p.name = name.trim();
  if (desc !== null) p.description = desc.trim();
  if (avail !== null) p.enabled = avail;
  ctx.store.save();
  await refreshPanel(interaction.guild, g);
  return interaction.reply(ok(g, `**${p.name}** aktualisiert – ${money(p.price, cur)}${p.enabled === false ? ' (nicht verfügbar)' : ''}.`));
}

async function onAutocomplete(interaction, ctx) {
  const g = ctx.store.guild(interaction.guildId);
  const q = String(interaction.options.getFocused() || '').toLowerCase();
  const list = Object.values(g.products).filter((p) => p.name.toLowerCase().includes(q)).slice(0, 25);
  return interaction.respond(list.map((p) => ({ name: `${p.name} (${money(p.price, g.config.currency)})`.slice(0, 100), value: p.id })));
}

module.exports = { setImageDir, onFeedbackButton, onFeedbackModal, panel, refreshPanel, cartView, onAdd, onCart, onClear, onCheckout, onOrder, onOrderButton, onProductCommand, onAutocomplete, orderEmbed };
