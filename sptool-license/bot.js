'use strict';
// SP Tool license system inside the Discord bot.
//
//  • Serves the SP Tool license API (/api/v1/...) on the bot's existing web server (Railway domain).
//  • Adds two GLOBAL slash commands (separate from the 100 guild-command limit):
//      /sptool        – users: show license, redeem key, list devices
//      /sptool-admin  – admins: grant/revoke licenses, reset devices (HWID), ban, keys, stats, setup
//  • Data lives in SQLite on the persistent volume (sptool-license.db). The signing key and the
//    HWID salt are created there on first start if they are not given as variables.
//
// Load it before the rest of the bot:  require('./sptool-license/bot.js');
// Disable with SPTOOL_LICENSE_ENABLED=false. Never crashes the bot: on any setup error it logs and stays off.

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { Client, Events, REST, Routes, MessageFlags } = require('discord.js');

const OWNER_ID = '697402284849627180';
// Public key built into the current SP Tool app release (shown in /sptool-admin setup to spot a mismatch).
const APP_PUBKEY = process.env.SPTOOL_APP_PUBKEY || '5iVZDgeKEizromOavt_4watv_TymaL7np_99Lys_gEQ';
const ENABLED = String(process.env.SPTOOL_LICENSE_ENABLED ?? 'true').toLowerCase() !== 'false';
const COMMANDS = new Set(['sptool', 'sptool-admin']);
// Licence levels Free < Premium < Creator < Admin < Developer (tiers.cjs). Admin/Developer only by a Developer.
const tiers = require(fs.existsSync(path.join(__dirname, 'tiers.cjs')) ? './tiers.cjs' : '../tiers.cjs');
const PLAN_CHOICES = tiers.PLANS.map((p) => ({ name: tiers.LABEL[p], value: p }));
const PLAN_LABEL = tiers.LABEL;
const COLOR = { ok: 0x57f287, info: 0x5865f2, warn: 0xfee75c, err: 0xed4245 };
const ERR_DE = {
  bad_id: 'Ungültige Discord-ID.',
  bad_plan: 'Unbekannter Plan.',
  bad_key: 'Das ist kein gültiger Key (Format `SPT-XXXX-XXXX-XXXX-XXXX`).',
  key_invalid: 'Diesen Key gibt es nicht oder er wurde widerrufen.',
  key_used: 'Dieser Key wurde bereits eingelöst.',
  banned: 'Dieser Account ist für SP Tool gesperrt.',
  protected: 'Der Owner kann nicht gebannt oder herabgestuft werden.',
  owner_only: 'Das darf nur der Owner.',
  dev_only: 'Das darf nur ein Developer (Admin- und Developer-Lizenzen, Keys und Accounts).',
  forbidden: 'Nur SP Tool Admins dürfen das.',
  self: 'Das geht nicht mit deinem eigenen Account.',
  key_lower_plan: 'Dieser Key hat einen niedrigeren Plan als die aktive Lizenz – er wurde nicht verbraucht.',
  not_found: 'Nicht gefunden.',
};

const state = { ready: false, error: null, cfg: null, db: null, handler: null, svc: null, publicKey: '', dataDir: '', volume: false, limiter: null, appId: null };

// ── setup ────────────────────────────────────────────────────────────────────
function readOrCreate(file, create, mode = 0o600) {
  try { const v = fs.readFileSync(file, 'utf8').trim(); if (v) return v; } catch { /* create below */ }
  const v = create();
  fs.writeFileSync(file, v, { mode });
  return v;
}

function publicBaseUrl() {
  const explicit = process.env.SPTOOL_PUBLIC_URL || process.env.PUBLIC_BASE_URL || process.env.PUBLIC_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  return `http://localhost:${process.env.PORT || 8080}`;
}

