import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeRole,
  hasAdminAccess,
  highestAdminRole,
  isSuperAdmin,
  canModerate,
} from '../src/lib/roles';

describe('normalizeRole', () => {
  it('maps auth server display names to snake_case ids', () => {
    assert.equal(normalizeRole('Super Admin'), 'super_admin');
    assert.equal(normalizeRole('Admin'), 'admin');
    assert.equal(normalizeRole('Moderator'), 'moderator');
  });

  it('leaves ids unchanged and handles missing values', () => {
    assert.equal(normalizeRole('super_admin'), 'super_admin');
    assert.equal(normalizeRole(' super-admin '), 'super_admin');
    assert.equal(normalizeRole(undefined), '');
  });
});

describe('highestAdminRole', () => {
  it('picks the highest role from the display names prod tokens carry', () => {
    assert.equal(highestAdminRole(['Admin', 'Super Admin']), 'super_admin');
    assert.equal(highestAdminRole(['Moderator', 'Admin']), 'admin');
    assert.equal(highestAdminRole(['User', 'Moderator']), 'moderator');
  });

  it('accepts snake_case ids too', () => {
    assert.equal(highestAdminRole(['super_admin']), 'super_admin');
  });

  it('returns undefined for users without an admin role', () => {
    assert.equal(highestAdminRole(['User', 'Content Creator']), undefined);
    assert.equal(highestAdminRole([]), undefined);
    assert.equal(highestAdminRole(undefined), undefined);
  });
});

describe('role checks', () => {
  it('grants admin access to super admins, admins and moderators in either form', () => {
    for (const role of ['Super Admin', 'super_admin', 'Admin', 'admin', 'Moderator', 'moderator']) {
      assert.equal(hasAdminAccess(role), true, role);
      assert.equal(canModerate(role), true, role);
    }
  });

  it('denies admin access to regular users', () => {
    assert.equal(hasAdminAccess('User'), false);
    assert.equal(hasAdminAccess(undefined), false);
    assert.equal(canModerate('user'), false);
  });

  it('recognises super admins only', () => {
    assert.equal(isSuperAdmin('Super Admin'), true);
    assert.equal(isSuperAdmin('super_admin'), true);
    assert.equal(isSuperAdmin('Admin'), false);
  });
});

describe('creator tiers in the admin', () => {
  it('admins and super admins change tiers; moderators see tiers read-only', async () => {
    const { canManageCreators } = await import('../src/lib/roles');
    assert.equal(canManageCreators('admin'), true);
    assert.equal(canManageCreators('Super Admin'), true);
    assert.equal(canManageCreators('moderator'), false);
    assert.equal(canManageCreators(undefined), false);
  });

  it('the nav lists Tiers (not Creators: tiers are set on Users), and its strings exist in English and Arabic', async () => {
    const { NAV_ITEMS } = await import('../src/components/shell/nav-model');
    const tiers = NAV_ITEMS.find((item) => item.href === '/tiers');
    assert.equal(tiers?.label, 'nav.tiers');
    assert.equal(tiers?.group, 'people', 'a top-level People item, not under Creators');
    assert.equal(tiers?.requires, undefined, 'every admin reads it; changes need creators:manage');
    assert.equal(NAV_ITEMS.some((item) => item.href === '/creators'), false, 'the Creators page is folded into Users');
    const en = (await import('../src/i18n/messages/en')).default;
    const ar = (await import('../src/i18n/messages/ar')).default;
    assert.deepEqual(Object.keys(ar.creators).sort(), Object.keys(en.creators).sort());
    assert.equal(en.nav.tiers, 'Tiers');
    assert.equal(ar.nav.tiers, 'الفئات');
  });
});
