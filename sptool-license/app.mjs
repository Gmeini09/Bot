// SP Tool license server – HTTP API (/api/v1). Zero external dependencies.
//
// Security model
//  • Identity: Discord OAuth2 ("identify" scope only). No passwords are handled.
//  • Sessions: random 256-bit bearer tokens, stored only as SHA-256, 30-day expiry, revocable.
//  • HWID binding: every session belongs to one registered device. Each request must send the
//    device's HWID hash (X-SPTool-HWID); a token copied to another PC is rejected.
//    A license allows `max_devices` devices; more devices need an admin reset.
//  • Licenses are checked server-side. The client receives an Ed25519-signed ticket that it can
//    verify offline for a short grace period – it cannot forge or extend it.
//  • Admins: the owner Discord ID (config.mjs) plus ADMIN_DISCORD_IDS. Every admin action is audited.
//
// createHandler() returns a (req, res) handler that can be mounted into another server
// (e.g. the Discord bot's web server); createApp() wraps it in its own http.Server.
import { createServer } from 'node:http';
import { audit, ensureUser, getUser, tx } from './db.mjs';
import { authorizeUrl } from './discord.mjs';
import { publicRawFromPrivate, randomToken, rateLimiter, serverHwidHash, sha256, signTicket } from './security.mjs';
import { createLicenseService, DAY, isSnowflake, LicenseError } from './service.mjs';
import tiers from './tiers.cjs';

const PENDING_TTL = 10 * 60_000;

class HttpError extends LicenseError {}

/** Paths served by the license API (used when mounting into another server). */
export const isLicensePath = (pathname, cfg) => pathname.startsWith('/api/v1/') || (cfg?.fakeDiscord && !cfg?.production && pathname.startsWith('/dev/fake-discord'));

