'use strict';
// The permissions the bot really needs (no Administrator) and a check that tells the owner what is missing –
// on the server and in each channel the bot uses.

const P = {
  KICK: 1n << 1n, BAN: 1n << 2n, ADMIN: 1n << 3n, MANAGE_CHANNELS: 1n << 4n, MANAGE_GUILD: 1n << 5n, REACT: 1n << 6n,
  AUDIT_LOG: 1n << 7n, VIEW: 1n << 10n, SEND: 1n << 11n, MANAGE_MESSAGES: 1n << 13n, EMBED: 1n << 14n, ATTACH: 1n << 15n,
  HISTORY: 1n << 16n, EXTERNAL_EMOJI: 1n << 18n, CHANGE_NICK: 1n << 26n, MANAGE_NICKS: 1n << 27n, MANAGE_ROLES: 1n << 28n,
  THREAD_SEND: 1n << 38n, MODERATE: 1n << 40n,
};

const NAMES = {
  KICK: 'Mitglieder kicken', BAN: 'Mitglieder bannen', MANAGE_CHANNELS: 'Kanäle verwalten', MANAGE_GUILD: 'Server verwalten (für Invite-Tracking)',
  REACT: 'Reaktionen hinzufügen', AUDIT_LOG: 'Audit-Log anzeigen', VIEW: 'Kanäle ansehen', SEND: 'Nachrichten senden',
  MANAGE_MESSAGES: 'Nachrichten verwalten', EMBED: 'Links einbetten', ATTACH: 'Dateien anhängen', HISTORY: 'Nachrichtenverlauf lesen',
  EXTERNAL_EMOJI: 'Externe Emojis verwenden', CHANGE_NICK: 'Nickname ändern', MANAGE_NICKS: 'Nicknames verwalten',
  MANAGE_ROLES: 'Rollen verwalten', THREAD_SEND: 'Nachrichten in Threads senden', MODERATE: 'Mitglieder im Timeout',
};

const NEEDED = Object.keys(NAMES);
const REQUIRED = NEEDED.reduce((a, k) => a | P[k], 0n);
const inviteUrl = (clientId) => `https://discord.com/oauth2/authorize?client_id=${clientId}&permissions=${REQUIRED}&scope=bot%20applications.commands`;

const has = (bits, p) => (BigInt(bits) & P.ADMIN) === P.ADMIN || (BigInt(bits) & p) === p;
const bitsOf = (perms) => (perms == null ? 0n : typeof perms === 'object' ? (perms.bitfield != null ? BigInt(perms.bitfield) : 0n) : BigInt(perms));

// what the bot does in each configured channel
const TEXT_NEED = ['VIEW', 'SEND', 'EMBED', 'HISTORY'];
const CHANNELS = {
  welcomeChannelId: ['Willkommen', [...TEXT_NEED, 'ATTACH']], verifyChannelId: ['Verifizieren', TEXT_NEED], shopChannelId: ['Shop', [...TEXT_NEED, 'ATTACH']],
  supportChannelId: ['Tickets', TEXT_NEED], modLogChannelId: ['Mod-Log', TEXT_NEED], ticketLogChannelId: ['Ticket-Log', [...TEXT_NEED, 'ATTACH']],
  giveawayChannelId: ['Giveaways', TEXT_NEED], feedbackChannelId: ['Feedback', TEXT_NEED], rolesChannelId: ['Rollen', TEXT_NEED],
  memberListChannelId: ['Mitgliederliste', TEXT_NEED],
  ticketCategoryId: ['Ticket-Kategorie', ['VIEW', 'MANAGE_CHANNELS']], orderCategoryId: ['Bestell-Kategorie', ['VIEW', 'MANAGE_CHANNELS']],
};

/** { admin, missing: [names], channels: [{ label, id, missing }] } – what the bot lacks right now. */
function check(guild, g) {
  const me = guild.members.me;
  const bits = bitsOf(me?.permissions);
  const admin = (bits & P.ADMIN) === P.ADMIN;
  const missing = NEEDED.filter((k) => !has(bits, P[k])).map((k) => NAMES[k]);
  const byId = new Map(); // one line per channel, even if it is used for several things
  for (const [key, [label, need]] of Object.entries(CHANNELS)) {
    const id = g.config[key];
    const ch = id && guild.channels.cache.get(id);
    if (!ch || typeof ch.permissionsFor !== 'function') continue;
    const cb = bitsOf(ch.permissionsFor(me));
    const miss = need.filter((k) => !has(cb, P[k])).map((k) => NAMES[k]);
    if (!miss.length) continue;
    const cur = byId.get(id) || { label: [], id, missing: [] };
    cur.label.push(label);
    for (const m of miss) if (!cur.missing.includes(m)) cur.missing.push(m);
    byId.set(id, cur);
  }
  const channels = [...byId.values()].map((c) => ({ ...c, label: c.label.join(', ') }));
  return { admin, missing, channels };
}

/** Lines for /setup and the start log. */
function report(guild, g) {
  const r = check(guild, g);
  const out = [];
  if (r.admin) out.push('⚠️ **Der Bot hat Administrator-Rechte.** Nimm sie ihm weg (Servereinstellungen → Rollen → Bot-Rolle) – die Liste unten reicht.');
  if (r.missing.length) out.push(`❌ Fehlende Server-Rechte: ${r.missing.join(', ')}`);
  for (const c of r.channels) out.push(`❌ <#${c.id}> (${c.label}): ${c.missing.join(', ')}`);
  if (!out.length) out.push('✅ Rechte: alles da, ohne Administrator.');
  return { ...r, lines: out, ok: !r.admin && !r.missing.length && !r.channels.length };
}

module.exports = { P, NAMES, REQUIRED, inviteUrl, check, report };
