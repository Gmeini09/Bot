// SP Tool web app (phone, tablet, browser): serves the built app from ./public. No dependencies.
// Sign-in and licences stay on the licence server (API_URL); this server only hands out static files.
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const ROOT = resolve(process.cwd(), 'public');
const PORT = Number(process.env.PORT || 8080);
const API = process.env.SPTOOL_API_ORIGIN || 'https://bot-production-d58c.up.railway.app';
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.txt': 'text/plain; charset=utf-8',
};
const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "font-src 'self' data:",
  "img-src 'self' data: blob: https://cdn.discordapp.com", "media-src 'self' data: blob:", "worker-src 'self' blob:",
  `connect-src 'self' ${API}`, "frame-ancestors 'none'", "base-uri 'self'", "form-action 'none'", "object-src 'none'",
].join('; ');
const SECURITY = {
  'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  'Strict-Transport-Security': 'max-age=31536000', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

function fileFor(urlPath) {
  let p;
  try { p = decodeURIComponent(urlPath.split('?')[0]); } catch { return null; }
  const full = normalize(join(ROOT, p));
  if (full !== ROOT && !full.startsWith(ROOT + '/')) return null; // no path traversal
  try { const st = statSync(full); if (st.isFile()) return { full, st }; if (st.isDirectory()) { const i = join(full, 'index.html'); return { full: i, st: statSync(i) }; } } catch { /* missing */ }
  return null;
}

createServer((req, res) => {
  const path = (req.url || '/').split('?')[0];
  if (path === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end(); }
  // unknown paths → the app (it has no server-side routes); files that look like files → 404
  const f = fileFor(path) ?? (extname(path) ? null : fileFor('/index.html'));
  if (!f) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY }); return res.end('Nicht gefunden'); }
  const ext = extname(f.full).toLowerCase();
  // index.html and sw.js always fresh (they decide which version runs); everything else is versioned by the build
  const fresh = ext === '.html' || f.full.endsWith('/sw.js') || ext === '.webmanifest';
  res.writeHead(200, {
    'Content-Type': TYPES[ext] || 'application/octet-stream', 'Content-Length': f.st.size,
    'Cache-Control': fresh ? 'no-cache' : 'public, max-age=3600', ...SECURITY,
    ...(f.full.endsWith('/sw.js') ? { 'Service-Worker-Allowed': '/' } : {}),
  });
  if (req.method === 'HEAD') return res.end();
  createReadStream(f.full).pipe(res);
}).listen(PORT, () => console.log(`SP Tool Web-App läuft auf Port ${PORT} · Lizenzserver ${API}`));
