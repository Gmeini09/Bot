// License operations shared by the HTTP API (app.mjs) and the Discord bot integration.
// Every function validates its input and writes an audit entry; callers only map errors to replies.
import { activeLicense, audit, ensureUser, getLicense, getUser, tx } from './db.mjs';
import { generateLicenseKey, isLicenseKey } from './security.mjs';

export const PLANS = ['free', 'premium', 'creator', 'developer'];
export const DAY = 86_400_000;
export const isSnowflake = (s) => typeof s === 'string' && /^\d{15,21}$/.test(s);

export class LicenseError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

export function createLicenseService({ cfg, db, now = () => Date.now() }) {
  const isConfigAdmin = (id) => cfg.adminIds.has(id);
  const roleOf = (u) => (u && isConfigAdmin(u.discord_id) ? 'admin' : u?.role ?? 'user');
  const isAdmin = (id) => isConfigAdmin(id) || getUser(db, id)?.role === 'admin';
  const needId = (id) => { if (!isSnowflake(id)) throw new LicenseError(400, 'bad_id', 'Invalid Discord ID.'); return id; };

  function licenseView(id) {
    if (isConfigAdmin(id)) return { plan: 'developer', maxDevices: 20, expiresAt: null, source: 'owner', active: true };
    const l = getLicense(db, id);
    if (!l) return null;
    const active = !l.revoked && (l.expires_at == null || l.expires_at > now());
    return { plan: l.plan, maxDevices: l.max_devices, expiresAt: l.expires_at, source: l.source, active, revoked: !!l.revoked, note: l.note };
  }

  function maxDevicesFor(id) {
    if (isConfigAdmin(id)) return 20;
    return activeLicense(db, id, now())?.max_devices ?? cfg.defaultMaxDevices;
  }

  const publicUser = (u) => ({ id: u.discord_id, username: u.username, globalName: u.global_name, avatar: u.avatar, role: roleOf(u), banned: !!u.banned, banReason: u.ban_reason, createdAt: u.created_at, lastLogin: u.last_login });
  const publicDevice = (d) => ({ id: d.id, name: d.name, kind: d.kind, firstSeen: d.first_seen, lastSeen: d.last_seen, revoked: !!d.revoked });
  const devicesOf = (id) => db.prepare('SELECT * FROM devices WHERE discord_id = ? ORDER BY last_seen DESC').all(id).map(publicDevice);

  function userDetail(id) {
    needId(id);
    const u = getUser(db, id);
    if (!u) return null;
    const sessions = db.prepare('SELECT created_at, last_used, expires_at, revoked, device_id FROM sessions WHERE discord_id = ? ORDER BY last_used DESC LIMIT 50').all(id);
    const log = db.prepare('SELECT at, actor, action, target, detail FROM audit_log WHERE target = ? OR actor = ? ORDER BY at DESC LIMIT 50').all(id, id);
    return { user: publicUser(u), license: licenseView(id), devices: devicesOf(id), maxDevices: maxDevicesFor(id), sessions, log };
  }

  function searchUsers(q = '') {
    const term = `%${String(q).slice(0, 64)}%`;
    const rows = db.prepare(`SELECT u.*, (SELECT COUNT(*) FROM devices d WHERE d.discord_id = u.discord_id AND d.revoked = 0) AS device_count
      FROM users u WHERE u.discord_id LIKE ? OR IFNULL(u.username,'') LIKE ? OR IFNULL(u.global_name,'') LIKE ? ORDER BY IFNULL(u.last_login, u.created_at) DESC LIMIT 200`).all(term, term, term);
    return rows.map((r) => ({ ...publicUser(r), license: licenseView(r.discord_id), deviceCount: r.device_count }));
  }

  function stats() {
    const c = (sql, ...a) => db.prepare(sql).get(...a).n;
    return {
      users: c('SELECT COUNT(*) AS n FROM users'),
      activeLicenses: c('SELECT COUNT(*) AS n FROM licenses WHERE revoked = 0 AND (expires_at IS NULL OR expires_at > ?)', now()),
      devices: c('SELECT COUNT(*) AS n FROM devices WHERE revoked = 0'),
      openKeys: c('SELECT COUNT(*) AS n FROM license_keys WHERE redeemed_by IS NULL AND revoked = 0'),
      banned: c('SELECT COUNT(*) AS n FROM users WHERE banned = 1'),
      logins24h: c("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'login' AND at > ?", now() - DAY),
    };
  }

  /** days: null/'' = lifetime. */
  function setLicense(actor, id, { plan, days, maxDevices, note }) {
    needId(id);
    plan = String(plan ?? '');
    if (!PLANS.includes(plan)) throw new LicenseError(400, 'bad_plan', `Plan must be one of ${PLANS.join(', ')}.`);
    const md = Math.max(1, Math.min(20, Number(maxDevices ?? 1) | 0));
    const expiresAt = days == null || days === '' || Number(days) <= 0 ? null : now() + Math.max(1, Number(days)) * DAY;
    ensureUser(db, id, now());
    db.prepare(`INSERT INTO licenses (discord_id, plan, max_devices, expires_at, source, revoked, note, updated_at) VALUES (?, ?, ?, ?, 'admin', 0, ?, ?)
      ON CONFLICT(discord_id) DO UPDATE SET plan = excluded.plan, max_devices = excluded.max_devices, expires_at = excluded.expires_at, source = 'admin', revoked = 0, note = excluded.note, updated_at = excluded.updated_at`)
      .run(id, plan, md, expiresAt, note ? String(note).slice(0, 200) : null, now());
    audit(db, actor, 'license.set', id, { plan, maxDevices: md, expiresAt });
    return licenseView(id);
  }

  function revokeLicense(actor, id) {
    needId(id);
    db.prepare('UPDATE licenses SET revoked = 1, updated_at = ? WHERE discord_id = ?').run(now(), id);
    audit(db, actor, 'license.revoked', id);
    return licenseView(id);
  }

  function ban(actor, id, reason) {
    needId(id);
    if (isConfigAdmin(id)) throw new LicenseError(403, 'protected', 'The owner cannot be banned.');
    if (roleOf(getUser(db, id)) === 'admin' && !isConfigAdmin(actor)) throw new LicenseError(403, 'owner_only', 'Only the owner can ban another admin.');
    const r = reason ? String(reason).slice(0, 200) : null;
    ensureUser(db, id, now());
    db.prepare('UPDATE users SET banned = 1, ban_reason = ? WHERE discord_id = ?').run(r, id);
    db.prepare('UPDATE sessions SET revoked = 1 WHERE discord_id = ?').run(id);
    audit(db, actor, 'user.banned', id, { reason: r });
  }

  function unban(actor, id) {
    needId(id);
    db.prepare('UPDATE users SET banned = 0, ban_reason = NULL WHERE discord_id = ?').run(id);
    audit(db, actor, 'user.unbanned', id);
  }

  function setRole(actor, id, role) {
    needId(id);
    role = role === 'admin' ? 'admin' : 'user';
    if (!isConfigAdmin(actor)) throw new LicenseError(403, 'owner_only', 'Only the owner can change admin roles.');
    if (isConfigAdmin(id) && role !== 'admin') throw new LicenseError(403, 'protected', 'The owner always stays admin.');
    ensureUser(db, id, now());
    db.prepare('UPDATE users SET role = ? WHERE discord_id = ?').run(role, id);
    audit(db, actor, 'user.role', id, { role });
  }

  function resetDevices(actor, id) {
    needId(id);
    const n = db.prepare('UPDATE devices SET revoked = 1 WHERE discord_id = ? AND revoked = 0').run(id).changes;
    db.prepare('UPDATE sessions SET revoked = 1 WHERE discord_id = ?').run(id);
    db.prepare('DELETE FROM devices WHERE discord_id = ? AND revoked = 1').run(id);
    audit(db, actor, 'devices.reset', id, { removed: n });
    return n;
  }

  function removeDevice(actor, deviceId) {
    const d = db.prepare('SELECT * FROM devices WHERE id = ?').get(String(deviceId));
    if (!d) throw new LicenseError(404, 'not_found', 'Device not found.');
    db.prepare('DELETE FROM sessions WHERE device_id = ?').run(d.id);
    db.prepare('DELETE FROM devices WHERE id = ?').run(d.id);
    audit(db, actor, 'device.removed', d.discord_id, { device: d.id, name: d.name });
  }

  function logoutAll(actor, id, self = false) {
    needId(id);
    db.prepare('UPDATE sessions SET revoked = 1 WHERE discord_id = ?').run(id);
    audit(db, actor, self ? 'logout.all' : 'sessions.revoked', id);
  }

  function createKeys(actor, { plan, count, days, maxDevices, note }) {
    plan = String(plan ?? '');
    if (!PLANS.includes(plan)) throw new LicenseError(400, 'bad_plan', `Plan must be one of ${PLANS.join(', ')}.`);
    const n = Math.max(1, Math.min(100, Number(count ?? 1) | 0));
    const d = days == null || days === '' || Number(days) <= 0 ? null : Math.max(1, Number(days) | 0);
    const md = Math.max(1, Math.min(20, Number(maxDevices ?? 1) | 0));
    const nt = note ? String(note).slice(0, 200) : null;
    const keys = tx(db, () => Array.from({ length: n }, () => {
      const k = generateLicenseKey();
      db.prepare('INSERT INTO license_keys (key, plan, days, max_devices, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(k, plan, d, md, nt, actor, now());
      return k;
    }));
    audit(db, actor, 'keys.created', null, { count: n, plan, days: d, maxDevices: md });
    return keys;
  }

  function listKeys() {
    return db.prepare('SELECT * FROM license_keys ORDER BY created_at DESC LIMIT 500').all()
      .map((r) => ({ key: r.key, plan: r.plan, days: r.days, maxDevices: r.max_devices, note: r.note, createdAt: r.created_at, redeemedBy: r.redeemed_by, redeemedAt: r.redeemed_at, revoked: !!r.revoked }));
  }

  function revokeKey(actor, key) {
    const n = db.prepare('UPDATE license_keys SET revoked = 1 WHERE key = ? AND redeemed_by IS NULL').run(String(key)).changes;
    if (!n) throw new LicenseError(404, 'not_found', 'Key not found or already redeemed.');
    audit(db, actor, 'key.revoked', String(key));
  }

  /** Redeems a key for a Discord ID (from the app or the bot). */
  function redeemKey(id, key) {
    needId(id);
    const k = String(key ?? '').trim().toUpperCase();
    if (!isLicenseKey(k)) throw new LicenseError(400, 'bad_key', 'That is not a valid license key (SPT-XXXX-XXXX-XXXX-XXXX).');
    const u = getUser(db, id);
    if (u?.banned && !isConfigAdmin(id)) throw new LicenseError(403, 'banned', 'This account is banned.');
    return tx(db, () => {
      const row = db.prepare('SELECT * FROM license_keys WHERE key = ?').get(k);
      if (!row || row.revoked) throw new LicenseError(404, 'key_invalid', 'This key does not exist or was revoked.');
      if (row.redeemed_by) throw new LicenseError(409, 'key_used', 'This key has already been used.');
      const t = now();
      ensureUser(db, id, t);
      const cur = activeLicense(db, id, t);
      // Rules when a license is already active:
      //  same plan   → the key's time is added (lifetime stays lifetime)
      //  higher plan → upgrade for the key's own term; refused if it would end a lifetime license
      //  lower plan  → refused (it would downgrade); the key stays unused and can be given to someone else
      const rank = (p) => PLANS.indexOf(p);
      let expires;
      if (!cur || cur.plan === row.plan) {
        const base = cur?.expires_at && cur.expires_at > t ? cur.expires_at : t;
        expires = row.days == null || (cur && cur.expires_at == null) ? null : base + row.days * DAY;
      } else if (rank(row.plan) < rank(cur.plan)) {
        throw new LicenseError(409, 'key_lower_plan', `You already have ${cur.plan} – this ${row.plan} key would downgrade it. The key was not used.`);
      } else {
        if (cur.expires_at == null && row.days != null) throw new LicenseError(409, 'key_ends_lifetime', `You have a lifetime ${cur.plan} license – this ${row.days}-day ${row.plan} key would replace it. The key was not used; ask an admin to upgrade you.`);
        expires = row.days == null ? null : t + row.days * DAY;
      }
      db.prepare(`INSERT INTO licenses (discord_id, plan, max_devices, expires_at, source, revoked, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?)
        ON CONFLICT(discord_id) DO UPDATE SET plan = excluded.plan, max_devices = MAX(excluded.max_devices, licenses.max_devices), expires_at = excluded.expires_at, source = excluded.source, revoked = 0, updated_at = excluded.updated_at`)
        .run(id, row.plan, row.max_devices, expires, `key:${k}`, t);
      db.prepare('UPDATE license_keys SET redeemed_by = ?, redeemed_at = ? WHERE key = ?').run(id, t, k);
      audit(db, id, 'key.redeemed', k, { plan: row.plan, expires });
      return licenseView(id);
    });
  }

  function auditLog(limit = 300) {
    return db.prepare('SELECT * FROM audit_log ORDER BY at DESC LIMIT ?').all(limit).map((r) => ({ ...r, detail: r.detail ? JSON.parse(r.detail) : null }));
  }

  return {
    isAdmin, isConfigAdmin, roleOf, licenseView, maxDevicesFor, publicUser, publicDevice, devicesOf, userDetail, searchUsers, stats,
    setLicense, revokeLicense, ban, unban, setRole, resetDevices, removeDevice, logoutAll, createKeys, listKeys, revokeKey, redeemKey, auditLog,
  };
}
