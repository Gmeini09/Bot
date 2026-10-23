'use strict';
// Welcome picture: avatar with a ring in the server colour, "WILLKOMMEN", the member's name and member number.
// Falls back to null (plain embed) if anything goes wrong – a welcome must never fail because of the picture.
const path = require('path');

let canvas = null;
function lib() {
  if (canvas !== null) return canvas;
  try {
    canvas = require('@napi-rs/canvas');
    const dir = path.join(path.dirname(require.resolve('@fontsource/montserrat/package.json')), 'files');
    for (const w of [500, 700, 800]) canvas.GlobalFonts.registerFromPath(path.join(dir, `montserrat-latin-${w}-normal.woff2`), 'XVYCard');
    for (const w of [500, 700, 800]) canvas.GlobalFonts.registerFromPath(path.join(dir, `montserrat-latin-ext-${w}-normal.woff2`), 'XVYCard');
  } catch (e) {
    console.error('⚠️ Willkommensbild nicht verfügbar:', e.message);
    canvas = false;
  }
  return canvas;
}

const W = 1100, H = 400;
const hex = (n) => `#${(n >>> 0).toString(16).padStart(6, '0').slice(-6)}`;

/** Name that the font can draw: the display name if it is plain Latin text, otherwise the username. */
function drawableName(displayName, username) {
  const d = String(displayName || '').trim();
  return d && /^[\p{Script=Latin}\p{N}\s._\-'!?&()¥$€+*#|]+$/u.test(d) ? d : String(username || 'Neues Mitglied');
}

function fit(ctx, text, weight, max, start) {
  let size = start;
  do { ctx.font = `${weight} ${size}px XVYCard`; size -= 2; } while (ctx.measureText(text).width > max && size > 24);
  if (ctx.measureText(text).width > max) { while (text.length > 3 && ctx.measureText(`${text}…`).width > max) text = text.slice(0, -1); text += '…'; }
  return text;
}

/** PNG buffer or null. avatar: image buffer (or null). */
async function render({ name, count, server, color = 0xc9a227, avatar }) {
  const c = lib();
  if (!c) return null;
  const cv = c.createCanvas(W, H);
  const x = cv.getContext('2d');
  const accent = hex(color);

  // background: dark with a soft glow in the accent colour
  x.fillStyle = '#0d0d10';
  x.fillRect(0, 0, W, H);
  const glow = x.createRadialGradient(200, H / 2, 20, 200, H / 2, 520);
  glow.addColorStop(0, `${accent}55`);
  glow.addColorStop(1, '#0d0d1000');
  x.fillStyle = glow;
  x.fillRect(0, 0, W, H);
  // thin frame and accent bar
  x.strokeStyle = `${accent}66`;
  x.lineWidth = 2;
  x.strokeRect(14, 14, W - 28, H - 28);
  x.fillStyle = accent;
  x.fillRect(14, H - 20, W - 28, 6);

  // avatar
  const cx = 200, cy = H / 2, r = 120;
  x.beginPath(); x.arc(cx, cy, r + 10, 0, Math.PI * 2); x.fillStyle = accent; x.fill();
  x.beginPath(); x.arc(cx, cy, r + 4, 0, Math.PI * 2); x.fillStyle = '#0d0d10'; x.fill();
  x.save();
  x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.clip();
  let drawn = false;
  if (avatar) { try { x.drawImage(await c.loadImage(avatar), cx - r, cy - r, r * 2, r * 2); drawn = true; } catch { /* default below */ } }
  if (!drawn) {
    x.fillStyle = '#26262e'; x.fillRect(cx - r, cy - r, r * 2, r * 2);
    x.fillStyle = accent; x.font = '800 110px XVYCard'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText((name || '?').trim().charAt(0).toUpperCase() || '?', cx, cy + 6);
  }
  x.restore();

  // text
  const left = 380, maxW = W - left - 60;
  x.textAlign = 'left'; x.textBaseline = 'alphabetic';
  x.fillStyle = accent;
  x.font = '700 30px XVYCard';
  x.fillText('W I L L K O M M E N', left, 135);
  x.fillStyle = '#ffffff';
  const nm = fit(x, name, 800, maxW, 76);
  x.fillText(nm, left, 222);
  x.fillStyle = '#b8b8c4';
  x.font = '500 30px XVYCard';
  x.fillText(fit(x, `im ${server}`, 500, maxW, 30), left, 275);
  x.fillStyle = accent;
  x.font = '700 28px XVYCard';
  x.fillText(`Mitglied #${count}`, left, 330);

  return cv.toBuffer('image/png');
}

/** Avatar of a member as a buffer (png, 256 px) or null. */
async function avatarOf(member) {
  try {
    const url = member.displayAvatarURL?.({ extension: 'png', size: 256 }) ?? member.user?.displayAvatarURL?.({ extension: 'png', size: 256 });
    if (!url) return null;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
  } catch { return null; }
}

module.exports = { render, avatarOf, drawableName };
