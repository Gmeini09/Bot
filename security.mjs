// Crypto helpers: tokens, hashing, license keys, Ed25519 signed license tickets, rate limiting.
import { createHash, createHmac, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign, timingSafeEqual } from 'node:crypto';

export const sha256 = (s) => createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const b64url = (buf) => Buffer.from(buf).toString('base64url');

/** HWIDs arrive already hashed by the client; the server hashes again with its own salt. */
export function serverHwidHash(clientHash, salt) {
  if (typeof clientHash !== 'string' || !/^[a-f0-9]{64}$/.test(clientHash)) return null;
  return salt ? createHmac('sha256', salt).update(clientHash).digest('hex') : sha256(clientHash);
}

const KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
export function generateLicenseKey() {
  const bytes = randomBytes(16);
  let s = '';
  for (let i = 0; i < 16; i++) s += KEY_ALPHABET[bytes[i] % KEY_ALPHABET.length];
  return `SPT-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}`;
}
export const isLicenseKey = (k) => typeof k === 'string' && /^SPT-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(k);

export function newSigningKey() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    /** raw 32-byte public key, base64url – embedded in the client build */
    publicRaw: publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64url'),
  };
}

export function publicRawFromPrivate(pem) {
  return createPublicKey(createPrivateKey(pem)).export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64url');
}

/** License ticket: base64url(JSON payload) + "." + base64url(Ed25519 signature over the payload part). */
export function signTicket(payload, privatePem) {
  const body = b64url(JSON.stringify(payload));
  const sig = sign(null, Buffer.from(body), createPrivateKey(privatePem));
  return `${body}.${b64url(sig)}`;
}

export function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Token bucket per key (IP or IP+route). */
export function rateLimiter({ capacity, refillPerSec }) {
  const buckets = new Map();
  return (key) => {
    const now = Date.now() / 1000;
    const b = buckets.get(key) ?? { tokens: capacity, at: now };
    b.tokens = Math.min(capacity, b.tokens + (now - b.at) * refillPerSec);
    b.at = now;
    const ok = b.tokens >= 1;
    if (ok) b.tokens -= 1;
    buckets.set(key, b);
    if (buckets.size > 50000) buckets.clear();
    return ok;
  };
}
