'use strict';
// SP Tool Cloud – project sync on the license server (Premium and up, admins always).
//
//   GET  /api/v1/cloud/projects              list (+ usage)
//   GET  /api/v1/cloud/projects/:id          one project (data)
//   POST /api/v1/cloud/projects/:id          save {baseRev, name, data} – 409 if the cloud changed meanwhile
//   POST /api/v1/cloud/projects/:id/delete   delete {baseRev} – 409 if the cloud changed meanwhile
//
// Conflict-safe: every write names the revision it is based on; the server never overwrites a newer
// revision silently. Same login as the license API: session token + hardware ID of the device.
// Stand-alone preload (node -r ./sptool-license/cloud-sync.js …): it handles only /api/v1/cloud/*
// and passes everything else on unchanged. Errors disable only this module.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const OWNER_ID = '697402284849627180';
const PREFIX = '/api/v1/cloud/';
const MAX_PROJECT = 3 * 1024 * 1024;
const MAX_TOTAL = 25 * 1024 * 1024;
const MAX_COUNT = 100;
const RANK = { free: 0, premium: 1, creator: 2, developer: 3 };
const ID_RE = /^prj-[a-z0-9-]{3,60}$/;
const MARKER_DAYS = 60;

let db = null;
function openDb() {
  if (db) return db;
  const dir = process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.DATA_DIR || path.join(__dirname, 'data');
  const file = path.join(dir, 'sptool-license.db');
  if (!fs.existsSync(file)) throw new Error('license database missing');
  const { DatabaseSync } = require('node:sqlite');
  db = new DatabaseSync(file);
  db.exec('PRAGMA busy_timeout = 4000');
  db.exec(`CREATE TABLE IF NOT EXISTS sptool_cloud (
    discord_id TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', rev INTEGER NOT NULL,
    updated_at INTEGER NOT NULL, size INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, data TEXT,
    PRIMARY KEY (discord_id, id))`);
  return db;
}

class HttpError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hwidHash = (clientHash) => {
  const salt = process.env.HWID_SERVER_SALT || '';
  return salt ? crypto.createHmac('sha256', salt).update(clientHash).digest('hex') : sha256(clientHash);
};
const configAdmin = (id) => id === OWNER_ID || String(process.env.SPTOOL_ADMIN_IDS || process.env.ADMIN_DISCORD_IDS || '').split(/[,\s;]+/).includes(id);
// role admins lose their rights while banned; owner and configured admins never do
const isAdmin = (u) => configAdmin(u.discord_id) || (u.role === 'admin' && !u.banned);

function authUser(req) {
  const d = openDb();
  const m = /^Bearer ([A-Za-z0-9_-]{20,})$/.exec(req.headers.authorization || '');
  if (!m) throw new HttpError(403, 'cloud_auth', 'Sign in again to use the cloud.');
  const s = d.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(sha256(m[1]));
  if (!s || s.revoked || s.expires_at <= Date.now()) throw new HttpError(403, 'cloud_session', 'Your session has expired. Sign in again to use the cloud.');
  const dev = d.prepare('SELECT * FROM devices WHERE id = ?').get(s.device_id);
  if (!dev || dev.revoked) throw new HttpError(403, 'cloud_device', 'This device was removed from your account.');
  const hw = String(req.headers['x-sptool-hwid'] || '');
  if (!hw || hwidHash(hw) !== dev.hwid_hash) throw new HttpError(403, 'cloud_hwid', 'This session belongs to another computer.');
  const u = d.prepare('SELECT * FROM users WHERE discord_id = ?').get(s.discord_id);
  if (!u) throw new HttpError(403, 'cloud_auth', 'Sign in again to use the cloud.');
  return u;
}

function authenticate(req) {
  const d = openDb();
  const u = authUser(req);
  if (u.banned && !isAdmin(u)) throw new HttpError(403, 'banned', 'This account is banned.');
  if (!isAdmin(u)) {
    const l = d.prepare('SELECT * FROM licenses WHERE discord_id = ?').get(u.discord_id);
    const active = l && !l.revoked && (l.expires_at == null || l.expires_at > Date.now());
    if (!active || (RANK[l.plan] ?? 0) < RANK.premium) throw new HttpError(403, 'plan_required', 'SP Tool Cloud needs Premium or higher.');
  }
  return u.discord_id;
}

