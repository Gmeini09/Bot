'use strict';
// Pure helpers without Discord objects – easy to test.

const money = (v, currency = 'EUR') => (Number(v) === 0 ? 'Gratis' : new Intl.NumberFormat('de-AT', { style: 'currency', currency }).format(Number(v) || 0));

/** "{user}", "{server}", "{verify}", "{count}" in welcome texts. */
function fillTemplate(text, vars) {
  return String(text || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m));
}

/** Parses "#c9a227", "c9a227" or "0xc9a227" → number, null if invalid. */
function parseColor(s) {
  const m = /^(?:#|0x)?([0-9a-f]{6})$/i.exec(String(s || '').trim());
  return m ? parseInt(m[1], 16) : null;
}

/** Price from user input: "9,99", "9.99 €", "10" → 9.99 / 10; null if invalid or negative. */
function parsePrice(s) {
  const t = String(s ?? '').replace(/[€\s]/g, '').replace(',', '.');
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100) / 100;
}

/** Cart lines with product data; unknown or disabled products are skipped. */
function cartLines(cart, products) {
  const lines = [];
  for (const [pid, qty] of Object.entries(cart?.items || {})) {
    const p = products[pid];
    if (!p || p.enabled === false || !(qty > 0)) continue;
    lines.push({ id: pid, name: p.name, emoji: p.emoji || '', price: p.price, qty, sum: Math.round(p.price * qty * 100) / 100 });
  }
  return lines;
}
const cartTotal = (lines) => Math.round(lines.reduce((a, l) => a + l.sum, 0) * 100) / 100;

function addToCart(cart, pid, max = 10) {
  cart.items ||= {};
  cart.items[pid] = Math.min(max, (cart.items[pid] || 0) + 1);
  cart.updatedAt = Date.now();
  return cart.items[pid];
}

/** Simple captcha: two small numbers, the answer is their sum. */
function makeCaptcha(rand = Math.random) {
  const a = 2 + Math.floor(rand() * 8), b = 1 + Math.floor(rand() * 9);
  return { question: `Was ist ${a} + ${b}?`, answer: String(a + b) };
}

const INVITE_RE = /(?:discord(?:app)?\.com\/invite|discord\.gg|dsc\.gg)\/[\w-]{2,}/i;
const hasInvite = (text) => INVITE_RE.test(String(text || ''));

/**
 * Remembers recent messages per user and says whether a new one is spam.
 * Returns null (fine) or a reason: 'spam' | 'duplicate'.
 */
class SpamTracker {
  constructor() { this.byUser = new Map(); }
  check(key, content, now, cfg) {
    const list = (this.byUser.get(key) || []).filter((m) => now - m.at < 20_000);
    list.push({ at: now, content: String(content || '').trim().toLowerCase() });
    this.byUser.set(key, list);
    if (this.byUser.size > 20_000) this.byUser.clear();
    if (cfg.spam && list.filter((m) => now - m.at < cfg.spamSeconds * 1000).length > cfg.spamMessages) return 'spam';
    const last = list[list.length - 1].content;
    if (cfg.duplicates && last.length > 0 && list.filter((m) => m.content === last).length >= 4) return 'duplicate';
    return null;
  }
  reset(key) { this.byUser.delete(key); }
}

/** Counts joins per server; true once the raid threshold is reached within the window. */
class RaidTracker {
  constructor() { this.joins = new Map(); this.until = new Map(); }
  join(guildId, now, cfg) {
    const list = (this.joins.get(guildId) || []).filter((t) => now - t < cfg.raidSeconds * 1000);
    list.push(now);
    this.joins.set(guildId, list);
    if (list.length >= cfg.raidJoins && !this.active(guildId, now)) {
      this.until.set(guildId, now + 10 * 60_000);
      return 'started';
    }
    return this.active(guildId, now) ? 'active' : null;
  }
  active(guildId, now) { return (this.until.get(guildId) || 0) > now; }
  stop(guildId) { this.until.delete(guildId); this.joins.delete(guildId); }
}

/** Plain-text transcript of ticket messages (oldest first). */
function transcript(channelName, messages) {
  const lines = [`Transkript #${channelName}`, `Erstellt: ${new Date().toISOString()}`, ''];
  for (const m of messages) {
    const when = new Date(m.createdTimestamp).toISOString().replace('T', ' ').slice(0, 19);
    const att = m.attachments?.length ? ` [Anhänge: ${m.attachments.join(', ')}]` : '';
    const emb = m.embeds ? ` [${m.embeds} Embed${m.embeds > 1 ? 's' : ''}]` : '';
    lines.push(`[${when}] ${m.author}: ${m.content || ''}${att}${emb}`.trimEnd());
  }
  return lines.join('\n');
}