const ready = !ENABLED ? Promise.resolve() : (async () => {
  const [{ createHandler }, { loadConfig }, { openDb }, { fetchDiscordUser }, sec] = await Promise.all([
    import('./app.mjs'), import('./config.mjs'), import('./db.mjs'), import('./discord.mjs'), import('./security.mjs'),
  ]);
  state.volume = Boolean(process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.DATA_DIR);
  state.dataDir = process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.DATA_DIR || path.join(__dirname, 'data');
  fs.mkdirSync(state.dataDir, { recursive: true });

  // Railway-friendly: the key may be given as PEM, as PEM with literal \n, or base64 of the PEM (one line).
  const envKey = String(process.env.SPTOOL_LICENSE_PRIVATE_KEY || '').trim();
  const fromEnv = !envKey ? '' : envKey.includes('BEGIN') ? envKey.replace(/\\n/g, '\n') : Buffer.from(envKey, 'base64').toString('utf8');
  const privatePem = fromEnv
    || readOrCreate(path.join(state.dataDir, 'sptool-license-ed25519.pem'), () => sec.newSigningKey().privatePem);
  const salt = process.env.SPTOOL_HWID_SALT
    || readOrCreate(path.join(state.dataDir, 'sptool-hwid-salt.txt'), () => crypto.randomBytes(32).toString('hex'));

  const cfg = loadConfig({
    PUBLIC_URL: publicBaseUrl(),
    DISCORD_CLIENT_ID: process.env.SPTOOL_DISCORD_CLIENT_ID || process.env.DISCORD_CLIENT_ID || '',
    DISCORD_CLIENT_SECRET: process.env.SPTOOL_DISCORD_CLIENT_SECRET || process.env.DISCORD_CLIENT_SECRET || '',
    ADMIN_DISCORD_IDS: process.env.SPTOOL_ADMIN_IDS || '',
    DB_PATH: path.join(state.dataDir, 'sptool-license.db'),
    LICENSE_PRIVATE_KEY: privatePem,
    HWID_SERVER_SALT: salt,
    SESSION_DAYS: process.env.SPTOOL_SESSION_DAYS,
    OFFLINE_GRACE_HOURS: process.env.SPTOOL_OFFLINE_GRACE_HOURS,
    DEFAULT_MAX_DEVICES: process.env.SPTOOL_DEFAULT_MAX_DEVICES,
    NODE_ENV: 'production',
    TRUST_PROXY: process.env.SPTOOL_TRUST_PROXY ?? '1',
    CORS_ORIGINS: '*',
  });
  state.cfg = cfg;
  state.db = openDb(cfg.dbPath);
  state.handler = createHandler({ cfg, db: state.db, discordUser: (code) => fetchDiscordUser(cfg, code) });
  state.svc = state.handler.service;
  state.publicKey = sec.publicRawFromPrivate(privatePem);
  state.limiter = sec.rateLimiter({ capacity: 5, refillPerSec: 1 / 60 });
  state.ready = true;
  console.log(`✅ SP Tool Lizenzsystem bereit – API: ${cfg.publicUrl}/api/v1 · Daten: ${state.dataDir}${state.volume ? '' : ' (⚠️ kein Volume – Daten gehen beim Redeploy verloren)'}`);
})().catch((error) => {
  state.error = error;
  console.error('❌ SP Tool Lizenzsystem deaktiviert:', error?.message || error);
});

// ── HTTP: mount /api/v1 on the bot's web server ─────────────────────────────
if (ENABLED && !http.__sptoolLicensePatch) {
  http.__sptoolLicensePatch = true;
  const original = http.createServer;
  http.createServer = function sptoolLicenseCreateServer(...args) {
    const listener = typeof args[0] === 'function' ? args[0] : (typeof args[1] === 'function' ? args[1] : null);
    if (listener) {
      const wrapped = function sptoolLicenseListener(req, res) {
        const p = String(req.url || '/').split('?')[0];
        if (!p.startsWith('/api/v1/')) return listener.call(this, req, res);
        if (!state.ready) {
          res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: 'unavailable', message: 'License server is starting or disabled.' }));
          return;
        }
        state.handler(req, res);
      };
      if (args[0] === listener) args[0] = wrapped; else args[1] = wrapped;
    }
    return original.apply(this, args);
  };
}