// token bucket per user: 120 requests / minute
const buckets = new Map();
function limit(id) {
  const now = Date.now();
  const b = buckets.get(id) || { t: 120, at: now };
  b.t = Math.min(120, b.t + ((now - b.at) / 60000) * 120); b.at = now;
  if (b.t < 1) throw new HttpError(429, 'rate_limited', 'Too many cloud requests – try again in a minute.');
  b.t -= 1; buckets.set(id, b);
  if (buckets.size > 5000) buckets.clear();
}

function readBody(req, max) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    // Over the limit: stop keeping data but read to the end, so the client gets a clean 413 answer.
    req.on('data', (c) => { size += c.length; if (size <= max) chunks.push(c); else chunks.length = 0; if (size > max * 4) req.destroy(); });
    req.on('end', () => {
      if (size > max) return reject(new HttpError(413, 'too_large', 'Project is too large for the cloud (max 3 MB).'));
      let v;
      try { v = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}; } catch { return reject(new HttpError(400, 'bad_json', 'Invalid JSON.')); }
      if (!v || typeof v !== 'object' || Array.isArray(v)) return reject(new HttpError(400, 'bad_json', 'Invalid JSON.'));
      resolve(v);
    });
    req.on('error', reject);
  });
}

// ── App release hand-off ─────────────────────────────────────────────────────
// An admin's SP Tool uploads its own release ZIP when the bot holds an older version, so every key DM
// carries the newest app without a manual /sptool-app-datei upload. Same storage as the key panel.
const APP_PREFIX = '/api/v1/sptool-app/';
const APP_ZIP_NAME = 'Turbo_Designs_SP_Tool.zip';
const MAX_APP_BYTES = 9.5 * 1024 * 1024; // Discord: 10 MB per DM attachment without boosts
const VER_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const dataDir = () => process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.DATA_DIR || path.join(__dirname, 'data');
const appDir = () => path.join(dataDir(), 'sptool-app');
function currentApp() {
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(appDir(), 'meta.json'), 'utf8'));
    return fs.existsSync(path.join(appDir(), meta.stored)) ? meta : null;
  } catch { return null; }
}
const verCmp = (a, b) => { const x = String(a || '0.0.0').split('.').map(Number), y = String(b || '0.0.0').split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); } return 0; };

