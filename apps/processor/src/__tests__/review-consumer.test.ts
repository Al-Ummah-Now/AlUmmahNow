/**
 * Pre-publication review consumer (docs/specs/VIDEO-REVIEW.md §4) against the real reports D1
 * schema (admin-api migrations, node:sqlite) with the FIXTURE provider. Nothing here calls a model:
 * the Workers AI provider refuses to be built under test (asserted below).
 */
import { createLogger } from '@al-ummah/logger';
import { DEFAULT_VIDEO_REVIEW_SETTINGS, MessageType, normaliseVideoReviewSettings, type VideoReviewScanPayload } from '@al-ummah/shared-types';
import { handleVideoReviewAppeal, handleVideoReviewScan, type ReviewConsumerEnv } from '../review/consumer';
import { WorkersAiModerationProvider, assertRealAiAllowed } from '../review/provider';
import { createSqliteD1, REPORTS_MIGRATIONS_DIR } from './sqlite-d1';

const logger = createLogger('processor-test', { logLevel: 'error' });
const NOW = Date.parse('2026-11-13T12:00:00Z');
const MANIFEST = 'review/v1/rev1/manifest.json';

/** A media bucket with a manifest of `frames` frames every 2 s and one audio chunk. */
function media(frames = 30) {
  const store = new Map<string, { body: string; contentType: string }>();
  const manifest = {
    videoId: 'v1', rev: 'rev1', durationMs: frames * 2000, capped: false, createdAt: 'x',
    frames: Array.from({ length: frames }, (_, i) => ({ key: `review/v1/rev1/frames/${i * 2000}.jpg`, atMs: i * 2000, sceneCut: false })),
    audio: [{ key: 'review/v1/rev1/audio/0.mp3', startMs: 0, endMs: frames * 2000 }],
  };
  store.set(MANIFEST, { body: JSON.stringify(manifest), contentType: 'application/json' });
  for (const f of manifest.frames) store.set(f.key, { body: 'jpegbytes', contentType: 'image/jpeg' });
  store.set('review/v1/rev1/audio/0.mp3', { body: 'mp3bytes', contentType: 'audio/mpeg' });
  return {
    store,
    async get(key: string) {
      const o = store.get(key);
      if (!o) return null;
      return { text: async () => o.body, arrayBuffer: async () => new TextEncoder().encode(o.body).buffer as ArrayBuffer, httpMetadata: { contentType: o.contentType } };
    },
    async put(key: string, value: string) {
      store.set(key, { body: value, contentType: 'application/json' });
    },
  };
}

function setup(opts: { budgetUsd?: number; frames?: number; videosStatus?: number } = {}) {
  const db = createSqliteD1(REPORTS_MIGRATIONS_DIR);
  const outcomes: Array<{ url: string; body: any }> = [];
  const sent: any[] = [];
  const env: ReviewConsumerEnv = {
    REPORTS_DB: db,
    REVIEW_MEDIA: media(opts.frames),
    VIDEOS: {
      fetch: async (url: RequestInfo, init?: RequestInit) => {
        outcomes.push({ url: String(url), body: JSON.parse(String(init?.body)) });
        return new Response('{}', { status: opts.videosStatus ?? 200 });
      },
    },
    INTERNAL_API_KEY: 'k',
    MESSAGE_QUEUE: { send: async (m: unknown) => void sent.push(m) },
    REVIEW_PROVIDER: 'fixture',
    VIDEO_REVIEW_ALLOWED: 'true',
  };
  const settings = normaliseVideoReviewSettings({ ...DEFAULT_VIDEO_REVIEW_SETTINGS, mode: 'enforce', ...(opts.budgetUsd !== undefined ? { dailyBudgetUsd: opts.budgetUsd } : {}) });
  const payload = (title: string, extra: Partial<VideoReviewScanPayload> = {}): VideoReviewScanPayload => ({
    videoId: 'v1', reviewId: 'r1', channelId: 'ch1', ownerId: 'u1', timing: 'pre', mode: 'enforce',
    metadataText: title, manifestKey: MANIFEST, trigger: 'upload', settings, queuedAt: new Date(NOW).toISOString(), ...extra,
  });
  const row = () => db.raw.prepare('SELECT * FROM content_reviews WHERE id = ?').get('r1') as Record<string, any>;
  const findings = () => db.raw.prepare('SELECT * FROM content_review_findings ORDER BY score DESC').all() as Array<Record<string, any>>;
  return { db, env, outcomes, sent, payload, row, findings };
}

