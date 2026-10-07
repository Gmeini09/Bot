// Licence levels Free < Premium < Creator < Admin < Developer: who may hand out what, who may change whom.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { openDb } from './db.mjs';
import { createLicenseService } from './service.mjs';

const tiers = createRequire(import.meta.url)('./tiers.cjs');
const OWNER = '697402284849627180';
const ADMIN = '111111111111111111', DEV = '222222222222222222', USER = '333333333333333333', ADMIN2 = '444444444444444444', OLD = '555555555555555555';

function setup() {
  const db = openDb(':memory:');
  const svc = createLicenseService({ cfg: { adminIds: new Set([OWNER]), defaultMaxDevices: 1 }, db });
  svc.setLicense(OWNER, DEV, { plan: 'developer' });
  svc.setLicense(OWNER, ADMIN, { plan: 'admin' });
  svc.setLicense(OWNER, ADMIN2, { plan: 'admin' });
  svc.setLicense(OWNER, USER, { plan: 'premium', days: 30 });
  // a Creator licence (all app features, no key management)
  svc.setLicense(OWNER, OLD, { plan: 'creator' });
  return { db, svc };
}
const code = (fn) => { try { fn(); return 'ok'; } catch (e) { return e.code ?? e.message; } };

test('levels: order, grant/manage rules, plan for old apps', () => {
  assert.deepEqual(tiers.PLANS, ['free', 'premium', 'creator', 'admin', 'developer']);
  assert.equal(tiers.tierOfPlan('nonsense'), 'free');
  assert.ok(tiers.canGrant('admin', 'creator') && !tiers.canGrant('admin', 'admin') && !tiers.canGrant('admin', 'developer'));
  assert.ok(tiers.canGrant('developer', 'developer') && tiers.canGrant('developer', 'admin'));
  assert.ok(!tiers.canGrant('creator', 'free'), 'Creator cannot manage keys');
  assert.ok(tiers.canManage('admin', 'premium') && !tiers.canManage('admin', 'admin') && tiers.canManage('developer', 'admin'));
  assert.equal(tiers.legacyTicketPlan('admin'), 'developer', 'apps up to 1.8.x do not know "admin"');
  assert.equal(tiers.legacyTicketPlan('developer'), 'developer');
  assert.equal(tiers.legacyTicketPlan('premium'), 'premium');
});

test('effective level: licence, owner, old role, ban', () => {
  const { db, svc } = setup();
  assert.equal(svc.tierOf(OWNER), 'developer');
  assert.equal(svc.tierOf(DEV), 'developer');
  assert.equal(svc.tierOf(ADMIN), 'admin');
  assert.equal(svc.tierOf(USER), 'premium');
  assert.equal(svc.tierOf(OLD), 'creator');
  assert.equal(svc.roleOf({ discord_id: ADMIN }), 'admin');
  assert.equal(svc.roleOf({ discord_id: OLD }), 'user', 'Creator gets no key management');
  assert.equal(svc.roleOf({ discord_id: DEV }), 'admin', 'Developer may use the admin area');
  // admins made by the owner before (role, no admin licence) stay admins
  db.prepare("UPDATE users SET role = 'admin' WHERE discord_id = ?").run(OLD);
  assert.equal(svc.tierOf(OLD), 'admin');
  svc.ban(DEV, ADMIN, 'test');
  assert.equal(svc.tierOf(ADMIN), 'free', 'a banned admin has no rights');
  assert.equal(svc.isAdmin(ADMIN), false);
});

