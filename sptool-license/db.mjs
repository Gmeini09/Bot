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
  return db;
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