// ── slash commands ───────────────────────────────────────────────────────────
const S = 3, I = 4, U = 6; // option types: string, integer, user
const target = [
  { type: U, name: 'user', description: 'Discord-Benutzer' },
  { type: S, name: 'id', description: 'oder Discord-ID (auch wenn die Person nicht auf dem Server ist)', min_length: 15, max_length: 21 },
];
const commandBodies = [
  {
    name: 'sptool', description: 'SP Tool – deine Lizenz', type: 1,
    options: [
      { type: 1, name: 'lizenz', description: 'Zeigt deine SP Tool Lizenz und Discord-ID' },
      { type: 1, name: 'einloesen', description: 'Lizenz-Key einlösen', options: [{ type: S, name: 'key', description: 'SPT-XXXX-XXXX-XXXX-XXXX', required: true, min_length: 19, max_length: 30 }] },
      { type: 1, name: 'geraete', description: 'Deine gebundenen PCs (HWID)' },
    ],
  },
  {
    name: 'sptool-admin', description: 'SP Tool – Lizenzen verwalten (nur Admins)', type: 1,
    default_member_permissions: '8',
    options: [
      { type: 1, name: 'info', description: 'Lizenz, Geräte und Status eines Benutzers', options: target },
      {
        type: 1, name: 'lizenz-geben', description: 'Lizenz vergeben oder ändern',
        options: [
          { type: S, name: 'plan', description: 'Plan', required: true, choices: PLAN_CHOICES },
          ...target,
          { type: I, name: 'tage', description: 'Laufzeit in Tagen (0 oder leer = lebenslang)', min_value: 0, max_value: 36500 },
          { type: I, name: 'geraete', description: 'Erlaubte PCs (Standard 1)', min_value: 1, max_value: 20 },
          { type: S, name: 'notiz', description: 'Notiz, z. B. Bestellnummer', max_length: 200 },
        ],
      },
      { type: 1, name: 'lizenz-entziehen', description: 'Lizenz widerrufen', options: target },
      { type: 1, name: 'geraete-reset', description: 'Alle gebundenen PCs entfernen (Umzug auf neuen PC)', options: target },
      { type: 1, name: 'ban', description: 'Für SP Tool sperren', options: [...target, { type: S, name: 'grund', description: 'Grund (sieht der Benutzer)', max_length: 200 }] },
      { type: 1, name: 'unban', description: 'Sperre aufheben', options: target },
      {
        type: 1, name: 'keys-erstellen', description: 'Lizenz-Keys erzeugen (jeder einmal einlösbar)',
        options: [
          { type: S, name: 'plan', description: 'Plan', required: true, choices: PLAN_CHOICES },
          { type: I, name: 'anzahl', description: 'Anzahl (1–25)', min_value: 1, max_value: 25 },
          { type: I, name: 'tage', description: 'Laufzeit in Tagen (0 oder leer = lebenslang)', min_value: 0, max_value: 36500 },
          { type: I, name: 'geraete', description: 'Erlaubte PCs', min_value: 1, max_value: 20 },
          { type: S, name: 'notiz', description: 'Notiz', max_length: 200 },
        ],
      },
      { type: 1, name: 'key-widerrufen', description: 'Unbenutzten Key ungültig machen', options: [{ type: S, name: 'key', description: 'SPT-…', required: true }] },
      { type: 1, name: 'suche', description: 'Benutzer suchen (Name oder ID)', options: [{ type: S, name: 'text', description: 'Suchbegriff', required: true }] },
      { type: 1, name: 'admin', description: 'Admin-Rechte vergeben/entziehen (nur Owner)', options: [{ type: S, name: 'aktion', description: 'hinzufügen oder entfernen', required: true, choices: [{ name: 'hinzufügen', value: 'admin' }, { name: 'entfernen', value: 'user' }] }, ...target] },
      { type: 1, name: 'stats', description: 'Übersicht' },
      { type: 1, name: 'setup', description: 'Einrichtung: API-Adresse, Public Key, Checkliste' },
    ],
  },
];

