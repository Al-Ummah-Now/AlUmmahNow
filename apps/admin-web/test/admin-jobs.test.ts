/**
 * Admin jobs on the Errors page and the Restore legacy profile fields page:
 * a label for every job kind and status in both languages, and the role gate.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN_JOB_KINDS, ADMIN_JOB_STATUSES, ROLE_CONTENT_PERMISSIONS } from '@al-ummah/shared-types';
import en from '../src/i18n/messages/en';
import ar from '../src/i18n/messages/ar';
import { createTranslator } from '../src/i18n/translate';
import { JOB_KIND_LABEL, JOB_STATUS_LABEL, isJobActive } from '../src/lib/admin-jobs';
import { canManageVideosUsers } from '../src/lib/roles';

const ARABIC = /[؀-ۿ]/;

describe('admin jobs', () => {
  it('every job kind and status has a label in English and Arabic', () => {
    const tEn = createTranslator('en');
    const tAr = createTranslator('ar');
    for (const kind of ADMIN_JOB_KINDS) {
      const key = JOB_KIND_LABEL[kind];
      assert.ok(key, `${kind} has no label`);
      assert.notEqual(tEn(key), key, `${kind} missing in English`);
      assert.match(tAr(key), ARABIC, `${kind} missing in Arabic`);
    }
    for (const status of ADMIN_JOB_STATUSES) {
      assert.notEqual(tEn(JOB_STATUS_LABEL[status]), JOB_STATUS_LABEL[status]);
      assert.match(tAr(JOB_STATUS_LABEL[status]), ARABIC);
    }
  });

  it('every legacy profiles and admin jobs string exists in both languages, with the same placeholders', () => {
    for (const group of ['legacyProfiles', 'adminJobs'] as const) {
      for (const [key, value] of Object.entries(en[group])) {
        if (typeof value !== 'string') continue;
        const arabic = (ar[group] as Record<string, unknown>)[key];
        assert.equal(typeof arabic, 'string', `${group}.${key} missing in Arabic`);
        const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
        assert.deepEqual(placeholders(arabic as string), placeholders(value), `${group}.${key} placeholders`);
      }
    }
  });

  it('only a job still going keeps the page refreshing', () => {
    assert.deepEqual(ADMIN_JOB_STATUSES.filter(isJobActive), ['queued', 'running', 'retrying']);
  });

  it('the Legacy profiles page follows users:manage (admins and super admins, not moderators)', () => {
    for (const role of ['super_admin', 'admin', 'moderator', 'user', undefined]) {
      const granted = !!role && (ROLE_CONTENT_PERMISSIONS[role] ?? []).includes('users:manage');
      assert.equal(canManageVideosUsers(role), granted, String(role));
    }
  });
});
