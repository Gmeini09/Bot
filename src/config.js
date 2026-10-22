'use strict';
// /config: all settings in one place.
const { embed, ok, fail } = require('./ui');
const { parseColor } = require('./logic');

const ch = (id) => (id ? `<#${id}>` : '–');
const ro = (id) => (id ? `<@&${id}>` : '–');
const onOff = (v) => (v ? '🟢 an' : '🔴 aus');

function show(g) {
  const c = g.config, a = c.automod;
  return embed(g, {
    title: `⚙️ Einstellungen – ${c.name}`,
    fields: [
      { name: 'Rollen', value: `Team: ${(c.staffRoleIds || []).map(ro).join(' ') || '–'}\nVerifiziert: ${ro(c.memberRoleId)}\nKunde: ${ro(c.customerRoleId)}`, inline: true },
      { name: 'Kanäle', value: `Willkommen: ${ch(c.welcomeChannelId)}\nVerifizieren: ${ch(c.verifyChannelId)}\nShop: ${ch(c.shopChannelId)}\nTickets: ${ch(c.supportChannelId)}\nMod-Log: ${ch(c.modLogChannelId)}\nTicket-Log: ${ch(c.ticketLogChannelId)}\nTicket-Kategorie: ${ch(c.ticketCategoryId)}\nBestell-Kategorie: ${ch(c.orderCategoryId)}\nGiveaways: ${ch(c.giveawayChannelId)}\nFeedback: ${ch(c.feedbackChannelId)}\nRollen-Panel: ${ch(c.rolesChannelId)}\nMitgliederliste: ${ch(c.memberListChannelId)}`, inline: true },
      { name: 'Verifizierung', value: `Captcha: ${onOff(c.captcha)}` },
      { name: 'Automod', value: `Gesamt: ${onOff(a.enabled)} · Spam: ${onOff(a.spam)} · Einladungen: ${onOff(a.invites)}\nMax. Erwähnungen: ${a.maxMentions} · Timeout ab ${a.warnTimeoutAt || '–'} Verwarnungen\nMindestalter: ${a.minAccountAgeDays ? `${a.minAccountAgeDays} Tage` : 'aus'} · Raid ab ${a.raidJoins} Beitritten in ${a.raidSeconds} s` },
      { name: 'Zahlung', value: c.paymentInfo },
      { name: 'Willkommenstext', value: c.welcomeText },
    ],
  });
}

async function onCommand(interaction, ctx) {
  const g = ctx.store.guild(interaction.guildId);
  const c = g.config;
  const sub = interaction.options.getSubcommand();
  const o = interaction.options;
  if (sub === 'anzeigen') return interaction.reply({ embeds: [show(g)], flags: 64 });
  if (sub === 'name') c.name = o.getString('name', true).trim();
  else if (sub === 'farbe') {
    const col = parseColor(o.getString('hex', true));
    if (col === null) return interaction.reply(fail(g, 'Ungültige Farbe – z. B. `#c9a227`.'));
    c.color = col;
  } else if (sub === 'teamrolle') {
    const id = o.getRole('rolle', true).id;
    c.staffRoleIds = (c.staffRoleIds || []).includes(id) ? c.staffRoleIds.filter((x) => x !== id) : [...(c.staffRoleIds || []), id];
  } else if (sub === 'kundenrolle') c.customerRoleId = o.getRole('rolle')?.id ?? null;
  else if (sub === 'kanal') {
    const key = o.getString('art', true);
    const chan = o.getChannel('kanal', true);
    const wantsCategory = key === 'ticketCategoryId' || key === 'orderCategoryId';
    if (wantsCategory !== (chan.type === 4)) return interaction.reply(fail(g, wantsCategory ? 'Bitte eine Kategorie wählen.' : 'Bitte einen Textkanal wählen, keine Kategorie.'));
    c[key] = chan.id;
    const panel = { verifyChannelId: 'verify', shopChannelId: 'shop', supportChannelId: 'tickets' }[key];
    if (panel) delete g.panels[panel]; // the panel is posted in the new channel
    if (key === 'memberListChannelId') g.panels.memberList = [];
  }
  else if (sub === 'mitgliedrolle') c.memberRoleId = o.getRole('rolle', true).id;
  else if (sub === 'zahlung') c.paymentInfo = o.getString('text', true).replace(/\\n/g, '\n');
  else if (sub === 'willkommen') c.welcomeText = o.getString('text', true).replace(/\\n/g, '\n');
  else if (sub === 'regeln') c.rulesText = o.getString('text', true).replace(/\\n/g, '\n');
  else if (sub === 'captcha') c.captcha = o.getBoolean('an', true);
  else if (sub === 'automod') {
    const a = c.automod;
    const map = { aktiv: ['enabled', 'Boolean'], spam: ['spam', 'Boolean'], einladungen: ['invites', 'Boolean'], max_erwaehnungen: ['maxMentions', 'Integer'], verwarnungen_timeout: ['warnTimeoutAt', 'Integer'], mindestalter_tage: ['minAccountAgeDays', 'Integer'], raid_joins: ['raidJoins', 'Integer'] };
    for (const [opt, [key, kind]] of Object.entries(map)) {
      const v = o[`get${kind}`](opt);
      if (v !== null) { a[key] = v; if (key === 'spam') a.duplicates = v; }
    }
  }
  ctx.store.save();
  // texts that appear in panels → refresh them
  if (['name', 'farbe', 'regeln', 'kanal', 'mitgliedrolle'].includes(sub)) await ctx.refreshPanels(interaction.guild, g);
  return interaction.reply({ ...ok(g, 'Gespeichert.'), embeds: [ok(g, 'Gespeichert.').embeds[0], show(g)] });
}

module.exports = { onCommand, show };
