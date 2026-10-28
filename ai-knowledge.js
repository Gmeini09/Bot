'use strict';
// What the KI-Chat knows about Turbo Designs: persona and the live shop catalog (selling-data.json on the volume,
// the same file the website feed reads). Read fresh for every answer, so price changes apply at once.
const fs = require('fs');
const path = require('path');

// Mirrors PRODUCT_TYPES in selling-entry.js (that file starts the bot, so it can't be required here).
const PRODUCTS = {
  thumbnail: { label: 'Thumbnail', delivery: '1–3 Tage' },
  nve: { label: 'NVE Preset / Grafik-Setup', delivery: '1–3 Tage' },
  soundpack: { label: 'Soundpack', delivery: '1–2 Tage' },
  grafik: { label: 'Grafik / Design', delivery: '1–4 Tage' },
  fivem: { label: 'FiveM Asset', delivery: 'nach Umfang' },
  bot: { label: 'Custom Discord Bot', delivery: 'nach Umfang' },
  bundle: { label: 'Bundle / Komplettpaket', delivery: 'nach Umfang' },
  sptool: { label: 'SP Tool (Soundpack Tool)', delivery: 'Lizenz-Key per DM' },
};
const SPTOOL_PLANS = 'Woche 10 €, Monat 15 €, Lifetime 20 €';

const PERSONA = 'Du bist der KI-Assistent von Turbo Designs auf dem Discord-Server „{server}“ – hilfsbereit, locker und kompetent. '
  + 'Turbo Designs macht Thumbnails, Grafiken, Soundpacks, NVE Presets, FiveM Assets, Discord Bots und das SP Tool. '
  + 'Bei Fragen zu Produkten hilfst du gern und machst Lust auf eine Bestellung, ohne aufdringlich zu sein.';

const euro = (n) => `${Number(n).toLocaleString('de-DE', { minimumFractionDigits: Number.isInteger(Number(n)) ? 0 : 2, maximumFractionDigits: 2 })} €`;

function readGuild(guildId) {
  const dir = process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.DATA_DIR || __dirname;
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'selling-data.json'), 'utf8')).guilds?.[guildId] || null; } catch { return null; }
}

function knowledge(guild) {
  const data = readGuild(guild.id);
  const lines = [];
  for (const [key, info] of Object.entries(PRODUCTS)) {
    const p = data?.products?.[key];
    if (p && p.enabled === false) continue;
    const price = p?.price === null || p?.price === undefined || p?.price === '' ? null : Number(p.price);
    const priceText = Number.isFinite(price) && price >= 0 ? euro(price) : key === 'sptool' ? SPTOOL_PLANS : 'Preis auf Anfrage (im Ticket)';
    lines.push(`- ${info.label}: ${priceText} · Lieferung ${info.delivery}${p?.description ? ` – ${p.description}` : ''}`);
  }
  return [
    `Produkte und Preise:\n${lines.join('\n')}`,
    'Bestellen: über das Shop-/Bestell-Panel auf dem Server (öffnet ein privates Bestell-Ticket) oder auf https://turbodesigns.net. Bezahlt wird per PayPal, die Details stehen im Ticket.',
    'Support, Fragen zu einer laufenden Bestellung, Partnerschaften: Ticket öffnen. Das Team antwortet dort.',
    'Das SP Tool ist eine Lizenz (Key per DM); Hilfe dazu gibt es über /sptool oder ein Ticket.',
  ].join('\n\n');
}

// "Ticket öffnen" under an answer = the bot's own support-ticket button (index.js, ticket_create:*);
// the KI's summary is then posted into the new ticket, recognised by its topic.
const TICKET = { customId: 'ticket_create:support', match: (channel, userId) => String(channel.topic || '').startsWith(`ticket-owner:${userId}|`) };

module.exports = { PERSONA, knowledge, TICKET };