describe('the automated check', () => {
  it('clean: approved, the outcome reaches api-videos, media purge scheduled (VR12)', async () => {
    const t = setup();
    const r = await handleVideoReviewScan(t.payload('A talk [review-fixture:clean]'), t.env, logger, { lastAttempt: false, now: NOW });
    expect(r).toEqual({ status: 'done', route: 'approve' });
    expect(t.outcomes).toHaveLength(1);
    expect(t.outcomes[0].url).toContain('/internal/review/v1/outcome');
    expect(t.outcomes[0].body.routing.route).toBe('approve');
    const row = t.row();
    expect(row.status).toBe('approved');
    expect(row.media_purge_after).toBe('2026-12-13T12:00:00.000Z');
    expect(row.partial).toBe(0);
    expect(t.sent.filter((m) => m.type === MessageType.NotificationCreate)).toHaveLength(0);
  });

  it('an NSFW frame holds with its timestamp, and reviewers are alerted (VR2, VR6)', async () => {
    const t = setup();
    t.db.raw.prepare('INSERT INTO review_alert_subscribers (user_id, senior, created_at, updated_at) VALUES (?, ?, ?, ?)').run('rev1', 0, 'x', 'x');
    t.db.raw.prepare('INSERT INTO review_alert_subscribers (user_id, senior, created_at, updated_at) VALUES (?, ?, ?, ?)').run('owner', 1, 'x', 'x');
    const r = await handleVideoReviewScan(t.payload('Clip [review-fixture:nsfw_frame@42000]'), t.env, logger, { lastAttempt: false, now: NOW });
    expect(r.route).toBe('hold');
    const row = t.row();
    expect(row.status).toBe('in_review');
    expect(row.nsfw).toBe(1);
    expect(row.hold_cause).toBe('nsfw');
    expect(row.sla_due_at).toBeTruthy();
    expect(row.media_purge_after).toBeNull();
    const top = t.findings()[0];
    expect(top.source).toBe('frame');
    expect(top.category).toBe('sexual');
    expect(Math.abs(top.at_ms - 42000)).toBeLessThanOrEqual(2000);
    expect(top.media_key).toContain('/frames/');
    const alerts = t.sent.filter((m) => m.type === MessageType.NotificationCreate).map((m) => m.payload);
    expect(alerts.map((a) => a.recipientUserId).sort()).toEqual(['owner', 'rev1']);
    expect(alerts[0].notificationKey).toBe('reviewNeeded');
  });

  it('explicit Arabic speech holds as NSFW (explicit language counts)', async () => {
    const t = setup();
    const r = await handleVideoReviewScan(t.payload('درس [review-fixture:explicit_ar_transcript]'), t.env, logger, { lastAttempt: false, now: NOW });
    expect(r.route).toBe('hold');
    expect(t.row().nsfw).toBe(1);
    expect(t.findings().some((f) => f.source === 'transcript' && f.category === 'sexual_explicit_language' && typeof f.text === 'string')).toBe(true);
    // VR11: the transcript is kept for the creator's opt-in caption draft
    expect(t.env.REVIEW_MEDIA && (t.env.REVIEW_MEDIA as any).store.has('review/v1/rev1/transcript.json')).toBe(true);
  });

  it('high-risk metadata: held in enforce, approved in enforce_nsfw', async () => {
    const a = setup();
    expect((await handleVideoReviewScan(a.payload('Title [review-fixture:high_risk_metadata]'), a.env, logger, { lastAttempt: false, now: NOW })).route).toBe('hold');
    expect(a.row().hold_cause).toBe('risk');
    const b = setup();
    expect((await handleVideoReviewScan(b.payload('Title [review-fixture:high_risk_metadata]', { mode: 'enforce_nsfw' }), b.env, logger, { lastAttempt: false, now: NOW })).route).toBe('approve');
  });

  it('provider down: retried, then held as check_failed on the last attempt (never approved)', async () => {
    const t = setup();
    const first = await handleVideoReviewScan(t.payload('x [review-fixture:provider_down]'), t.env, logger, { lastAttempt: false, now: NOW });
    expect(first.status).toBe('retry');
    expect(t.outcomes).toHaveLength(0);
    const last = await handleVideoReviewScan(t.payload('x [review-fixture:provider_down]'), t.env, logger, { lastAttempt: true, now: NOW });
    expect(last.route).toBe('hold');
    expect(t.row().hold_cause).toBe('check_failed');
    expect(t.outcomes[0].body.routing.route).toBe('hold');
  });

  it('no review media: partial, held for a person', async () => {
    const t = setup();
    await handleVideoReviewScan(t.payload('clean title', { manifestKey: undefined }), t.env, logger, { lastAttempt: false, now: NOW });
    expect(t.row().partial).toBe(1);
    expect(t.row().hold_cause).toBe('check_failed');
  });

  it('a metadata edit checks text only and is never partial', async () => {
    const t = setup();
    const r = await handleVideoReviewScan(t.payload('new title', { trigger: 'metadata_edit' }), t.env, logger, { lastAttempt: false, now: NOW });
    expect(r.route).toBe('approve');
    expect(t.row().partial).toBe(0);
  });

  it('shadow: recorded as it would have been routed; api-videos never hears of it', async () => {
    const t = setup();
    const r = await handleVideoReviewScan(t.payload('Clip [review-fixture:nsfw_frame@4000]', { mode: 'shadow' }), t.env, logger, { lastAttempt: false, now: NOW });
    expect(r.route).toBe('hold');
    expect(t.row().status).toBe('shadow');
    expect(t.row().route).toBe('hold');
    expect(t.outcomes).toHaveLength(0);
    expect(t.sent).toHaveLength(0);
  });

  it('budget stop (VR14): held for a person without calling a model', async () => {
    const t = setup({ budgetUsd: 0 });
    // Spend something today so the reservation is refused at a $0 cap
    t.db.raw.prepare("INSERT INTO ai_budget_daily (day, feature, reserved) VALUES ('2026-11-13', 'video_review', 1)").run();
    const r = await handleVideoReviewScan(t.payload('clean'), t.env, logger, { lastAttempt: false, now: NOW });
    expect(r.route).toBe('hold');
    expect(t.row().hold_cause).toBe('budget');
  });

  it('a redelivered scan re-sends the stored outcome without checking again', async () => {
    const t = setup();
    await handleVideoReviewScan(t.payload('clean'), t.env, logger, { lastAttempt: false, now: NOW });
    const checkedAt = t.row().checked_at;
    await handleVideoReviewScan(t.payload('clean'), t.env, logger, { lastAttempt: false, now: NOW + 60_000 });
    expect(t.outcomes).toHaveLength(2);
    expect(t.row().checked_at).toBe(checkedAt);
  });

  it('api-videos unreachable: retried (the result is kept, the models are not called again)', async () => {
    const t = setup({ videosStatus: 503 });
    expect((await handleVideoReviewScan(t.payload('clean'), t.env, logger, { lastAttempt: false, now: NOW })).status).toBe('retry');
    expect(t.row().route).toBe('approve');
  });

  it('never runs where review is not allowed (QA, stage)', async () => {
    const t = setup();
    const r = await handleVideoReviewScan(t.payload('clean'), { ...t.env, VIDEO_REVIEW_ALLOWED: 'false', REVIEW_PROVIDER: undefined }, logger, { lastAttempt: false, now: NOW });
    expect(r).toEqual({ status: 'done' });
    expect(t.row()).toBeUndefined();
  });
});

