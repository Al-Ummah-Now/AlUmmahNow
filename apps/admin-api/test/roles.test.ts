import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRole, normalizeRoles, hasAdminRole, hasModeratorRole } from '../src/lib/roles';

describe('normalizeRole', () => {
  it('maps auth server display names to snake_case ids', () => {
    assert.equal(normalizeRole('Super Admin'), 'super_admin');
    assert.equal(normalizeRole('Admin'), 'admin');
    assert.equal(normalizeRole('Moderator'), 'moderator');
  });

  it('leaves ids unchanged and tolerates odd spacing and hyphens', () => {
    assert.equal(normalizeRole('super_admin'), 'super_admin');
    assert.equal(normalizeRole('  super-admin '), 'super_admin');
    assert.equal(normalizeRole('SUPER   ADMIN'), 'super_admin');
  });

  it('returns an empty string for missing values', () => {
    assert.equal(normalizeRole(undefined), '');
    assert.equal(normalizeRole(null), '');
  });
});

describe('normalizeRoles', () => {
  it('normalizes every role and drops empty or non-string entries', () => {
    assert.deepEqual(normalizeRoles(['Super Admin', 'Admin', '', 42, null]), ['super_admin', 'admin']);
  });

  it('returns an empty list when the claim is not an array', () => {
    assert.deepEqual(normalizeRoles(undefined), []);
    assert.deepEqual(normalizeRoles('Admin'), []);
  });
});

describe('hasAdminRole', () => {
  it('accepts super admins and admins, by display name or id', () => {
    assert.equal(hasAdminRole(['Super Admin']), true);
    assert.equal(hasAdminRole(['Admin']), true);
    assert.equal(hasAdminRole(['super_admin']), true);
  });

  it('rejects moderators and regular users', () => {
    assert.equal(hasAdminRole(['Moderator']), false);
    assert.equal(hasAdminRole(['User']), false);
    assert.equal(hasAdminRole([]), false);
    assert.equal(hasAdminRole(undefined), false);
  });
});

describe('hasModeratorRole', () => {
  it('accepts super admins, admins and moderators', () => {
    assert.equal(hasModeratorRole(['Super Admin', 'Admin']), true);
    assert.equal(hasModeratorRole(['Moderator']), true);
    assert.equal(hasModeratorRole(['admin']), true);
  });

  it('rejects users without an admin role', () => {
    assert.equal(hasModeratorRole(['User']), false);
    assert.equal(hasModeratorRole(['Content Creator']), false);
    assert.equal(hasModeratorRole([]), false);
  });
});
