'use strict';
// SP Tool – license key management in Discord (admins only).
//
//   /sptool-key            hub: overview + create keys (menus) + manage/remove keys (list, filter, multi-select)
//   /sptool-key-entfernen  remove one key directly (with autocomplete) – a redeemed key also revokes that license
//   /sptool-app-datei      upload the app ZIP that is attached to every key DM
//   /sptool-user           manage one user: plan, runtime, PCs, hardware-ID reset, revoke, ban, resend app
//
// Hub extras: bulk clean-up / delete all keys (typed confirmation), export open keys as .txt, audit log.
// Background: DM reminder 3 days before a license expires (SPTOOL_EXPIRY_DM=false disables it).
//
// Stand-alone add-on: preloaded with `node -r ./sptool-license/keys-panel.js start-fixed.js`. It does not touch
// the bot's other code and works on the same SQLite license database (license_keys, licenses, users, audit_log)
// as the SP Tool license server, so changes apply in the app immediately. Errors disable only this panel.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const OWNER_ID = '697402284849627180';
const CMD_HUB = 'sptool-key';
const CMD_REMOVE = 'sptool-key-entfernen';
const CMD_APP = 'sptool-app-datei';
const CMD_USER = 'sptool-user';
const COMMANDS = new Set([CMD_HUB, CMD_REMOVE, CMD_APP, CMD_USER]);
const DAY = 86400000;
const REMIND_BEFORE = 3 * DAY;
const MAX_APP_BYTES = 9.5 * 1024 * 1024; // Discord: 10 MB per file without boosts
const APP_ZIP_NAME = 'Turbo_Designs_SP_Tool.zip'; // name users always receive, for every release and update
const PREFIX = 'spk';
const EPHEMERAL = 64;
const PLANS = { free: 'Free', premium: 'Premium', creator: 'Creator', developer: 'Developer' };
const DURATIONS = [
  ['1', '1 Tag'], ['3', '3 Tage'], ['7', '7 Tage'], ['14', '14 Tage'], ['30', '30 Tage'], ['60', '60 Tage'],
  ['90', '90 Tage'], ['180', '180 Tage'], ['365', '1 Jahr'], ['0', 'Lebenslang'],
];
const DEVICES = ['1', '2', '3', '5', '10'];
const COUNTS = ['1', '3', '5', '10', '25'];
const FILTERS = { open: 'Offen', used: 'Eingelöst', revoked: 'Gesperrt', all: 'Alle' };
const PAGE = 10;
const C = { blue: 0x1f7bff, green: 0x3fb67f, red: 0xed4245, amber: 0xfee75c };
const FOOTER = { text: 'SP Tool by Turbo Design · Keys binden Discord-ID + Hardware-ID' };

let db = null;
let dbError = null;
const selections = new Map(); // userId → { keys: string[], at }

function openDb() {
  if (db) return db;
  try {
    const { DatabaseSync } = require('node:sqlite');
    const dir = process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.DATA_DIR || path.join(__dirname, 'data');
    const file = path.join(dir, 'sptool-license.db');
    if (!fs.existsSync(file)) throw new Error(`Lizenz-Datenbank fehlt (${file}) – läuft das SP Tool Lizenzsystem?`);
    db = new DatabaseSync(file);
    db.exec('PRAGMA busy_timeout = 4000');
    const cols = new Set(db.prepare('PRAGMA table_info(license_keys)').all().map((c) => c.name));
    for (const c of ['key', 'plan', 'days', 'max_devices', 'note', 'created_by', 'created_at', 'redeemed_by', 'revoked']) if (!cols.has(c)) throw new Error(`license_keys.${c} fehlt`);
    dbError = null;
  } catch (e) {
    dbError = e;
    db = null;
    console.error('❌ SP Tool Key-Panel: Datenbank nicht verfügbar:', e?.message || e);
  }
  return db;
}
const needDb = () => { const d = openDb(); if (!d) throw new Error(dbError?.message || 'Datenbank nicht verfügbar'); return d; };
const audit = (d, actor, action, target, detail) => { try { d.prepare('INSERT INTO audit_log (at, actor, action, target, detail) VALUES (?, ?, ?, ?, ?)').run(Date.now(), actor, action, target, detail ? JSON.stringify(detail) : null); } catch { /* optional */ } };