describe('appeals', () => {
  it('opens an appeal row pointing at the rejected review', async () => {
    const t = setup();
    await handleVideoReviewScan(t.payload('Clip [review-fixture:nsfw_frame@42000]'), t.env, logger, { lastAttempt: false, now: NOW });
    await handleVideoReviewAppeal({ videoId: 'v1', reviewId: 'r1', appealReviewId: 'r2', ownerId: 'u1', message: 'It is a medical lecture', at: 'now' }, t.env, logger);
    const appeal = t.db.raw.prepare('SELECT * FROM content_reviews WHERE id = ?').get('r2') as Record<string, any>;
    expect(appeal.status).toBe('appealed');
    expect(appeal.appeal_of).toBe('r1');
    expect(appeal.appeal_message).toBe('It is a medical lecture');
  });
});

describe('no AI spend in tests', () => {
  it('the Workers AI provider refuses to be built under test, CI or E2E', () => {
    expect(() => new WorkersAiModerationProvider({ run: jest.fn() }, DEFAULT_VIDEO_REVIEW_SETTINGS.models, {})).toThrow(/Refusing to call Workers AI/);
    expect(() => assertRealAiAllowed({ CI: 'true' }, {})).toThrow();
    expect(() => assertRealAiAllowed({ E2E_ENV: 'local' }, {})).toThrow();
    expect(() => assertRealAiAllowed({}, {})).not.toThrow();
  });
});
