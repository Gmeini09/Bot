// License operations shared by the HTTP API (app.mjs) and the Discord bot integration.
// Every function validates its input and writes an audit entry; callers only map errors to replies.
import { activeLicense, audit, ensureUser, getLicense, getUser, tx } from './db.mjs';
import { randomInt } from 'node:crypto';
import { generateLicenseKey, isLicenseKey } from './security.mjs';
import tiers from './tiers.cjs';

/** Licence levels Free < Premium < Creator < Admin < Developer (see tiers.cjs). */
export const PLANS = tiers.PLANS;
export const PRODUCT_PLANS = tiers.PRODUCT_PLANS;
export const DAY = 86_400_000;
/** Products besides SP Tool (whose license stays in `licenses`). Their licenses live in `product_licenses`. */
export const PRODUCTS = ['skin'];
/** Key kinds sold in addition to SP Tool keys (SPT-…): Turbo Skin Tool (TSK-…) and Multi (TMK-…, both tools). */
export const KEY_KINDS = { skin: { prefix: 'TSK', grants: ['skin'] }, multi: { prefix: 'TMK', grants: ['sptool', 'skin'] } };
const PRODUCT_KEY_RE = /^(TSK|TMK)-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
export const isProductKey = (k) => PRODUCT_KEY_RE.test(String(k ?? ''));
const KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newProductKey = (prefix) => `${prefix}-${Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => KEY_ALPHABET[randomInt(KEY_ALPHABET.length)]).join('')).join('-')}`;

