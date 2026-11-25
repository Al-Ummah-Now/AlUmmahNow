/**
 * Transcode troubleshooting panel (videos admin → Delivery): which actions each job state offers,
 * words for every state, reason and Cloudflare problem in en and ar, the logs filter check, the
 * no-token note and the new admin job kinds.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN_JOB_KINDS, TRANSCODE_REASONS, TROUBLESHOOT_STATES, TROUBLESHOOT_TOKEN_CHECKS, type TroubleshootJob, type TroubleshootStatus } from '@al-ummah/shared-types';
import en from '../src/i18n/messages/en';
import ar from '../src/i18n/messages/ar';
import { API_ERROR_LABEL, REASON_LABEL, SOURCE_VERDICT_LABEL, STATE_LABEL, filterProblem, jobActions, orderJobs, sourceLines, statusNote } from '../src/app/(protected)/delivery/troubleshoot-view';
import { JOB_KIND_LABEL } from '../src/lib/admin-jobs';
import { JOB_STATUS_LABEL } from '../src/app/(protected)/delivery/metrics';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- walks the message tree by key
const lookup = (messages: unknown, key: string) => key.split('.').reduce<any>((node, part) => node?.[part], messages);

const status = (over: Partial<TroubleshootStatus> = {}): TroubleshootStatus => ({ at: '2026-11-15T12:00:00Z', token: 'ok', containers: null, queues: null, waiting: null, ...over });
const job = (videoId: string, state: TroubleshootJob['state'] = 'queued'): TroubleshootJob => ({
  videoId, jobId: `job-${videoId}`, title: null, state, attempt: 1, maxAttempts: 8, queuedAt: null, startedAt: null, nextRetryAt: null, lastSeenAt: null, progress: null, reason: null, error: null, source: null, instance: null,
});

describe('job actions', () => {
  it('Retry now on everything not transcoding; Cancel on everything still going', () => {
    assert.deepEqual(jobActions({ state: 'queued' }), { retry: true, cancel: true });
    assert.deepEqual(jobActions({ state: 'start_retry' }), { retry: true, cancel: true });
    assert.deepEqual(jobActions({ state: 'waiting_retry' }), { retry: true, cancel: true });
    assert.deepEqual(jobActions({ state: 'running' }), { retry: false, cancel: true });
    assert.deepEqual(jobActions({ state: 'failed' }), { retry: true, cancel: false });
    assert.deepEqual(jobActions({ state: 'cancelled' }), { retry: true, cancel: false });
  });

  it('puts the focused video first and keeps the rest in order', () => {
    const items = [job('aaaaaaaa'), job('bbbbbbbb'), job('cccccccc')];
    assert.deepEqual(orderJobs(items, 'bbbbbbbb').map((j) => j.videoId), ['bbbbbbbb', 'aaaaaaaa', 'cccccccc']);
    assert.equal(orderJobs(items, null), items);
  });
});

describe('logs filter', () => {
  it('accepts empty, video ids and job ids only', () => {
    assert.equal(filterProblem(''), false);
    assert.equal(filterProblem('912859ed-e618-4d04-8438-874a74a251dd'), false);
    assert.equal(filterProblem('short'), true);
    assert.equal(filterProblem('$workers.scriptName'), true);
    assert.equal(filterProblem('a b c d e f g h'), true);
  });
});

describe('status note', () => {
  it('says why Cloudflare details are missing', () => {
    assert.equal(statusNote(status({ token: 'missing' })), 'transcodeTroubleshoot.noToken');
    assert.equal(statusNote(status({ token: 'unreadable' })), 'transcodeTroubleshoot.unreadableToken');
    assert.equal(statusNote(status()), 'transcodeTroubleshoot.notHere');
    assert.equal(statusNote(status({ containers: { ok: false, error: 'forbidden' } })), null);
  });
});

describe('what the file is', () => {
  const source = { bytes: 13_654_915, container: 'mp4', zeroStartPercent: 1.2, zeroEndPercent: 0, format: 'mov,mp4', streams: [{ kind: 'audio', codec: 'aac' }, { kind: 'cover', codec: 'mjpeg' }], durationSeconds: 812 } as const;
  const words = (messages: unknown) => ((key: string, params: Record<string, string> = {}) => String(lookup(messages, key)).replace(/\{(\w+)\}/g, (_m, k) => params[k] ?? '')) as never;

  it('says it in plain words, with size, length, streams and empty bytes', () => {
    const out = sourceLines({ ...source, streams: [...source.streams] }, words(en), 'en');
    assert.equal(out.verdict, 'The file has sound only, no picture.');
    assert.deepEqual(out.details.slice(2), ['Sound: \u2068aac\u2069', 'Cover image: \u2068mjpeg\u2069', 'Empty bytes: 1.2% of the first MB, 0% of the last MB']);
  });

  it('in Arabic with Arabic digits and words', () => {
    const out = sourceLines({ ...source, streams: [], zeroEndPercent: 100 }, words(ar), 'ar');
    assert.equal(out.verdict, ar.transcodeTroubleshoot.source.halfWritten);
    assert.match(out.details.join(' '), /[٠-٩]/);
    assert.doesNotMatch(out.details.join(' '), /[0-9]/);
  });
});

describe('strings', () => {
  const keys = [
    ...TROUBLESHOOT_STATES.map((s) => STATE_LABEL[s]),
    ...TRANSCODE_REASONS.map((r) => REASON_LABEL[r]),
    ...Object.values(API_ERROR_LABEL),
    ...Object.values(SOURCE_VERDICT_LABEL),
    ...TROUBLESHOOT_TOKEN_CHECKS.map((c) => `transcodeTroubleshoot.checks.${c}`),
    JOB_KIND_LABEL['media.transcode-retry'],
    JOB_KIND_LABEL['media.transcode-cancel'],
    JOB_STATUS_LABEL.cancelled,
  ];

  it('every state, reason, problem and check has words in en and ar', () => {
    for (const key of keys) {
      assert.equal(typeof lookup(en, key), 'string', `en ${key}`);
      assert.equal(typeof lookup(ar, key), 'string', `ar ${key}`);
    }
  });

  it('every admin job kind has a label', () => {
    for (const kind of ADMIN_JOB_KINDS) assert.ok(JOB_KIND_LABEL[kind], kind);
  });

  it('Arabic says «مرئي», never فيديو', () => {
    const arText = JSON.stringify(ar.transcodeTroubleshoot);
    assert.doesNotMatch(arText, /فيديو/);
    assert.match(arText, /مرئي/);
  });

  it('the no-token note says so in plain words and names who can fix it', () => {
    assert.match(en.transcodeTroubleshoot.noToken, /No Cloudflare token is set/);
    assert.match(en.transcodeTroubleshoot.noToken, /super admin/);
  });
});

describe('container states and log levels in words (approved-design check 2026-11-15)', () => {
  it('every container state and log level has en and ar words, the Arabic ones in Arabic', () => {
    for (const group of ['instanceStates', 'logLevels'] as const) {
      const keys = Object.keys(lookup(en, `transcodeTroubleshoot.${group}`));
      assert.deepEqual(Object.keys(lookup(ar, `transcodeTroubleshoot.${group}`)), keys, group);
      for (const k of keys) assert.match(lookup(ar, `transcodeTroubleshoot.${group}.${k}`), /[؀-ۿ]/, `${group}.${k}`);
    }
    for (const state of ['running', 'stopped']) assert.ok(lookup(en, `transcodeTroubleshoot.instanceStates.${state}`), state);
    assert.ok(lookup(en, 'transcodeTroubleshoot.logLevels.warn'));
  });
});