async function registerCommands(client) {
  const token = client.token;
  if (!token || !client.application?.id) return;
  state.appId = client.application.id;
  if (state.cfg && !state.cfg.discord.clientId) state.cfg.discord.clientId = client.application.id;
  const rest = new REST({ version: '10' }).setToken(token);
  for (const body of commandBodies) {
    try {
      // POST upserts a single global command and leaves every other command untouched.
      await rest.post(Routes.applicationCommands(client.application.id), { body });
    } catch (error) {
      console.error(`❌ SP Tool Command /${body.name} konnte nicht registriert werden:`, error?.message || error);
    }
  }
  console.log('✅ SP Tool Commands registriert: /sptool, /sptool-admin (global)');
}

// ── helpers ──────────────────────────────────────────────────────────────────
const ts = (ms, style = 'D') => (ms ? `<t:${Math.floor(ms / 1000)}:${style}>` : '—');
const planText = (l) => {
  if (!l) return 'Keine Lizenz';
  if (!l.active) return l.revoked ? `~~${PLAN_LABEL[l.plan] || l.plan}~~ (widerrufen)` : `${PLAN_LABEL[l.plan] || l.plan} (abgelaufen ${ts(l.expiresAt)})`;
  return `**${PLAN_LABEL[l.plan] || l.plan}** · ${l.expiresAt ? `bis ${ts(l.expiresAt)} (${ts(l.expiresAt, 'R')})` : 'lebenslang'}`;
};
const embed = (title, description, color = COLOR.info, fields) => ({ title, description, color, fields, footer: { text: 'SP Tool Lizenzsystem' }, timestamp: new Date().toISOString() });
const reply = (i, payload) => {
  const p = { ...payload, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } };
  return i.deferred || i.replied ? i.editReply(p) : i.reply(p);
};
const errorText = (e) => ERR_DE[e?.code] || e?.message || String(e);

function resolveTarget(i) {
  const u = i.options.getUser('user');
  const id = u?.id || (i.options.getString('id') || '').trim();
  if (!/^\d{15,21}$/.test(id)) return { error: 'Gib einen **user** oder eine gültige Discord-**id** an.' };
  return { id, user: u };
}

function rememberName(id, user) {
  if (!user || !state.db) return;
  state.db.prepare('INSERT INTO users (discord_id, created_at) VALUES (?, ?) ON CONFLICT(discord_id) DO NOTHING').run(id, Date.now());
  state.db.prepare('UPDATE users SET username = COALESCE(username, ?), global_name = COALESCE(global_name, ?), avatar = COALESCE(avatar, ?) WHERE discord_id = ?')
    .run(user.username ?? null, user.globalName ?? null, user.avatar ?? null, id);
}

function deviceLines(devices) {
  const list = devices.filter((d) => !d.revoked);
  if (!list.length) return 'Noch kein PC gebunden – wird beim ersten Login in SP Tool gebunden.';
  return list.slice(0, 10).map((d) => `🖥️ **${d.name}** · ${d.kind} · zuletzt ${ts(d.lastSeen, 'R')}`).join('\n');
}