function readRaw(req, max) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size <= max) chunks.push(c); else chunks.length = 0; if (size > max * 2) req.destroy(); });
    req.on('end', () => (size > max ? reject(new HttpError(413, 'too_large', 'The app ZIP is larger than Discord allows (9.5 MB).')) : resolve(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}

async function handleApp(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, '');
  const u = authUser(req);
  if (!isAdmin(u)) throw new HttpError(403, 'admin_only', 'Only admins can publish the app.');
  if (u.banned && !configAdmin(u.discord_id)) throw new HttpError(403, 'banned', 'This account is banned.');
  limit(u.discord_id);
  const rest = new URL(req.url, 'http://x').pathname.slice(APP_PREFIX.length);
  if (rest !== 'release') throw new HttpError(404, 'not_found', 'Not found.');
  const cur = currentApp();
  if (req.method === 'GET') return send(res, 200, { version: cur?.version ?? null, size: cur?.size ?? null, uploadedAt: cur?.uploadedAt ?? null });
  if (req.method !== 'POST') throw new HttpError(405, 'method', 'Method not allowed.');
  const version = String(req.headers['x-sptool-version'] || '');
  if (!VER_RE.test(version)) throw new HttpError(400, 'bad_version', 'Invalid version.');
  const buf = await readRaw(req, MAX_APP_BYTES);
  const latest = currentApp(); // another upload may have finished while this body was arriving
  if (latest && verCmp(version, latest.version) <= 0) return send(res, 200, { stored: false, version: latest.version });
  if (cur && verCmp(version, cur.version) <= 0) return send(res, 200, { stored: false, version: cur.version });
  if (buf.length < 1024 || buf.readUInt32LE(0) !== 0x04034b50) throw new HttpError(400, 'bad_zip', 'That is not a ZIP file.');
  if (!buf.includes(Buffer.from('SPTool.exe'))) throw new HttpError(400, 'bad_zip', 'The ZIP does not contain SPTool.exe.');
  fs.mkdirSync(appDir(), { recursive: true });
  const stored = `app-${Date.now()}.zip`;
  fs.writeFileSync(path.join(appDir(), stored), buf);
  const meta = { name: APP_ZIP_NAME, uploadedName: APP_ZIP_NAME, stored, size: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'), version, uploadedAt: Date.now(), uploadedBy: u.discord_id, via: 'app' };
  fs.writeFileSync(path.join(appDir(), 'meta.json.tmp'), JSON.stringify(meta, null, 2));
  fs.renameSync(path.join(appDir(), 'meta.json.tmp'), path.join(appDir(), 'meta.json'));
  if (latest && latest.stored !== stored) { try { fs.unlinkSync(path.join(appDir(), latest.stored)); } catch { /* ignore */ } }
  try { openDb().prepare('INSERT INTO audit_log (at, actor, action, target, detail) VALUES (?, ?, ?, ?, ?)').run(Date.now(), u.discord_id, 'app.uploaded', null, JSON.stringify({ name: APP_ZIP_NAME, size: buf.length, version, via: 'app-auto' })); } catch { /* optional */ }
  console.log(`📦 SP Tool App v${version} automatisch übernommen (${(buf.length / 1048576).toFixed(1)} MB) – Key-DMs enthalten jetzt diese Version.`);
  return send(res, 200, { stored: true, version });
}

const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  'Access-Control-Allow-Origin': process.env.CORS_ORIGINS || '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-SPTool-HWID, X-SPTool-Version',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Max-Age': '600',
};
const send = (res, status, body) => { res.writeHead(status, HEADERS); res.end(body === '' ? '' : JSON.stringify(body)); };

function usage(d, uid) {
  const r = d.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM sptool_cloud WHERE discord_id = ? AND deleted = 0').get(uid);
  return { count: r.n, bytes: r.bytes, maxBytes: MAX_TOTAL, maxCount: MAX_COUNT, maxProject: MAX_PROJECT };
}

async function handle(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, '');
  const url = new URL(req.url, 'http://x');
  const rest = url.pathname.slice(PREFIX.length).split('/').filter(Boolean);
  const uid = authenticate(req);
  limit(uid);
  const d = openDb();
  if (rest[0] !== 'projects') throw new HttpError(404, 'not_found', 'Not found.');
  if (rest.length === 1 && req.method === 'GET') {
    const rows = d.prepare('SELECT id, name, rev, updated_at, size, deleted FROM sptool_cloud WHERE discord_id = ? ORDER BY updated_at DESC').all(uid);
    return send(res, 200, { projects: rows.map((r) => ({ id: r.id, name: r.name, rev: r.rev, updatedAt: r.updated_at, size: r.size, deleted: !!r.deleted })), usage: usage(d, uid) });
  }
  const id = rest[1];
  if (!ID_RE.test(id || '')) throw new HttpError(400, 'bad_id', 'Invalid project id.');
  let cur = d.prepare('SELECT * FROM sptool_cloud WHERE discord_id = ? AND id = ?').get(uid, id);
  if (rest.length === 2 && req.method === 'GET') {
    if (!cur || cur.deleted) throw new HttpError(404, 'not_found', 'This project is not in the cloud.');
    return send(res, 200, { id, name: cur.name, rev: cur.rev, updatedAt: cur.updated_at, data: JSON.parse(cur.data) });
  }
  if (req.method !== 'POST') throw new HttpError(405, 'method', 'Method not allowed.');
  const body = await readBody(req, MAX_PROJECT + 64 * 1024);
  // read again after the body arrived: another device may have saved meanwhile. From here on everything is
  // synchronous (node:sqlite), so check and write cannot interleave with another request.
  cur = d.prepare('SELECT * FROM sptool_cloud WHERE discord_id = ? AND id = ?').get(uid, id);
  const baseRev = Number.isInteger(body.baseRev) ? body.baseRev : 0;
  const curRev = cur ? cur.rev : 0;
  if (baseRev !== curRev) return send(res, 409, { error: 'conflict', message: 'The cloud copy changed on another device.', rev: curRev, updatedAt: cur ? cur.updated_at : null, deleted: cur ? !!cur.deleted : false });
  const t = Date.now();
  if (rest.length === 3 && rest[2] === 'delete') {
    if (!cur) return send(res, 200, { rev: 0 });
    d.prepare('UPDATE sptool_cloud SET deleted = 1, data = NULL, size = 0, rev = ?, updated_at = ? WHERE discord_id = ? AND id = ?').run(curRev + 1, t, uid, id);
    // delete markers only need to live until the other PCs have seen them
    d.prepare('DELETE FROM sptool_cloud WHERE discord_id = ? AND deleted = 1 AND updated_at < ?').run(uid, t - MARKER_DAYS * 86400000);
    return send(res, 200, { rev: curRev + 1, updatedAt: t });
  }
  if (rest.length !== 2) throw new HttpError(404, 'not_found', 'Not found.');
  if (!body.data || typeof body.data !== 'object') throw new HttpError(400, 'bad_data', 'Project data missing.');
  const data = JSON.stringify(body.data);
  if (Buffer.byteLength(data) > MAX_PROJECT) throw new HttpError(413, 'too_large', 'Project is too large for the cloud (max 3 MB).');
  const u = usage(d, uid);
  const others = u.bytes - (cur && !cur.deleted ? cur.size : 0);
  if (others + Buffer.byteLength(data) > MAX_TOTAL) throw new HttpError(413, 'quota', 'Your cloud storage is full (25 MB). Delete cloud projects you no longer need.');
  if ((!cur || cur.deleted) && u.count >= MAX_COUNT) throw new HttpError(413, 'quota', `You can keep up to ${MAX_COUNT} projects in the cloud.`);
  const name = String(body.name || 'Project').slice(0, 120);
  d.prepare(`INSERT INTO sptool_cloud (discord_id, id, name, rev, updated_at, size, deleted, data) VALUES (?, ?, ?, ?, ?, ?, 0, ?)
    ON CONFLICT(discord_id, id) DO UPDATE SET name = excluded.name, rev = excluded.rev, updated_at = excluded.updated_at, size = excluded.size, deleted = 0, data = excluded.data`)
    .run(uid, id, name, curRev + 1, t, Buffer.byteLength(data), data);
  return send(res, 200, { rev: curRev + 1, updatedAt: t });
}

