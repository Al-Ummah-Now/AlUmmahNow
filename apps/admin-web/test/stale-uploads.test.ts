/**
 * Stale uploads page: who sees it, filters, Bunny status words, ages,
 * which actions apply, and en/ar strings.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canUseStaleUploads } from '../src/lib/roles';
import { actionsFor, bunnyLabel, formatAge, parseStaleFilter, statusQuery } from '../src/app/(protected)/stale-uploads/labels';
import { createTranslator } from '../src/i18n/translate';
import en from '../src/i18n/messages/en';
import ar from '../src/i18n/messages/ar';
import type { StaleUploadItem } from '../src/lib/api/types';

const ARABIC = /[؀-ۿ]/;
const t = createTranslator('en');

const item = (over: Partial<StaleUploadItem> = {}): StaleUploadItem => ({
  videoId: 'v1',
  target: 'abandoned',
  status: 'would_delete',
  checks: 2,
  firstSeenAt: '2026-11-10T00:00:00.000Z',
  updatedAt: '2026-11-10T00:00:00.000Z',
  ...over,
});

describe('stale uploads access (mirrors admin-api videos:uploads)', () => {
  it('is for admins and super admins, not moderators', () => {
    assert.equal(canUseStaleUploads('admin'), true);
    assert.equal(canUseStaleUploads('Super Admin'), true);
    assert.equal(canUseStaleUploads('moderator'), false);
    assert.equal(canUseStaleUploads(undefined), false);
  });
});

describe('stale uploads labels', () => {
  it('filters: unknown values fall back to "needs a decision"; all sends no status', () => {
    assert.equal(parseStaleFilter('failed'), 'failed');
    assert.equal(parseStaleFilter('drop table'), 'open');
    assert.equal(parseStaleFilter(undefined), 'open');
    assert.equal(statusQuery('all'), undefined);
    assert.equal(statusQuery('open'), 'open');
  });

  it('Bunny status in words', () => {
    assert.equal(bunnyLabel(t, null), 'Not at Bunny');
    assert.equal(bunnyLabel(t, { status: 0 }), 'Created, no bytes');
    assert.equal(bunnyLabel(t, { status: 6 }), 'Upload failed');
    assert.equal(bunnyLabel(t, { status: 4 }), 'Ready');
    assert.equal(bunnyLabel(t, { status: 8 }), 'Ready (status 8)');
  });

  it('age', () => {
    const now = Date.parse('2026-11-10T12:00:00.000Z');
    assert.equal(formatAge(t, '2026-11-10T11:20:00.000Z', now), '40 min');
    assert.equal(formatAge(t, '2026-11-09T10:00:00.000Z', now), '26 h');
    assert.equal(formatAge(t, '2026-11-01T12:00:00.000Z', now), '9 d');
    assert.equal(formatAge(t, undefined, now), '—');
  });

  it('actions per state', () => {
    assert.deepEqual(actionsFor(item()), { delete: true, keep: true, retry: true });
    assert.deepEqual(actionsFor(item({ status: 'deleted' })), { delete: false, keep: false, retry: false });
    assert.deepEqual(actionsFor(item({ status: 'checking' })), { delete: false, keep: true, retry: false });
    assert.deepEqual(actionsFor(item({ status: 'failed' })), { delete: true, keep: true, retry: true });
    assert.deepEqual(actionsFor(item({ status: 'kept' })), { delete: true, keep: false, retry: true });
  });

  it('every string exists in English and Arabic, and the Arabic is Arabic', () => {
    assert.equal(en.nav.staleUploads, 'Stale uploads');
    assert.match(ar.nav.staleUploads, ARABIC);
    for (const key of Object.keys(en.staleUploads) as (keyof typeof en.staleUploads)[]) {
      assert.ok(ar.staleUploads[key], `ar.staleUploads.${key}`);
      if (/[a-z]{3}/i.test(en.staleUploads[key].replace(/\{[^}]+\}|Bunny/g, ''))) assert.match(ar.staleUploads[key], ARABIC, `ar.staleUploads.${key}`);
    }
  });
});
