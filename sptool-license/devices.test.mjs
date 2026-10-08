// Device binding: PCs count against the licence limit; a phone / web app has its own slot that a new phone takes over.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createApp } from './app.mjs';
import { loadConfig } from './config.mjs';
import { openDb } from './db.mjs';
import { newSigningKey } from './security.mjs';

const hw = (s) => createHash('sha256').update(s).digest('hex');

async function server() {
  const keys = newSigningKey();
  const cfg = loadConfig({ LICENSE_PRIVATE_KEY: keys.privatePem, HWID_SERVER_SALT: 'salt', PUBLIC_URL: 'http://localhost', DISCORD_CLIENT_ID: '1', DISCORD_CLIENT_SECRET: 'x', CORS_ORIGINS: '*' });
  const db = openDb(':memory:');
  const srv = createApp({ cfg, db, discordUser: async (code) => { const [id, name] = code.split(':'); return { id, username: name, global_name: name, avatar: null }; } });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  let n = 0;
  const login = async (id, hwid, kind) => {
    const state = `st${++n}_${'x'.repeat(40)}`;
    await fetch(`${base}/api/v1/auth/discord/start?state=${state}&hwid=${hwid}&device=${kind}&kind=${kind}`, { redirect: 'manual' });
    await fetch(`${base}/api/v1/auth/discord/callback?state=${state}&code=${id}:u${id.slice(-3)}`, { redirect: 'manual' });
    return (await fetch(`${base}/api/v1/auth/poll?state=${state}`)).json();
  };
  const me = async (token, hwid) => (await fetch(`${base}/api/v1/me`, { headers: { Authorization: `Bearer ${token}`, 'X-SPTool-HWID': hwid } })).status;
  return { srv, db, login, me };
}

test('a phone gets its own slot next to the PC; a second PC is still refused', async () => {
  const { srv, login, me } = await server();
  const U = '900000000000000001';
  const pc = await login(U, hw('pc1'), 'desktop');
  assert.equal(pc.status, 'ok');
  const phone = await login(U, hw('phone1'), 'mobile');
  assert.equal(phone.status, 'ok', 'the phone does not count against the PC limit');
  assert.equal(await me(pc.token, hw('pc1')), 200, 'the PC stays signed in');
  assert.equal(await me(phone.token, hw('phone1')), 200);
  const pc2 = await login(U, hw('pc2'), 'desktop');
  assert.equal(pc2.code, 'device_limit', 'the PC limit is unchanged');
  srv.close();
});

test('a new phone or browser replaces the previous one; the old one is signed out but may come back', async () => {
  const { srv, db, login, me } = await server();
  const U = '900000000000000002';
  const a = await login(U, hw('phoneA'), 'mobile');
  const b = await login(U, hw('browserB'), 'browser');
  assert.equal(b.status, 'ok');
  assert.equal(await me(a.token, hw('phoneA')), 401, 'the replaced phone is signed out');
  assert.equal(await me(b.token, hw('browserB')), 200);
  const kinds = db.prepare('SELECT kind FROM devices WHERE discord_id = ? AND revoked = 0').all(U).map((r) => r.kind);
  assert.deepEqual(kinds, ['browser'], 'only one web device at a time');
  const again = await login(U, hw('phoneA'), 'mobile');
  assert.equal(again.status, 'ok', 'a replaced phone is not blocked – it simply takes the slot back');
  assert.equal(await me(b.token, hw('browserB')), 401);
  srv.close();
});

test('the same phone signing in again keeps its device', async () => {
  const { srv, db, login } = await server();
  const U = '900000000000000003';
  await login(U, hw('p'), 'mobile');
  await login(U, hw('p'), 'mobile');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM devices WHERE discord_id = ?').get(U).n, 1);
  srv.close();
});