// ── app file (ZIP that is attached to every key DM) ─────────────────────────
const dataDir = () => process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.DATA_DIR || path.join(__dirname, 'data');
const appDir = () => path.join(dataDir(), 'sptool-app');
function appFile() {
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(appDir(), 'meta.json'), 'utf8'));
    const file = path.join(appDir(), meta.stored);
    if (!fs.existsSync(file)) return null;
    return { ...meta, name: APP_ZIP_NAME, uploadedName: meta.uploadedName ?? meta.name, file };
  } catch { return null; }
}
async function storeAppFile(att, actor, version) {
  const name = String(att.name || 'SPTool.zip');
  if (!/\.zip$/i.test(name)) throw new Error('Bitte eine .zip-Datei hochladen.');
  if (att.size > MAX_APP_BYTES) throw new Error(`Datei zu groß (${(att.size / 1048576).toFixed(1)} MB) – Discord erlaubt max. 10 MB pro DM-Anhang.`);
  const res = await fetch(att.url);
  if (!res.ok) throw new Error(`Download von Discord fehlgeschlagen (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_APP_BYTES) throw new Error('Datei zu groß.');
  if (buf.readUInt32LE(0) !== 0x04034b50) throw new Error('Das ist keine gültige ZIP-Datei.');
  fs.mkdirSync(appDir(), { recursive: true });
  const safe = APP_ZIP_NAME;
  const stored = `app-${Date.now()}.zip`;
  fs.writeFileSync(path.join(appDir(), stored), buf);
  const old = appFile();
  const meta = { name: safe, uploadedName: name.slice(0, 120), stored, size: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'), version: version || null, uploadedAt: Date.now(), uploadedBy: actor };
  fs.writeFileSync(path.join(appDir(), 'meta.json'), JSON.stringify(meta, null, 2));
  if (old && old.stored !== stored) { try { fs.unlinkSync(old.file); } catch { /* ignore */ } }
  try { const d = openDb(); if (d) audit(d, actor, 'app.uploaded', null, { name: safe, size: buf.length, version: version || null }); } catch { /* ignore */ }
  return meta;
}
const appLine = (a) => (a ? `📦 \`${a.name}\`${a.version ? ` · v${a.version}` : ''} · ${(a.size / 1048576).toFixed(1)} MB · hochgeladen ${ts(a.uploadedAt)}` : '⚠️ Keine App-Datei hinterlegt – mit `/sptool-app-datei` hochladen, dann hängt der Bot sie an jede Key-DM.');

const KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newKey() {
  const b = crypto.randomBytes(16);
  let s = '';
  for (let i = 0; i < 16; i++) s += KEY_ALPHABET[b[i] % KEY_ALPHABET.length];
  return `SPT-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}`;
}
const isKey = (k) => /^SPT-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(k);

function isAdmin(id) {
  const ids = new Set([OWNER_ID, ...String(process.env.SPTOOL_ADMIN_IDS || process.env.ADMIN_DISCORD_IDS || '').split(/[,\s;]+/).filter(Boolean)]);
  if (ids.has(id)) return true;
  try { return openDb()?.prepare('SELECT role FROM users WHERE discord_id = ?').get(id)?.role === 'admin'; } catch { return false; }
}

const durLabel = (d) => (d == null || d === '0' || d === 0 ? 'Lebenslang' : DURATIONS.find((x) => x[0] === String(d))?.[1] ?? `${d} Tage`);
const ts = (ms, s = 'R') => (ms ? `<t:${Math.floor(ms / 1000)}:${s}>` : '—');
const row = (components) => ({ type: 1, components });
const btn = (custom_id, label, style = 2, extra = {}) => ({ type: 2, style, label, custom_id, ...extra });

// ── data ─────────────────────────────────────────────────────────────────────
function stats() {
  const d = needDb();
  const n = (sql, ...a) => d.prepare(sql).get(...a).n;
  const opt = (sql, ...a) => { try { return n(sql, ...a); } catch { return null; } }; // tables of the license server
  return {
    open: n('SELECT COUNT(*) AS n FROM license_keys WHERE redeemed_by IS NULL AND revoked = 0'),
    used: n('SELECT COUNT(*) AS n FROM license_keys WHERE redeemed_by IS NOT NULL'),
    revoked: n('SELECT COUNT(*) AS n FROM license_keys WHERE revoked = 1'),
    total: n('SELECT COUNT(*) AS n FROM license_keys'),
    users: opt('SELECT COUNT(*) AS n FROM users'),
    active: opt('SELECT COUNT(*) AS n FROM licenses WHERE revoked = 0 AND (expires_at IS NULL OR expires_at > ?)', Date.now()),
    expiring: opt('SELECT COUNT(*) AS n FROM licenses WHERE revoked = 0 AND expires_at > ? AND expires_at <= ?', Date.now(), Date.now() + 7 * DAY),
    devices: opt('SELECT COUNT(*) AS n FROM devices WHERE revoked = 0'),
    banned: opt('SELECT COUNT(*) AS n FROM users WHERE banned = 1'),
    logins: opt("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'login' AND at > ?", Date.now() - DAY),
  };
}
const num = (v) => (v == null ? '—' : `**${v}**`);

const WHERE = { open: 'redeemed_by IS NULL AND revoked = 0', used: 'redeemed_by IS NOT NULL', revoked: 'revoked = 1', all: '1 = 1' };
function listKeys(filter, page) {
  const d = needDb();
  const rows = d.prepare(`SELECT * FROM license_keys WHERE ${WHERE[filter] ?? WHERE.open} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(PAGE + 1, page * PAGE);
  const total = d.prepare(`SELECT COUNT(*) AS n FROM license_keys WHERE ${WHERE[filter] ?? WHERE.open}`).get().n;
  return { rows: rows.slice(0, PAGE), more: rows.length > PAGE, total };
}

function keyState(r) {
  if (r.revoked) return r.redeemed_by ? `⛔ gesperrt · war <@${r.redeemed_by}>` : '⛔ gesperrt';
  if (r.redeemed_by) return `✅ eingelöst von <@${r.redeemed_by}>`;
  return '🟦 offen';
}

function createKeys(actor, st) {
  const d = needDb();
  const n = Number(st.count), days = st.days === '0' ? null : Number(st.days), dev = Number(st.devices);
  const note = st.user ? `Discord-Panel für ${st.user}` : 'Discord-Panel';
  const keys = [];
  d.exec('BEGIN IMMEDIATE');
  try {
    const ins = d.prepare('INSERT INTO license_keys (key, plan, days, max_devices, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (let i = 0; i < n; i++) { const k = newKey(); ins.run(k, st.plan, days, dev, note, actor, Date.now()); keys.push(k); }
    audit(d, actor, 'keys.created', st.user || null, { count: n, plan: st.plan, days, maxDevices: dev, via: 'discord-panel' });
    d.exec('COMMIT');
  } catch (e) { d.exec('ROLLBACK'); throw e; }
  return keys;
}

/**
 * Removes keys. Unused key → deleted. Redeemed key → key blocked and the license it created is revoked
 * (the app locks at its next license check). Returns a summary per key.
 */
function removeKeys(actor, keys) {
  const d = needDb();
  const out = [];
  d.exec('BEGIN IMMEDIATE');
  try {
    for (const k of keys) {
      const r = d.prepare('SELECT * FROM license_keys WHERE key = ?').get(k);
      if (!r) { out.push({ key: k, result: 'nicht gefunden' }); continue; }
      if (!r.redeemed_by) {
        d.prepare('DELETE FROM license_keys WHERE key = ?').run(k);
        audit(d, actor, 'key.deleted', k, { plan: r.plan });
        out.push({ key: k, result: 'gelöscht' });
        continue;
      }
      d.prepare('UPDATE license_keys SET revoked = 1 WHERE key = ?').run(k);
      let lic = 0;
      try { lic = d.prepare("UPDATE licenses SET revoked = 1, updated_at = ? WHERE discord_id = ? AND source = ? AND revoked = 0").run(Date.now(), r.redeemed_by, `key:${k}`).changes; } catch { /* schema without source */ }
      audit(d, actor, 'key.revoked', k, { user: r.redeemed_by, licenseRevoked: lic > 0 });
      out.push({ key: k, result: lic ? `gesperrt + Lizenz von <@${r.redeemed_by}> entzogen` : `gesperrt (Lizenz von <@${r.redeemed_by}> stammt nicht mehr von diesem Key)` });
    }
    d.exec('COMMIT');
  } catch (e) { d.exec('ROLLBACK'); throw e; }
  return out;
}

// ── views ────────────────────────────────────────────────────────────────────
function hubView(note) {
  const s = stats();
  return {
    content: '',
    embeds: [{
      color: C.blue,
      title: '🔑 SP Tool – Key-Zentrale',
      description: ['Lizenz-Keys erstellen und verwalten. Ein Key wird beim Einlösen fest an **Discord-ID + Hardware-ID** gebunden.', note ? `\n${note}` : ''].join('\n'),
      fields: [
        { name: '🟦 Offen', value: `**${s.open}**`, inline: true },
        { name: '✅ Eingelöst', value: `**${s.used}**`, inline: true },
        { name: '⛔ Gesperrt', value: `**${s.revoked}**`, inline: true },
        { name: '👥 User', value: `${num(s.users)}${s.banned ? ` · ${s.banned} gesperrt` : ''}`, inline: true },
        { name: '🎫 Aktive Lizenzen', value: `${num(s.active)}${s.expiring ? ` · ${s.expiring} laufen in 7 Tagen ab` : ''}`, inline: true },
        { name: '🖥️ PCs · Logins 24h', value: `${num(s.devices)} · ${num(s.logins)}`, inline: true },
        { name: 'App-Datei für Key-DMs', value: appLine(appFile()), inline: false },
      ],
      footer: FOOTER,
    }],
    components: [
      row([
        btn('spk:new', 'Keys erstellen', 3, { emoji: { name: '➕' } }),
        btn('spk:m:open:0', 'Keys verwalten', 1, { emoji: { name: '🗂️' } }),
        btn('spk:users', 'User verwalten', 1, { emoji: { name: '👤' } }),
      ]),
      row([
        btn('spk:bulk', 'Aufräumen / Alle löschen', 4, { emoji: { name: '🧹' }, disabled: !s.total }),
        btn('spk:export', 'Offene Keys als Datei', 2, { emoji: { name: '📤' }, disabled: !s.open }),
        btn('spk:log:0', 'Verlauf', 2, { emoji: { name: '📜' } }),
      ]),
    ],
  };
}

// create flow – state lives in the ids: spk:<action>:<plan>:<days>:<devices>:<count>:<userId|->
const CREATE_ACTIONS = new Set(['plan', 'days', 'devices', 'user', 'count', 'create', 'cancel', 'again']);
function encode(action, st) { return [PREFIX, action, st.plan, st.days, st.devices, st.count, st.user || '-'].join(':'); }
function decode(id) {
  const [, action, plan, days, devices, count, user] = String(id).split(':');
  return { action, st: { plan: PLANS[plan] ? plan : 'premium', days: DURATIONS.some((d) => d[0] === days) ? days : '30', devices: DEVICES.includes(devices) ? devices : '1', count: COUNTS.includes(count) ? count : '1', user: /^\d{15,21}$/.test(user || '') ? user : '' } };
}
const DEFAULT = { plan: 'premium', days: '30', devices: '1', count: '1', user: '' };

function createView(st, note) {
  const select = (action, placeholder, options) => row([{ type: 3, custom_id: encode(action, st), placeholder, min_values: 1, max_values: 1, options }]);
  return {
    content: '',
    embeds: [{
      color: C.blue,
      title: '➕ Lizenz-Keys erstellen',
      description: ['Wähle alles aus und klicke **Erstellen**.', note ? `\n${note}` : ''].join('\n'),
      fields: [
        { name: 'Plan', value: `**${PLANS[st.plan]}**`, inline: true },
        { name: 'Laufzeit', value: `**${durLabel(st.days)}**`, inline: true },
        { name: 'PCs (Hardware-ID)', value: `**${st.devices}**`, inline: true },
        { name: 'Anzahl', value: `**${st.count}**`, inline: true },
        { name: 'Für User', value: st.user ? `<@${st.user}> · bekommt die Keys per DM` : '— nur anzeigen', inline: true },
      ],
      footer: FOOTER,
    }],
    components: [
      select('plan', 'Plan wählen', Object.entries(PLANS).map(([v, l]) => ({ label: l, value: v, default: v === st.plan, emoji: { name: v === 'developer' ? '🛠️' : v === 'creator' ? '🎨' : v === 'premium' ? '⭐' : '🆓' } }))),
      select('days', 'Laufzeit wählen', DURATIONS.map(([v, l]) => ({ label: l, value: v, default: v === st.days, emoji: { name: v === '0' ? '♾️' : '⏱️' } }))),
      select('devices', 'Erlaubte PCs', DEVICES.map((v) => ({ label: `${v} PC${v === '1' ? '' : 's'} (Hardware-ID)`, value: v, default: v === st.devices, emoji: { name: '🖥️' } }))),
      row([{ type: 5, custom_id: encode('user', st), placeholder: 'Optional: User wählen (Keys per DM)', min_values: 0, max_values: 1, ...(st.user ? { default_values: [{ id: st.user, type: 'user' }] } : {}) }]),
      row([
        btn(encode('create', st), `${st.count === '1' ? 'Key' : `${st.count} Keys`} erstellen`, 3, { emoji: { name: '✅' } }),
        btn(encode('count', st), `Anzahl: ${st.count}`, 2, { emoji: { name: '🔢' } }),
        btn(encode('cancel', st), 'Zurück', 2, { emoji: { name: '🏠' } }),
      ]),
    ],
  };
}

function manageView(userId, filter, page, note) {
  const { rows, more, total } = listKeys(filter, page);
  const sel = selections.get(userId)?.keys ?? [];
  const lines = rows.map((r) => `${sel.includes(r.key) ? '☑️' : '▫️'} \`${r.key}\` · ${PLANS[r.plan] ?? r.plan} · ${durLabel(r.days)} · ${r.max_devices} PC\n　${keyState(r)} · erstellt ${ts(r.created_at)}`);
  const filterRow = row(Object.entries(FILTERS).map(([f, l]) => btn(`spk:m:${f}:0`, l, f === filter ? 1 : 2)));
  const comps = [filterRow];
  if (rows.length) {
    comps.push(row([{
      type: 3, custom_id: `spk:msel:${filter}:${page}`, placeholder: 'Keys zum Entfernen auswählen…', min_values: 0, max_values: rows.length,
      options: rows.map((r) => ({ label: r.key, value: r.key, default: sel.includes(r.key), description: `${PLANS[r.plan] ?? r.plan} · ${durLabel(r.days)} · ${r.redeemed_by ? (r.revoked ? 'gesperrt' : 'eingelöst') : r.revoked ? 'gesperrt' : 'offen'}`.slice(0, 100), emoji: { name: r.revoked ? '⛔' : r.redeemed_by ? '✅' : '🟦' } })),
    }]));
  }
  comps.push(row([
    // ":prev"/":next" suffix keeps these ids unique (Discord rejects duplicate custom_ids, e.g. ◀ on page 0 == filter button)
    btn(`spk:m:${filter}:${Math.max(0, page - 1)}:prev`, '◀', 2, { disabled: page === 0 }),
    btn(`spk:m:${filter}:${page + 1}:next`, '▶', 2, { disabled: !more }),
    btn(`spk:mdel:${filter}:${page}`, sel.length ? `${sel.length} entfernen` : 'Entfernen', 4, { emoji: { name: '🗑️' }, disabled: !sel.length }),
    btn('spk:hub', 'Übersicht', 2, { emoji: { name: '🏠' } }),
  ]));
  return {
    content: '',
    embeds: [{
      color: C.blue,
      title: `🗂️ Keys verwalten · ${FILTERS[filter]} (${total})`,
      description: [note ?? '', lines.length ? lines.join('\n') : '_Keine Keys in dieser Ansicht._'].filter(Boolean).join('\n\n').slice(0, 4000),
      footer: { text: `Seite ${page + 1}${more ? ' · weitere vorhanden' : ''} · Unbenutzte Keys werden gelöscht, eingelöste gesperrt + Lizenz entzogen` },
    }],
    components: comps,
  };
}

function confirmView(keys, yesId, noId) {
  const d = needDb();
  const lines = keys.map((k) => {
    const r = d.prepare('SELECT * FROM license_keys WHERE key = ?').get(k);
    if (!r) return `\`${k}\` · nicht gefunden`;
    return `\`${k}\` · ${PLANS[r.plan] ?? r.plan} · ${r.redeemed_by ? `**eingelöst von <@${r.redeemed_by}> → Lizenz wird entzogen**` : 'offen → wird gelöscht'}`;
  });
  return {
    content: '',
    embeds: [{ color: C.red, title: `🗑️ ${keys.length} Key${keys.length > 1 ? 's' : ''} wirklich entfernen?`, description: lines.join('\n').slice(0, 4000), footer: { text: 'Das kann nicht rückgängig gemacht werden.' } }],
    components: [row([btn(yesId, 'Ja, entfernen', 4, { emoji: { name: '🗑️' } }), btn(noId, 'Abbrechen', 2)])],
  };
}

// ── bulk clean-up / delete all ────────────────────────────────────────────────
const BULK = {
  open: { label: 'Alle offenen Keys löschen', confirm: 'LÖSCHEN', info: 'Löscht jeden noch nicht eingelösten Key. Eingelöste Keys und Lizenzen bleiben.' },
  revoked: { label: 'Gesperrte Keys aufräumen', confirm: 'LÖSCHEN', info: 'Entfernt gesperrte Keys aus der Liste (deren Lizenzen sind bereits entzogen).' },
  all: { label: 'ALLE Keys entfernen + Lizenzen entziehen', confirm: 'ALLE LÖSCHEN', info: 'Löscht **jeden** Key. Wer einen Key eingelöst hat, verliert seine Lizenz. Nur der Owner.', owner: true },
};
function bulkCounts() {
  const d = needDb();
  const n = (w) => d.prepare(`SELECT COUNT(*) AS n FROM license_keys WHERE ${w}`).get().n;
  return { open: n(WHERE.open), revoked: n(WHERE.revoked), all: n(WHERE.all) };
}
function bulkView(userId, note) {
  const c = bulkCounts();
  const owner = userId === OWNER_ID;
  return {
    content: '',
    embeds: [{
      color: C.red,
      title: '🧹 Aufräumen / Alle Keys löschen',
      description: [note ?? '', ...Object.entries(BULK).map(([k, b]) => `**${b.label}** (${c[k]})\n${b.info}`), '_Zur Sicherheit musst du jede Aktion mit einem Wort bestätigen._'].filter(Boolean).join('\n\n'),
      footer: FOOTER,
    }],
    components: [row([
      btn('spk:bk:open', `Offene löschen (${c.open})`, 4, { emoji: { name: '🗑️' }, disabled: !c.open }),
      btn('spk:bk:revoked', `Gesperrte aufräumen (${c.revoked})`, 2, { emoji: { name: '🧽' }, disabled: !c.revoked }),
      btn('spk:bk:all', `ALLE entfernen (${c.all})`, 4, { emoji: { name: '🧨' }, disabled: !c.all || !owner }),
      btn('spk:hub', 'Übersicht', 2, { emoji: { name: '🏠' } }),
    ])],
  };
}
const confirmModal = (customId, title, word) => ({
  custom_id: customId, title: title.slice(0, 45),
  components: [row([{ type: 4, custom_id: 'confirm', label: `Zum Bestätigen „${word}“ eingeben`, style: 1, required: true, min_length: 1, max_length: 30, placeholder: word }])],
});
function bulkRemove(actor, mode) {
  const d = needDb();
  if (mode === 'revoked') {
    const keys = d.prepare(`SELECT key FROM license_keys WHERE ${WHERE.revoked}`).all().map((r) => r.key);
    d.prepare(`DELETE FROM license_keys WHERE ${WHERE.revoked}`).run();
    audit(d, actor, 'keys.cleanup', null, { removed: keys.length });
    return { removed: keys.length, revokedLicenses: 0 };
  }
  const where = mode === 'all' ? 'revoked = 0' : WHERE.open;
  const before = d.prepare('SELECT COUNT(*) AS n FROM license_keys').get().n;
  const keys = d.prepare(`SELECT key FROM license_keys WHERE ${where}`).all().map((r) => r.key);
  const res = keys.length ? removeKeys(actor, keys) : [];
  if (mode === 'all') d.prepare('DELETE FROM license_keys').run(); // the already blocked ones too
  const removed = before - d.prepare('SELECT COUNT(*) AS n FROM license_keys').get().n;
  audit(d, actor, mode === 'all' ? 'keys.deleted_all' : 'keys.deleted_open', null, { count: removed });
  return { removed, revokedLicenses: res.filter((r) => /entzogen/.test(r.result)).length };
}

// ── export / audit log ───────────────────────────────────────────────────────
function exportFile() {
  const rows = needDb().prepare(`SELECT key, plan, days, max_devices, created_at, note FROM license_keys WHERE ${WHERE.open} ORDER BY created_at DESC`).all();
  const lines = rows.map((r) => [r.key, PLANS[r.plan] ?? r.plan, durLabel(r.days), `${r.max_devices} PC`, new Date(r.created_at).toISOString().slice(0, 10), r.note ?? ''].join(' | '));
  const text = [`SP Tool – offene Lizenz-Keys (${rows.length}) · Export ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`, 'Key | Plan | Laufzeit | PCs | erstellt | Notiz', '', ...lines, ''].join('\n');
  return { count: rows.length, file: { attachment: Buffer.from(text, 'utf8'), name: `sptool-keys-offen-${new Date().toISOString().slice(0, 10)}.txt` } };
}
const ACTION_LABEL = {
  'keys.created': '➕ Keys erstellt', 'key.deleted': '🗑️ Key gelöscht', 'key.revoked': '⛔ Key gesperrt', 'key.redeemed': '🎫 Key eingelöst',
  'keys.deleted_open': '🗑️ Offene Keys gelöscht', 'keys.deleted_all': '🧨 Alle Keys entfernt', 'keys.cleanup': '🧽 Aufgeräumt', 'app.uploaded': '📦 App hochgeladen',
  login: '🔐 Login', 'license.set': '🎫 Lizenz gesetzt', 'license.revoked': '⛔ Lizenz entzogen', 'license.extended': '⏱️ Lizenz verlängert',
  'devices.reset': '🖥️ Hardware-ID zurückgesetzt', 'device.removed': '🖥️ PC entfernt', 'user.banned': '🚫 Gesperrt', 'user.unbanned': '✅ Entsperrt', 'user.role': '🛡️ Rolle',
  'app.sent': '📨 App gesendet', 'expiry.reminded': '⏰ Ablauf-Erinnerung',
};
const who = (x) => (/^\d{15,21}$/.test(String(x ?? '')) ? `<@${x}>` : x ? `\`${String(x).slice(0, 24)}\`` : '—');
function logView(page) {
  const d = needDb();
  const per = 12;
  const rows = d.prepare('SELECT at, actor, action, target FROM audit_log ORDER BY at DESC LIMIT ? OFFSET ?').all(per + 1, page * per);
  const lines = rows.slice(0, per).map((r) => `${ts(r.at)} · ${ACTION_LABEL[r.action] ?? `\`${r.action}\``} · ${who(r.actor)}${r.target ? ` → ${isKey(r.target) ? `\`${r.target}\`` : who(r.target)}` : ''}`);
  return {
    content: '',
    embeds: [{ color: C.blue, title: '📜 Verlauf', description: (lines.join('\n') || '_Noch keine Einträge._').slice(0, 4000), footer: { text: `Seite ${page + 1} · Logins, Keys, Lizenzen und Admin-Aktionen` } }],
    components: [row([
      btn(`spk:log:${Math.max(0, page - 1)}:prev`, '◀', 2, { disabled: page === 0 }),
      btn(`spk:log:${page + 1}:next`, '▶', 2, { disabled: rows.length <= per }),
      btn('spk:hub', 'Übersicht', 2, { emoji: { name: '🏠' } }),
    ])],
  };
}

