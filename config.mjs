// SP Tool license server – configuration from environment variables.
// See server/.env.example. Never commit real secrets.
import { readFileSync, existsSync } from 'node:fs';

/** The owner's Discord account. Always admin, can never be banned or demoted. */
export const OWNER_DISCORD_ID = '697402284849627180';

export function loadConfig(env = process.env) {
  const adminIds = new Set([OWNER_DISCORD_ID, ...String(env.ADMIN_DISCORD_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean)]);
  for (const id of adminIds) if (!/^\d{15,21}$/.test(id)) throw new Error(`ADMIN_DISCORD_IDS contains an invalid Discord ID: ${id}`);
  const keyPath = env.LICENSE_PRIVATE_KEY_FILE ?? 'server/data/license-ed25519.pem';
  return {
    port: Number(env.PORT ?? 8787),
    host: env.HOST ?? '0.0.0.0',
    publicUrl: (env.PUBLIC_URL ?? 'http://localhost:8787').replace(/\/$/, ''),
    dbPath: env.DB_PATH ?? 'server/data/sptool.db',
    discord: {
      clientId: env.DISCORD_CLIENT_ID ?? '',
      clientSecret: env.DISCORD_CLIENT_SECRET ?? '',
    },
    adminIds,
    privateKeyPem: env.LICENSE_PRIVATE_KEY ?? (existsSync(keyPath) ? readFileSync(keyPath, 'utf8') : ''),
    privateKeyPath: keyPath,
    hwidSalt: env.HWID_SERVER_SALT ?? '',
    sessionDays: Number(env.SESSION_DAYS ?? 30),
    offlineGraceHours: Number(env.OFFLINE_GRACE_HOURS ?? 72),
    defaultMaxDevices: Number(env.DEFAULT_MAX_DEVICES ?? 1),
    corsOrigins: String(env.CORS_ORIGINS ?? '*'),
    /** Development only: replaces Discord with a local fake login. Refused in production. */
    fakeDiscord: env.SPTOOL_FAKE_DISCORD === '1',
    production: env.NODE_ENV === 'production',
    /** Trust X-Forwarded-For (only behind a reverse proxy that sets it). */
    trustProxy: env.TRUST_PROXY === '1',
  };
}
