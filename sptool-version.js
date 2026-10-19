'use strict';
// /sptool-version – shows which SP Tool version runs on each of your PCs and which one is the newest.
//
// The newest version is the release an admin pushed with "Update an alle verteilen" (sptool-app/meta.json).
// Each PC's version: SP Tool (from 1.10.6) sends its version with the update check (GET /api/v1/sptool-app/latest,
// ?v=<version>). This module only listens to that request – it never answers it or changes it – and
// remembers the version per device in the license database. Self-contained; never crashes the bot.
const fs = require('fs');
const http = require('http');
const path = require('path');
const crypto = require('crypto');

const CMD = 'sptool-version';
const EPHEMERAL = 64;
const C = { blue: 0x1f7bff, green: 0x3fb67f, amber: 0xfee75c };
const VER_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const PRODUCTS = { sptool: { dir: 'sptool-app', label: 'SP Tool', emoji: '🎧' }, skin: { dir: 'skin-app', label: 'Turbo Skin Tool', emoji: '🎨' }, toolkit: { dir: 'toolkit-app', label: 'Turbo Designs ToolKit', emoji: '🧰' } };

const dataDir = () => process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.DATA_DIR || path.join(__dirname, 'sptool-license', 'data');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const verCmp = (a, b) => { const x = String(a || '0.0.0').split('.').map(Number), y = String(b || '0.0.0').split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); } return 0; };

let db = null;
function openDb() {
  if (db) return db;
  const file = path.join(dataDir(), 'sptool-license.db');
  if (!fs.existsSync(file)) return null; // created by the license server on its first start
  const { DatabaseSync } = require('node:sqlite');
  db = new DatabaseSync(file);
  db.exec('PRAGMA busy_timeout = 4000');
  db.exec(`CREATE TABLE IF NOT EXISTS sptool_app_versions (
    device_id TEXT NOT NULL, product TEXT NOT NULL, discord_id TEXT NOT NULL, version TEXT NOT NULL, seen_at INTEGER NOT NULL,
    PRIMARY KEY (device_id, product))`);
  return db;
}

/** Newest published release of a product, or null. */
function latestOf(product) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(dataDir(), PRODUCTS[product].dir, 'meta.json'), 'utf8'));
    return m && VER_RE.test(String(m.version)) ? { version: String(m.version), at: m.uploadedAt ?? null } : null;
  } catch { return null; }
}

/** Remembers the version an app reported with its update check (session → device). Pure side effect, never throws. */
function record(req) {
  try {
    const url = new URL(String(req.url || ''), 'http://x');
    if (req.method !== 'GET' || url.pathname !== '/api/v1/sptool-app/latest') return;
    const version = String(url.searchParams.get('v') || req.headers['x-sptool-version'] || '');
    const tok = /^Bearer ([A-Za-z0-9_-]{20,})$/.exec(String(req.headers.authorization || ''));
    if (!VER_RE.test(version) || !tok) return;
    const p = url.searchParams.get('product');
    const product = p === 'skin' || p === 'toolkit' ? p : 'sptool';
    const d = openDb();
    if (!d) return;
    const s = d.prepare('SELECT discord_id, device_id, revoked, expires_at FROM sessions WHERE token_hash = ?').get(sha256(tok[1]));
    if (!s || s.revoked || s.expires_at <= Date.now()) return;
    d.prepare(`INSERT INTO sptool_app_versions (device_id, product, discord_id, version, seen_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(device_id, product) DO UPDATE SET version = excluded.version, discord_id = excluded.discord_id, seen_at = excluded.seen_at`)
      .run(s.device_id, product, s.discord_id, version, Date.now());
  } catch (e) { console.error('⚠️ /sptool-version: Version nicht gespeichert:', e?.message || e); }
}

const ts = (t) => (t ? `<t:${Math.floor(t / 1000)}:R>` : 'unbekannt');

