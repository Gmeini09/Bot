-- SP Tool license server – initial schema.
-- Discord IDs are 64-bit snowflakes and are always stored as TEXT (too large for JS numbers).
CREATE TABLE IF NOT EXISTS users (
  discord_id   TEXT PRIMARY KEY,
  username     TEXT NOT NULL DEFAULT '',
  global_name  TEXT,
  avatar       TEXT,
  role         TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  banned       INTEGER NOT NULL DEFAULT 0,
  ban_reason   TEXT,
  created_at   INTEGER NOT NULL,
  last_login   INTEGER
);

CREATE TABLE IF NOT EXISTS licenses (
  discord_id   TEXT PRIMARY KEY REFERENCES users(discord_id) ON DELETE CASCADE,
  plan         TEXT NOT NULL CHECK (plan IN ('free', 'premium', 'creator', 'developer')),
  max_devices  INTEGER NOT NULL DEFAULT 1 CHECK (max_devices BETWEEN 1 AND 20),
  expires_at   INTEGER,              -- NULL = lifetime
  source       TEXT NOT NULL,        -- 'admin' | 'key:<KEY>'
  revoked      INTEGER NOT NULL DEFAULT 0,
  note         TEXT,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS license_keys (
  key          TEXT PRIMARY KEY,     -- SPT-XXXX-XXXX-XXXX-XXXX
  plan         TEXT NOT NULL CHECK (plan IN ('free', 'premium', 'creator', 'developer')),
  days         INTEGER,              -- NULL = lifetime
  max_devices  INTEGER NOT NULL DEFAULT 1,
  note         TEXT,
  created_by   TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  redeemed_by  TEXT,
  redeemed_at  INTEGER,
  revoked      INTEGER NOT NULL DEFAULT 0
);

-- Hardware binding. Only a salted SHA-256 of the machine id is ever stored.
CREATE TABLE IF NOT EXISTS devices (
  id           TEXT PRIMARY KEY,
  discord_id   TEXT NOT NULL REFERENCES users(discord_id) ON DELETE CASCADE,
  hwid_hash    TEXT NOT NULL,
  name         TEXT NOT NULL DEFAULT 'PC',
  kind         TEXT NOT NULL DEFAULT 'desktop',
  first_seen   INTEGER NOT NULL,
  last_seen    INTEGER NOT NULL,
  revoked      INTEGER NOT NULL DEFAULT 0,
  UNIQUE (discord_id, hwid_hash)
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash   TEXT PRIMARY KEY,
  discord_id   TEXT NOT NULL REFERENCES users(discord_id) ON DELETE CASCADE,
  device_id    TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  last_used    INTEGER NOT NULL,
  revoked      INTEGER NOT NULL DEFAULT 0
);

-- Pending Discord logins (desktop opens the browser, then polls with its secret state).
CREATE TABLE IF NOT EXISTS pending_logins (
  state_hash   TEXT PRIMARY KEY,
  hwid_hash    TEXT NOT NULL,
  device_name  TEXT NOT NULL,
  device_kind  TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  result       TEXT                  -- JSON once finished
);

CREATE TABLE IF NOT EXISTS audit_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  at           INTEGER NOT NULL,
  actor        TEXT NOT NULL,
  action       TEXT NOT NULL,
  target       TEXT,
  detail       TEXT
);

CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(discord_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(discord_id);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at DESC);
