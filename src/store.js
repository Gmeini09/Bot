'use strict';
// Persistent JSON store, one object per server. Lives on the Railway volume (DATA_DIR / RAILWAY_VOLUME_MOUNT_PATH).
// Writes are atomic (temp file + rename) and debounced, so a crash never leaves a half-written file.
const fs = require('fs');
const path = require('path');

const DEFAULT_TICKET_TYPES = [
  { id: 'support', label: 'Support', emoji: '🎫', description: 'Hilfe bei Problemen oder Fragen' },
  { id: 'bestellung', label: 'Bestellung', emoji: '🛒', description: 'Fragen zu einer Bestellung oder einem Produkt' },
  { id: 'bewerbung', label: 'Bewerbung', emoji: '📝', description: 'Bewirb dich für das Team' },
  { id: 'report', label: 'Report', emoji: '🚨', description: 'Einen Nutzer oder Vorfall melden' },
];

function defaultGuild() {
  return {
    config: {
      name: 'XVY Imperium',
      color: 0xc9a227,
      staffRoleIds: [], // team roles: see tickets/orders, exempt from automod
      memberRoleId: null,
      customerRoleId: null,
      welcomeChannelId: null,
      verifyChannelId: null,
      rulesText: [
        '1. Respektvoller Umgang – keine Beleidigungen, Hetze oder Drohungen.',
        '2. Kein Spam, keine Werbung und keine fremden Einladungslinks.',
        '3. Keine NSFW-, Gewalt- oder illegalen Inhalte.',
        '4. Anweisungen des Teams sind zu befolgen.',
        '5. Käufe und Support laufen ausschließlich über Tickets.',
      ].join('\n'),
      welcomeText: 'Willkommen im **{server}**, {user}! Bitte verifiziere dich in {verify}, um alle Kanäle zu sehen.',
      captcha: true,
      supportChannelId: null,
      ticketCategoryId: null,
      ticketLogChannelId: null,
      ticketTypes: DEFAULT_TICKET_TYPES.map((t) => ({ ...t })),
      shopChannelId: null,
      orderCategoryId: null,
      giveawayChannelId: null,
      feedbackChannelId: null,
      rolesChannelId: null,
      paymentInfo: 'Die Zahlungsinformationen erhältst du im Bestell-Ticket vom Team.',
      currency: 'EUR',
      modLogChannelId: null,
      automod: {
        enabled: true,
        spam: true, // more than spamMessages messages in spamSeconds
        spamMessages: 6,
        spamSeconds: 7,
        duplicates: true, // the same message 4 times in 20 s
        invites: true, // foreign Discord invite links
        maxMentions: 5, // more user mentions in one message
        warnTimeoutAt: 3, // that many warnings → 1 h timeout
        minAccountAgeDays: 0, // 0 = off
        raidJoins: 8, // that many joins …
        raidSeconds: 30, // … within this many seconds = raid mode
      },
    },
    panels: {},
    tickets: {},
    ticketCounter: 0,
    warns: {},
    products: {},
    productCounter: 0,
    carts: {},
    orders: {},
    orderCounter: 0,
    giveaways: {},
    giveawayCounter: 0,
    selfRoles: [],
  };
}

/** Fills keys that were added in newer versions without touching what is stored. */
function migrate(g) {
  const d = defaultGuild();
  const out = { ...d, ...g };
  out.config = { ...d.config, ...(g.config || {}) };
  out.config.automod = { ...d.config.automod, ...((g.config || {}).automod || {}) };
  if (!Array.isArray(out.config.ticketTypes) || !out.config.ticketTypes.length) out.config.ticketTypes = DEFAULT_TICKET_TYPES;
  if (!Array.isArray(out.config.staffRoleIds)) out.config.staffRoleIds = [];
  if (out.config.staffRoleId && !out.config.staffRoleIds.includes(out.config.staffRoleId)) out.config.staffRoleIds.push(out.config.staffRoleId);
  delete out.config.staffRoleId;
  for (const k of ['panels', 'tickets', 'warns', 'products', 'carts', 'orders', 'giveaways']) if (!out[k] || typeof out[k] !== 'object') out[k] = {};
  if (!Array.isArray(out.selfRoles)) out.selfRoles = [];
  return out;
}

class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'xvy-bot.json');
    this.data = { guilds: {} };
    this.timer = null;
    fs.mkdirSync(dir, { recursive: true });
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (raw && typeof raw === 'object' && raw.guilds) this.data = raw;
    } catch (e) {
      if (e.code !== 'ENOENT') {
        // keep the broken file for inspection instead of overwriting it
        try { fs.copyFileSync(this.file, `${this.file}.broken-${Date.now()}`); } catch { /* ignore */ }
        console.error('⚠️ Datenspeicher nicht lesbar – starte mit leerem Speicher:', e.message);
      }
    }
  }

  guild(id) {
    const cur = this.data.guilds[id];
    if (!cur) this.data.guilds[id] = defaultGuild();
    else if (!cur.__v || cur.__v < 3) this.data.guilds[id] = migrate(cur);
    this.data.guilds[id].__v = 3;
    return this.data.guilds[id];
  }

  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 300);
    if (this.timer.unref) this.timer.unref();
  }

  flush() {
    clearTimeout(this.timer);
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1));
    fs.renameSync(tmp, this.file);
  }
}

module.exports = { Store, defaultGuild, migrate, DEFAULT_TICKET_TYPES };