/** The reply for one user (pure apart from the database read – tested). */
function versionView(discordId, { self = true, name = '' } = {}) {
  const d = openDb();
  const latest = latestOf('sptool');
  const who = self ? 'Du hast' : `**${name || discordId}** hat`;
  const fields = [{ name: '🆕 Neueste Version', value: latest ? `**${latest.version}**${latest.at ? ` · veröffentlicht ${ts(latest.at)}` : ''}` : 'Noch keine Version veröffentlicht.', inline: false }];
  let devices = [];
  if (d) {
    try {
      devices = d.prepare(`SELECT dv.id, dv.name, dv.kind, dv.last_seen, v.version, v.seen_at FROM devices dv
        LEFT JOIN sptool_app_versions v ON v.device_id = dv.id AND v.product = 'sptool'
        WHERE dv.discord_id = ? AND dv.revoked = 0 ORDER BY dv.last_seen DESC`).all(discordId);
    } catch { devices = []; }
  }
  let behind = 0, unknown = 0;
  if (!devices.length) {
    fields.push({ name: '💻 Deine PCs', value: `${who} SP Tool noch auf keinem PC angemeldet.`, inline: false });
  } else {
    const lines = devices.slice(0, 10).map((dv) => {
      const label = `${dv.kind === 'web' || dv.kind === 'mobile' ? '📱' : '💻'} **${String(dv.name || 'PC').slice(0, 40)}**`;
      if (!dv.version) { unknown++; return `${label} – Version unbekannt · zuletzt online ${ts(dv.last_seen)}`; }
      const cmp = latest ? verCmp(dv.version, latest.version) : 0;
      if (cmp < 0) behind++;
      const state = !latest ? '' : cmp < 0 ? ` · ⬆️ Update auf **${latest.version}** verfügbar` : ' · ✅ aktuell';
      return `${label} – **${dv.version}**${state} · gemeldet ${ts(dv.seen_at)}`;
    });
    if (devices.length > 10) lines.push(`… und ${devices.length - 10} weitere`);
    fields.push({ name: self ? '💻 Deine PCs' : '💻 PCs', value: lines.join('\n').slice(0, 1024), inline: false });
  }
  const tips = [];
  if (behind) tips.push('**Updaten:** SP Tool öffnen – es lädt das Update selbst und fragt dich. Oder Einstellungen → Updates → „Nach Updates suchen“.');
  if (unknown) tips.push('**Version unbekannt:** Der PC hat SP Tool seit dem letzten Update nicht geöffnet oder läuft mit einer Version vor 1.10.6 (die meldet ihre Version noch nicht). Einfach SP Tool öffnen und den Befehl nochmal ausführen. Die Version steht auch unten links in SP Tool.');
  if (tips.length) fields.push({ name: 'ℹ️ Tipp', value: tips.join('\n').slice(0, 1024), inline: false });
  const allOk = devices.length > 0 && !behind && !unknown && latest;
  return {
    embeds: [{
      color: allOk ? C.green : behind ? C.amber : C.blue,
      title: `🎧 SP Tool – Version${self ? '' : ` von ${name || discordId}`}`,
      description: allOk ? 'Alles aktuell – überall läuft die neueste Version.' : behind ? `${behind === 1 ? 'Ein PC ist' : `${behind} PCs sind`} nicht auf dem neuesten Stand.` : undefined,
      fields,
      footer: { text: 'SP Tool by Turbo Design' },
    }],
    flags: EPHEMERAL,
  };
}

const staffIds = () => new Set(String(`${process.env.MASTER_USER_IDS || ''},${process.env.SPTOOL_ADMIN_IDS || ''}`).split(/[,\s;]+/).filter(Boolean));
const staffRoles = () => new Set(String(`${process.env.ADMIN_ROLE_IDS || ''},${process.env.MANAGER_ROLE_IDS || ''}`).split(/[,\s;]+/).filter(Boolean));
function isStaff(i) {
  if (staffIds().has(i.user.id)) return true;
  if (i.memberPermissions?.has?.(0x8n) || i.memberPermissions?.has?.(0x20n)) return true; // Administrator / Manage Server
  const roles = i.member?.roles?.cache ? [...i.member.roles.cache.keys()] : Array.isArray(i.member?.roles) ? i.member.roles : [];
  const want = staffRoles();
  return roles.some((r) => want.has(r));
}