// ── user management ──────────────────────────────────────────────────────────
const isId = (x) => /^\d{15,21}$/.test(String(x ?? ''));
function ensureUser(d, id, name) {
  d.prepare("INSERT OR IGNORE INTO users (discord_id, username, created_at) VALUES (?, ?, ?)").run(id, String(name ?? '').slice(0, 64), Date.now());
}
function licenseLine(l) {
  if (!l) return '— keine Lizenz';
  const plan = `**${PLANS[l.plan] ?? l.plan}**`;
  if (l.revoked) return `⛔ entzogen (war ${plan})`;
  if (l.expires_at != null && l.expires_at <= Date.now()) return `⌛ ${plan} · abgelaufen ${ts(l.expires_at)}`;
  return `✅ ${plan} · ${l.expires_at == null ? 'lebenslang' : `bis ${ts(l.expires_at, 'D')} (${ts(l.expires_at)})`}`;
}
function usersPickView(note) {
  return {
    content: '',
    embeds: [{ color: C.blue, title: '👤 User verwalten', description: `${note ? `${note}\n\n` : ''}Wähle einen User – oder nutze \`/${CMD_USER}\`.\nDu kannst Plan und Laufzeit ändern, PCs freigeben (Hardware-ID zurücksetzen), Lizenzen entziehen, sperren und die App erneut schicken.`, footer: FOOTER }],
    components: [
      row([{ type: 5, custom_id: 'spk:usel', placeholder: 'User auswählen…', min_values: 1, max_values: 1 }]),
      row([btn('spk:hub', 'Übersicht', 2, { emoji: { name: '🏠' } })]),
    ],
  };
}
function userView(id, note) {
  const d = needDb();
  const u = d.prepare('SELECT * FROM users WHERE discord_id = ?').get(id);
  const l = d.prepare('SELECT * FROM licenses WHERE discord_id = ?').get(id);
  const devs = d.prepare('SELECT name, kind, first_seen, last_seen FROM devices WHERE discord_id = ? AND revoked = 0 ORDER BY last_seen DESC').all(id);
  const keys = d.prepare('SELECT key, plan, redeemed_at, revoked FROM license_keys WHERE redeemed_by = ? ORDER BY redeemed_at DESC LIMIT 5').all(id);
  const active = !!l && !l.revoked && (l.expires_at == null || l.expires_at > Date.now());
  const role = id === OWNER_ID ? '👑 Owner' : u?.role === 'admin' ? '🛡️ Admin' : 'User';
  const maxDev = l?.max_devices ?? 1;
  return {
    content: '',
    embeds: [{
      color: u?.banned ? C.red : active ? C.green : C.amber,
      title: `👤 ${u?.global_name || u?.username || 'User'}${u?.banned ? ' · 🚫 gesperrt' : ''}`,
      description: [note ?? '', `<@${id}> · \`${id}\``].filter(Boolean).join('\n\n'),
      fields: [
        { name: 'Rolle', value: role, inline: true },
        { name: 'Letzter Login', value: u?.last_login ? ts(u.last_login) : u ? 'noch nie' : 'noch nie in der App', inline: true },
        { name: 'PCs', value: `**${devs.length}/${maxDev}**`, inline: true },
        { name: 'Lizenz', value: licenseLine(l), inline: false },
        ...(u?.banned ? [{ name: 'Sperrgrund', value: String(u.ban_reason || '—').slice(0, 200), inline: false }] : []),
        { name: 'Gebundene PCs (Hardware-ID)', value: devs.length ? devs.slice(0, 8).map((x) => `🖥️ ${String(x.name).slice(0, 40)} · zuletzt ${ts(x.last_seen)}`).join('\n') : '— keiner', inline: false },
        { name: 'Eingelöste Keys', value: keys.length ? keys.map((k) => `\`${k.key}\` · ${PLANS[k.plan] ?? k.plan}${k.revoked ? ' · ⛔' : ''} · ${ts(k.redeemed_at)}`).join('\n') : '— keine', inline: false },
      ],
      footer: FOOTER,
    }],
    components: [
      row([{ type: 3, custom_id: `spk:uplan:${id}`, placeholder: 'Plan setzen…', min_values: 1, max_values: 1,
        options: Object.entries(PLANS).map(([v, lb]) => ({ label: `Plan: ${lb}`, value: v, default: active && l.plan === v, description: active ? 'Laufzeit bleibt' : 'Neue Lizenz · 30 Tage' })) }]),
      row([
        btn(`spk:uext:${id}:30`, '+30 Tage', 2, { emoji: { name: '⏱️' }, disabled: !l }),
        btn(`spk:uext:${id}:365`, '+1 Jahr', 2, { emoji: { name: '📅' }, disabled: !l }),
        btn(`spk:ulife:${id}`, 'Lebenslang', 2, { emoji: { name: '♾️' }, disabled: !l || (active && l.expires_at == null) }),
        btn(`spk:udev:${id}:1`, '+1 PC', 2, { emoji: { name: '🖥️' }, disabled: !l || maxDev >= 20 }),
        btn(`spk:udev:${id}:-1`, '−1 PC', 2, { disabled: !l || maxDev <= 1 }),
      ]),
      row([
        btn(`spk:ureset:${id}`, 'Hardware-ID zurücksetzen', 1, { emoji: { name: '🔄' }, disabled: !devs.length }),
        btn(`spk:urevoke:${id}`, 'Lizenz entziehen', 4, { emoji: { name: '⛔' }, disabled: !active }),
        btn(`spk:uban:${id}`, u?.banned ? 'Entsperren' : 'Sperren', u?.banned ? 3 : 4, { emoji: { name: u?.banned ? '✅' : '🚫' }, disabled: id === OWNER_ID }),
        btn(`spk:usend:${id}`, 'App per DM', 2, { emoji: { name: '📨' }, disabled: !appFile() }),
        btn('spk:users', 'Zurück', 2, { emoji: { name: '↩️' } }),
      ]),
    ],
  };
}
function userAction(actor, id, action, arg) {
  const d = needDb();
  const t = Date.now();
  const l = d.prepare('SELECT * FROM licenses WHERE discord_id = ?').get(id);
  switch (action) {
    case 'plan': {
      if (!PLANS[arg]) throw new Error('Unbekannter Plan');
      ensureUser(d, id);
      const active = l && !l.revoked && (l.expires_at == null || l.expires_at > t);
      if (l) d.prepare("UPDATE licenses SET plan = ?, revoked = 0, expires_at = ?, source = 'admin', updated_at = ? WHERE discord_id = ?").run(arg, active ? l.expires_at : t + 30 * DAY, t, id);
      else d.prepare("INSERT INTO licenses (discord_id, plan, max_devices, expires_at, source, revoked, updated_at) VALUES (?, ?, 1, ?, 'admin', 0, ?)").run(id, arg, t + 30 * DAY, t);
      audit(d, actor, 'license.set', id, { plan: arg, via: 'discord-panel' });
      return `✅ Plan auf **${PLANS[arg]}** gesetzt${active ? '' : ' (30 Tage)'}.`;
    }
    case 'ext': {
      if (!l) throw new Error('Keine Lizenz – erst einen Plan wählen.');
      if (l.expires_at == null && !l.revoked) return 'ℹ️ Lizenz ist bereits lebenslang.';
      const base = l.expires_at && l.expires_at > t && !l.revoked ? l.expires_at : t;
      const exp = base + Number(arg) * DAY;
      d.prepare('UPDATE licenses SET expires_at = ?, revoked = 0, updated_at = ? WHERE discord_id = ?').run(exp, t, id);
      audit(d, actor, 'license.extended', id, { days: Number(arg), expiresAt: exp });
      return `✅ Verlängert bis ${ts(exp, 'D')}.`;
    }
    case 'life': {
      if (!l) throw new Error('Keine Lizenz – erst einen Plan wählen.');
      d.prepare('UPDATE licenses SET expires_at = NULL, revoked = 0, updated_at = ? WHERE discord_id = ?').run(t, id);
      audit(d, actor, 'license.extended', id, { lifetime: true });
      return '✅ Lizenz ist jetzt lebenslang.';
    }
    case 'dev': {
      if (!l) throw new Error('Keine Lizenz – erst einen Plan wählen.');
      const md = Math.max(1, Math.min(20, l.max_devices + Number(arg)));
      d.prepare('UPDATE licenses SET max_devices = ?, updated_at = ? WHERE discord_id = ?').run(md, t, id);
      audit(d, actor, 'license.set', id, { maxDevices: md });
      return `✅ Erlaubte PCs: **${md}**.`;
    }
    case 'reset': {
      d.prepare('UPDATE sessions SET revoked = 1 WHERE discord_id = ?').run(id);
      const n = d.prepare('DELETE FROM devices WHERE discord_id = ?').run(id).changes;
      audit(d, actor, 'devices.reset', id, { removed: n, via: 'discord-panel' });
      return `✅ ${n} PC${n === 1 ? '' : 's'} freigegeben – der User meldet sich auf dem neuen PC einfach neu mit Discord an.`;
    }
    case 'revoke': {
      d.prepare('UPDATE licenses SET revoked = 1, updated_at = ? WHERE discord_id = ?').run(t, id);
      audit(d, actor, 'license.revoked', id, { via: 'discord-panel' });
      return '⛔ Lizenz entzogen – die App sperrt sich beim nächsten Lizenz-Check. Rückgängig: Plan wählen.';
    }
    case 'ban': {
      if (id === OWNER_ID) throw new Error('Der Owner kann nicht gesperrt werden.');
      if (isAdmin(id) && actor !== OWNER_ID) throw new Error('Nur der Owner kann Admins sperren.');
      ensureUser(d, id);
      d.prepare('UPDATE users SET banned = 1, ban_reason = ? WHERE discord_id = ?').run(String(arg || '').slice(0, 200) || null, id);
      d.prepare('UPDATE sessions SET revoked = 1 WHERE discord_id = ?').run(id);
      audit(d, actor, 'user.banned', id, { reason: arg || null, via: 'discord-panel' });
      return '🚫 User gesperrt und überall abgemeldet.';
    }
    case 'unban': {
      d.prepare('UPDATE users SET banned = 0, ban_reason = NULL WHERE discord_id = ?').run(id);
      audit(d, actor, 'user.unbanned', id, { via: 'discord-panel' });
      return '✅ User entsperrt.';
    }
    default: throw new Error('Unbekannte Aktion');
  }
}

