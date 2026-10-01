// Discord OAuth2 (authorization code flow, scope "identify" only).
// The client secret never leaves the server; Discord passwords and user tokens are never touched.
const API = 'https://discord.com/api/v10';

export function authorizeUrl(cfg, state) {
  const u = new URL('https://discord.com/oauth2/authorize');
  u.searchParams.set('client_id', cfg.discord.clientId);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', 'identify');
  u.searchParams.set('redirect_uri', `${cfg.publicUrl}/api/v1/auth/discord/callback`);
  u.searchParams.set('state', state);
  u.searchParams.set('prompt', 'none');
  return u.toString();
}

/** Exchanges the code and returns { id, username, global_name, avatar }. */
export async function fetchDiscordUser(cfg, code, fetchImpl = fetch) {
  const body = new URLSearchParams({
    client_id: cfg.discord.clientId,
    client_secret: cfg.discord.clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: `${cfg.publicUrl}/api/v1/auth/discord/callback`,
  });
  const tr = await fetchImpl(`${API}/oauth2/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  if (!tr.ok) throw new Error(`Discord token exchange failed (${tr.status})`);
  const tok = await tr.json();
  const ur = await fetchImpl(`${API}/users/@me`, { headers: { Authorization: `Bearer ${tok.access_token}` } });
  if (!ur.ok) throw new Error(`Discord user lookup failed (${ur.status})`);
  const u = await ur.json();
  if (!u || typeof u.id !== 'string' || !/^\d{15,21}$/.test(u.id)) throw new Error('Discord returned an invalid user.');
  // The Discord access token is not stored; SP Tool only needs the identity.
  return { id: u.id, username: String(u.username ?? ''), global_name: u.global_name ?? null, avatar: u.avatar ?? null };
}