async function handle(i) {
  const other = i.options.getUser('user');
  if (other && other.id !== i.user.id && !isStaff(i)) return i.reply({ content: '❌ Die Version von anderen sehen nur Admins. Lass `user` leer, um deine eigene zu sehen.', flags: EPHEMERAL });
  if (!openDb()) return i.reply({ content: '❌ Die SP-Tool-Datenbank ist gerade nicht erreichbar. Versuch es gleich nochmal.', flags: EPHEMERAL });
  const target = other ?? i.user;
  return i.reply(versionView(target.id, { self: target.id === i.user.id, name: target.globalName || target.username }));
}

const commandBody = {
  name: CMD,
  description: 'Zeigt, welche SP-Tool-Version auf deinen PCs läuft und welche die neueste ist.',
  options: [{ type: 6, name: 'user', description: 'Nur für Admins: die Version eines anderen Mitglieds', required: false }],
  integration_types: [0], contexts: [0, 1],
};

const isOurs = (i) => i?.isChatInputCommand?.() && i.commandName === CMD;

function install() {
  if (String(process.env.SPTOOL_VERSION_CMD ?? 'true').toLowerCase() === 'false') return;
  // update checks of every app: listen in before any router (also before SP Tool Cloud, which answers them)
  if (!http.Server.prototype.__sptoolVersionTap) {
    http.Server.prototype.__sptoolVersionTap = true;
    const realEmit = http.Server.prototype.emit;
    http.Server.prototype.emit = function sptoolVersionEmit(ev, req, ...rest) {
      if (ev === 'request' && req && String(req.url || '').startsWith('/api/v1/sptool-app/latest')) record(req);
      return realEmit.call(this, ev, req, ...rest);
    };
  }

  const { Client, Events, REST, Routes } = require('discord.js');
  if (Client.prototype.__sptoolVersionCmd) return;
  Client.prototype.__sptoolVersionCmd = true;
  // the other command routers must not answer /sptool-version ("unknown command")
  const filtered = (listener) => { const w = function spvSkip(i, ...a) { if (isOurs(i)) return undefined; return listener.call(this, i, ...a); }; w.listener = listener; return w; };
  for (const m of ['on', 'addListener', 'prependListener']) {
    const real = Client.prototype[m];
    Client.prototype[m] = function spvFiltered(ev, listener) { return real.call(this, ev, ev === Events.InteractionCreate && typeof listener === 'function' ? filtered(listener) : listener); };
  }
  const realPrepend = require('events').EventEmitter.prototype.prependListener;
  const attach = (client) => {
    if (!client || client.__spvInstalled) return;
    client.__spvInstalled = true;
    realPrepend.call(client, Events.InteractionCreate, (i) => {
      if (!isOurs(i)) return;
      handle(i).catch((e) => {
        console.error('❌ /sptool-version:', e);
        const p = { content: `❌ Fehler: ${String(e?.message || e).slice(0, 300)}`, flags: EPHEMERAL };
        (i.deferred || i.replied ? i.followUp(p) : i.reply(p)).catch(() => {});
      });
    });
    const register = async (c) => {
      if (client.__spvRegistered) return;
      client.__spvRegistered = true;
      try {
        const rest = new REST({ version: '10' }).setToken(c.token || client.token);
        await rest.post(Routes.applicationCommands((c.application || client.application).id), { body: commandBody });
        console.log(`✅ /${CMD} bereit`);
      } catch (e) { client.__spvRegistered = false; console.error(`❌ /${CMD} konnte nicht registriert werden:`, e?.message || e); }
    };
    for (const ev of new Set([Events.ClientReady, 'clientReady', 'ready'])) client.once(ev, (c) => { void register(c || client); });
    if (client.isReady?.()) void register(client);
  };
  const realLogin = Client.prototype.login;
  Client.prototype.login = function spvLogin(...args) { attach(this); return realLogin.apply(this, args); };
}

try { install(); } catch (e) { console.error(`❌ /${CMD} nicht geladen:`, e?.message || e); }
module.exports = { versionView, record, verCmp, isOurs, commandBody, _reset: () => { db = null; } };