test('keys: Admin up to Creator, Developer everything, Creator nothing', () => {
  const { svc } = setup();
  assert.equal(code(() => svc.createKeys(ADMIN, { plan: 'creator' })), 'ok');
  assert.equal(code(() => svc.createKeys(ADMIN, { plan: 'admin' })), 'dev_only');
  assert.equal(code(() => svc.createKeys(ADMIN, { plan: 'developer' })), 'dev_only');
  assert.equal(code(() => svc.createKeys(DEV, { plan: 'admin' })), 'ok');
  assert.equal(code(() => svc.createKeys(DEV, { plan: 'developer' })), 'ok');
  assert.equal(code(() => svc.createKeys(OLD, { plan: 'free' })), 'forbidden');
  assert.equal(code(() => svc.createKeys(USER, { plan: 'free' })), 'forbidden');
  // Skin Tool / Multi keys have no Admin level; a Developer Multi key can only be made by a Developer
  assert.equal(code(() => svc.createProductKeys(DEV, { kind: 'skin', plan: 'admin' })), 'bad_plan');
  assert.equal(code(() => svc.createProductKeys(ADMIN, { kind: 'multi', plan: 'developer' })), 'dev_only');
  assert.equal(code(() => svc.createProductKeys(ADMIN, { kind: 'multi', plan: 'creator' })), 'ok');
  // an Admin key can only be revoked by a Dev
  const [k] = svc.createKeys(DEV, { plan: 'admin' });
  assert.equal(code(() => svc.revokeKey(ADMIN, k)), 'dev_only');
  assert.equal(code(() => svc.revokeKey(DEV, k)), 'ok');
});

test('every key works: Free key → Free licence; Admin key makes an admin', () => {
  const { svc } = setup();
  const NEW = '666666666666666666', NEW2 = '777777777777777777';
  const [free] = svc.createKeys(ADMIN, { plan: 'free', days: 30 });
  assert.equal(svc.redeemKey(NEW, free).tier, 'free');
  assert.equal(svc.tierOf(NEW), 'free');
  const [adm] = svc.createKeys(DEV, { plan: 'admin' });
  svc.redeemKey(NEW2, adm);
  assert.equal(svc.tierOf(NEW2), 'admin');
  assert.equal(svc.isAdmin(NEW2), true);
  // a lower key never downgrades: Premium key on a Creator licence is refused and stays unused
  const [pr] = svc.createKeys(ADMIN, { plan: 'premium', days: 30 });
  assert.equal(code(() => svc.redeemKey(OLD, pr)), 'key_lower_plan');
});

test('accounts: Admin manages users, only Developer touches Admin/Developer accounts, nobody the owner', () => {
  const { svc } = setup();
  assert.equal(code(() => svc.setLicense(ADMIN, USER, { plan: 'creator' })), 'ok');
  assert.equal(code(() => svc.setLicense(ADMIN, USER, { plan: 'admin' })), 'dev_only');
  assert.equal(code(() => svc.revokeLicense(ADMIN, ADMIN2)), 'dev_only');
  assert.equal(code(() => svc.ban(ADMIN, ADMIN2, 'x')), 'dev_only');
  assert.equal(code(() => svc.resetDevices(ADMIN, DEV)), 'dev_only');
  assert.equal(code(() => svc.ban(ADMIN, USER, 'x')), 'ok');
  assert.equal(code(() => svc.unban(ADMIN, USER)), 'ok');
  assert.equal(code(() => svc.ban(DEV, ADMIN2, 'x')), 'ok');
  assert.equal(code(() => svc.unban(ADMIN, ADMIN2)), 'dev_only', 'a banned admin is still an admin account');
  assert.equal(code(() => svc.unban(DEV, ADMIN2)), 'ok');
  assert.equal(code(() => svc.setLicense(DEV, ADMIN2, { plan: 'developer' })), 'ok');
  assert.equal(code(() => svc.ban(DEV, OWNER, 'x')), 'protected');
  assert.equal(code(() => svc.revokeLicense(DEV, OWNER)), 'protected');
  assert.equal(code(() => svc.ban(ADMIN, ADMIN, 'x')), 'self');
  assert.equal(code(() => svc.setRole(ADMIN, USER, 'admin')), 'dev_only');
  assert.equal(code(() => svc.setRole(DEV, USER, 'admin')), 'ok');
});

test('licence views carry the level; the owner is Developer', () => {
  const { svc } = setup();
  assert.equal(svc.licenseView(OWNER).tier, 'developer');
  assert.equal(svc.licenseView(OLD).tier, 'creator');
  assert.equal(svc.licenseView(DEV).plan, 'developer');
  assert.equal(svc.userDetail(ADMIN).user.tier, 'admin');
});