/** Tables for the extra products (created on start – the bundled migrations only know SP Tool). */
export function ensureProductTables(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS product_licenses (
    discord_id TEXT NOT NULL, product TEXT NOT NULL, plan TEXT NOT NULL, max_devices INTEGER NOT NULL DEFAULT 1,
    expires_at INTEGER, source TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0, note TEXT, updated_at INTEGER NOT NULL,
    PRIMARY KEY (discord_id, product))`);
  db.exec(`CREATE TABLE IF NOT EXISTS product_keys (
    key TEXT PRIMARY KEY, kind TEXT NOT NULL, plan TEXT NOT NULL, days INTEGER, max_devices INTEGER NOT NULL DEFAULT 1, note TEXT,
    created_by TEXT NOT NULL, created_at INTEGER NOT NULL, redeemed_by TEXT, redeemed_at INTEGER, revoked INTEGER NOT NULL DEFAULT 0)`);
}
export const isSnowflake = (s) => typeof s === 'string' && /^\d{15,21}$/.test(s);

export class LicenseError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

export function createLicenseService({ cfg, db, now = () => Date.now() }) {
  const isConfigAdmin = (id) => cfg.adminIds.has(id);
  /** Effective licence level of an account (licence, owner-set admin role, configured admins = Developer). */
  const tierOf = (id, opts) => tiers.effectiveTier(db, id, isConfigAdmin, now(), opts);
  // "admin" role = may use the admin area / key management: Admin and Developer level
  const roleOf = (u) => (u && tiers.isStaff(tierOf(u.discord_id)) ? 'admin' : 'user');
  const isAdmin = (id) => tiers.isStaff(tierOf(id));
  const isDev = (id) => tierOf(id) === 'developer';
  /** Refuses when the actor may not change this account (its real level, also while banned). */
  function needManage(actor, id) {
    if (actor === id) return;
    if (isConfigAdmin(id) && !isConfigAdmin(actor)) throw new LicenseError(403, 'protected', 'The owner account cannot be changed.');
    if (!tiers.canManage(tierOf(actor), tierOf(id, { ignoreBan: true }))) throw new LicenseError(403, 'dev_only', 'Only a Developer can change Admin and Developer accounts.');
  }
  /** Refuses when the actor may not hand out this plan (Admin up to Creator, Developer everything). */
  function needGrant(actor, plan) {
    if (!tiers.canGrant(tierOf(actor), plan)) {
      throw tiers.isStaff(tierOf(actor))
        ? new LicenseError(403, 'dev_only', `Only a Developer can hand out ${tiers.LABEL[plan] ?? plan} licences and keys.`)
        : new LicenseError(403, 'forbidden', 'Admins only.');
    }
  }
  const needId = (id) => { if (!isSnowflake(id)) throw new LicenseError(400, 'bad_id', 'Invalid Discord ID.'); return id; };
  ensureProductTables(db);
  // 002: the database accepts the levels Admin and Developer (once; keeps every row)
  if (tiers.migratePlanLevels(db)) console.log('ℹ️ SP Tool Lizenz-Datenbank: Stufe Admin ergänzt (002_plan_levels)');
  const needProduct = (p) => { if (p !== 'sptool' && !PRODUCTS.includes(p)) throw new LicenseError(400, 'bad_product', 'Unknown product.'); return p; };
  const getProductLicense = (id, product) => db.prepare('SELECT * FROM product_licenses WHERE discord_id = ? AND product = ?').get(id, product);
  const isActiveRow = (l, t = now()) => Boolean(l) && !l.revoked && (l.expires_at == null || l.expires_at > t);

  function licenseView(id) {
    if (isConfigAdmin(id)) return { plan: 'developer', tier: 'developer', maxDevices: 20, expiresAt: null, source: 'owner', active: true };
    const l = getLicense(db, id);
    if (!l) return null;
    const active = !l.revoked && (l.expires_at == null || l.expires_at > now());
    return { plan: l.plan, tier: tiers.tierOfPlan(l.plan), maxDevices: l.max_devices, expiresAt: l.expires_at, source: l.source, active, revoked: !!l.revoked, note: l.note };
  }

  /** License of one product ('sptool' = the SP Tool license). */
  function productView(id, product = 'sptool') {
    if (product === 'sptool') return licenseView(id);
    needProduct(product);
    if (isConfigAdmin(id)) return { plan: 'developer', tier: 'developer', maxDevices: 20, expiresAt: null, source: 'owner', active: true };
    const l = getProductLicense(id, product);
    if (!l) return null;
    return { plan: l.plan, tier: tiers.tierOfPlan(l.plan), maxDevices: l.max_devices, expiresAt: l.expires_at, source: l.source, active: isActiveRow(l), revoked: !!l.revoked, note: l.note };
  }
  /** All products of a user: { sptool, skin }. */
  const productsOf = (id) => Object.fromEntries(['sptool', ...PRODUCTS].map((p) => [p, productView(id, p)]));

  function maxDevicesFor(id) {
    if (isConfigAdmin(id)) return 20;
    const t = now();
    const mds = [activeLicense(db, id, t)?.max_devices, ...db.prepare('SELECT * FROM product_licenses WHERE discord_id = ?').all(id).filter((l) => isActiveRow(l, t)).map((l) => l.max_devices)].filter((n) => n != null);
    return mds.length ? Math.max(...mds) : cfg.defaultMaxDevices;
  }

  const publicUser = (u) => ({ id: u.discord_id, username: u.username, globalName: u.global_name, avatar: u.avatar, role: roleOf(u), tier: tierOf(u.discord_id, { ignoreBan: true }), banned: !!u.banned, banReason: u.ban_reason, createdAt: u.created_at, lastLogin: u.last_login });
  const publicDevice = (d) => ({ id: d.id, name: d.name, kind: d.kind, firstSeen: d.first_seen, lastSeen: d.last_seen, revoked: !!d.revoked });
  const devicesOf = (id) => db.prepare('SELECT * FROM devices WHERE discord_id = ? ORDER BY last_seen DESC').all(id).map(publicDevice);

  function userDetail(id) {
    needId(id);
    const u = getUser(db, id);
    if (!u) return null;
    const sessions = db.prepare('SELECT created_at, last_used, expires_at, revoked, device_id FROM sessions WHERE discord_id = ? ORDER BY last_used DESC LIMIT 50').all(id);
    const log = db.prepare('SELECT at, actor, action, target, detail FROM audit_log WHERE target = ? OR actor = ? ORDER BY at DESC LIMIT 50').all(id, id);
    return { user: publicUser(u), license: licenseView(id), products: productsOf(id), devices: devicesOf(id), maxDevices: maxDevicesFor(id), sessions, log };
  }

  function searchUsers(q = '') {
    const term = `%${String(q).slice(0, 64)}%`;
    const rows = db.prepare(`SELECT u.*, (SELECT COUNT(*) FROM devices d WHERE d.discord_id = u.discord_id AND d.revoked = 0) AS device_count
      FROM users u WHERE u.discord_id LIKE ? OR IFNULL(u.username,'') LIKE ? OR IFNULL(u.global_name,'') LIKE ? ORDER BY IFNULL(u.last_login, u.created_at) DESC LIMIT 200`).all(term, term, term);
    return rows.map((r) => ({ ...publicUser(r), license: licenseView(r.discord_id), products: productsOf(r.discord_id), deviceCount: r.device_count }));
  }

  function stats() {
    const c = (sql, ...a) => db.prepare(sql).get(...a).n;
    return {
      users: c('SELECT COUNT(*) AS n FROM users'),
      activeLicenses: c('SELECT COUNT(*) AS n FROM licenses WHERE revoked = 0 AND (expires_at IS NULL OR expires_at > ?)', now()),
      devices: c('SELECT COUNT(*) AS n FROM devices WHERE revoked = 0'),
      openKeys: c('SELECT COUNT(*) AS n FROM license_keys WHERE redeemed_by IS NULL AND revoked = 0') + c('SELECT COUNT(*) AS n FROM product_keys WHERE redeemed_by IS NULL AND revoked = 0'),
      skinLicenses: c("SELECT COUNT(*) AS n FROM product_licenses WHERE product = 'skin' AND revoked = 0 AND (expires_at IS NULL OR expires_at > ?)", now()),
      banned: c('SELECT COUNT(*) AS n FROM users WHERE banned = 1'),
      logins24h: c("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'login' AND at > ?", now() - DAY),
    };
  }

  /** days: null/'' = lifetime. */
  function setLicense(actor, id, { plan, days, maxDevices, note }) {
    needId(id);
    plan = String(plan ?? '');
    if (!PLANS.includes(plan)) throw new LicenseError(400, 'bad_plan', `Plan must be one of ${PLANS.join(', ')}.`);
    needGrant(actor, plan);
    needManage(actor, id);
    const md = Math.max(1, Math.min(20, Number(maxDevices ?? 1) | 0));
    const expiresAt = days == null || days === '' || Number(days) <= 0 ? null : now() + Math.max(1, Number(days)) * DAY;
    ensureUser(db, id, now());
    db.prepare(`INSERT INTO licenses (discord_id, plan, max_devices, expires_at, source, revoked, note, updated_at) VALUES (?, ?, ?, ?, 'admin', 0, ?, ?)
      ON CONFLICT(discord_id) DO UPDATE SET plan = excluded.plan, max_devices = excluded.max_devices, expires_at = excluded.expires_at, source = 'admin', revoked = 0, note = excluded.note, updated_at = excluded.updated_at`)
      .run(id, plan, md, expiresAt, note ? String(note).slice(0, 200) : null, now());
    audit(db, actor, 'license.set', id, { plan, maxDevices: md, expiresAt });
    return licenseView(id);
  }

  /** Same as setLicense for another product (Turbo Skin Tool …). */
  function setProductLicense(actor, id, product, { plan, days, maxDevices, note }) {
    if (needProduct(product) === 'sptool') return setLicense(actor, id, { plan, days, maxDevices, note });
    needId(id);
    plan = String(plan ?? '');
    if (!PRODUCT_PLANS.includes(plan)) throw new LicenseError(400, 'bad_plan', `Plan must be one of ${PRODUCT_PLANS.join(', ')}.`);
    needGrant(actor, plan);
    needManage(actor, id);
    const md = Math.max(1, Math.min(20, Number(maxDevices ?? 1) | 0));
    const expiresAt = days == null || days === '' || Number(days) <= 0 ? null : now() + Math.max(1, Number(days)) * DAY;
    ensureUser(db, id, now());
    db.prepare(`INSERT INTO product_licenses (discord_id, product, plan, max_devices, expires_at, source, revoked, note, updated_at) VALUES (?, ?, ?, ?, ?, 'admin', 0, ?, ?)
      ON CONFLICT(discord_id, product) DO UPDATE SET plan = excluded.plan, max_devices = excluded.max_devices, expires_at = excluded.expires_at, source = 'admin', revoked = 0, note = excluded.note, updated_at = excluded.updated_at`)
      .run(id, product, plan, md, expiresAt, note ? String(note).slice(0, 200) : null, now());
    audit(db, actor, 'license.set', id, { product, plan, maxDevices: md, expiresAt });
    return productView(id, product);
  }
  function revokeProductLicense(actor, id, product) {
    if (needProduct(product) === 'sptool') return revokeLicense(actor, id);
    needId(id);
    needManage(actor, id);
    db.prepare('UPDATE product_licenses SET revoked = 1, updated_at = ? WHERE discord_id = ? AND product = ?').run(now(), id, product);
    audit(db, actor, 'license.revoked', id, { product });
    return productView(id, product);
  }

  function revokeLicense(actor, id) {
    needId(id);
    needManage(actor, id);
    db.prepare('UPDATE licenses SET revoked = 1, updated_at = ? WHERE discord_id = ?').run(now(), id);
    audit(db, actor, 'license.revoked', id);
    return licenseView(id);
  }

  function ban(actor, id, reason) {
    needId(id);
    if (isConfigAdmin(id)) throw new LicenseError(403, 'protected', 'The owner cannot be banned.');
    if (actor === id) throw new LicenseError(403, 'self', 'You cannot ban yourself.');
    needManage(actor, id);
    const r = reason ? String(reason).slice(0, 200) : null;
    ensureUser(db, id, now());
    db.prepare('UPDATE users SET banned = 1, ban_reason = ? WHERE discord_id = ?').run(r, id);
    db.prepare('UPDATE sessions SET revoked = 1 WHERE discord_id = ?').run(id);
    audit(db, actor, 'user.banned', id, { reason: r });
  }

  function unban(actor, id) {
    needId(id);
    if (actor === id && !isConfigAdmin(actor)) throw new LicenseError(403, 'self', 'You cannot unban yourself.');
    needManage(actor, id);
    db.prepare('UPDATE users SET banned = 0, ban_reason = NULL WHERE discord_id = ?').run(id);
    audit(db, actor, 'user.unbanned', id);
  }

  function setRole(actor, id, role) {
    needId(id);
    role = role === 'admin' ? 'admin' : 'user';
    if (!isDev(actor)) throw new LicenseError(403, 'dev_only', 'Only a Developer can change admin roles.');
    if (isConfigAdmin(id) && role !== 'admin') throw new LicenseError(403, 'protected', 'The owner always stays admin.');
    ensureUser(db, id, now());
    db.prepare('UPDATE users SET role = ? WHERE discord_id = ?').run(role, id);
    audit(db, actor, 'user.role', id, { role });
  }

  function resetDevices(actor, id) {
    needId(id);
    needManage(actor, id);
    const n = db.prepare('UPDATE devices SET revoked = 1 WHERE discord_id = ? AND revoked = 0').run(id).changes;
    db.prepare('UPDATE sessions SET revoked = 1 WHERE discord_id = ?').run(id);
    db.prepare('DELETE FROM devices WHERE discord_id = ? AND revoked = 1').run(id);
    audit(db, actor, 'devices.reset', id, { removed: n });
    return n;
  }

  function removeDevice(actor, deviceId) {
    const d = db.prepare('SELECT * FROM devices WHERE id = ?').get(String(deviceId));
    if (!d) throw new LicenseError(404, 'not_found', 'Device not found.');
    needManage(actor, d.discord_id);
    db.prepare('DELETE FROM sessions WHERE device_id = ?').run(d.id);
    db.prepare('DELETE FROM devices WHERE id = ?').run(d.id);
    audit(db, actor, 'device.removed', d.discord_id, { device: d.id, name: d.name });
  }

  function logoutAll(actor, id, self = false) {
    needId(id);
    if (!self) needManage(actor, id);
    db.prepare('UPDATE sessions SET revoked = 1 WHERE discord_id = ?').run(id);
    audit(db, actor, self ? 'logout.all' : 'sessions.revoked', id);
  }

  function createKeys(actor, { plan, count, days, maxDevices, note }) {
    plan = String(plan ?? '');
    if (!PLANS.includes(plan)) throw new LicenseError(400, 'bad_plan', `Plan must be one of ${PLANS.join(', ')}.`);
    needGrant(actor, plan);
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

  /** kind: 'skin' (TSK-…, Turbo Skin Tool) or 'multi' (TMK-…, SP Tool + Skin Tool). 'sptool' = classic SPT keys. */
  function createProductKeys(actor, { kind, plan, count, days, maxDevices, note }) {
    if (kind === 'sptool' || kind == null) return createKeys(actor, { plan, count, days, maxDevices, note });
    const k = KEY_KINDS[kind];
    if (!k) throw new LicenseError(400, 'bad_kind', 'Key kind must be sptool, skin or multi.');
    plan = String(plan ?? '');
    if (!PRODUCT_PLANS.includes(plan)) throw new LicenseError(400, 'bad_plan', `Plan must be one of ${PRODUCT_PLANS.join(', ')}.`);
    needGrant(actor, plan);
    const n = Math.max(1, Math.min(100, Number(count ?? 1) | 0));
    const d = days == null || days === '' || Number(days) <= 0 ? null : Math.max(1, Number(days) | 0);
    const md = Math.max(1, Math.min(20, Number(maxDevices ?? 1) | 0));
    const nt = note ? String(note).slice(0, 200) : null;
    const keys = tx(db, () => Array.from({ length: n }, () => {
      let key; do { key = newProductKey(k.prefix); } while (db.prepare('SELECT 1 FROM product_keys WHERE key = ?').get(key));
      db.prepare('INSERT INTO product_keys (key, kind, plan, days, max_devices, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(key, kind, plan, d, md, nt, actor, now());
      return key;
    }));
    audit(db, actor, 'keys.created', null, { kind, count: n, plan, days: d, maxDevices: md });
    return keys;
  }

  function listKeys() {
    const product = db.prepare('SELECT * FROM product_keys ORDER BY created_at DESC LIMIT 500').all()
      .map((r) => ({ key: r.key, kind: r.kind, plan: r.plan, days: r.days, maxDevices: r.max_devices, note: r.note, createdAt: r.created_at, redeemedBy: r.redeemed_by, redeemedAt: r.redeemed_at, revoked: !!r.revoked }));
    return [...listSptKeys(), ...product].sort((a, b) => b.createdAt - a.createdAt).slice(0, 500);
  }

  function listSptKeys() {
    return db.prepare('SELECT * FROM license_keys ORDER BY created_at DESC LIMIT 500').all()
      .map((r) => ({ key: r.key, kind: 'sptool', plan: r.plan, days: r.days, maxDevices: r.max_devices, note: r.note, createdAt: r.created_at, redeemedBy: r.redeemed_by, redeemedAt: r.redeemed_at, revoked: !!r.revoked }));
  }

  function revokeKey(actor, key) {
    const row = db.prepare('SELECT plan FROM license_keys WHERE key = ?').get(String(key)) ?? db.prepare('SELECT plan FROM product_keys WHERE key = ?').get(String(key));
    if (row) needGrant(actor, row.plan); // an Admin/Developer key can only be revoked by a Developer
    const n = db.prepare('UPDATE license_keys SET revoked = 1 WHERE key = ? AND redeemed_by IS NULL').run(String(key)).changes
      + db.prepare('UPDATE product_keys SET revoked = 1 WHERE key = ? AND redeemed_by IS NULL').run(String(key)).changes;
    if (!n) throw new LicenseError(404, 'not_found', 'Key not found or already redeemed.');
    audit(db, actor, 'key.revoked', String(key));
  }

  // Rules when a license is already active (same for every product):
  //  same plan   → the key's time is added (lifetime stays lifetime)
  //  higher plan → upgrade for the key's own term; refused if it would end a lifetime license
  //  lower plan  → refused (it would downgrade); the key stays unused and can be given to someone else
  function grantFor(cur, row, t) {
    const rank = tiers.rankOf;
    if (!cur || rank(cur.plan) === rank(row.plan)) {
      const base = cur?.expires_at && cur.expires_at > t ? cur.expires_at : t;
      return { expires: row.days == null || (cur && cur.expires_at == null) ? null : base + row.days * DAY };
    }
    if (rank(row.plan) < rank(cur.plan)) return { error: new LicenseError(409, 'key_lower_plan', `You already have ${cur.plan} – this ${row.plan} key would downgrade it. The key was not used.`) };
    if (cur.expires_at == null && row.days != null) return { error: new LicenseError(409, 'key_ends_lifetime', `You have a lifetime ${cur.plan} license – this ${row.days}-day ${row.plan} key would replace it. The key was not used; ask an admin to upgrade you.`) };
    return { expires: row.days == null ? null : t + row.days * DAY };
  }

  /** TSK-/TMK- keys: Turbo Skin Tool, or both tools. Products the key cannot improve (lower plan …) are skipped. */
  function redeemProductKey(id, k) {
    return tx(db, () => {
      const row = db.prepare('SELECT * FROM product_keys WHERE key = ?').get(k);
      if (!row || row.revoked) throw new LicenseError(404, 'key_invalid', 'This key does not exist or was revoked.');
      if (row.redeemed_by) throw new LicenseError(409, 'key_used', 'This key has already been used.');
      const bound = /^Discord-Panel für (\d{15,21})$/.exec(String(row.note ?? ''))?.[1];
      if (bound && bound !== id) throw new LicenseError(403, 'key_bound', 'This key was sent to another Discord account and only works there.');
      const t = now();
      ensureUser(db, id, t);
      const granted = [];
      let firstError = null;
      for (const product of KEY_KINDS[row.kind]?.grants ?? []) {
        const cur = product === 'sptool' ? activeLicense(db, id, t) : (isActiveRow(getProductLicense(id, product), t) ? getProductLicense(id, product) : null);
        const g = grantFor(cur, row, t);
        if (g.error) { firstError ??= g.error; continue; }
        if (product === 'sptool') {
          db.prepare(`INSERT INTO licenses (discord_id, plan, max_devices, expires_at, source, revoked, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?)
            ON CONFLICT(discord_id) DO UPDATE SET plan = excluded.plan, max_devices = MAX(excluded.max_devices, licenses.max_devices), expires_at = excluded.expires_at, source = excluded.source, revoked = 0, updated_at = excluded.updated_at`)
            .run(id, row.plan, row.max_devices, g.expires, `key:${k}`, t);
        } else {
          db.prepare(`INSERT INTO product_licenses (discord_id, product, plan, max_devices, expires_at, source, revoked, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)
            ON CONFLICT(discord_id, product) DO UPDATE SET plan = excluded.plan, max_devices = MAX(excluded.max_devices, product_licenses.max_devices), expires_at = excluded.expires_at, source = excluded.source, revoked = 0, updated_at = excluded.updated_at`)
            .run(id, product, row.plan, row.max_devices, g.expires, `key:${k}`, t);
        }
        granted.push(product);
      }
      if (!granted.length) throw firstError ?? new LicenseError(409, 'key_unusable', 'This key cannot be used on this account.');
      db.prepare('UPDATE product_keys SET redeemed_by = ?, redeemed_at = ? WHERE key = ?').run(id, t, k);
      audit(db, id, 'key.redeemed', k, { kind: row.kind, plan: row.plan, products: granted });
      return { granted, products: productsOf(id) };
    });
  }

  /** Redeems a key for a Discord ID (from the app or the bot). SPT keys return the SP Tool license (as before). */
  function redeemKey(id, key) {
    needId(id);
    const k = String(key ?? '').trim().toUpperCase();
    if (isProductKey(k)) {
      const u0 = getUser(db, id);
      if (u0?.banned && !isConfigAdmin(id)) throw new LicenseError(403, 'banned', 'This account is banned.');
      return redeemProductKey(id, k).products.sptool ?? null;
    }
    if (!isLicenseKey(k)) throw new LicenseError(400, 'bad_key', 'That is not a valid license key (SPT-, TSK- or TMK-XXXX-XXXX-XXXX-XXXX).');
    const u = getUser(db, id);
    if (u?.banned && !isConfigAdmin(id)) throw new LicenseError(403, 'banned', 'This account is banned.');
    return tx(db, () => {
      const row = db.prepare('SELECT * FROM license_keys WHERE key = ?').get(k);
      if (!row || row.revoked) throw new LicenseError(404, 'key_invalid', 'This key does not exist or was revoked.');
      if (row.redeemed_by) throw new LicenseError(409, 'key_used', 'This key has already been used.');
      // Keys an admin sent to one person through the Discord key panel ("Discord-Panel für <id>") only work
      // for that Discord account – forwarding the DM does not hand over the license.
      const bound = /^Discord-Panel für (\d{15,21})$/.exec(String(row.note ?? ''))?.[1];
      if (bound && bound !== id) throw new LicenseError(403, 'key_bound', 'This key was sent to another Discord account and only works there.');
      const t = now();
      ensureUser(db, id, t);
      const g = grantFor(activeLicense(db, id, t), row, t);
      if (g.error) throw g.error;
      const expires = g.expires;
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
    isAdmin, isDev, tierOf, isConfigAdmin, roleOf, licenseView, productView, productsOf, setProductLicense, revokeProductLicense, createProductKeys, redeemProductKey, maxDevicesFor, publicUser, publicDevice, devicesOf, userDetail, searchUsers, stats,
    setLicense, revokeLicense, ban, unban, setRole, resetDevices, removeDevice, logoutAll, createKeys, listKeys, revokeKey, redeemKey, auditLog,
  };
}