// ── DMs ─────────────────────────────────────────────────────────────────────
const appSteps = (app) => `1. Angehängte **${app.name}** herunterladen und entpacken\n2. **SPTool.exe** starten (Windows-Warnung: „Weitere Informationen“ → „Trotzdem ausführen“)\n3. **Continue with Discord** → anmelden`;
async function sendApp(client, id, actor) {
  const app = appFile();
  if (!app) throw new Error('Keine App-Datei hinterlegt – erst `/sptool-app-datei` nutzen.');
  const u = await client.users.fetch(id);
  await u.send({ files: [{ attachment: app.file, name: app.name }], embeds: [{ color: C.blue, title: '📦 SP Tool – Download', description: `Hier ist die aktuelle Version${app.version ? ` **v${app.version}**` : ''} von SP Tool.`, fields: [{ name: 'Installation', value: appSteps(app) }], footer: { text: 'SP Tool by Turbo Design' } }] });
  try { audit(needDb(), actor, 'app.sent', id, { name: app.name }); } catch { /* ignore */ }
}
async function remindExpiring(client) {
  if (String(process.env.SPTOOL_EXPIRY_DM ?? 'true').toLowerCase() === 'false') return 0;
  const d = openDb();
  if (!d) return 0;
  d.exec('CREATE TABLE IF NOT EXISTS sptool_bot_reminders (discord_id TEXT NOT NULL, expires_at INTEGER NOT NULL, sent_at INTEGER NOT NULL, PRIMARY KEY (discord_id, expires_at))');
  const t = Date.now();
  const due = d.prepare(`SELECT l.discord_id, l.plan, l.expires_at FROM licenses l WHERE l.revoked = 0 AND l.expires_at > ? AND l.expires_at <= ?
    AND NOT EXISTS (SELECT 1 FROM sptool_bot_reminders r WHERE r.discord_id = l.discord_id AND r.expires_at = l.expires_at)`).all(t, t + REMIND_BEFORE);
  let sent = 0;
  for (const r of due) {
    d.prepare('INSERT OR IGNORE INTO sptool_bot_reminders (discord_id, expires_at, sent_at) VALUES (?, ?, ?)').run(r.discord_id, r.expires_at, t);
    try {
      const u = await client.users.fetch(r.discord_id);
      await u.send({ embeds: [{ color: C.amber, title: '⏰ Deine SP Tool Lizenz läuft bald ab', description: `Dein **${PLANS[r.plan] ?? r.plan}**-Plan endet ${ts(r.expires_at)} (${ts(r.expires_at, 'f')}).\n\nUm weiterzumachen, löse einfach einen neuen Key in SP Tool ein (**Einstellungen → Account**) – die restliche Zeit wird angerechnet.`, footer: { text: 'SP Tool by Turbo Design' } }] });
      audit(d, 'system', 'expiry.reminded', r.discord_id, { expiresAt: r.expires_at });
      sent++;
    } catch { /* DMs closed */ }
  }
  return sent;
}

