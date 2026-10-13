'use strict';
// Verification (button + optional captcha) and welcome messages.
const { embed, button, row, modal, ok, fail, BTN } = require('./ui');
const { makeCaptcha, fillTemplate } = require('./logic');

const pending = new Map(); // `${guild}:${user}` → { answer, at }

function panel(g) {
  return {
    embeds: [embed(g, {
      title: `✅ Willkommen bei ${g.config.name}`,
      description: [
        '**Regeln**',
        g.config.rulesText,
        '',
        'Mit Klick auf **Verifizieren** akzeptierst du die Regeln und schaltest den Server frei.',
      ].join('\n'),
      timestamp: false,
    })],
    components: [row(button('verify:start', 'Verifizieren', BTN.success, '✅'))],
  };
}

async function grant(interaction, g) {
  const role = interaction.guild.roles.cache.get(g.config.memberRoleId);
  if (!role) return interaction.reply(fail(g, 'Die Mitglied-Rolle fehlt – bitte melde dich beim Team.'));
  if (interaction.member.roles.cache.has(role.id)) return interaction.reply(ok(g, 'Du bist bereits verifiziert.'));
  try {
    await interaction.member.roles.add(role, 'Verifiziert');
  } catch {
    return interaction.reply(fail(g, 'Ich darf dir die Rolle nicht geben – das Team muss die Bot-Rolle über die Mitglied-Rolle ziehen.'));
  }
  return interaction.reply(ok(g, `Du bist verifiziert – viel Spaß auf **${g.config.name}**!`));
}

async function onButton(interaction, ctx) {
  const g = ctx.store.guild(interaction.guildId);
  if (!g.config.captcha) return grant(interaction, g);
  if (interaction.member.roles.cache.has(g.config.memberRoleId)) return interaction.reply(ok(g, 'Du bist bereits verifiziert.'));
  const c = makeCaptcha();
  pending.set(`${interaction.guildId}:${interaction.user.id}`, { answer: c.answer, at: Date.now() });
  if (pending.size > 5000) pending.clear();
  return interaction.showModal(modal('verify:captcha', 'Kurze Prüfung', [{ id: 'answer', label: c.question, max: 4, placeholder: 'Antwort als Zahl' }]));
}

async function onModal(interaction, ctx) {
  const g = ctx.store.guild(interaction.guildId);
  const key = `${interaction.guildId}:${interaction.user.id}`;
  const p = pending.get(key);
  pending.delete(key);
  if (!p || Date.now() - p.at > 5 * 60_000) return interaction.reply(fail(g, 'Die Aufgabe ist abgelaufen – klick noch einmal auf **Verifizieren**.'));
  if (interaction.fields.getTextInputValue('answer').trim() !== p.answer) return interaction.reply(fail(g, 'Leider falsch – klick noch einmal auf **Verifizieren**.'));
  return grant(interaction, g);
}

async function welcome(member, ctx) {
  const g = ctx.store.guild(member.guild.id);
  const ch = member.guild.channels.cache.get(g.config.welcomeChannelId);
  if (!ch) return;
  const text = fillTemplate(g.config.welcomeText, {
    user: `<@${member.id}>`, server: g.config.name, verify: g.config.verifyChannelId ? `<#${g.config.verifyChannelId}>` : 'dem Verifizierungs-Kanal', count: member.guild.memberCount,
  });
  await ch.send({
    content: `<@${member.id}>`,
    embeds: [embed(g, { title: '👋 Neues Mitglied', description: text, thumbnail: member.user.displayAvatarURL?.({ size: 128 }), footer: `${g.config.name} • Mitglied #${member.guild.memberCount}` })],
    allowedMentions: { users: [member.id] },
  }).catch(() => {});
}

module.exports = { panel, onButton, onModal, welcome, pending };
