'use strict';
// SP Tool licence levels – one definition for the licence server, the Discord bot and the cloud API.
//
//   Free       every key: create soundpacks (import own sounds, take sounds from other packs, build, download)
//   Premium    more than Free: edit & generate sounds, presets, WAV export, more soundpacks, cloud
//   Creator    everything in the app, but no key / user management
//   Admin      + manage keys, licences, users, PCs (up to Creator; cannot touch Admin/Developer accounts)
//   Developer  all permissions ("Dev"): + Admin/Developer keys and licences, manage Admin accounts
//
// "admin" is new; "developer" existed before and is now the top level with all permissions.

const PLANS = ['free', 'premium', 'creator', 'admin', 'developer'];
const RANK = { free: 0, premium: 1, creator: 2, admin: 3, developer: 4 };
const LABEL = { free: 'Free', premium: 'Premium', creator: 'Creator', admin: 'Admin', developer: 'Developer' };
const EMOJI = { free: '🆓', premium: '⭐', creator: '🎨', admin: '🛡️', developer: '🛠️' };
/** Levels that manage keys/users. */
const STAFF = ['admin', 'developer'];
/** The Turbo Skin Tool knows only these plans – Admin exists for SP Tool licences only. */
const PRODUCT_PLANS = ['free', 'premium', 'creator', 'developer'];

/** Level of a stored plan (unknown → free). */
const tierOfPlan = (p) => (Object.prototype.hasOwnProperty.call(RANK, p) ? p : 'free');
const rankOf = (p) => RANK[tierOfPlan(p)];
const atLeast = (p, min) => rankOf(p) >= RANK[min];
const maxTier = (...ps) => ps.filter(Boolean).map(tierOfPlan).reduce((a, b) => (RANK[b] > RANK[a] ? b : a), 'free');
const isStaff = (p) => atLeast(p, 'admin');

/**
 * Who may hand out a plan (keys, licences): Admin up to Creator, Developer everything.
 * actorTier = the actor's effective level.
 */
const canGrant = (actorTier, plan) => {
  if (!isStaff(actorTier)) return false;
  return rankOf(plan) <= RANK.creator || tierOfPlan(actorTier) === 'developer';
};
/** Who may change another account (licence, ban, PCs, sessions): Admin only non-staff accounts, Developer everyone but the owner. */
const canManage = (actorTier, targetTier) => isStaff(actorTier) && (!isStaff(targetTier) || tierOfPlan(actorTier) === 'developer');

/** The plan value old apps (≤ 1.8.x) understand inside a ticket: "admin" is new there → "developer". */
const legacyTicketPlan = (tier) => (tierOfPlan(tier) === 'admin' ? 'developer' : tierOfPlan(tier));

/**
 * Effective level of a Discord account from the licence database: the active SP Tool licence, an admin role set by
 * the owner (counts as Admin), and configured admins/owner (Developer). A banned account has no rights (ignoreBan: its
 * level as it would be without the ban – used to decide who may unban it).
 * db: node:sqlite DatabaseSync, isConfigAdmin: (id) => boolean.
 */
function effectiveTier(db, id, isConfigAdmin, now = Date.now(), { ignoreBan = false } = {}) {
  if (isConfigAdmin(id)) return 'developer';
  let lic = null, user = null;
  try { lic = db.prepare('SELECT plan, revoked, expires_at FROM licenses WHERE discord_id = ?').get(id); } catch { lic = null; }
  try { user = db.prepare('SELECT role, banned FROM users WHERE discord_id = ?').get(id); } catch { user = null; }
  if (user?.banned && !ignoreBan) return 'free'; // a banned account keeps no rights, whatever its licence says
  const active = lic && !lic.revoked && (lic.expires_at == null || lic.expires_at > now);
  return maxTier(active ? lic.plan : 'free', user?.role === 'admin' && (!user.banned || ignoreBan) ? 'admin' : 'free');
}

/** Plan values the database accepts after migration 002 (the licence levels). */
const PLAN_VALUES = PLANS;

/**
 * Migration 002_plan_levels (in code, because SQLite cannot change a CHECK constraint, and because the live server
 * takes db.mjs from another place): rebuilds `licenses` and `license_keys` with the wider plan list. The table
 * definitions come from the live database and only the plan CHECK is replaced; all columns and rows are copied 1:1
 * (also columns added later), indexes are recreated. Runs once, in one transaction; on any error nothing changes.
 */
function migratePlanLevels(db) {
  const NAME = '002_plan_levels';
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  if (db.prepare('SELECT 1 FROM schema_migrations WHERE name = ?').get(NAME)) return false;
  const check = `CHECK (plan IN (${PLAN_VALUES.map((p) => `'${p}'`).join(', ')}))`;
  const re = /CHECK\s*\(\s*plan\s+IN\s*\([^)]*\)\s*\)/i;
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const table of ['licenses', 'license_keys']) {
      const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
      if (!row || !row.sql || !re.test(row.sql)) continue;
      const indexes = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL").all(table).map((r) => r.sql);
      const tmp = `${table}__new`;
      db.exec(row.sql.replace(re, check).replace(/^CREATE TABLE\s+(IF NOT EXISTS\s+)?("?)\w+\2/i, `CREATE TABLE ${tmp}`));
      db.exec(`INSERT INTO ${tmp} SELECT * FROM ${table}`);
      const before = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
      const after = db.prepare(`SELECT COUNT(*) AS n FROM ${tmp}`).get().n;
      if (before !== after) throw new Error(`${table}: ${after} of ${before} rows copied`);
      db.exec(`DROP TABLE ${table}`);
      db.exec(`ALTER TABLE ${tmp} RENAME TO ${table}`);
      for (const sql of indexes) db.exec(sql);
    }
    db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(NAME, Date.now());
    db.exec('COMMIT');
    return true;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

module.exports = { PLAN_VALUES, migratePlanLevels, PLANS, RANK, LABEL, EMOJI, STAFF, PRODUCT_PLANS, tierOfPlan, rankOf, atLeast, maxTier, isStaff, canGrant, canManage, legacyTicketPlan, effectiveTier };