const resultText = (res) => res.map((r) => `\`${r.key}\` → ${r.result}`).join('\n');

// ── interaction handling ─────────────────────────────────────────────────────
// /sptool verbinden (pairing from the license bot) gets a confirmation step first – see pairing below.
const isPairCommand = (i) => !i?.__spkConfirmed && i?.isChatInputCommand?.() && i.commandName === 'sptool' && (() => { try { return i.options.getSubcommand(false) === 'verbinden'; } catch { return false; } })();
const isOurs = (i) => !i?.__spkConfirmed && (((i?.isChatInputCommand?.() || i?.isAutocomplete?.()) && COMMANDS.has(i.commandName)) || isPairCommand(i) || String(i?.customId || '').startsWith(`${PREFIX}:`));

// ── pairing confirmation: /sptool verbinden code:… ───────────────────────────
// The license bot links the PC to the account of whoever runs the command. Running somebody else's code
// therefore logs THEIR PC in with YOUR account (an admin helping a user ended up logging the user in as
// the owner), and a user tricked into running a stranger's code would hand over their license.
// So the command first shows which PC gets which account and links only after a click – always with the
// account of the person who confirms. Nobody can link a PC to another person's account.
const PAIR_RE = /^[A-F0-9]{10}$/;
function pendingByCode(code) {
  try { return needDb().prepare('SELECT device_name, created_at, result FROM pending_logins WHERE UPPER(substr(state_hash, 1, 10)) = ? ORDER BY created_at DESC LIMIT 1').get(code) ?? null; } catch { return null; }
}
async function askPair(i) {
  const code = String(i.options.getString('code', true) || '').trim().toUpperCase();
  if (!PAIR_RE.test(code)) return i.reply({ content: '❌ Der Verbindungscode ist ungültig (10 Zeichen, 0–9 und A–F).', flags: EPHEMERAL });
  const p = pendingByCode(code);
  if (!p) return i.reply({ content: '❌ Der Verbindungscode ist abgelaufen oder unbekannt. Klicke in SP Tool erneut auf **Continue with Discord**.', flags: EPHEMERAL });
  if (p.result) return i.reply({ content: '❌ Dieser Verbindungscode wurde bereits verwendet.', flags: EPHEMERAL });
  const admin = isAdmin(i.user.id);
  const who = i.user.globalName || i.user.username;
  return i.reply({
    flags: EPHEMERAL,
    embeds: [{
      color: admin ? C.red : C.blue,
      title: '🔗 SP Tool mit deinem Discord-Account verbinden?',
      description: [
        `PC: **${String(p.device_name || 'Unbekannter PC').slice(0, 60)}** · Code \`${code}\` · erstellt ${ts(p.created_at)}`,
        '',
        `Dieser PC wird mit **${who}** (\`${i.user.id}\`) angemeldet – mit deiner Lizenz.`,
        'Nur bestätigen, wenn das **dein eigener PC** ist. Gib nie Codes von anderen Personen ein.',
        ...(admin ? ['', '⛔ **Du bist Admin/Owner.** Ist das der PC eines Users, **nicht bestätigen** – der User muss `/sptool verbinden` selbst mit seinem Account ausführen, sonst läuft sein PC mit deinem Owner-Account.'] : []),
      ].join('\n'),
      footer: FOOTER,
    }],
    components: [row([
      btn(`spk:pairself:${code}`, admin ? 'Ja, das ist MEIN eigener PC' : 'Ja, das ist mein PC – verbinden', admin ? 4 : 3, { emoji: { name: '🔗' } }),
      btn('spk:paircancel', 'Abbrechen', 2),
    ])],
  });
}
/** After the click the license bot links the code exactly as before (same user who confirmed); its reply lands here. */
function confirmPair(i, code) {
  return new Promise((resolve) => {
    let done = false;
    const finish = async (payload) => {
      if (done) return; done = true;
      const content = typeof payload === 'string' ? payload : payload?.content ?? '';
      const embeds = typeof payload === 'object' && payload?.embeds ? payload.embeds : [];
      try { await i.editReply({ content: content || ' ', embeds, components: [] }); } catch { /* ignore */ }
      resolve(content);
    };
    const opts = { getSubcommand: () => 'verbinden', getSubcommandGroup: () => null, getString: (n) => (n === 'code' ? code : null), getUser: () => null, getInteger: () => null, getBoolean: () => null, get: (n) => (n === 'code' ? { name: 'code', value: code } : null), data: [] };
    const cmd = {
      __spkConfirmed: true, id: i.id, type: 2, commandName: 'sptool', commandType: 1, user: i.user, member: i.member, guild: i.guild, guildId: i.guildId, channel: i.channel, channelId: i.channelId, client: i.client, locale: i.locale, options: opts,
      deferred: false, replied: false, ephemeral: true, createdTimestamp: Date.now(),
      isChatInputCommand: () => true, isCommand: () => true, isRepliable: () => true, isAutocomplete: () => false, isButton: () => false, isStringSelectMenu: () => false, isUserSelectMenu: () => false, isModalSubmit: () => false, isMessageComponent: () => false, inGuild: () => !!i.guildId,
      deferReply: async () => { cmd.deferred = true; },
      reply: async (p) => { cmd.replied = true; await finish(p); },
      editReply: async (p) => { await finish(p); },
      followUp: async (p) => { await finish(p); },
      fetchReply: async () => null,
    };
    setTimeout(() => finish('⚠️ Keine Antwort vom Lizenzsystem – prüfe in SP Tool, ob die Anmeldung geklappt hat.'), 15000);
    try { i.client.emit('interactionCreate', cmd); } catch (e) { finish(`❌ ${e?.message || e}`); }
  });
}

