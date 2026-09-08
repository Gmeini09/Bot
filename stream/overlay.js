'use strict';
const token = location.hash.slice(1);
history.replaceState(null, '', location.pathname);
const $ = id => document.getElementById(id);
let latest = null, offset = 0, failed = false;
function render() {
  const a = latest?.giveaway;
  $('panel').hidden = !a || a.status === 'cancelled';
  if (!a) return;
  $('prize').textContent = a.prize;
  $('count').textContent = `${a.count} Teilnehmer`;
  const seconds = Math.max(0, Math.ceil((a.endsAt - (Date.now() + offset)) / 1000));
  $('timer').textContent = a.status === 'open' ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : 'BEENDET';
  $('instruction').textContent = a.status === 'open' ? (seconds ? '!join im Twitch-Chat' : 'Auslosung läuft …') : (a.winners.length ? 'Gewinner: ' + a.winners.join(', ') : 'Keine Teilnehmer – kein Gewinner.');
  $('warning').textContent = failed ? 'Verbindung zum Bot unterbrochen – Daten möglicherweise veraltet' : latest.connected ? '' : 'Twitch-Chat ist derzeit nicht verbunden';
}
async function update() {
  try {
    const r = await fetch('/stream/state', { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error('state');
    latest = await r.json(); offset = latest.serverTime - Date.now(); failed = false;
  } catch { failed = true; }
  render(); setTimeout(update, 1500);
}
setInterval(render, 250); update();
