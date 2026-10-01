'use strict';
// SP Tool – license key management in Discord (admins only).
//
//   /sptool-key            hub: overview + create keys (menus) + manage/remove keys (list, filter, multi-select)
//   /sptool-key-entfernen  remove one key directly (with autocomplete) – a redeemed key also revokes that license
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
const COMMANDS = new Set([CMD_HUB, CMD_REMOVE]);
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
  const n = (sql) => d.prepare(sql).get().n;
  return {
    open: n('SELECT COUNT(*) AS n FROM license_keys WHERE redeemed_by IS NULL AND revoked = 0'),
    used: n('SELECT COUNT(*) AS n FROM license_keys WHERE redeemed_by IS NOT NULL'),
    revoked: n('SELECT COUNT(*) AS n FROM license_keys WHERE revoked = 1'),
  };
}

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
      ],
      footer: FOOTER,
    }],
    components: [row([
      btn('spk:new', 'Keys erstellen', 3, { emoji: { name: '➕' } }),
      btn('spk:m:open:0', 'Keys verwalten / entfernen', 1, { emoji: { name: '🗂️' } }),
    ])],
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
    btn(`spk:m:${filter}:${Math.max(0, page - 1)}`, '◀', 2, { disabled: page === 0 }),
    btn(`spk:m:${filter}:${page + 1}`, '▶', 2, { disabled: !more }),
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

const resultText = (res) => res.map((r) => `\`${r.key}\` → ${r.result}`).join('\n');

// ── interaction handling ─────────────────────────────────────────────────────
const isOurs = (i) => ((i?.isChatInputCommand?.() || i?.isAutocomplete?.()) && COMMANDS.has(i.commandName)) || String(i?.customId || '').startsWith(`${PREFIX}:`);

async function autocomplete(i) {
  if (!isAdmin(i.user.id) || !openDb()) return i.respond([]);
  const q = String(i.options.getFocused() || '').toUpperCase().replace(/[^A-Z0-9-]/g, '');
  const rows = db.prepare('SELECT key, plan, redeemed_by, revoked FROM license_keys WHERE key LIKE ? ORDER BY created_at DESC LIMIT 25').all(`%${q}%`);
  return i.respond(rows.map((r) => ({ name: `${r.key} · ${PLANS[r.plan] ?? r.plan} · ${r.revoked ? 'gesperrt' : r.redeemed_by ? 'eingelöst' : 'offen'}`.slice(0, 100), value: r.key })));
}

