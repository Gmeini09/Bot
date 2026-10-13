'use strict';
// /stats: orders, revenue, top products, ratings, tickets and giveaways – for the team.
const { embed } = require('./ui');
const { money } = require('./logic');

const DAY = 86_400_000;

function summarize(g, now = Date.now()) {
  const orders = Object.values(g.orders);
  const paid = orders.filter((o) => o.status === 'paid' || o.status === 'delivered');
  const sum = (list) => Math.round(list.reduce((a, o) => a + (o.total || 0), 0) * 100) / 100;
  const recent = (list, days) => list.filter((o) => now - o.createdAt < days * DAY);
  const qty = {};
  for (const o of paid) for (const l of o.items || []) qty[l.name] = (qty[l.name] || 0) + l.qty;
  const top = Object.entries(qty).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const ratings = orders.filter((o) => o.feedback?.stars).map((o) => o.feedback.stars);
  const avg = ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : null;
  const by = (s) => orders.filter((o) => o.status === s).length;
  const gws = Object.values(g.giveaways || {});
  return {
    orders: orders.length, open: by('open'), paid: by('paid'), delivered: by('delivered'), cancelled: by('cancelled'),
    revenue: sum(paid), revenue30: sum(recent(paid, 30)), revenue7: sum(recent(paid, 7)), orders30: recent(orders, 30).length,
    customers: new Set(paid.map((o) => o.userId)).size, top, ratings: ratings.length, avg,
    openTickets: Object.keys(g.tickets).length, tickets: g.ticketCounter,
    giveaways: gws.length, giveawaysRunning: gws.filter((x) => !x.ended).length, giveawayEntries: gws.reduce((a, x) => a + x.entrants.length, 0),
    warns: Object.values(g.warns).reduce((a, w) => a + w.length, 0),
  };
}

const stars = (avg) => (avg == null ? '–' : `${'⭐'.repeat(Math.round(avg))} ${String(avg).replace('.', ',')} / 5`);

async function onCommand(interaction, ctx) {
  const g = ctx.store.guild(interaction.guildId);
  const s = summarize(g);
  const cur = g.config.currency;
  const m = (v) => (v === 0 ? '0,00 €' : money(v, cur));
  return interaction.reply({ embeds: [embed(g, {
    title: `📊 Statistik – ${g.config.name}`,
    fields: [
      { name: '🛒 Bestellungen', value: `Gesamt: **${s.orders}** (30 Tage: ${s.orders30})\n🟡 offen ${s.open} · 🔵 bezahlt ${s.paid} · 🟢 geliefert ${s.delivered} · 🔴 storniert ${s.cancelled}`, inline: false },
      { name: '💶 Umsatz', value: `Gesamt: **${m(s.revenue)}**\n30 Tage: ${m(s.revenue30)} · 7 Tage: ${m(s.revenue7)}\nKunden: ${s.customers}`, inline: true },
      { name: '🏆 Top-Produkte', value: s.top.length ? s.top.map(([n, q], i) => `${i + 1}. ${n} – ${q}×`).join('\n') : '–', inline: true },
      { name: '⭐ Bewertungen', value: `${stars(s.avg)} (${s.ratings})`, inline: true },
      { name: '🎫 Tickets', value: `Offen: ${s.openTickets} · Gesamt: ${s.tickets}`, inline: true },
      { name: '🎉 Giveaways', value: `${s.giveaways} (laufend: ${s.giveawaysRunning}) · ${s.giveawayEntries} Teilnahmen`, inline: true },
      { name: '🛡️ Verwarnungen', value: String(s.warns), inline: true },
      { name: '👥 Mitglieder', value: String(interaction.guild.memberCount ?? '–'), inline: true },
    ],
  })], flags: 64 });
}

module.exports = { summarize, onCommand };
