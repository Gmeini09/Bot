'use strict';
// Giveaways: /giveaway start → message with a join button; winners are drawn automatically when the time is up
// (checked every 15 s, so a restart of the bot never loses a giveaway).
const { randomInt } = require('crypto');
const { embed, button, row, ok, fail, BTN } = require('./ui');
const { parseDuration } = require('./logic');

const ts = (ms) => Math.floor(ms / 1000);

function view(g, gw) {
  const ended = gw.ended;
  const lines = [
    gw.description ? `${gw.description}\n` : '',
    ended ? `**Beendet** <t:${ts(gw.endedAt || gw.endsAt)}:R>` : `**Endet** <t:${ts(gw.endsAt)}:R> (<t:${ts(gw.endsAt)}:f>)`,
    `**Gewinner:** ${ended ? (gw.winnerIds.length ? gw.winnerIds.map((id) => `<@${id}>`).join(', ') : 'niemand – keine Teilnehmer') : gw.winners}`,
    `**Teilnehmer:** ${gw.entrants.length}`,
    `**Gestartet von:** <@${gw.hostId}>`,
  ].filter(Boolean);
  return {
    embeds: [embed(g, { title: `🎉 ${gw.prize}`, description: lines.join('\n'), color: ended ? 0x95a5a6 : 0xf1c40f, footer: `${g.config.name} • Giveaway ${gw.id}` })],
    components: [row(button(`gw:${gw.id}`, ended ? 'Beendet' : `Teilnehmen (${gw.entrants.length})`, ended ? BTN.secondary : BTN.success, '🎉', ended))],
  };
}

/** Draws `count` different winners from `pool` (crypto random). */
function draw(pool, count) {
  const left = [...pool];
  const out = [];
  while (left.length && out.length < count) out.push(left.splice(randomInt(left.length), 1)[0]);
  return out;
}

async function finish(guild, g, gw, ctx, reroll = false) {
  const prev = gw.winnerIds || [];
  const pool = reroll ? gw.entrants.filter((id) => !prev.includes(id)) : gw.entrants;
  gw.winnerIds = draw(pool, gw.winners);
  gw.ended = true;
  gw.endedAt ||= Date.now();
  ctx.store.save();
  const ch = guild.channels.cache.get(gw.channelId);
  if (ch) {
    const msg = await ch.messages.fetch(gw.messageId).catch(() => null);
    if (msg) await msg.edit(view(g, gw)).catch(() => {});
    const text = gw.winnerIds.length
      ? `🎉 Glückwunsch ${gw.winnerIds.map((id) => `<@${id}>`).join(', ')}! Du hast **${gw.prize}** gewonnen${reroll ? ' (neu gezogen)' : ''}. Melde dich per Ticket beim Team.`
      : `Für **${gw.prize}** hat niemand teilgenommen – kein Gewinner.`;
    await ch.send({ content: text, allowedMentions: { users: gw.winnerIds } }).catch(() => {});
  }
  await ctx.log(guild, { title: `🎉 Giveaway ${gw.id} ${reroll ? 'neu gezogen' : 'beendet'}`, description: `**${gw.prize}** – ${gw.entrants.length} Teilnehmer\nGewinner: ${gw.winnerIds.map((id) => `<@${id}>`).join(', ') || '–'}`, color: 0xf1c40f });
}

/** Ends every giveaway whose time is up (called on a timer). */
async function tick(ctx, now = Date.now()) {
  for (const guild of ctx.client.guilds.cache.values()) {
    const g = ctx.store.guild(guild.id);
    for (const gw of Object.values(g.giveaways)) {
      if (!gw.ended && gw.endsAt <= now) await finish(guild, g, gw, ctx).catch((e) => console.error('giveaway', gw.id, e.message));
    }
  }
}

function find(g, q) {
  const s = String(q || '').trim().toUpperCase();
  return g.giveaways[s] || Object.values(g.giveaways).find((x) => x.prize.toLowerCase() === String(q || '').trim().toLowerCase());
}

/** Manage Server, the team, or the giveaway role (config.giveawayRoleId). */
function mayHost(member, g) {
  const { isStaff } = require('./tickets');
  return isStaff(member, g) || (!!g.config.giveawayRoleId && !!member?.roles?.cache?.has(g.config.giveawayRoleId));
}

