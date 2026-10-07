// SQLite storage (node:sqlite, no external dependency) + data access.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), 'database', 'migrations');

export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const done = new Set(db.prepare('SELECT name FROM schema_migrations').all().map((r) => r.name));
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(f)) continue;
    db.exec('BEGIN');
    try {
      db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(f, Date.now());
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  migratePlanLevels(db);
  return db;
}

/** Plan values allowed after 002: the licence levels Free < Premium < Creator < Admin < Developer. */
export const PLAN_VALUES = ['free', 'premium', 'creator', 'admin', 'developer'];

/**
 * 002_plan_levels (in code, because SQLite cannot change a CHECK constraint): rebuilds `licenses` and
 * `license_keys` with the wider plan list. The table definitions are taken from the live database and only the
 * plan CHECK is replaced, all columns and rows are copied 1:1 (also columns added later), indexes are recreated.
 * Runs once, inside one transaction; on any error nothing is changed.
 */
export function migratePlanLevels(db) {
  const NAME = '002_plan_levels';
  if (db.prepare('SELECT 1 FROM schema_migrations WHERE name = ?').get(NAME)) return;
  const check = `CHECK (plan IN (${PLAN_VALUES.map((p) => `'${p}'`).join(', ')}))`;
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const table of ['licenses', 'license_keys']) {
      const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
      if (!row?.sql) continue;
      const re = /CHECK\s*\(\s*plan\s+IN\s*\([^)]*\)\s*\)/i;
      if (!re.test(row.sql)) continue; // no plan restriction (or already replaced)
      const indexes = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL").all(table).map((r) => r.sql);
      const tmp = `${table}__new`;
      const createSql = row.sql.replace(re, check).replace(/^CREATE TABLE\s+(IF NOT EXISTS\s+)?("?)\w+\2/i, `CREATE TABLE ${tmp}`);
      db.exec(createSql);
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
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function audit(db, actor, action, target = null, detail = null) {
  db.prepare('INSERT INTO audit_log (at, actor, action, target, detail) VALUES (?, ?, ?, ?, ?)').run(Date.now(), actor, action, target, detail == null ? null : JSON.stringify(detail));
}

export const getUser = (db, id) => db.prepare('SELECT * FROM users WHERE discord_id = ?').get(id);
export const getLicense = (db, id) => db.prepare('SELECT * FROM licenses WHERE discord_id = ?').get(id);

export function ensureUser(db, id, now = Date.now()) {
  db.prepare('INSERT INTO users (discord_id, created_at) VALUES (?, ?) ON CONFLICT(discord_id) DO NOTHING').run(id, now);
  return getUser(db, id);
}

/** Active license or null (expired / revoked / missing). */
export function activeLicense(db, id, now = Date.now()) {
  const l = getLicense(db, id);
  if (!l || l.revoked || (l.expires_at != null && l.expires_at <= now)) return null;
  return l;
}

export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}