/** Channel-safe name part: "Max Müller!" → "max-muller". */
function slug(s) {
  return String(s || 'user').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20) || 'user';
}

const pad = (n, w = 4) => String(n).padStart(w, '0');

/** "30m", "2h", "1d12h", "90" (minutes) → milliseconds; null if invalid or outside 1 minute … 30 days. */
function parseDuration(s) {
  const t = String(s || '').trim().toLowerCase().replace(/\s+/g, '');
  if (/^\d+$/.test(t)) { const ms = Number(t) * 60_000; return ms >= 60_000 && ms <= 30 * 86_400_000 ? ms : null; }
  const m = /^(?:(\d+)(?:d|t|tage?))?(?:(\d+)(?:h|std))?(?:(\d+)(?:m|min))?$/.exec(t);
  if (!m || !(m[1] || m[2] || m[3])) return null;
  const ms = ((Number(m[1] || 0) * 24 + Number(m[2] || 0)) * 60 + Number(m[3] || 0)) * 60_000;
  return ms >= 60_000 && ms <= 30 * 86_400_000 ? ms : null;
}

/** Account age in whole days. */
const accountAgeDays = (createdTimestamp, now = Date.now()) => Math.floor((now - createdTimestamp) / 86_400_000);

/** True when a single Unicode emoji (or a custom emoji <:name:id>) – Discord rejects anything else in menus. */
function validEmoji(e) {
  const s = String(e || '').trim();
  if (!s) return false;
  if (/^<a?:\w{2,32}:\d{15,21}>$/.test(s)) return true;
  return /^\p{Extended_Pictographic}(️|‍\p{Extended_Pictographic}|\p{Emoji_Modifier})*$/u.test(s) || /^[0-9#*]️?⃣$/.test(s);
}

/** "10%" → percent 10; "5", "5€", "4,50" → amount; null if invalid. */
function parseDiscount(s) {
  const t = String(s ?? '').trim();
  const pm = /^(\d{1,2}(?:[.,]\d{1,2})?|100)\s*%$/.exec(t);
  if (pm) { const v = Number(pm[1].replace(',', '.')); return v > 0 && v <= 100 ? { type: 'percent', value: v } : null; }
  const v = parsePrice(t);
  return v && v > 0 ? { type: 'amount', value: v } : null;
}

const normCode = (s) => String(s || '').trim().toUpperCase();

/** Why a code can't be used, or null. */
function discountError(d, userId, now = Date.now()) {
  if (!d) return 'Diesen Rabattcode gibt es nicht.';
  if (d.expiresAt && now > d.expiresAt) return 'Dieser Rabattcode ist abgelaufen.';
  if (d.maxUses && (d.uses || 0) >= d.maxUses) return 'Dieser Rabattcode ist schon aufgebraucht.';
  if ((d.usedBy || []).includes(userId)) return 'Du hast diesen Rabattcode schon benutzt.';
  return null;
}

/** Discount on a total: { amount, total } (never below 0). */
function applyDiscount(total, d) {
  const raw = d.type === 'percent' ? total * d.value / 100 : d.value;
  const amount = Math.round(Math.min(total, raw) * 100) / 100;
  return { amount, total: Math.round((total - amount) * 100) / 100 };
}

const discountLabel = (d, currency = 'EUR') => (d.type === 'percent' ? `${String(d.value).replace('.', ',')} %` : money(d.value, currency));

/** Stock: null/undefined = unlimited. */
const inStock = (p) => p.stock == null || p.stock > 0;

const ORDER_STATUS = {
  open: { label: 'Offen – wartet auf Zahlung', emoji: '🟡' },
  paid: { label: 'Bezahlt – in Bearbeitung', emoji: '🔵' },
  delivered: { label: 'Geliefert', emoji: '🟢' },
  cancelled: { label: 'Storniert', emoji: '🔴' },
};

module.exports = { parseDiscount, normCode, discountError, applyDiscount, discountLabel, inStock, parseDuration, money, fillTemplate, parseColor, parsePrice, cartLines, cartTotal, addToCart, makeCaptcha, hasInvite, SpamTracker, RaidTracker, transcript, slug, pad, accountAgeDays, validEmoji, ORDER_STATUS };