async function onCommand(interaction, ctx) {
  const g = ctx.store.guild(interaction.guildId);
  if (!mayHost(interaction.member, g)) return interaction.reply(fail(g, 'Giveaways dürfen nur das Team und Mitglieder mit der Rolle **giveaway perms** starten.'));
  const sub = interaction.options.getSubcommand();
  if (sub === 'liste') {
    const all = Object.values(g.giveaways).sort((a, b) => b.endsAt - a.endsAt).slice(0, 15);
    return interaction.reply({ embeds: [embed(g, { title: '🎉 Giveaways', description: all.length ? all.map((x) => `\`${x.id}\` ${x.ended ? '⚪' : '🟢'} **${x.prize}** – ${x.entrants.length} Teilnehmer – ${x.ended ? 'beendet' : `endet <t:${ts(x.endsAt)}:R>`}`).join('\n') : 'Noch keine Giveaways. `/giveaway start`' })], flags: 64 });
  }
  if (sub === 'start') {
    const ms = parseDuration(interaction.options.getString('dauer', true));
    if (!ms) return interaction.reply(fail(g, 'Ungültige Dauer – z. B. `30m`, `2h`, `1d` oder `1d12h` (1 Minute bis 30 Tage).'));
    const target = interaction.options.getChannel('kanal') || interaction.guild.channels.cache.get(g.config.giveawayChannelId) || interaction.channel;
    if (!target?.send) return interaction.reply(fail(g, 'In diesen Kanal kann ich nicht schreiben.'));
    const gw = {
      id: `G${++g.giveawayCounter}`, prize: interaction.options.getString('preis', true).trim(), description: interaction.options.getString('beschreibung')?.trim() || '',
      winners: interaction.options.getInteger('gewinner') || 1, endsAt: Date.now() + ms, channelId: target.id, messageId: null,
      hostId: interaction.user.id, entrants: [], ended: false, winnerIds: [], createdAt: Date.now(),
    };
    const msg = await target.send(view(g, gw));
    gw.messageId = msg.id;
    g.giveaways[gw.id] = gw;
    ctx.store.save();
    await ctx.log(interaction.guild, { title: `🎉 Giveaway ${gw.id} gestartet`, description: `**${gw.prize}** in <#${target.id}> – endet <t:${ts(gw.endsAt)}:R>\nVon <@${interaction.user.id}>`, color: 0xf1c40f });
    return interaction.reply(ok(g, `Giveaway **${gw.prize}** läuft: ${msg.url}`));
  }
  const gw = find(g, interaction.options.getString('giveaway', true));
  if (!gw) return interaction.reply(fail(g, 'Giveaway nicht gefunden.'));
  if (sub === 'beenden') {
    if (gw.ended) return interaction.reply(fail(g, 'Dieses Giveaway ist schon beendet – `/giveaway neu-ziehen` zieht neue Gewinner.'));
    await interaction.deferReply({ flags: 64 });
    await finish(interaction.guild, g, gw, ctx);
    return interaction.editReply(ok(g, `Beendet – Gewinner: ${gw.winnerIds.map((id) => `<@${id}>`).join(', ') || 'keine'}`));
  }
  // neu-ziehen
  if (!gw.ended) return interaction.reply(fail(g, 'Das Giveaway läuft noch – erst `/giveaway beenden`.'));
  await interaction.deferReply({ flags: 64 });
  await finish(interaction.guild, g, gw, ctx, true);
  return interaction.editReply(ok(g, `Neu gezogen: ${gw.winnerIds.map((id) => `<@${id}>`).join(', ') || 'keine weiteren Teilnehmer'}`));
}

async function onJoin(interaction, ctx) {
  const g = ctx.store.guild(interaction.guildId);
  const gw = g.giveaways[interaction.customId.split(':')[1]];
  if (!gw) return interaction.reply(fail(g, 'Dieses Giveaway gibt es nicht mehr.'));
  if (gw.ended || gw.endsAt <= Date.now()) return interaction.reply(fail(g, 'Dieses Giveaway ist schon vorbei.'));
  const i = gw.entrants.indexOf(interaction.user.id);
  if (i >= 0) gw.entrants.splice(i, 1); else gw.entrants.push(interaction.user.id);
  ctx.store.save();
  await interaction.update(view(g, gw));
  return interaction.followUp(ok(g, i >= 0 ? 'Du bist ausgetragen. Klick nochmal, um wieder mitzumachen.' : `Du bist dabei – viel Glück bei **${gw.prize}**! 🍀`));
}

async function onAutocomplete(interaction, ctx) {
  const g = ctx.store.guild(interaction.guildId);
  const q = String(interaction.options.getFocused() || '').toLowerCase();
  const sub = interaction.options.getSubcommand();
  const list = Object.values(g.giveaways).filter((x) => (sub === 'beenden' ? !x.ended : x.ended) && (`${x.id} ${x.prize}`.toLowerCase().includes(q))).slice(0, 25);
  return interaction.respond(list.map((x) => ({ name: `${x.id} – ${x.prize}`.slice(0, 100), value: x.id })));
}

module.exports = { view, draw, finish, tick, onCommand, onJoin, onAutocomplete, mayHost };
