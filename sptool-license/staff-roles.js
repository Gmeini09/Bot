'use strict';
// Staff roles: members with the "Manager" role may use every slash command of the bot, like an administrator.
//
// Preload (node -r ./sptool-license/staff-roles.js start-fixed.js). Instead of touching every command, it makes
// Discord permission checks see a Manager as an administrator:
//   · member.permissions            (GuildMember)       → all permissions
//   · interaction.memberPermissions (slash commands …)  → all permissions
// What stays as it is on purpose: things only the SERVER OWNER may do (e.g. Anti-Nuke), the bot's own
// permissions, and SP Tool license admins (they are separate Discord accounts, not a role).
//
// Which roles count:  MANAGER_ROLE_IDS   (comma separated role IDs)          – exact
//                     MANAGER_ROLE_NAMES (comma separated, default "manager") – name without emojis/symbols, any case
// Turn off with STAFF_ROLES=false.

const ON = String(process.env.STAFF_ROLES ?? 'true').toLowerCase() !== 'false';
const list = (v) => String(v || '').split(/[,;]+/).map((s) => s.trim()).filter(Boolean);
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9äöüß]+/g, '');
const ROLE_IDS = new Set(list(process.env.MANAGER_ROLE_IDS));
const ROLE_NAMES = new Set(list(process.env.MANAGER_ROLE_NAMES || 'manager').map(norm).filter(Boolean));

const isManagerRole = (role) => Boolean(role) && (ROLE_IDS.has(role.id) || ROLE_NAMES.has(norm(role.name)));

function install() {
  if (!ON || globalThis.__staffRoles) return;
  const djs = require('discord.js');
  const { GuildMember, PermissionsBitField, Client } = djs;
  if (!GuildMember || !PermissionsBitField || !Client) throw new Error('discord.js classes not found');
  const ALL = new PermissionsBitField(PermissionsBitField.All).freeze();

  /** true for a human member that holds a Manager role (never for bots – the bot's own rights stay real). */
  function isManager(member) {
    try {
      if (!member || member.user?.bot) return false;
      const cache = member.roles?.cache;
      return Boolean(cache && typeof cache.some === 'function' && cache.some(isManagerRole));
    } catch { return false; }
  }

  // 1 · member.permissions
  const desc = Object.getOwnPropertyDescriptor(GuildMember.prototype, 'permissions');
  if (!desc?.get) throw new Error('GuildMember.permissions getter not found');
  Object.defineProperty(GuildMember.prototype, 'permissions', {
    configurable: true,
    enumerable: desc.enumerable,
    get() { return isManager(this) ? ALL : desc.get.call(this); },
  });

  // 2 · interaction.memberPermissions (computed by Discord, stored on the interaction) – set before any listener runs
  const emit = Client.prototype.emit;
  Client.prototype.emit = function staffRolesEmit(event, ...args) {
    if (event === 'interactionCreate') {
      const i = args[0];
      try { if (i && i.member instanceof GuildMember && isManager(i.member)) Object.defineProperty(i, 'memberPermissions', { value: ALL, configurable: true, writable: true }); } catch { /* never block an interaction */ }
    } else if ((event === 'ready' || event === 'clientReady') && !this.__staffLogged) {
      this.__staffLogged = true;
      try {
        const found = [];
        for (const g of this.guilds?.cache?.values?.() ?? []) for (const r of g.roles?.cache?.values?.() ?? []) if (isManagerRole(r)) found.push(`${g.name} → ${r.name}`);
        const similar = [];
        for (const g of this.guilds?.cache?.values?.() ?? []) for (const r of g.roles?.cache?.values?.() ?? []) if (!isManagerRole(r) && /manag|leitung|lead/.test(norm(r.name))) similar.push(`${g.name} → ${r.name} (${r.id})`);
        console.log(found.length ? `👔 Manager-Rollen mit vollem Bot-Zugriff: ${found.join(' · ')}` : '⚠️ Keine Manager-Rolle gefunden (MANAGER_ROLE_NAMES / MANAGER_ROLE_IDS prüfen)');
        if (similar.length) console.log(`ℹ️ Ähnliche Rollen (nicht freigeschaltet): ${similar.slice(0, 15).join(' · ')}`);
      } catch { /* logging only */ }
    }
    return emit.call(this, event, ...args);
  };

  globalThis.__staffRoles = { isManager, isManagerRole };
  console.log(`ℹ️ Staff-Rollen geladen · Manager = alle Befehle · Namen: ${[...ROLE_NAMES].join(', ') || '–'}${ROLE_IDS.size ? ` · IDs: ${[...ROLE_IDS].join(', ')}` : ''} · v1.0.1`);
}

try { install(); } catch (e) { console.error('❌ Staff-Rollen nicht geladen:', e?.message || e); }
module.exports = { isManagerRole, norm };
