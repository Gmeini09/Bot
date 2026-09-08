'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, randomInt } = require('node:crypto');
class UserError extends Error {}

class Store {
  constructor(dir, now = Date.now) {
    this.now = now;
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'unfug-stream.json');
    this.state = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : { version: 1, guilds: {} };
    if (this.state.version !== 1 || !this.state.guilds) throw new Error('STREAM_STORAGE_INVALID');
  }
  save() {
    const temp = this.file + '.tmp';
    const fd = fs.openSync(temp, 'w', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(this.state)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temp, this.file);
  }
  guild(id) {
    if (!this.state.guilds[id]) {
      this.state.guilds[id] = { enabled: false, overlayKey: randomBytes(32).toString('hex'), template: '{name} ist live!\n{title}\n{url}', seen: [], giveaway: null };
      this.save();
    }
    return this.state.guilds[id];
  }
  create(id, prize, minutes, count) {
    const g = this.guild(id);
    this.expire();
    if (g.giveaway?.status === 'open') throw new UserError('Es läuft bereits ein Giveaway.');
    if (!prize || prize.length > 200 || !Number.isInteger(minutes) || minutes < 1 || minutes > 1440 || !Number.isInteger(count) || count < 1 || count > 20) throw new UserError('Ungültiger Preis, Dauer oder Gewinnerzahl.');
    g.giveaway = { id: randomBytes(8).toString('hex'), channel: g.channel, prize, count, endsAt: this.now() + minutes * 60000, status: 'open', entrants: {}, winners: [], drawn: [] };
    g.overlayHidden = false;
    this.save();
    return g.giveaway;
  }
  join(channel, userId, login) {
    if (!/^\d+$/.test(userId) || !/^[a-z0-9_]{1,25}$/i.test(login)) return false;
    this.expire();
    let changed = false;
    for (const g of Object.values(this.state.guilds)) {
      const a = g.giveaway;
      if (a?.status !== 'open' || a.channel !== channel || a.entrants[userId] || Object.keys(a.entrants).length >= 20000) continue;
      a.entrants[userId] = login;
      changed = true;
    }
    if (changed) this.save();
    return changed;
  }
  draw(id, reroll = false) {
    const a = this.guild(id).giveaway;
    if (!a || (reroll ? a.status !== 'ended' : a.status !== 'open')) throw new UserError('Kein passendes Giveaway.');
    const pool = Object.keys(a.entrants).filter(id => !a.drawn.includes(id));
    if (reroll && !pool.length) throw new UserError('Keine weiteren Teilnehmer für eine Neuziehung.');
    a.winners = [];
    while (pool.length && a.winners.length < a.count) {
      const [userId] = pool.splice(randomInt(pool.length), 1);
      a.drawn.push(userId);
      a.winners.push({ userId, login: a.entrants[userId] });
    }
    a.status = 'ended';
    this.save();
    return a;
  }
  expire() {
    for (const [id, g] of Object.entries(this.state.guilds)) if (g.giveaway?.status === 'open' && g.giveaway.endsAt <= this.now()) this.draw(id);
  }
  cancel(id) {
    const a = this.guild(id).giveaway;
    if (!a || a.status !== 'open') throw new UserError('Kein laufendes Giveaway.');
    a.status = 'cancelled'; this.save();
  }
  publicState(id, connected) {
    this.expire();
    const g = this.guild(id);
    const a = g.overlayHidden ? null : g.giveaway;
    return { serverTime: this.now(), connected, giveaway: a ? { id: a.id, prize: a.prize, status: a.status, endsAt: a.endsAt, count: Object.keys(a.entrants).length, winners: a.winners.map(w => w.login) } : null };
  }
}
module.exports = { Store, UserError };