async function handle(i) {
  if (i.isAutocomplete?.()) return autocomplete(i);
  if (!isAdmin(i.user.id)) return i.reply({ content: '❌ Nur SP Tool Admins können Keys verwalten.', flags: EPHEMERAL });

  if (i.isChatInputCommand?.()) {
    if (!openDb()) return i.reply({ content: `❌ Key-Verwaltung nicht verfügbar: ${dbError?.message}`, flags: EPHEMERAL });
    if (i.commandName === CMD_HUB) return i.reply({ ...hubView(), flags: EPHEMERAL });
    const key = String(i.options.getString('key', true)).trim().toUpperCase();
    if (!isKey(key)) return i.reply({ content: '❌ Das ist kein gültiger Key (`SPT-XXXX-XXXX-XXXX-XXXX`).', flags: EPHEMERAL });
    if (!db.prepare('SELECT 1 FROM license_keys WHERE key = ?').get(key)) return i.reply({ content: `❌ Key \`${key}\` gibt es nicht.`, flags: EPHEMERAL });
    return i.reply({ ...confirmView([key], `spk:x1:${key}`, 'spk:x1no'), flags: EPHEMERAL });
  }

  const parts = String(i.customId).split(':');
  const kind = parts[1];
  if (kind === 'hub') return i.update(hubView());
  if (kind === 'new') return i.update(createView({ ...DEFAULT }));
  if (kind === 'm') return i.update(manageView(i.user.id, FILTERS[parts[2]] ? parts[2] : 'open', Math.max(0, Number(parts[3]) || 0)));
  if (kind === 'msel') {
    selections.set(i.user.id, { keys: (i.values ?? []).filter(isKey), at: Date.now() });
    return i.update(manageView(i.user.id, parts[2], Number(parts[3]) || 0));
  }
  if (kind === 'mdel') {
    const keys = selections.get(i.user.id)?.keys ?? [];
    if (!keys.length) return i.update(manageView(i.user.id, parts[2], Number(parts[3]) || 0, '⚠️ Erst Keys im Menü auswählen.'));
    return i.update(confirmView(keys, `spk:mdo:${parts[2]}:${parts[3]}`, `spk:m:${parts[2]}:${parts[3]}`));
  }
  if (kind === 'mdo') {
    const keys = selections.get(i.user.id)?.keys ?? [];
    selections.delete(i.user.id);
    const res = keys.length ? removeKeys(i.user.id, keys) : [];
    return i.update(manageView(i.user.id, parts[2], 0, res.length ? `✅ Erledigt:\n${resultText(res)}` : '⚠️ Nichts ausgewählt.'));
  }
  if (kind === 'x1') {
    const res = removeKeys(i.user.id, [parts[2]]);
    return i.update({ content: '', embeds: [{ color: C.green, title: '✅ Key entfernt', description: resultText(res), footer: FOOTER }], components: [row([btn('spk:m:all:0', 'Alle Keys ansehen', 2, { emoji: { name: '🗂️' } })])] });
  }
  if (kind === 'x1no') return i.update({ content: 'Abgebrochen – nichts entfernt.', embeds: [], components: [] });

  if (!CREATE_ACTIONS.has(kind)) return i.update(hubView());
  const { action, st } = decode(i.customId);
  if (action === 'plan' || action === 'days' || action === 'devices') { st[action] = i.values?.[0] ?? st[action]; return i.update(createView(st)); }
  if (action === 'user') { st.user = i.values?.[0] ?? ''; return i.update(createView(st)); }
  if (action === 'count') { st.count = COUNTS[(COUNTS.indexOf(st.count) + 1) % COUNTS.length]; return i.update(createView(st)); }
  if (action === 'cancel') return i.update(hubView());
  if (action === 'again') return i.update(createView(st));
  if (action === 'create') {
    let keys;
    try { keys = createKeys(i.user.id, st); } catch (e) { return i.update(createView(st, `❌ Fehler: ${e?.message || e}`)); }
    let dm = '';
    if (st.user) {
      try {
        const u = await i.client.users.fetch(st.user);
        await u.send({ embeds: [{ color: C.blue, title: '🎧 Dein SP Tool Lizenz-Key', description: `\`\`\`\n${keys.join('\n')}\n\`\`\``, fields: [
          { name: 'Plan', value: PLANS[st.plan], inline: true }, { name: 'Laufzeit', value: durLabel(st.days), inline: true }, { name: 'PCs', value: st.devices, inline: true },
          { name: 'So aktivierst du', value: 'SP Tool öffnen → **Continue with Discord** → Key eingeben. Die Lizenz wird an deine Discord-ID und deinen PC gebunden.' },
        ], footer: { text: 'SP Tool by Turbo Design' } }] });
        dm = `\n📨 Per DM an <@${st.user}> gesendet.`;
      } catch { dm = `\n⚠️ DM an <@${st.user}> nicht möglich (DMs geschlossen) – bitte selbst schicken.`; }
    }
    return i.update({
      content: '',
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

  const attach = (client) => {
    if (!client || client.__spkInstalled) return;
    client.__spkInstalled = true;
    client.prependListener(Events.InteractionCreate, (i) => {
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
        console.log(`✅ SP Tool Key-Verwaltung bereit: /${CMD_HUB}, /${CMD_REMOVE}${dbError ? ` (Datenbank: ${dbError.message})` : ''}`);
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

module.exports = { handle, hubView, createView, manageView, removeKeys, createKeys, decode, encode, isOurs, commandBodies };