async function autocomplete(i) {
  if (!isAdmin(i.user.id) || !openDb()) return i.respond([]);
  const q = String(i.options.getFocused() || '').toUpperCase().replace(/[^A-Z0-9-]/g, '');
  const rows = db.prepare('SELECT key, plan, redeemed_by, revoked FROM license_keys WHERE key LIKE ? ORDER BY created_at DESC LIMIT 25').all(`%${q}%`);
  return i.respond(rows.map((r) => ({ name: `${r.key} · ${PLANS[r.plan] ?? r.plan} · ${r.revoked ? 'gesperrt' : r.redeemed_by ? 'eingelöst' : 'offen'}`.slice(0, 100), value: r.key })));
}

async function handle(i) {
  if (i.isAutocomplete?.()) return autocomplete(i);
  // pairing confirmation is for everyone, not only admins
  if (isPairCommand(i)) return askPair(i);
  { const [, k, c] = String(i.customId || '').split(':');
    if (k === 'paircancel') return i.update({ content: 'Abgebrochen – nichts wurde verbunden.', embeds: [], components: [] });
    if (k === 'pairself') {
      if (!PAIR_RE.test(c || '')) return i.update({ content: '❌ Ungültiger Code.', embeds: [], components: [] });
      await i.update({ content: '⏳ Verbinde…', embeds: [], components: [] });
      return confirmPair(i, c);
    } }
  if (!isAdmin(i.user.id)) return i.reply({ content: '❌ Nur SP Tool Admins können Keys verwalten.', flags: EPHEMERAL });

  if (i.isChatInputCommand?.()) {
    if (!openDb()) return i.reply({ content: `❌ Key-Verwaltung nicht verfügbar: ${dbError?.message}`, flags: EPHEMERAL });
    if (i.commandName === CMD_HUB) return i.reply({ ...hubView(), flags: EPHEMERAL });
    if (i.commandName === CMD_USER) {
      const u = i.options.getUser('user', true);
      return i.reply({ ...userView(u.id), flags: EPHEMERAL });
    }
    if (i.commandName === CMD_APP) {
      await i.deferReply({ flags: EPHEMERAL });
      try {
        const meta = await storeAppFile(i.options.getAttachment('datei', true), i.user.id, i.options.getString('version'));
        return i.editReply({ embeds: [{ color: C.green, title: '✅ App-Datei gespeichert', description: `${appLine({ ...meta })}\n\nAb jetzt hängt der Bot diese Datei an jede Key-DM an.`, fields: [{ name: 'SHA-256', value: `\`${meta.sha256.slice(0, 32)}…\`` }], footer: FOOTER }] });
      } catch (e) {
        return i.editReply({ content: `❌ ${e?.message || e}` });
      }
    }
    const key = String(i.options.getString('key', true)).trim().toUpperCase();
    if (!isKey(key)) return i.reply({ content: '❌ Das ist kein gültiger Key (`SPT-XXXX-XXXX-XXXX-XXXX`).', flags: EPHEMERAL });
    if (!db.prepare('SELECT 1 FROM license_keys WHERE key = ?').get(key)) return i.reply({ content: `❌ Key \`${key}\` gibt es nicht.`, flags: EPHEMERAL });
    return i.reply({ ...confirmView([key], `spk:x1:${key}`, 'spk:x1no'), flags: EPHEMERAL });
  }

  const parts = String(i.customId).split(':');
  const kind = parts[1];
  const upd = (view) => i.update({ attachments: [], ...view });

  if (i.isModalSubmit?.()) {
    const typed = String(i.fields.getTextInputValue('confirm') ?? '').trim().toUpperCase();
    if (kind === 'bkm') {
      const b = BULK[parts[2]];
      if (!b || (b.owner && i.user.id !== OWNER_ID)) return upd(bulkView(i.user.id, '❌ Nicht erlaubt.'));
      if (typed !== b.confirm) return upd(bulkView(i.user.id, `❌ Nicht bestätigt – du musst genau „${b.confirm}“ eingeben. Nichts wurde gelöscht.`));
      const r = bulkRemove(i.user.id, parts[2]);
      return upd(bulkView(i.user.id, `✅ **${r.removed}** Key${r.removed === 1 ? '' : 's'} entfernt${r.revokedLicenses ? ` · **${r.revokedLicenses}** Lizenz${r.revokedLicenses === 1 ? '' : 'en'} entzogen` : ''}.`));
    }
    if (kind === 'ubanm' && isId(parts[2])) {
      const reason = String(i.fields.getTextInputValue('confirm') ?? '').trim();
      return upd(userView(parts[2], userAction(i.user.id, parts[2], 'ban', reason)));
    }
    return upd(hubView());
  }

  if (kind === 'hub') return upd(hubView());
  if (kind === 'bulk') return upd(bulkView(i.user.id));
  if (kind === 'bk') {
    const b = BULK[parts[2]];
    if (!b) return upd(bulkView(i.user.id));
    if (b.owner && i.user.id !== OWNER_ID) return upd(bulkView(i.user.id, '❌ Das darf nur der Owner.'));
    return i.showModal(confirmModal(`spk:bkm:${parts[2]}`, b.label, b.confirm));
  }
  if (kind === 'export') {
    const e = exportFile();
    if (!e.count) return i.reply({ content: 'Keine offenen Keys vorhanden.', flags: EPHEMERAL });
    return i.reply({ content: `📤 **${e.count}** offene Key${e.count === 1 ? '' : 's'} als Datei:`, files: [e.file], flags: EPHEMERAL });
  }
  if (kind === 'log') return upd(logView(Math.max(0, Number(parts[2]) || 0)));
  if (kind === 'users') return upd(usersPickView());
  if (kind === 'usel') {
    const id = i.values?.[0];
    return upd(isId(id) ? userView(id) : usersPickView('⚠️ Kein User gewählt.'));
  }
  const USER_ACTIONS = { uplan: 'plan', uext: 'ext', ulife: 'life', udev: 'dev', ureset: 'reset', urevoke: 'revoke' };
  if (USER_ACTIONS[kind] && isId(parts[2])) {
    const id = parts[2];
    let note;
    try { note = userAction(i.user.id, id, USER_ACTIONS[kind], kind === 'uplan' ? i.values?.[0] : parts[3]); } catch (e) { note = `❌ ${e?.message || e}`; }
    return upd(userView(id, note));
  }
  if (kind === 'uban' && isId(parts[2])) {
    const id = parts[2];
    const banned = needDb().prepare('SELECT banned FROM users WHERE discord_id = ?').get(id)?.banned;
    if (banned) return upd(userView(id, userAction(i.user.id, id, 'unban')));
    if (id === OWNER_ID || (isAdmin(id) && i.user.id !== OWNER_ID)) return upd(userView(id, '❌ Diesen User darfst du nicht sperren.'));
    return i.showModal({ custom_id: `spk:ubanm:${id}`, title: 'User sperren', components: [row([{ type: 4, custom_id: 'confirm', label: 'Grund (sieht der User in der App)', style: 2, required: true, min_length: 2, max_length: 200, placeholder: 'z. B. Key weitergegeben' }])] });
  }
  if (kind === 'usend' && isId(parts[2])) {
    let note;
    try { await sendApp(i.client, parts[2], i.user.id); note = `📨 App per DM an <@${parts[2]}> gesendet.`; } catch (e) { note = /Cannot send|50007/.test(String(e?.message || e)) ? '⚠️ DM nicht möglich (DMs geschlossen).' : `❌ ${e?.message || e}`; }
    return upd(userView(parts[2], note));
  }
  if (kind === 'new') return upd(createView({ ...DEFAULT }));
  if (kind === 'm') return upd(manageView(i.user.id, FILTERS[parts[2]] ? parts[2] : 'open', Math.max(0, Number(parts[3]) || 0)));
  if (kind === 'msel') {
    selections.set(i.user.id, { keys: (i.values ?? []).filter(isKey), at: Date.now() });
    return upd(manageView(i.user.id, parts[2], Number(parts[3]) || 0));
  }
  if (kind === 'mdel') {
    const keys = selections.get(i.user.id)?.keys ?? [];
    if (!keys.length) return upd(manageView(i.user.id, parts[2], Number(parts[3]) || 0, '⚠️ Erst Keys im Menü auswählen.'));
    return upd(confirmView(keys, `spk:mdo:${parts[2]}:${parts[3]}`, `spk:m:${parts[2]}:${parts[3]}`));
  }
  if (kind === 'mdo') {
    const keys = selections.get(i.user.id)?.keys ?? [];
    selections.delete(i.user.id);
    const res = keys.length ? removeKeys(i.user.id, keys) : [];
    return upd(manageView(i.user.id, parts[2], 0, res.length ? `✅ Erledigt:\n${resultText(res)}` : '⚠️ Nichts ausgewählt.'));
  }
  if (kind === 'x1') {
    const res = removeKeys(i.user.id, [parts[2]]);
    return upd({ content: '', embeds: [{ color: C.green, title: '✅ Key entfernt', description: resultText(res), footer: FOOTER }], components: [row([btn('spk:m:all:0', 'Alle Keys ansehen', 2, { emoji: { name: '🗂️' } })])] });
  }
  if (kind === 'x1no') return upd({ content: 'Abgebrochen – nichts entfernt.', embeds: [], components: [] });

  if (!CREATE_ACTIONS.has(kind)) return upd(hubView());
  const { action, st } = decode(i.customId);
  if (action === 'plan' || action === 'days' || action === 'devices') { st[action] = i.values?.[0] ?? st[action]; return upd(createView(st)); }
  if (action === 'user') { st.user = i.values?.[0] ?? ''; return upd(createView(st)); }
  if (action === 'count') { st.count = COUNTS[(COUNTS.indexOf(st.count) + 1) % COUNTS.length]; return upd(createView(st)); }
  if (action === 'cancel') return upd(hubView());
  if (action === 'again') return upd(createView(st));
  if (action === 'create') {
    let keys;
    try { keys = createKeys(i.user.id, st); } catch (e) { return upd(createView(st, `❌ Fehler: ${e?.message || e}`)); }
    let dm = '';
    if (st.user) {
      try {
        const u = await i.client.users.fetch(st.user);
        const app = appFile();
        await u.send({ ...(app ? { files: [{ attachment: app.file, name: app.name }] } : {}), embeds: [{ color: C.blue, title: '🎧 Dein SP Tool Lizenz-Key', description: `\`\`\`\n${keys.join('\n')}\n\`\`\``, fields: [
          { name: 'Plan', value: PLANS[st.plan], inline: true }, { name: 'Laufzeit', value: durLabel(st.days), inline: true }, { name: 'PCs', value: st.devices, inline: true },
          { name: 'So aktivierst du', value: `${app ? `${appSteps(app)}\n4.` : '1. **Continue with Discord** → anmelden\n2.'} Key eingeben. Die Lizenz wird an deine Discord-ID und deinen PC gebunden – Weitergeben funktioniert nicht.` },
        ], footer: { text: 'SP Tool by Turbo Design' } }] });
        dm = `\n📨 Per DM an <@${st.user}> gesendet${app ? ` – mit ${app.name}` : ' (ohne App-Datei – `/sptool-app-datei` hochladen)'}.`;
      } catch { dm = `\n⚠️ DM an <@${st.user}> nicht möglich (DMs geschlossen) – bitte selbst schicken.`; }
    }
    return upd({
      content: '',
      ...(keys.length > 1 ? { files: [{ attachment: Buffer.from(`${keys.join('\n')}\n`, 'utf8'), name: `sptool-keys-${st.plan}-${keys.length}.txt` }] } : {}),
      embeds: [{ color: C.green, title: `✅ ${keys.length} Key${keys.length > 1 ? 's' : ''} erstellt`, description: `\`\`\`\n${keys.join('\n')}\n\`\`\`${dm}`,
        fields: [{ name: 'Plan', value: PLANS[st.plan], inline: true }, { name: 'Laufzeit', value: durLabel(st.days), inline: true }, { name: 'PCs', value: st.devices, inline: true }],
        footer: { text: 'Jeder Key ist nur einmal einlösbar · bindet Discord-ID + Hardware-ID' } }],
      components: [row([
        btn(encode('again', st), 'Weitere Keys', 1, { emoji: { name: '🔑' } }),
        btn('spk:m:open:0', 'Keys verwalten', 2, { emoji: { name: '🗂️' } }),
        btn('spk:hub', 'Übersicht', 2, { emoji: { name: '🏠' } }),
      ])],
    });
  }
}

