/** Profile emails page (super admins): which check a repair may follow, the report pages and the nav item. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AdminJob, ProfileEmailsResult } from '@al-ummah/shared-types';
import { repairableCheck, reportPages } from '../src/app/(protected)/profile-emails/model';
import { jobTargetHref } from '../src/components/content/job-helpers';
import { NAV_ITEMS } from '../src/components/shell/nav-model';

const NOW = Date.parse('2026-11-24T12:00:00.000Z');
const result = (over: Partial<ProfileEmailsResult> = {}) => ({ mode: 'check', scanned: 10, matching: 5, differs: 2, missing: 1, channels: 2, noAccount: 2, unreadable: 0, profilesWritten: 0, channelsWritten: 0, reportPages: [0, 3], ...over });
const job = (over: Partial<AdminJob> = {}): AdminJob =>
  ({ id: 'j1', kind: 'profiles.repair-emails', targetKind: 'user', targetId: 'profile-emails', params: { mode: 'check' }, status: 'succeeded', attempts: 1, lastError: null, result: result() as never, actorId: 'a', createdAt: '', updatedAt: '', finishedAt: '2026-11-24T11:00:00.000Z', ...over }) as AdminJob;

describe('profile emails page', () => {
  it('offers a repair only after a recent finished check that found something', () => {
    assert.deepEqual(repairableCheck([job()], NOW), { id: 'j1', records: 5 });
    assert.equal(repairableCheck([], NOW), null);
    assert.equal(repairableCheck([job({ finishedAt: '2026-11-23T11:00:00.000Z' })], NOW), null, 'too old');
    assert.equal(repairableCheck([job({ result: result({ differs: 0, missing: 0, channels: 0 }) as never })], NOW), null, 'nothing to write');
    assert.equal(repairableCheck([job({ status: 'failed' })], NOW), null);
    assert.equal(repairableCheck([job({ id: 'r', params: { mode: 'repair' } }), job()], NOW), null, 'already repaired since');
    assert.deepEqual(repairableCheck([job({ id: 'f', status: 'failed' }), job()], NOW), { id: 'j1', records: 5 });
  });

  it('lists the report pages', () => {
    assert.deepEqual(reportPages(result() as ProfileEmailsResult), [0, 3]);
    assert.deepEqual(reportPages(null), []);
  });

  it('is in the nav for super admins only, and its jobs link to it', () => {
    const item = NAV_ITEMS.find((i) => i.href === '/profile-emails')!;
    const access = { contact: true, processing: true, errors: true, manageUsers: true, staleUploads: true, media: true, ops: true };
    assert.equal(item.requires!({ ...access, superAdmin: true }), true);
    assert.equal(item.requires!(access), false);
    assert.equal(jobTargetHref(job()), '/profile-emails');
  });
});
