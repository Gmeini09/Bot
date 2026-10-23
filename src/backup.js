'use strict';
// Daily snapshots of the data file on the volume (kept 14 days) and /backup to download the current data.
// Protects against a broken or wrongly changed data file; Railway's volume backups protect against losing the volume.
const fs = require('fs');
const path = require('path');
const { ok, fail } = require('./ui');

const KEEP = 14;
const day = (now) => new Date(now).toISOString().slice(0, 10);

/** Writes today's snapshot once and removes the oldest ones. Returns the snapshot path or null if it already existed. */
function snapshot(store, now = Date.now()) {
  const dir = path.join(store.dir, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `xvy-bot-${day(now)}.json`);
  if (fs.existsSync(file)) return null;
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(store.data));
  fs.renameSync(`${file}.tmp`, file);
  const old = fs.readdirSync(dir).filter((f) => /^xvy-bot-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  for (const f of old.slice(0, Math.max(0, old.length - KEEP))) fs.rmSync(path.join(dir, f), { force: true });
  return file;
}

const list = (store) => {
  const dir = path.join(store.dir, 'backups');
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];
};

/** /backup – the server's current data as a JSON file (only for the person running it). */
async function onCommand(interaction, ctx) {
  const g = ctx.store.guild(interaction.guildId);
  if (interaction.user.id !== interaction.guild.ownerId && !interaction.member.permissions.has(1n << 3n)) return interaction.reply(fail(g, 'Nur der Server-Owner oder Admins.'));
  const data = JSON.stringify({ guildId: interaction.guildId, exportedAt: new Date().toISOString(), data: g }, null, 1);
  const snaps = list(ctx.store);
  return interaction.reply({
    ...ok(g, `Aktuelle Daten im Anhang. Tägliche Sicherungen auf dem Server: ${snaps.length} (letzte: ${snaps.at(-1)?.slice(8, 18) ?? '–'}).`),
    files: [{ attachment: Buffer.from(data, 'utf8'), name: `xvy-backup-${day(Date.now())}.json` }],
  });
}

module.exports = { snapshot, list, onCommand, KEEP };