const commandBodies = [
  { name: CMD_HUB, type: 1, description: 'SP Tool – Lizenz-Keys erstellen, verwalten und entfernen (nur Admins)', default_member_permissions: '8', dm_permission: true },
  {
    name: CMD_REMOVE, type: 1, description: 'SP Tool – einen Lizenz-Key entfernen (eingelöst: Lizenz wird entzogen)', default_member_permissions: '8', dm_permission: true,
    options: [{ type: 3, name: 'key', description: 'SPT-XXXX-XXXX-XXXX-XXXX (tippen für Vorschläge)', required: true, autocomplete: true, min_length: 3, max_length: 30 }],
  },
  {
    name: CMD_APP, type: 1, description: 'SP Tool – App-ZIP hochladen, die an jede Key-DM angehängt wird (nur Admins)', default_member_permissions: '8', dm_permission: true,
    options: [
      { type: 11, name: 'datei', description: 'App-ZIP (max. 10 MB) – wird immer als Turbo_Designs_SP_Tool.zip verschickt', required: true },
      { type: 3, name: 'version', description: 'Versionsnummer, z. B. 1.1.0', max_length: 20 },
    ],
  },
  {
    name: CMD_USER, type: 1, description: 'SP Tool – User verwalten: Plan, Laufzeit, PCs, Hardware-ID, Sperre (nur Admins)', default_member_permissions: '8', dm_permission: true,
    options: [{ type: 6, name: 'user', description: 'Discord-User', required: true }],
  },
];

