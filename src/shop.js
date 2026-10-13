'use strict';
// Shop: catalog panel with a product menu, cart, checkout → private order channel; the team sets the status.
const { embed, button, row, select, modal, ok, fail, BTN } = require('./ui');
const { money, parsePrice, cartLines, cartTotal, addToCart, slug, pad, validEmoji, ORDER_STATUS, transcript } = require('./logic');
const { privateChannel, isStaff, fetchAll, staffPing } = require('./tickets');
const { postPanel } = require('./setup');

const enabledProducts = (g) => Object.values(g.products).filter((p) => p.enabled !== false).sort((a, b) => a.createdAt - b.createdAt);

function panel(g) {
  const list = enabledProducts(g);
  const cur = g.config.currency;
  const description = list.length
    ? list.map((p) => `${p.emoji ? `${p.emoji} ` : ''}**${p.name}** – ${money(p.price, cur)}${p.description ? `\n> ${p.description}` : ''}`).join('\n\n')
    : '*Noch keine Produkte – bald geht es los!*';
  const components = [];
  if (list.length) components.push(select('shop:add', '🛒 Produkt in den Warenkorb legen …', list.slice(0, 25).map((p) => ({ label: `${p.name} – ${money(p.price, cur)}`, value: p.id, description: p.description, emoji: p.emoji }))));
  components.push(row(button('shop:cart', 'Warenkorb', BTN.success, '🛒')));
  return {
    embeds: [embed(g, {
      title: `🛍️ ${g.config.name} – Shop`,
      description: `${description}\n\n**So bestellst du:** Produkt auswählen → Warenkorb → Bestellen. Danach öffnet sich ein privates Bestell-Ticket mit den Zahlungsinfos.`,
      timestamp: false,
    })],
    components,
  };
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
  if (next === 'delivered' && g.config.customerRoleId) {
    const m = await interaction.guild.members.fetch(o.userId).catch(() => null);
    if (m) await m.roles.add(g.config.customerRoleId, `Bestellung #${pad(o.no)} geliefert`).catch(() => {});
  }
  const u = await interaction.client.users.fetch(o.userId).catch(() => null);
  if (u) await u.send({ embeds: [embed(g, { title: `Bestellung #${pad(o.no)} bei ${g.config.name}`, description: `${st.emoji} Neuer Status: **${st.label}**` })] }).catch(() => {});
  await ctx.log(interaction.guild, { title: `📦 Bestellung #${pad(o.no)}`, description: `${st.emoji} ${st.label} – von <@${interaction.user.id}>` });
  return undefined;
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
    delete g.products[p.id];
    ctx.store.save();
    await refreshPanel(interaction.guild, g);
    return interaction.reply(ok(g, `**${p.name}** wurde entfernt.`));
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

module.exports = { panel, refreshPanel, cartView, onAdd, onCart, onClear, onCheckout, onOrder, onOrderButton, onProductCommand, onAutocomplete, orderEmbed };
