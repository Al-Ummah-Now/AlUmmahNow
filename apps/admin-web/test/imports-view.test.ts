/**
 * The Imports view and the Jobs page additions (wiki TOOLS-ADMIN TA-8): times in the admin's zone with
 * the zone shown and UTC for the tooltip, waits in words, job errors in plain words, log lines, the nav
 * gate, Retry/Cancel by status, and every new string in both languages with the same placeholders.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN_JOB_LOG_EVENTS, CAPTION_JOB_ERRORS, IMPORT_CAPTION_STATES, IMPORT_ITEM_STATES, IMPORT_SIDECAR_PARTS } from '@al-ummah/shared-types';
import en from '../src/i18n/messages/en';
import ar from '../src/i18n/messages/ar';
import { createTranslator, type MessageKey } from '../src/i18n/translate';
import { formatDuration, formatLocalTime, zoneLabel } from '../src/lib/local-time';
import { canCancelStatus, canRetryStatus, jobErrorWords, jobTone, logLineKey } from '../src/components/content/job-helpers';
import { visibleItems, type NavAccess } from '../src/components/shell/nav-model';
import { canManageImports } from '../src/lib/roles';

const ARABIC = /[؀-ۿ]/;
const LATIN_DIGIT = /[0-9]/;
const AT = '2026-11-22T19:20:00.000Z';

describe('times in the admin (local zone, UTC on hover)', () => {
  it('shows the zone\'s short name at that moment, as Intl writes it in each language', () => {
    assert.equal(zoneLabel(new Date(AT), 'America/New_York', 'en'), 'EST');
    assert.equal(zoneLabel(new Date('2026-07-01T12:00:00Z'), 'America/New_York', 'en'), 'EDT', 'summer time');
    assert.equal(zoneLabel(new Date(AT), 'Asia/Kolkata', 'en'), 'GMT+5:30');
    assert.equal(zoneLabel(new Date(AT), 'UTC', 'en'), 'UTC');
    assert.equal(zoneLabel(new Date(AT), 'Asia/Riyadh', 'ar'), 'غرينتش+٣');
    assert.equal(zoneLabel(new Date(AT), 'America/New_York', 'ar'), 'غرينتش-٥', 'Intl writes a hyphen');
    assert.equal(zoneLabel(new Date(AT), 'UTC', 'ar'), 'UTC');
  });

  it('formats the time in the zone with its label, and the same moment in UTC', () => {
    const en1 = formatLocalTime(AT, 'en', 'America/New_York')!;
    assert.match(en1.text, /Nov\s22,\s2026.*2:20\sPM\sEST$/);
    assert.match(en1.utc, /7:20\sPM\sUTC$/);
    assert.match(formatLocalTime(AT, 'en', 'America/New_York', { date: false })!.text, /^2:20\sPM\sEST$/);
    // Logs: steps seconds apart stay apart
    assert.match(formatLocalTime(AT, 'en', 'America/New_York', { seconds: true })!.text, /2:20:\d\d\sPM\sEST$/);
    assert.match(formatLocalTime(AT, 'ar', 'Asia/Riyadh', { seconds: true })!.text, /١٠:٢٠:[٠-٩]{2}/);
    const ar1 = formatLocalTime(AT, 'ar', 'Asia/Riyadh')!;
    assert.match(ar1.text, /١٠:٢٠/);
    assert.ok(ar1.text.endsWith('غرينتش+٣'));
    assert.doesNotMatch(ar1.text, LATIN_DIGIT, 'Arabic digits only');
    assert.equal(formatLocalTime('not a date', 'en', 'UTC'), null);
  });

  it('breaks only between the date and the time: the date, the time and its zone stay whole', () => {
    const spaces = (s: string) => [...s].filter((c) => /\s/.test(c) && c !== '\u00A0').length;
    assert.equal(spaces(formatLocalTime(AT, 'en', 'America/New_York')!.text), 1);
    assert.equal(spaces(formatLocalTime(AT, 'ar', 'America/New_York')!.text), 1);
    assert.equal(spaces(formatLocalTime(AT, 'en', 'America/New_York', { date: false })!.text), 0);
  });

  it('says a wait in words, rounded down', () => {
    const plain = (text: string) => text.replace(/\u00A0/g, ' ');
    assert.equal(formatDuration(80, 'en'), '1\u00A0minute 20\u00A0seconds', 'each number stays with its unit; the break is between them');
    assert.equal(plain(formatDuration(10, 'en')), '10 seconds');
    assert.equal(plain(formatDuration(300, 'en')), '5 minutes');
    assert.equal(plain(formatDuration(43200, 'en')), '12 hours');
    assert.equal(plain(formatDuration(90, 'en')), '1 minute 30 seconds');
    assert.equal(plain(formatDuration(80, 'en')), '1 minute 20 seconds', 'a retry wait is never understated');
    assert.equal(plain(formatDuration(160, 'en')), '2 minutes 40 seconds');
    assert.equal(plain(formatDuration(7500, 'en')), '2 hours 5 minutes');
    assert.match(formatDuration(80, 'ar'), / و/);
    assert.match(formatDuration(300, 'ar'), /^٥\u00A0/, 'the number stays with its unit');
    assert.doesNotMatch(formatDuration(43200, 'ar'), LATIN_DIGIT);
  });
});

describe('jobs on the Jobs page', () => {
  it('puts each kind of stored error in plain words', () => {
    const cases: Array<[string, string]> = [
      ['Could not queue the job: Queue send failed', 'queue'],
      ['No handler for search.reconcile', 'noHandler'],
      ['SEARCH_DB is not bound', 'binding'],
      ['Bunny Stream delete failed: 500', 'bunny'],
      ['The operation timed out', 'timeout'],
      ['R2 put failed', 'storage'],
      ['D1_ERROR: UNIQUE constraint failed', 'database'],
      ['Video v1 not found', 'notFound'],
      ['fetch failed', 'service'],
      ['403 Forbidden', 'denied'],
      ['hidden', 'hidden'],
      ['Something odd', 'other'],
    ];
    for (const [error, word] of cases) assert.equal(jobErrorWords(error), `jobs.errorWords.${word}`, error);
  });

  it('names every log event, and Retry queues "again"', () => {
    for (const event of ADMIN_JOB_LOG_EVENTS) assert.ok(en.jobs.log[logLineKey({ event }).split('.').pop() as keyof typeof en.jobs.log], event);
    assert.equal(logLineKey({ event: 'queued', retried: true }), 'jobs.log.retried');
    const t = createTranslator('ar');
    assert.equal(t('jobs.log.failed_attempt', { attempt: '٢', wait: '٢٠ ثانية' }), 'فشلت المحاولة ٢، وتُعاد بعد ٢٠ ثانية');
  });

  it('offers Retry on failed and cancelled jobs, Cancel on unfinished ones', () => {
    assert.deepEqual(['queued', 'running', 'retrying', 'succeeded', 'failed', 'cancelled'].map((status) => [canRetryStatus({ status } as never), canCancelStatus({ status, kind: 'channel.purge' } as never)]), [
      [false, true],
      [false, true],
      [false, true],
      [false, false],
      [true, false],
      [true, false],
    ]);
    assert.equal(jobTone('cancelled'), 'neutral');
    // A data erasure runs to the end: no Cancel
    assert.equal(canCancelStatus({ status: 'queued', kind: 'user.delete-data' }), false);
    assert.equal(canCancelStatus({ status: 'running', kind: 'user.erase-run' }), false);
  });
});

describe('the Imports view', () => {
  const access = (imports: boolean): NavAccess => ({ contact: true, processing: true, errors: true, manageUsers: true, staleUploads: true, media: true, ops: true, imports });

  it('is in the nav for admins and super admins only (imports:manage)', () => {
    assert.ok(visibleItems(access(true)).some((i) => i.href === '/imports'));
    assert.ok(!visibleItems(access(false)).some((i) => i.href === '/imports'));
    assert.deepEqual(['admin', 'super_admin', 'moderator', 'content_reviewer', undefined].map((r) => canManageImports(r)), [true, true, false, false, false]);
  });

  it('labels every file state, sidecar part, caption state and caption error in both languages', () => {
    const keys: string[] = [
      ...IMPORT_ITEM_STATES.flatMap((s) => [`imports.states.${s}`, `imports.counts.${s}`]),
      ...IMPORT_SIDECAR_PARTS.map((p) => `imports.parts.${p}`),
      ...IMPORT_CAPTION_STATES.map((s) => `imports.captionStates.${s}`),
      ...CAPTION_JOB_ERRORS.map((e) => `imports.captionErrors.${e}`),
      'jobs.statuses.cancelled',
      'adminJobs.statuses.cancelled',
      'nav.imports',
    ];
    const tEn = createTranslator('en');
    const tAr = createTranslator('ar');
    for (const key of keys) {
      assert.notEqual(tEn(key as MessageKey), key, `${key} in English`);
      assert.match(tAr(key as MessageKey), ARABIC, `${key} in Arabic`);
    }
  });

  it('has every new string in Arabic with the same placeholders, and Arabic never says فيديو', () => {
    const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const walk = (a: unknown, b: unknown, path: string) => {
      if (typeof a === 'string') {
        assert.equal(typeof b, 'string', `${path} missing in Arabic`);
        assert.deepEqual(placeholders(b as string), placeholders(a), `${path} placeholders`);
        assert.doesNotMatch(b as string, /فيديو/, `${path} says فيديو`);
        return;
      }
      for (const [k, v] of Object.entries(a as Record<string, unknown>)) walk(v, (b as Record<string, unknown>)?.[k], `${path}.${k}`);
    };
    walk(en.imports, ar.imports, 'imports');
    walk(en.jobs, ar.jobs, 'jobs');
  });
});
