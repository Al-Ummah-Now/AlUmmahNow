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
