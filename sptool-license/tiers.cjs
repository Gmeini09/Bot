'use strict';
// SP Tool licence levels – one definition for the licence server, the Discord bot and the cloud API.
//
//   Free       every key: create soundpacks (import own sounds, take sounds from other packs, build, download)
//   Premium    more than Free: edit & generate sounds, presets, WAV export, more soundpacks, cloud
//   Creator    everything in the app, but no key / user management
//   Admin      + manage keys, licences, users, PCs (up to Creator; cannot touch Admin/Developer accounts)
//   Developer  all permissions ("Dev"): + Admin/Developer keys and licences, manage Admin accounts
//
// "admin" is new; "developer" existed before and is now the top level with all permissions.

const PLANS = ['free', 'premium', 'creator', 'admin', 'developer'];
const RANK = { free: 0, premium: 1, creator: 2, admin: 3, developer: 4 };
const LABEL = { free: 'Free', premium: 'Premium', creator: 'Creator', admin: 'Admin', developer: 'Developer' };
const EMOJI = { free: '🆓', premium: '⭐', creator: '🎨', admin: '🛡️', developer: '🛠️' };
/** Levels that manage keys/users. */
const STAFF = ['admin', 'developer'];
/** The Turbo Skin Tool knows only these plans – Admin exists for SP Tool licences only. */
const PRODUCT_PLANS = ['free', 'premium', 'creator', 'developer'];

/** Level of a stored plan (unknown → free). */
const tierOfPlan = (p) => (Object.prototype.hasOwnProperty.call(RANK, p) ? p : 'free');
const rankOf = (p) => RANK[tierOfPlan(p)];
const atLeast = (p, min) => rankOf(p) >= RANK[min];
const maxTier = (...ps) => ps.filter(Boolean).map(tierOfPlan).reduce((a, b) => (RANK[b] > RANK[a] ? b : a), 'free');
const isStaff = (p) => atLeast(p, 'admin');

/**
 * Who may hand out a plan (keys, licences): Admin up to Creator, Developer everything.
 * actorTier = the actor's effective level.
 */
const canGrant = (actorTier, plan) => {
  if (!isStaff(actorTier)) return false;
  return rankOf(plan) <= RANK.creator || tierOfPlan(actorTier) === 'developer';
};
/** Who may change another account (licence, ban, PCs, sessions): Admin only non-staff accounts, Developer everyone but the owner. */
const canManage = (actorTier, targetTier) => isStaff(actorTier) && (!isStaff(targetTier) || tierOfPlan(actorTier) === 'developer');

/** The plan value old apps (≤ 1.8.x) understand inside a ticket: "admin" is new there → "developer". */
const legacyTicketPlan = (tier) => (tierOfPlan(tier) === 'admin' ? 'developer' : tierOfPlan(tier));

/**
 * Effective level of a Discord account from the licence database: the active SP Tool licence, an admin role set by
 * the owner (counts as Admin), and configured admins/owner (Developer). A banned account has no rights (ignoreBan: its
 * level as it would be without the ban – used to decide who may unban it).
 * db: node:sqlite DatabaseSync, isConfigAdmin: (id) => boolean.
 */
function effectiveTier(db, id, isConfigAdmin, now = Date.now(), { ignoreBan = false } = {}) {
  if (isConfigAdmin(id)) return 'developer';
  let lic = null, user = null;
  try { lic = db.prepare('SELECT plan, revoked, expires_at FROM licenses WHERE discord_id = ?').get(id); } catch { lic = null; }
  try { user = db.prepare('SELECT role, banned FROM users WHERE discord_id = ?').get(id); } catch { user = null; }
  if (user?.banned && !ignoreBan) return 'free'; // a banned account keeps no rights, whatever its licence says
  const active = lic && !lic.revoked && (lic.expires_at == null || lic.expires_at > now);
  return maxTier(active ? lic.plan : 'free', user?.role === 'admin' && (!user.banned || ignoreBan) ? 'admin' : 'free');
}

module.exports = { PLANS, RANK, LABEL, EMOJI, STAFF, PRODUCT_PLANS, tierOfPlan, rankOf, atLeast, maxTier, isStaff, canGrant, canManage, legacyTicketPlan, effectiveTier };