function userEmbed(id, detail, svc) {
  const lic = svc.licenseView(id);
  const u = detail?.user;
  const name = u ? (u.globalName || u.username || 'Unbekannt') : 'Noch nie in SP Tool angemeldet';
  const fields = [
    { name: 'Lizenz', value: planText(lic), inline: false },
    { name: `Geräte (${detail ? detail.devices.filter((d) => !d.revoked).length : 0}/${svc.maxDevicesFor(id)})`, value: detail ? deviceLines(detail.devices) : '—', inline: false },
  ];
  if (u) fields.push({ name: 'Status', value: [`Stufe: **${id === OWNER_ID ? 'Owner (Developer)' : PLAN_LABEL[u.tier] ?? 'Free'}**`, u.banned ? `⛔ Gebannt${u.banReason ? `: ${u.banReason}` : ''}` : '✅ Nicht gebannt', `Letzter Login: ${ts(u.lastLogin, 'R')}`].join('\n'), inline: false });
  if (lic?.note) fields.push({ name: 'Notiz', value: String(lic.note).slice(0, 200), inline: false });
  return embed(`${name}`, `<@${id}> · \`${id}\``, u?.banned ? COLOR.err : lic?.active ? COLOR.ok : COLOR.warn, fields);
}

// ── handlers ─────────────────────────────────────────────────────────────────
async function handleUser(i) {
  const svc = state.svc;
  const sub = i.options.getSubcommand();
  const me = i.user.id;
  if (sub === 'lizenz') {
    const lic = svc.licenseView(me);
    return reply(i, { embeds: [embed('🎧 Deine SP Tool Lizenz', planText(lic), lic?.active ? COLOR.ok : COLOR.warn, [
      { name: 'Deine Discord-ID', value: `\`${me}\`\nSchick sie an das Team, wenn du eine Lizenz kaufst.` },
      { name: 'So geht’s', value: 'SP Tool öffnen → **Mit Discord anmelden**. Dein PC wird dabei an deine Lizenz gebunden.' },
    ])] });
  }
  if (sub === 'geraete') {
    const devices = svc.devicesOf(me);
    return reply(i, { embeds: [embed('🖥️ Deine Geräte', deviceLines(devices), COLOR.info, [{ name: 'Limit', value: `${devices.filter((d) => !d.revoked).length} von ${svc.maxDevicesFor(me)} PCs belegt. Neuer PC? Ein Admin kann deine Geräte zurücksetzen.` }])] });
  }
  if (sub === 'einloesen') {
    if (!state.limiter(`bot:${me}`)) return reply(i, { content: '⏳ Zu viele Versuche. Warte ein paar Minuten.' });
    try {
      const lic = svc.redeemKey(me, i.options.getString('key', true));
      rememberName(me, i.user);
      return reply(i, { embeds: [embed('✅ Key eingelöst', planText(lic), COLOR.ok, [{ name: 'Nächster Schritt', value: 'SP Tool öffnen → **Mit Discord anmelden**.' }])] });
    } catch (e) {
      return reply(i, { content: `❌ ${errorText(e)}` });
    }
  }
}