function install() {
  if (String(process.env.SPTOOL_KEY_PANEL ?? 'true').toLowerCase() === 'false') return;
  const { Client, Events, REST, Routes } = require('discord.js');
  if (Client.prototype.__sptoolKeyPanel) return;
  Client.prototype.__sptoolKeyPanel = true;

  // Other routers of the bot must not see (and answer) our interactions.
  const realOn = Client.prototype.on;
  Client.prototype.on = function spkFilteredOn(eventName, listener) {
    if (eventName === Events.InteractionCreate) {
      return realOn.call(this, eventName, function spkSkip(interaction, ...args) {
        if (isOurs(interaction)) return undefined;
        return listener.call(this, interaction, ...args);
      });
    }
    return realOn.call(this, eventName, listener);
  };
  // prependListener/addListener too: the license bot must not pair before the confirmation.
  const realPrepend = Client.prototype.prependListener;
  const realAdd = Client.prototype.addListener;
  const filtered = (listener) => function spkSkip(interaction, ...args) {
    if (isOurs(interaction)) return undefined;
    return listener.call(this, interaction, ...args);
  };
  Client.prototype.prependListener = function spkFilteredPrepend(eventName, listener) {
    return realPrepend.call(this, eventName, eventName === Events.InteractionCreate ? filtered(listener) : listener);
  };
  Client.prototype.addListener = function spkFilteredAdd(eventName, listener) {
    return realAdd.call(this, eventName, eventName === Events.InteractionCreate ? filtered(listener) : listener);
  };

  const attach = (client) => {
    if (!client || client.__spkInstalled) return;
    client.__spkInstalled = true;
    realPrepend.call(client, Events.InteractionCreate, (i) => {
      if (!isOurs(i)) return;
      handle(i).catch((e) => {
        console.error('❌ SP Tool Key-Panel:', e);
        if (i.isAutocomplete?.()) return;
        const p = { content: `❌ Fehler: ${String(e?.message || e).slice(0, 300)}`, flags: EPHEMERAL };
        (i.deferred || i.replied ? i.followUp(p) : i.reply(p)).catch(() => {});
      });
    });
    const register = async (c) => {
      if (client.__spkRegistered) return;
      client.__spkRegistered = true;
      try {
        const rest = new REST({ version: '10' }).setToken(c.token || client.token);
        const appId = (c.application || client.application).id;
        for (const body of commandBodies) await rest.post(Routes.applicationCommands(appId), { body });
        openDb();
        console.log(`✅ SP Tool Key-Verwaltung bereit: /${CMD_HUB}, /${CMD_REMOVE}, /${CMD_APP}, /${CMD_USER}${dbError ? ` (Datenbank: ${dbError.message})` : ''} · v1.3.1`);
        const tick = () => remindExpiring(client).then((n) => { if (n) console.log(`⏰ SP Tool: ${n} Ablauf-Erinnerung(en) gesendet`); }).catch((e) => console.error('❌ SP Tool Ablauf-Erinnerung:', e?.message || e));
        setTimeout(tick, 60000).unref?.();
        setInterval(tick, 3600000).unref?.();
      } catch (e) { client.__spkRegistered = false; console.error('❌ SP Tool Key-Panel: Commands konnten nicht registriert werden:', e?.message || e); }
    };
    // discord.js 14.22+ emits "clientReady", older versions "ready" – register once on whichever comes.
    for (const ev of new Set([Events.ClientReady, 'clientReady', 'ready'])) client.once(ev, (c) => { void register(c || client); });
    if (client.isReady?.()) void register(client);
  };

  const realLogin = Client.prototype.login;
  Client.prototype.login = function spkLogin(...args) {
    attach(this);
    return realLogin.apply(this, args);
  };
  const realEmit = Client.prototype.emit;
  Client.prototype.emit = function spkEmit(event, ...args) {
    if (!this.__spkInstalled) attach(this);
    return realEmit.call(this, event, ...args);
  };
  console.log('ℹ️ SP Tool Key-Verwaltung geladen');
}

try { install(); } catch (e) { console.error('❌ SP Tool Key-Panel nicht geladen:', e?.message || e); }

module.exports = { userView, userAction, bulkView, bulkRemove, logView, exportFile, remindExpiring, usersPickView, appFile, storeAppFile, handle, hubView, createView, manageView, removeKeys, createKeys, decode, encode, isOurs, commandBodies };
