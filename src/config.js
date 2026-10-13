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
      { name: 'Rollen', value: `Team: ${ro(c.staffRoleId)}\nMitglied: ${ro(c.memberRoleId)}\nKunde: ${ro(c.customerRoleId)}`, inline: true },
      { name: 'Kanäle', value: `Willkommen: ${ch(c.welcomeChannelId)}\nVerifizieren: ${ch(c.verifyChannelId)}\nShop: ${ch(c.shopChannelId)}\nSupport: ${ch(c.supportChannelId)}\nMod-Log: ${ch(c.modLogChannelId)}\nTicket-Log: ${ch(c.ticketLogChannelId)}`, inline: true },
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
  if (sub === 'anzeigen') return interaction.reply({ embeds: [show(g)], ephemeral: true });
  if (sub === 'name') c.name = o.getString('name', true).trim();
  else if (sub === 'farbe') {
    const col = parseColor(o.getString('hex', true));
    if (col === null) return interaction.reply(fail(g, 'Ungültige Farbe – z. B. `#c9a227`.'));
    c.color = col;
  } else if (sub === 'teamrolle') c.staffRoleId = o.getRole('rolle', true).id;
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
  if (['name', 'farbe', 'regeln'].includes(sub)) await ctx.refreshPanels(interaction.guild, g);
  return interaction.reply({ ...ok(g, 'Gespeichert.'), embeds: [ok(g, 'Gespeichert.').embeds[0], show(g)] });
}

module.exports = { onCommand, show };