async function handleAdmin(i) {
  const svc = state.svc;
  const actor = i.user.id;
  if (!svc.isAdmin(actor)) return reply(i, { content: '❌ Nur SP Tool Admins dürfen das.' });
  const sub = i.options.getSubcommand();
  try {
    if (sub === 'stats') {
      const s = svc.stats();
      return reply(i, { embeds: [embed('📊 SP Tool Übersicht', null, COLOR.info, [
        { name: 'Benutzer', value: String(s.users), inline: true }, { name: 'Aktive Lizenzen', value: String(s.activeLicenses), inline: true },
        { name: 'Gebundene PCs', value: String(s.devices), inline: true }, { name: 'Offene Keys', value: String(s.openKeys), inline: true },
        { name: 'Gebannt', value: String(s.banned), inline: true }, { name: 'Logins 24 h', value: String(s.logins24h), inline: true },
      ])] });
    }
    if (sub === 'setup') {
      const cfg = state.cfg;
      const checks = [
        `${cfg.discord.clientSecret ? '✅' : '❌'} \`DISCORD_CLIENT_SECRET\` gesetzt (Discord Developer Portal → OAuth2)`,
        `${state.volume ? '✅' : '⚠️'} Persistentes Volume (${state.dataDir})`,
        `${/^https:/.test(cfg.publicUrl) ? '✅' : '⚠️'} Öffentliche HTTPS-Adresse`,
        `${state.publicKey === APP_PUBKEY ? '✅ Signaturschlüssel passt zur App' : '⚠️ Signaturschlüssel ≠ App-Schlüssel – Apps ab v1.0.1 übernehmen den Server-Schlüssel automatisch; sonst `SPTOOL_LICENSE_PRIVATE_KEY` in Railway setzen'}`,
      ].join('\n');
      return reply(i, { embeds: [embed('⚙️ SP Tool Einrichtung', checks, COLOR.info, [
        { name: '1 · Redirect in Discord eintragen', value: `Developer Portal → deine App${state.appId ? ` (\`${state.appId}\`)` : ''} → OAuth2 → Redirects:\n\`${cfg.publicUrl}/api/v1/auth/discord/callback\`` },
        { name: '2 · App bauen mit', value: `\`SPTOOL_API_URL=${cfg.publicUrl}\`\n\`SPTOOL_LICENSE_PUBKEY=${state.publicKey}\`` },
        { name: 'Hinweis', value: 'Der Public Key ist nicht geheim. Der private Schlüssel bleibt auf dem Volume – Volume nicht löschen, sonst müssen alle die App neu installieren.' },
      ])] });
    }
    if (sub === 'keys-erstellen') {
      const keys = svc.createKeys(actor, { plan: i.options.getString('plan', true), count: i.options.getInteger('anzahl') ?? 1, days: i.options.getInteger('tage'), maxDevices: i.options.getInteger('geraete') ?? 1, note: i.options.getString('notiz') });
      const days = i.options.getInteger('tage');
      return reply(i, { content: `🔑 **${keys.length} Key${keys.length > 1 ? 's' : ''}** · ${PLAN_LABEL[i.options.getString('plan', true)]} · ${days ? `${days} Tage` : 'lebenslang'} · jeder nur einmal einlösbar\n\`\`\`\n${keys.join('\n')}\n\`\`\`` });
    }
    if (sub === 'key-widerrufen') {
      svc.revokeKey(actor, i.options.getString('key', true).trim().toUpperCase());
      return reply(i, { content: '✅ Key widerrufen.' });
    }
    if (sub === 'suche') {
      const rows = svc.searchUsers(i.options.getString('text', true)).slice(0, 15);
      const text = rows.length ? rows.map((u) => `• **${u.globalName || u.username || '—'}** \`${u.id}\` · ${u.license?.active ? PLAN_LABEL[u.license.plan] : 'keine Lizenz'} · ${u.deviceCount} PC${u.banned ? ' · ⛔' : ''}`).join('\n') : 'Keine Treffer.';
      return reply(i, { embeds: [embed('🔎 Suche', text.slice(0, 4000), COLOR.info)] });
    }

    const t = resolveTarget(i);
    if (t.error) return reply(i, { content: `❌ ${t.error}` });
    const { id, user } = t;

    if (sub === 'info') return reply(i, { embeds: [userEmbed(id, svc.userDetail(id), svc)] });
    if (sub === 'lizenz-geben') {
      rememberName(id, user);
      const lic = svc.setLicense(actor, id, { plan: i.options.getString('plan', true), days: i.options.getInteger('tage'), maxDevices: i.options.getInteger('geraete') ?? svc.licenseView(id)?.maxDevices ?? 1, note: i.options.getString('notiz') });
      let dm = false;
      try {
        const u = user || await i.client.users.fetch(id);
        await u.send({ embeds: [embed('🎧 Du hast eine SP Tool Lizenz!', planText(lic), COLOR.ok, [{ name: 'So startest du', value: 'SP Tool öffnen → **Mit Discord anmelden**. Dein PC wird dabei an deine Lizenz gebunden (max. ' + lic.maxDevices + ' PC).' }])] });
        dm = true;
      } catch { /* DMs closed */ }
      return reply(i, { embeds: [embed('✅ Lizenz gesetzt', `<@${id}>: ${planText(lic)} · ${lic.maxDevices} PC${lic.maxDevices > 1 ? 's' : ''}`, COLOR.ok, [{ name: 'Benachrichtigung', value: dm ? 'Per DM informiert.' : 'DM nicht möglich (DMs geschlossen oder nicht auf einem gemeinsamen Server).' }])] });
    }
    if (sub === 'lizenz-entziehen') { svc.revokeLicense(actor, id); return reply(i, { content: `✅ Lizenz von <@${id}> widerrufen. Die App sperrt spätestens nach Ablauf der Offline-Zeit.` }); }
    if (sub === 'geraete-reset') { const n = svc.resetDevices(actor, id); return reply(i, { content: `✅ ${n} PC${n === 1 ? '' : 's'} von <@${id}> entfernt und abgemeldet. Der nächste Login bindet den neuen PC.` }); }
    if (sub === 'ban') { rememberName(id, user); svc.ban(actor, id, i.options.getString('grund')); return reply(i, { content: `⛔ <@${id}> ist für SP Tool gesperrt und überall abgemeldet.` }); }
    if (sub === 'unban') { svc.unban(actor, id); return reply(i, { content: `✅ Sperre von <@${id}> aufgehoben.` }); }
    if (sub === 'admin') {
      const role = i.options.getString('aktion', true);
      rememberName(id, user);
      svc.setRole(actor, id, role);
      return reply(i, { content: role === 'admin' ? `🛡️ <@${id}> ist jetzt SP Tool Admin.` : `✅ <@${id}> ist kein Admin mehr.` });
    }
    return reply(i, { content: '❌ Unbekannter Befehl.' });
  } catch (e) {
    return reply(i, { content: `❌ ${errorText(e)}` });
  }
}