function install() {
  if (String(process.env.SPTOOL_CLOUD ?? 'true').toLowerCase() === 'false' || http.__sptoolCloud) return;
  http.__sptoolCloud = true;
  const original = http.createServer;
  http.createServer = function sptoolCloudCreateServer(...args) {
    const listener = typeof args[0] === 'function' ? args[0] : (typeof args[1] === 'function' ? args[1] : null);
    if (listener) {
      const wrapped = function sptoolCloudListener(req, res) {
        const url = String(req.url || '');
        const h = url.startsWith(PREFIX) ? handle : url.startsWith(APP_PREFIX) ? handleApp : null;
        if (!h) return listener.call(this, req, res);
        h(req, res).catch((e) => {
          if (res.headersSent) return;
          if (e instanceof HttpError) return send(res, e.status, { error: e.code, message: e.message });
          console.error('❌ SP Tool Cloud:', e?.message || e);
          send(res, 500, { error: 'internal', message: 'Cloud error – please try again.' });
        });
      };
      if (args[0] === listener) args[0] = wrapped; else args[1] = wrapped;
    }
    return original.apply(this, args);
  };
  console.log('ℹ️ SP Tool Cloud geladen · /api/v1/cloud · /api/v1/sptool-app · v1.2.0');
}

try { install(); } catch (e) { console.error('❌ SP Tool Cloud nicht geladen:', e?.message || e); }
module.exports = { handle, handleApp, authenticate, verCmp, HttpError };