export function createHandler({ cfg, db, discordUser, now = () => Date.now(), service }) {
  const svc = service ?? createLicenseService({ cfg, db, now });
  const limitGeneral = rateLimiter({ capacity: 120, refillPerSec: 2 });
  const limitAuth = rateLimiter({ capacity: 60, refillPerSec: 1 });
  const limitRedeem = rateLimiter({ capacity: 8, refillPerSec: 1 / 30 });
  const isAdminId = (id) => cfg.adminIds.has(id);
  let publicKey = '';
  try { publicKey = cfg.privateKeyPem ? publicRawFromPrivate(cfg.privateKeyPem) : ''; } catch { /* reported at startup */ }

  // ── helpers
  function send(res, status, body, headers = {}) {
    const isHtml = typeof body === 'string';
    res.writeHead(status, {
      'Content-Type': isHtml ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
      'Access-Control-Allow-Origin': cfg.corsOrigins,
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-SPTool-HWID',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      ...headers,
    });
    res.end(isHtml ? body : JSON.stringify(body));
  }

  async function readJson(req) {
    let size = 0;
    const chunks = [];
    for await (const c of req) {
      size += c.length;
      if (size > 64 * 1024) throw new HttpError(413, 'too_large', 'Request body too large.');
      chunks.push(c);
    }
    if (!chunks.length) return {};
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'bad_json', 'Invalid JSON.'); }
  }

  // Behind a proxy: X-Real-IP, else the last X-Forwarded-For hop (the one the proxy appended).
  function ip(req) {
    if (cfg.trustProxy) {
      const real = req.headers['x-real-ip'];
      if (real) return String(real).trim();
      const xff = req.headers['x-forwarded-for'];
      if (xff) { const hops = String(xff).split(',').map((s) => s.trim()).filter(Boolean); if (hops.length) return hops[hops.length - 1]; }
    }
    return req.socket?.remoteAddress ?? '?';
  }

  function authenticate(req) {
    const m = /^Bearer ([A-Za-z0-9_-]{20,})$/.exec(req.headers.authorization ?? '');
    if (!m) throw new HttpError(401, 'unauthenticated', 'Sign in required.');
    const s = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(sha256(m[1]));
    if (!s || s.revoked || s.expires_at <= now()) throw new HttpError(401, 'session_expired', 'Your session has expired. Sign in again.');
    const dev = db.prepare('SELECT * FROM devices WHERE id = ?').get(s.device_id);
    if (!dev || dev.revoked) throw new HttpError(401, 'device_revoked', 'This device was removed from your account. Sign in again.');
    const hw = serverHwidHash(String(req.headers['x-sptool-hwid'] ?? ''), cfg.hwidSalt);
    if (!hw || hw !== dev.hwid_hash) throw new HttpError(403, 'hwid_mismatch', 'This session belongs to another computer.');
    const u = getUser(db, s.discord_id);
    if (!u) throw new HttpError(401, 'unauthenticated', 'Sign in required.');
    if (u.banned && !isAdminId(u.discord_id)) throw new HttpError(403, 'banned', `This account is banned${u.ban_reason ? `: ${u.ban_reason}` : '.'}`);
    if (now() - s.last_used > 60_000) {
      db.prepare('UPDATE sessions SET last_used = ? WHERE token_hash = ?').run(now(), s.token_hash);
      db.prepare('UPDATE devices SET last_seen = ? WHERE id = ?').run(now(), dev.id);
    }
    return { session: s, user: u, device: dev, clientHwid: String(req.headers['x-sptool-hwid']) };
  }

  function requireAdmin(ctx) {
    if (svc.roleOf(ctx.user) !== 'admin') throw new HttpError(403, 'forbidden', 'Admins only.');
  }

  // product = which app asks: 'sptool' (default, SP Tool) or 'skin' (Turbo Skin Tool). The ticket carries the
  // product (field "prod", missing = SP Tool), so a ticket of one tool never unlocks the other.
  function ticketFor(ctx, product = 'sptool') {
    const lic = svc.productView(ctx.user.discord_id, product);
    if (!lic?.active) return null;
    const t = now();
    const offlineUntil = Math.min(t + cfg.offlineGraceHours * 3_600_000, lic.expiresAt ?? Infinity);
    return signTicket({
      v: 1, sub: ctx.user.discord_id, name: ctx.user.global_name || ctx.user.username, role: svc.roleOf(ctx.user),
      // SP Tool: "tier" is the licence level (Free … Developer); "plan" stays a value that apps up to 1.8.x understand ("admin" → "developer")
      ...(product === 'sptool'
        ? (() => { const tier = svc.tierOf(ctx.user.discord_id); return { plan: tiers.legacyTicketPlan(tier), tier }; })()
        : { plan: lic.plan, prod: product }),
      exp: lic.expiresAt, hwid: ctx.clientHwid, iat: t, offlineUntil,
    }, cfg.privateKeyPem);
  }

  // ── login completion (shared by Discord callback and dev fake)
  function completeLogin(pending, du) {
    return tx(db, () => {
      const t = now();
      ensureUser(db, du.id, t);
      db.prepare('UPDATE users SET username = ?, global_name = ?, avatar = ?, last_login = ? WHERE discord_id = ?').run(du.username, du.global_name, du.avatar, t, du.id);
      if (isAdminId(du.id)) db.prepare("UPDATE users SET role = 'admin', banned = 0 WHERE discord_id = ?").run(du.id);
      const u = getUser(db, du.id);
      if (u.banned) { audit(db, du.id, 'login.denied', du.id, { reason: 'banned' }); return { status: 'error', code: 'banned', message: `This account is banned${u.ban_reason ? `: ${u.ban_reason}` : '.'}` }; }
      let dev = db.prepare('SELECT * FROM devices WHERE discord_id = ? AND hwid_hash = ?').get(du.id, pending.hwid_hash);
      if (dev?.revoked) {
        audit(db, du.id, 'login.denied', du.id, { reason: 'device_revoked' });
        return { status: 'error', code: 'device_revoked', message: 'This computer was removed from your account by an admin.' };
      }
      if (!dev) {
        const active = db.prepare('SELECT COUNT(*) AS n FROM devices WHERE discord_id = ? AND revoked = 0').get(du.id).n;
        const max = svc.maxDevicesFor(du.id);
        if (active >= max) {
          audit(db, du.id, 'login.denied', du.id, { reason: 'device_limit', active, max });
          return { status: 'error', code: 'device_limit', message: `Your license is already bound to ${active} computer${active > 1 ? 's' : ''} (limit ${max}). Ask an admin to reset your devices.`, discordId: du.id };
        }
        dev = { id: `dev_${randomToken(9)}` };
        db.prepare('INSERT INTO devices (id, discord_id, hwid_hash, name, kind, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)').run(dev.id, du.id, pending.hwid_hash, pending.device_name, pending.device_kind, t, t);
        audit(db, du.id, 'device.bound', dev.id, { name: pending.device_name, kind: pending.device_kind });
      } else {
        db.prepare('UPDATE devices SET last_seen = ?, name = ? WHERE id = ?').run(t, pending.device_name, dev.id);
      }
      const token = randomToken(32);
      db.prepare('INSERT INTO sessions (token_hash, discord_id, device_id, created_at, expires_at, last_used) VALUES (?, ?, ?, ?, ?, ?)').run(sha256(token), du.id, dev.id, t, t + cfg.sessionDays * DAY, t);
      audit(db, du.id, 'login', dev.id);
      return { status: 'ok', token };
    });
  }

  function finishPending(stateHash, result) {
    db.prepare('UPDATE pending_logins SET result = ? WHERE state_hash = ?').run(JSON.stringify(result), stateHash);
  }

  // German text for the browser page after Discord sign-in (the app gets the code and translates itself)
  const refusedText = (r) => r.code === 'banned' ? `Dieses Konto ist gesperrt${/: (.+)$/s.exec(r.message ?? '')?.[1] ? `: ${/: (.+)$/s.exec(r.message)[1]}` : '.'}`
    : r.code === 'device_revoked' ? 'Dieser PC wurde von einem Admin aus deinem Konto entfernt.'
    : r.code === 'device_limit' ? 'Deine Lizenz ist schon an die erlaubte Anzahl PCs gebunden. Ein Admin kann deine PCs zurücksetzen.'
    : (r.message ?? 'Die Anmeldung wurde abgelehnt.');
  const page = (title, msg, ok) => `<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#08090C;color:#F5F7FA;font:16px/1.5 'Segoe UI',system-ui,sans-serif">
<div style="max-width:440px;padding:32px;border:1px solid #242A34;border-radius:16px;background:#12151B;text-align:center">
<div style="font-size:42px;margin-bottom:8px;color:${ok ? '#3fb67f' : '#d9534f'}">${ok ? '✓' : '!'}</div>
<h1 style="font-size:20px;margin:0 0 8px">${title}</h1><p style="color:#9098A7;margin:0">${msg}</p></div></body>`;
  const pairPage = (code) => `<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SP Tool verbinden</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#08090C;color:#F5F7FA;font:16px/1.5 'Segoe UI',system-ui,sans-serif">
<div style="max-width:480px;padding:32px;border:1px solid #242A34;border-radius:16px;background:#12151B">
<h1 style="font-size:21px;margin:0 0 6px">Fast geschafft – nur noch ein Befehl</h1>
<p style="color:#9098A7;margin:0 0 18px">Schick diesen Befehl in Discord an den SP-Tool-Bot (in einem Kanal oder per DM):</p>
<div style="font:600 18px/1.4 Consolas,monospace;padding:14px 16px;border-radius:12px;background:#08090C;border:1px solid #5865F2;user-select:all;word-break:break-all">/sptool verbinden code:${code}</div>
<ol style="color:#C9CED8;padding-left:20px;margin:18px 0 0">
<li>Befehl oben markieren und kopieren (Strg + C)</li>
<li>In Discord einfügen und abschicken</li>
<li>Auf <b>„Ja, das ist mein PC“</b> klicken</li>
<li>Fertig – SP Tool meldet dich automatisch an. Diesen Tab kannst du schließen.</li>
</ol>
<p style="color:#636B78;font-size:13px;margin:18px 0 0">Der Code gilt 10 Minuten und nur für diesen PC. Gib ihn niemandem weiter.</p>
</div></body>`;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // ── routes
  async function route(req, res) {
    const url = new URL(req.url ?? '/', 'http://x');
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const q = (k) => url.searchParams.get(k) ?? '';
    const m = req.method ?? 'GET';
    const clientIp = ip(req);

    if (m === 'OPTIONS') return send(res, 204, '');
    if (!limitGeneral(clientIp)) throw new HttpError(429, 'rate_limited', 'Too many requests. Slow down.');

    if (path === '/api/v1/health') return send(res, 200, { ok: true, time: now() });
    // Which sign-in the app should offer: Discord one-click (OAuth configured) or the /sptool verbinden code.
    if (m === 'GET' && path === '/api/v1/auth/mode') return send(res, 200, { oneClick: !!(cfg.discord?.clientId && cfg.discord?.clientSecret) });
    // Public key that signs license tickets (not secret). Lets the app recover if its built-in key
    // does not match this server (e.g. the key on the server was regenerated).
    if (m === 'GET' && path === '/api/v1/public-key') return send(res, 200, { alg: 'Ed25519', publicKey });

    // 1) Desktop/browser starts a login with its own secret state and the device hash.
    if (m === 'GET' && path === '/api/v1/auth/discord/start') {
      if (!limitAuth(`a:${clientIp}`)) throw new HttpError(429, 'rate_limited', 'Too many login attempts.');
      const state = q('state'), hw = serverHwidHash(q('hwid'), cfg.hwidSalt);
      if (!/^[A-Za-z0-9_-]{32,128}$/.test(state)) throw new HttpError(400, 'bad_state', 'Invalid login state.');
      if (!hw) throw new HttpError(400, 'bad_hwid', 'Invalid device id.');
      const kind = ['desktop', 'browser', 'mobile'].includes(q('kind')) ? q('kind') : 'desktop';
      const name = q('device').replace(/[^\w .\-()]/g, '').slice(0, 40) || 'PC';
      db.prepare('DELETE FROM pending_logins WHERE created_at < ?').run(now() - PENDING_TTL);
      db.prepare('INSERT OR REPLACE INTO pending_logins (state_hash, hwid_hash, device_name, device_kind, created_at) VALUES (?, ?, ?, ?, ?)').run(sha256(state), hw, name, kind, now());
      if (cfg.fakeDiscord && !cfg.production) return send(res, 302, '', { Location: `/dev/fake-discord?state=${encodeURIComponent(state)}` });
      // Discord sign-in in one click needs DISCORD_CLIENT_ID + DISCORD_CLIENT_SECRET. Without them the PC is
      // linked with a short code that the user sends to the bot (/sptool verbinden) – shown here and in the app.
      if (!cfg.discord?.clientId || !cfg.discord?.clientSecret) return send(res, 200, pairPage(sha256(state).slice(0, 10).toUpperCase()));
      return send(res, 302, '', { Location: authorizeUrl(cfg, state) });
    }

    // 2) Discord redirects back here.
    if (m === 'GET' && path === '/api/v1/auth/discord/callback') {
      const state = q('state');
      const pending = db.prepare('SELECT * FROM pending_logins WHERE state_hash = ?').get(sha256(state));
      if (!pending || pending.created_at < now() - PENDING_TTL) return send(res, 400, page('Anmeldung abgelaufen', 'Starte die Anmeldung in SP Tool neu.', false));
      if (q('error')) { finishPending(pending.state_hash, { status: 'error', code: 'discord_denied', message: 'Discord login was cancelled.' }); return send(res, 200, page('Anmeldung abgebrochen', 'Du kannst diesen Tab schließen und es in SP Tool noch einmal versuchen.', false)); }
      try {
        const du = await discordUser(q('code'));
        const r = completeLogin(pending, du);
        finishPending(pending.state_hash, r);
        return r.status === 'ok'
          ? send(res, 200, page('Angemeldet', `Willkommen, ${esc(du.global_name || du.username)}! Geh zurück zu SP Tool – diesen Tab kannst du schließen.`, true))
          : send(res, 200, page('Anmeldung abgelehnt', esc(refusedText(r)), false));
      } catch {
        finishPending(pending.state_hash, { status: 'error', code: 'discord_failed', message: 'Discord login failed. Try again.' });
        return send(res, 502, page('Discord-Anmeldung fehlgeschlagen', 'Versuch es gleich noch einmal.', false));
      }
    }

    // Development-only fake Discord (never available in production).
    if (cfg.fakeDiscord && !cfg.production && path === '/dev/fake-discord') {
      return send(res, 200, `<!doctype html><meta charset="utf-8"><body style="background:#08090C;color:#fff;font:16px system-ui;display:grid;place-items:center;min-height:100vh"><form action="/dev/fake-discord/complete" style="display:grid;gap:10px;padding:24px;border:1px solid #242A34;border-radius:14px;background:#12151B"><b>Fake Discord (development)</b><input type="hidden" name="state" value="${esc(q('state'))}"><input name="id" placeholder="Discord ID" value="697402284849627180" style="padding:8px"><input name="username" placeholder="Username" value="admin" style="padding:8px"><button style="padding:10px;background:#5865F2;color:#fff;border:0;border-radius:8px">Authorize</button></form></body>`);
    }
    if (cfg.fakeDiscord && !cfg.production && path === '/dev/fake-discord/complete') {
      const pending = db.prepare('SELECT * FROM pending_logins WHERE state_hash = ?').get(sha256(q('state')));
      if (!pending || !isSnowflake(q('id'))) return send(res, 400, page('Invalid', 'Bad fake login.', false));
      const r = completeLogin(pending, { id: q('id'), username: q('username') || 'user', global_name: q('username') || null, avatar: null });
      finishPending(pending.state_hash, r);
      return send(res, 200, page(r.status === 'ok' ? 'Signed in' : 'Sign-in refused', esc(r.message ?? 'Return to SP Tool.'), r.status === 'ok'));
    }

    // 3) Client polls with its secret state; the token is handed out exactly once.
    if (m === 'GET' && path === '/api/v1/auth/poll') {
      if (!limitAuth(`p:${clientIp}`)) throw new HttpError(429, 'rate_limited', 'Too many requests.');
      const row = db.prepare('SELECT * FROM pending_logins WHERE state_hash = ?').get(sha256(q('state')));
      if (!row) return send(res, 404, { status: 'unknown' });
      if (!row.result) return send(res, 200, { status: row.created_at < now() - PENDING_TTL ? 'expired' : 'pending' });
      db.prepare('DELETE FROM pending_logins WHERE state_hash = ?').run(row.state_hash);
      return send(res, 200, JSON.parse(row.result));
    }

    // ── authenticated user routes
    if (path.startsWith('/api/v1/me') || path.startsWith('/api/v1/license') || path.startsWith('/api/v1/auth/logout') || path.startsWith('/api/v1/admin')) {
      const ctx = authenticate(req);
      const me = ctx.user.discord_id;
      const product = q('product') || 'sptool';
      if (!['sptool', 'skin'].includes(product)) throw new HttpError(400, 'bad_product', 'Unknown product.');

      if (m === 'GET' && path === '/api/v1/me') {
        return send(res, 200, { user: svc.publicUser(ctx.user), license: svc.productView(me, product), products: svc.productsOf(me), devices: svc.devicesOf(me), currentDevice: ctx.device.id, maxDevices: svc.maxDevicesFor(me), ticket: ticketFor(ctx, product) });
      }
      if (m === 'POST' && path === '/api/v1/license/check') {
        return send(res, 200, { license: svc.productView(me, product), products: svc.productsOf(me), ticket: ticketFor(ctx, product) });
      }
      if (m === 'POST' && path === '/api/v1/license/redeem') {
        if (!limitRedeem(`r:${clientIp}`)) throw new HttpError(429, 'rate_limited', 'Too many attempts. Wait a few minutes.');
        const { key } = await readJson(req);
        svc.redeemKey(me, key);
        return send(res, 200, { ok: true, license: svc.productView(me, product), products: svc.productsOf(me), ticket: ticketFor(ctx, product) });
      }
      if (m === 'POST' && path === '/api/v1/auth/logout') {
        db.prepare('UPDATE sessions SET revoked = 1 WHERE token_hash = ?').run(ctx.session.token_hash);
        return send(res, 200, { ok: true });
      }
      if (m === 'POST' && path === '/api/v1/auth/logout-all') {
        svc.logoutAll(me, me, true);
        return send(res, 200, { ok: true });
      }

      // ── admin
      if (path.startsWith('/api/v1/admin')) {
        requireAdmin(ctx);
        const actor = me;
        const seg = path.split('/').slice(4); // after /api/v1/admin

        if (m === 'GET' && seg[0] === 'stats') return send(res, 200, svc.stats());
        if (m === 'GET' && seg[0] === 'users' && !seg[1]) return send(res, 200, { users: svc.searchUsers(q('q')) });
        if (seg[0] === 'users' && seg[1]) {
          const id = seg[1];
          if (!isSnowflake(id)) throw new HttpError(400, 'bad_id', 'Invalid Discord ID.');
          if (m === 'GET' && !seg[2]) {
            const d = svc.userDetail(id);
            if (!d) throw new HttpError(404, 'not_found', 'No user with this Discord ID yet. You can still grant a license – it applies when they sign in.');
            return send(res, 200, d);
          }
          const body = m === 'POST' ? await readJson(req) : {};
          if (m === 'POST' && seg[2] === 'license') {
            const p = String(body.product ?? 'sptool');
            if (String(body.plan ?? '') === 'none') return send(res, 200, { license: svc.revokeProductLicense(actor, id, p) });
            return send(res, 200, { license: svc.setProductLicense(actor, id, p, body) });
          }
          if (m === 'POST' && seg[2] === 'ban') { svc.ban(actor, id, body.reason); return send(res, 200, { ok: true }); }
          if (m === 'POST' && seg[2] === 'unban') { svc.unban(actor, id); return send(res, 200, { ok: true }); }
          if (m === 'POST' && seg[2] === 'role') { svc.setRole(actor, id, body.role); return send(res, 200, { ok: true }); }
          if (m === 'POST' && seg[2] === 'devices' && seg[3] === 'reset') return send(res, 200, { removed: svc.resetDevices(actor, id) });
          if (m === 'POST' && seg[2] === 'logout-all') { svc.logoutAll(actor, id); return send(res, 200, { ok: true }); }
        }
        if (m === 'DELETE' && seg[0] === 'devices' && seg[1]) { svc.removeDevice(actor, seg[1]); return send(res, 200, { ok: true }); }
        if (seg[0] === 'keys') {
          if (m === 'GET' && !seg[1]) return send(res, 200, { keys: svc.listKeys() });
          if (m === 'POST' && !seg[1]) return send(res, 200, { keys: svc.createProductKeys(actor, await readJson(req)) });
          if (m === 'POST' && seg[1] && seg[2] === 'revoke') { svc.revokeKey(actor, seg[1]); return send(res, 200, { ok: true }); }
        }
        if (m === 'GET' && seg[0] === 'audit') return send(res, 200, { entries: svc.auditLog() });
        throw new HttpError(404, 'not_found', 'Unknown admin route.');
      }
    }
    throw new HttpError(404, 'not_found', 'Not found.');
  }

  const handler = (req, res) => {
    route(req, res).catch((e) => {
      if (res.headersSent) return;
      if (e instanceof LicenseError) return send(res, e.status, { error: e.code, message: e.message });
      console.error('[sptool-license]', e);
      send(res, 500, { error: 'internal', message: 'Something went wrong on the server.' });
    });
  };
  handler.service = svc;
  return handler;
}

export function createApp(opts) {
  return createServer(createHandler(opts));
}