async function handleInteraction(i) {
  if (!i.isChatInputCommand?.() || !COMMANDS.has(i.commandName)) return;
  if (!state.ready) {
    await reply(i, { content: state.error ? '❌ Das SP Tool Lizenzsystem ist auf diesem Bot deaktiviert (Fehler beim Start, siehe Logs).' : '⏳ Das Lizenzsystem startet gerade. Versuch es gleich nochmal.' }).catch(() => {});
    return;
  }
  try {
    if (i.commandName === 'sptool') await handleUser(i);
    else await handleAdmin(i);
  } catch (error) {
    console.error('❌ SP Tool Command Fehler:', error);
    await reply(i, { content: '❌ Interner Fehler im Lizenzsystem.' }).catch(() => {});
  }
}

// ── client hooks ─────────────────────────────────────────────────────────────
if (ENABLED && !Client.prototype.__sptoolLicenseHook) {
  Client.prototype.__sptoolLicenseHook = true;

  // Keep the bot's other interaction routers away from our commands.
  const realOn = Client.prototype.on;
  Client.prototype.on = function sptoolFilteredOn(eventName, listener) {
    if (eventName === Events.InteractionCreate) {
      return realOn.call(this, eventName, function sptoolSkip(interaction, ...args) {
        if (interaction?.isChatInputCommand?.() && COMMANDS.has(interaction.commandName)) return undefined;
        return listener.call(this, interaction, ...args);
      });
    }
    return realOn.call(this, eventName, listener);
  };

  const realLogin = Client.prototype.login;
  Client.prototype.login = function sptoolLogin(...args) {
    if (!this.__sptoolInstalled) {
      this.__sptoolInstalled = true;
      this.prependListener(Events.InteractionCreate, (i) => { void handleInteraction(i); });
      this.once(Events.ClientReady, async (c) => {
        await ready;
        if (state.ready) await registerCommands(c);
      });
    }
    return realLogin.apply(this, args);
  };
}

module.exports = { ready, state, commandBodies, handleInteraction, OWNER_ID };
