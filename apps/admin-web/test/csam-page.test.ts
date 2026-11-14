/**
 * CSAM cases in the admin (docs/specs/CSAM-RESPONSE.md): super admins only in the nav, the
 * CyberTipline checklist's pre-filled fields, evidence downloads (attachment only, a refused one
 * goes through a fresh sign-in), the case actions and the en/ar copy. Synthetic values only.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CSAM_ACCESS_ACTIONS, CSAM_CASE_STATUSES, CSAM_ITEM_KINDS, NCMEC_CYBERTIPLINE_URL, type CsamReportFacts } from '@al-ummah/shared-types';
import {
  CSAM_FACT_IDS,
  caseActions,
  csamDownloadHref,
  csamDownloadRedirect,
  csamEvidenceHeaders,
  csamFactRows,
  csamFactsText,
  isCsamEvidenceName,
  needsReport,
  sortCases,
  logDetailText,
  retentionLabelKey,
  utcTime,
  validReportId,
} from '../src/app/(protected)/moderation/csam/model';
import { visibleItems, type NavAccess } from '../src/components/shell/nav-model';
import en from '../src/i18n/messages/en';
import ar from '../src/i18n/messages/ar';

const access = (superAdmin: boolean): NavAccess => ({ contact: true, processing: true, errors: true, manageUsers: true, staleUploads: true, media: true, ops: true, superAdmin });

const FACTS: CsamReportFacts = {
  matchedUrl: 'https://media.alummahnow.net/pub/vid-synth-01/r1/thumb.jpg',
  detectedAt: '2026-11-14T03:00:00.000Z',
  incidentTimeZone: 'UTC',
  itemKind: 'video_thumbnail',
  itemId: 'vid-synth-01',
  uploadedAt: '2026-11-13T22:00:00.000Z',
  uploader: { userId: 'usr-synth-01', email: 'synthetic@example.invalid', displayName: 'Synthetic', handle: 'synthetic', channelId: 'chan-synth-01', channelName: '', ipAddress: null },
  evidenceFiles: [
    { name: '01-matched-image.jpg', bytes: 10, contentType: 'image/jpeg' },
    { name: 'record-video.json', bytes: 20, contentType: 'application/json' },
  ],
};

describe('CSAM nav', () => {
  it('shows CSAM cases to super admins only, in Moderation', () => {
    const item = visibleItems(access(true)).find((i) => i.href === '/moderation/csam');
    assert.equal(item?.group, 'moderation');
    assert.equal(visibleItems(access(false)).some((i) => i.href === '/moderation/csam'), false);
    assert.equal(visibleItems({ ...access(true), superAdmin: undefined }).some((i) => i.href === '/moderation/csam'), false);
  });
});

describe('CyberTipline checklist', () => {
  it('pre-fills every report field from the record, and leaves the IP address to the reporter', () => {
    const rows = csamFactRows(FACTS, (k) => `kind:${k}`);
    assert.deepEqual(rows.map((r) => r.id), [...CSAM_FACT_IDS]);
    const value = (id: string) => rows.find((r) => r.id === id)!.value;
    assert.equal(value('matchedUrl'), FACTS.matchedUrl);
    // Times as the form takes them, in UTC (the time zone field)
    assert.equal(value('incidentAt'), '2026-11-14 03:00:00');
    assert.equal(value('uploadedAt'), '2026-11-13 22:00:00');
    assert.equal(value('timeZone'), 'UTC');
    assert.equal(value('itemKind'), 'kind:video_thumbnail');
    assert.equal(value('email'), 'synthetic@example.invalid');
    assert.equal(value('files'), '01-matched-image.jpg, record-video.json');
    assert.equal(value('ipAddress'), null);
    // Blank values count as unknown
    assert.equal(value('channelName'), null);
    assert.equal(rows.find((r) => r.id === 'matchedUrl')!.ltr, true);
    assert.equal(rows.find((r) => r.id === 'displayName')!.ltr, false);
  });

  it('"Copy all" lists the filled fields with their labels', () => {
    const text = csamFactsText(csamFactRows(FACTS, (k) => k), (id) => `L-${id}`);
    assert.ok(text.startsWith('L-incidentAt: 2026-11-14 03:00:00\n'));
    assert.ok(text.includes(`L-matchedUrl: ${FACTS.matchedUrl}`));
    assert.equal(text.includes('L-ipAddress'), false);
  });

  it('links the CyberTipline and accepts report numbers the way admin-api does', () => {
    assert.equal(NCMEC_CYBERTIPLINE_URL, 'https://report.cybertip.org/reporting');
    assert.equal(validReportId('SYNTH-0001'), true);
    assert.equal(validReportId(' 12345 '), true);
    assert.equal(validReportId('ab'), false);
    assert.equal(validReportId('has space'), false);
    assert.equal(validReportId('x'.repeat(65)), false);
  });
});

describe('evidence downloads', () => {
  it('accepts only evidence file names', () => {
    assert.equal(isCsamEvidenceName('01-matched-image.jpg'), true);
    assert.equal(isCsamEvidenceName('record-video.json'), true);
    for (const bad of ['', '../manifest.bin', '.hidden', 'a/b', 'a..b', 'x'.repeat(121)]) assert.equal(isCsamEvidenceName(bad), false, bad);
  });

  it('downloads as an attachment that is never sniffed, framed or cached', () => {
    assert.equal(csamDownloadHref('case-synth-01', '01-matched-image.jpg'), '/api/csam/case-synth-01/files/01-matched-image.jpg');
    const h = csamEvidenceHeaders('01-matched-image.jpg', '10');
    assert.equal(h.get('content-type'), 'application/octet-stream');
    assert.equal(h.get('content-disposition'), 'attachment; filename="01-matched-image.jpg"');
    assert.equal(h.get('x-content-type-options'), 'nosniff');
    assert.equal(h.get('cache-control'), 'private, no-store');
    assert.ok(h.get('content-security-policy')!.includes('sandbox'));
    assert.equal(h.get('content-length'), '10');
    assert.equal(csamEvidenceHeaders('a.jpg', 'abc').get('content-length'), null);
  });

  it('a refused download goes through a fresh sign-in (or the passkey page) and back to the case', () => {
    const step = csamDownloadRedirect(401, 'step_up_required', '/moderation/csam/case-synth-01');
    assert.ok(step?.startsWith('/login?'));
    assert.ok(step!.includes(encodeURIComponent('/moderation/csam/case-synth-01')));
    assert.ok(step!.includes('prompt=login'));
    assert.ok(csamDownloadRedirect(403, 'passkey_required', '/moderation/csam/case-synth-01')?.startsWith('/passkey-needed?'));
    assert.equal(csamDownloadRedirect(403, 'forbidden', '/moderation/csam/case-synth-01'), null);
    assert.equal(csamDownloadRedirect(404, 'evidence_deleted', '/moderation/csam/case-synth-01'), null);
  });
});

describe('case list and actions', () => {
  it('lists what needs a person first, then newest', () => {
    const c = (id: string, status: (typeof CSAM_CASE_STATUSES)[number], detectedAt: string) => ({ id, status, detectedAt });
    const sorted = sortCases([
      c('closed', 'closed', '2026-11-14T05:00:00Z'),
      c('reported', 'reported', '2026-11-14T04:00:00Z'),
      c('contained-old', 'contained', '2026-11-13T00:00:00Z'),
      c('contained-new', 'contained', '2026-11-14T01:00:00Z'),
      c('unmapped', 'unmapped', '2026-11-12T00:00:00Z'),
    ]);
    assert.deepEqual(sorted.map((x) => x.id), ['unmapped', 'contained-new', 'contained-old', 'reported', 'closed']);
    assert.equal(needsReport('contained'), true);
    assert.equal(needsReport('reported'), false);
    assert.equal(needsReport('unmapped'), false);
  });

  it('offers mapping, retry, the report and the hold only when they apply', () => {
    assert.deepEqual(caseActions({ status: 'unmapped', evidenceDeletedAt: null, reportedAt: null }), { map: true, retry: false, report: false, reportTimeFixed: false, hold: true, download: true });
    assert.equal(caseActions({ status: 'containment_failed', evidenceDeletedAt: null, reportedAt: null }).retry, true);
    const reported = caseActions({ status: 'reported', evidenceDeletedAt: null, reportedAt: '2026-11-14T04:00:00Z' });
    assert.equal(reported.report, true);
    assert.equal(reported.reportTimeFixed, true);
    const deleted = caseActions({ status: 'closed', evidenceDeletedAt: '2027-11-14T04:00:00Z', reportedAt: '2026-11-14T04:00:00Z' });
    assert.deepEqual([deleted.report, deleted.hold, deleted.download], [false, false, false]);
  });
});

describe('readable values', () => {
  it('says when evidence goes: a date, deleted, kept under a hold, or not until the report', () => {
    assert.equal(retentionLabelKey({ evidenceDeletedAt: null, retainUntil: '2027-11-14T00:00:00Z', legalHold: false }), 'date');
    assert.equal(retentionLabelKey({ evidenceDeletedAt: null, retainUntil: null, legalHold: true }), 'hold');
    assert.equal(retentionLabelKey({ evidenceDeletedAt: null, retainUntil: null, legalHold: false }), 'untilReported');
    assert.equal(retentionLabelKey({ evidenceDeletedAt: '2027-11-14T00:00:00Z', retainUntil: null, legalHold: true }), 'deleted');
  });

  it('writes log details and report times for people, not as JSON', () => {
    assert.equal(logDetailText({ retentionDays: { from: 365, to: 730 } }), 'retentionDays: 365 → 730');
    assert.equal(logDetailText({ name: '01-matched-image.jpg', ban: 'banned' }), 'name: 01-matched-image.jpg · ban: banned');
    assert.equal(logDetailText(null), null);
    assert.equal(logDetailText({}), null);
    assert.equal(utcTime('2026-11-14T04:05:06.789Z'), '2026-11-14 04:05:06');
    assert.equal(utcTime('not a time'), 'not a time');
  });
});

describe('CSAM copy', () => {
  it('labels every status, kind, fact, job state and log action in both languages', () => {
    for (const m of [en, ar]) {
      for (const s of CSAM_CASE_STATUSES) assert.ok(m.csamPage.statuses[s], s);
      for (const k of CSAM_ITEM_KINDS) assert.ok(m.csamPage.kinds[k], k);
      for (const f of CSAM_FACT_IDS) assert.ok(m.csamPage.facts[f], f);
      for (const a of CSAM_ACCESS_ACTIONS) assert.ok(m.csamPage.log.actions[a.replace(/\./g, '_') as keyof typeof m.csamPage.log.actions], a);
      for (const j of ['queued', 'running', 'retrying', 'succeeded', 'failed'] as const) assert.ok(m.csamPage.job.statuses[j], j);
      // The takedown job's steps (api-videos lib/csam/contain.ts CONTAIN_PHASES, '-' as '_')
      for (const ph of ['plan', 'copy_public', 'purge_public', 'copy_source', 'purge', 'ban'] as const) assert.ok(m.csamPage.job.phases[ph], ph);
      assert.ok(m.nav.csam);
    }
  });

  it('says مرئي for video in Arabic, never فيديو', () => {
    assert.equal(JSON.stringify(ar.csamPage).includes('فيديو'), false);
    assert.equal(ar.csamPage.kinds.video, 'مرئي');
  });

  it('explains every CSAM error code admin-api returns', () => {
    for (const code of ['text_required', 'already_mapped', 'not_mapped', 'invalid_report_id', 'invalid_reported_at', 'reported_at_fixed', 'reason_required', 'invalid_retention', 'evidence_deleted', 'invalid_resolution', 'closed'] as const) {
      assert.ok(en.content.errors[code] && ar.content.errors[code], code);
    }
  });
});
