/**
 * Review alerts for the Admin app (#1265): rota and escalation, senior-only items, claim clears,
 * timings, and nothing sensitive in a push. Real SQL (notifications + reports migrations),
 * recording push providers: no real pushes.
 */
import { createLogger } from '@al-ummah/logger';
import {
  MessageType,
  isOnCall,
  reviewAlertRecipients,
  reviewAlertText,
  validateReviewAlertSettings,
  REVIEW_ALERT_SETTINGS_KEY,
  type ReviewAlertPayload,
  type ReviewAlertSettings,
} from '@al-ummah/shared-types';
import { handleReviewAlert, processReviewAlertBatch } from '../review-alerts/consumer';
import { handleReviewAlertsInternal } from '../review-alerts/internal';
import { purgeExpiredReviewAlerts, REVIEW_ALERT_RETENTION_MS } from '../review-alerts/store';
import type { AlertPush, PushProvider, PushProviders, PushResult, PushTarget } from '../push/provider';
import { createSqliteD1, REPORTS_MIGRATIONS_DIR } from './sqlite-d1';

const logger = createLogger('review-alerts-test', { logLevel: 'error' });

class Recorder implements PushProvider {
  readonly name = 'recorder';
  alerts: Array<{ target: PushTarget; alert: AlertPush }> = [];
  constructor(private readonly answer: (t: PushTarget) => PushResult = () => ({ ok: true })) {}
  async send(): Promise<PushResult> {
    throw new Error('review alerts never use send()');
  }
  async sendAlert(target: PushTarget, alert: AlertPush): Promise<PushResult> {
    this.alerts.push({ target, alert });
    return this.answer(target);
  }
}
const all = (p: PushProvider): PushProviders => ({ apns: p, fcm: p, wns: p, webpush: p });

// 2026-11-16 is a Monday; 10:00 UTC
const MONDAY_10_UTC = Date.UTC(2026, 10, 16, 10, 0);

const always = [{ days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '24:00' }];
function settings(overrides: Partial<ReviewAlertSettings> = {}): ReviewAlertSettings {
  return {
    enabled: true,
    escalateAllAfterSeconds: 120,
    escalateSeniorsAfterSeconds: 240,
    owners: ['owner'],
    rota: [
      { userId: 'oncall', senior: false, timeZone: 'UTC', shifts: always },
      { userId: 'offcall', senior: false, timeZone: 'UTC', shifts: [] },
      { userId: 'senior-on', senior: true, timeZone: 'UTC', shifts: always },
      { userId: 'senior-off', senior: true, timeZone: 'UTC', shifts: [] },
      { userId: 'paused', senior: true, timeZone: 'UTC', shifts: always, paused: true },
    ],
    ...overrides,
  };
}

describe('rota rules (shared-types)', () => {
  it('time zone shifts the window', () => {
    const riyadh = { userId: 'r', senior: false, timeZone: 'Asia/Riyadh', shifts: [{ days: [1], start: '13:00', end: '14:00' }] };
    expect(isOnCall(riyadh, MONDAY_10_UTC)).toBe(true); // 10:00 UTC = 13:00 Riyadh
    expect(isOnCall({ ...riyadh, timeZone: 'UTC' }, MONDAY_10_UTC)).toBe(false);
    const night = { userId: 'n', senior: false, timeZone: 'UTC', shifts: [{ days: [0], start: '22:00', end: '11:00' }] };
    expect(isOnCall(night, MONDAY_10_UTC)).toBe(true); // Sunday's night shift runs into Monday morning
    expect(isOnCall({ ...night, shifts: [{ days: [1], start: '22:00', end: '11:00' }] }, MONDAY_10_UTC)).toBe(false);
  });

  it('steps: on call first, then every eligible reviewer, then seniors and owners; paused never', () => {
    const s = settings();
    expect(reviewAlertRecipients(s, { seniorOnly: false }, 0, MONDAY_10_UTC)).toEqual(['oncall', 'senior-on']);
    expect(reviewAlertRecipients(s, { seniorOnly: false }, 1, MONDAY_10_UTC)).toEqual(['offcall', 'oncall', 'senior-off', 'senior-on']);
    expect(reviewAlertRecipients(s, { seniorOnly: false }, 2, MONDAY_10_UTC)).toEqual(['owner', 'senior-off', 'senior-on']);
  });

  it('minor-present and escalated items reach senior reviewers only, at every step', () => {
    const s = settings();
    for (const step of [0, 1, 2] as const) {
      const r = reviewAlertRecipients(s, { seniorOnly: true }, step, MONDAY_10_UTC);
      expect(r.some((u) => u === 'oncall' || u === 'offcall' || u === 'paused')).toBe(false);
    }
    expect(reviewAlertRecipients(s, { seniorOnly: true }, 0, MONDAY_10_UTC)).toEqual(['senior-on']);
    expect(reviewAlertRecipients({ ...s, enabled: false }, { seniorOnly: false }, 2, MONDAY_10_UTC)).toEqual([]);
  });

  it('validates admin input', () => {
    expect(validateReviewAlertSettings(settings()).ok).toBe(true);
    expect(validateReviewAlertSettings({ ...settings(), escalateSeniorsAfterSeconds: 60 }).ok).toBe(false);
    expect(validateReviewAlertSettings({ ...settings(), escalateAllAfterSeconds: 5 }).ok).toBe(false);
    expect(validateReviewAlertSettings({ ...settings(), rota: [{ userId: 'a', senior: false, timeZone: 'Mars/Base', shifts: [] }] }).ok).toBe(false);
    expect(validateReviewAlertSettings({ ...settings(), rota: [{ userId: 'a', senior: false, timeZone: 'UTC', shifts: [{ days: [7], start: '00:00', end: '01:00' }] }] }).ok).toBe(false);
    const dup = settings().rota[0];
    expect(validateReviewAlertSettings({ ...settings(), rota: [dup, dup] }).ok).toBe(false);
  });

  it('push text is the reason and time left only, in en and ar', () => {
    expect(reviewAlertText('nsfw', 4, 'en')).toEqual({ title: 'Review queue', body: 'Video held for review · NSFW · 4 min left', openLabel: 'Open', claimLabel: 'Claim' });
    expect(reviewAlertText('minor', 2, 'ar-SA').body).toBe('مرئي محجوز للمراجعة · وجود قاصر · بقي 2 د');
  });
});

describe('review alerts consumer', () => {
  let db: ReturnType<typeof createSqliteD1>;
  let reports: ReturnType<typeof createSqliteD1>;
  let queued: Array<{ body: any; delaySeconds?: number }>;
  let env: any;

  const setSettings = (s: ReviewAlertSettings) =>
    reports.raw.prepare('INSERT OR REPLACE INTO site_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?)').run(REVIEW_ALERT_SETTINGS_KEY, JSON.stringify(s), 'admin', '2026-11-13');
  const device = (installId: string, userId: string, app = 'admin', provider = 'apns', locale = 'en') =>
    db.raw
      .prepare("INSERT INTO push_devices (install_id, user_id, app, platform, provider, token, locale, created_at, updated_at) VALUES (?, ?, ?, 'ios', ?, ?, ?, 0, 0)")
      .run(installId, userId, app, provider, `tok-${installId}`, locale);
  const row = (id = 'rev-1') => db.raw.prepare('SELECT * FROM review_alerts WHERE review_id = ?').get(id) as any;
  const held = (over: Partial<ReviewAlertPayload> = {}): ReviewAlertPayload => ({
    event: 'held',
    reviewId: 'rev-1',
    videoId: 'vid-secret-1',
    reason: 'nsfw',
    seniorOnly: false,
    deadlineAt: MONDAY_10_UTC + 5 * 60000,
    at: MONDAY_10_UTC,
    ...over,
  });

  beforeEach(() => {
    db = createSqliteD1();
    reports = createSqliteD1(REPORTS_MIGRATIONS_DIR);
    queued = [];
    env = {
      NOTIFICATIONS_DB: db,
      REPORTS_DB: reports,
      REVIEW_ALERTS_QUEUE: { send: async (body: any, opts?: { delaySeconds?: number }) => void queued.push({ body, delaySeconds: opts?.delaySeconds }) },
    };
    setSettings(settings());
    for (const u of ['oncall', 'offcall', 'senior-on', 'senior-off', 'paused', 'owner']) device(`adm-${u}`, u);
    device('viewer-oncall', 'oncall', 'viewer');
    device('studio-oncall', 'oncall', 'studio');
  });

  it('held: pushes the on-call reviewers’ Admin installs only, schedules both escalations, records the timings', async () => {
    const p = new Recorder();
    const out = await handleReviewAlert(env, all(p), held(), logger, MONDAY_10_UTC + 800);
    expect(out.status).toBe('sent');
    expect(p.alerts.map((a) => a.target.installId).sort()).toEqual(['adm-oncall', 'adm-senior-on']);
    expect(p.alerts.every((a) => a.target.app === 'admin')).toBe(true);
    expect(queued.map((q) => [q.body.type, q.body.payload.step, q.delaySeconds])).toEqual([
      [MessageType.ReviewAlert, 1, 119],
      [MessageType.ReviewAlert, 2, 239],
    ]);
    expect(row()).toMatchObject({ held_at: MONDAY_10_UTC, alerted_at: MONDAY_10_UTC + 800, senior_only: 0, video_id: 'vid-secret-1' });
    expect(JSON.parse(row().alerted_users)).toEqual(['oncall', 'senior-on']);
  });

  it('a push says only the reason and the time left: no title, channel, video id, thumbnail or media URL', async () => {
    const p = new Recorder();
    await handleReviewAlert(env, all(p), held(), logger, MONDAY_10_UTC + 60000);
    const alert = p.alerts[0].alert;
    expect(alert).toEqual({ kind: 'alert', reviewId: 'rev-1', title: 'Review queue', body: 'Video held for review · NSFW · 4 min left', openLabel: 'Open', claimLabel: 'Claim', actionUrl: '/moderation/review/rev-1', ttlSeconds: 600 });
    expect(JSON.stringify(p.alerts)).not.toContain('vid-secret-1');
  });

  it('escalation step 1 reaches every eligible reviewer not alerted yet; step 2 the seniors and owners', async () => {
    const p = new Recorder();
    await handleReviewAlert(env, all(p), held(), logger, MONDAY_10_UTC);
    p.alerts = [];
    await handleReviewAlert(env, all(p), { event: 'escalate', reviewId: 'rev-1', step: 1, at: MONDAY_10_UTC }, logger, MONDAY_10_UTC + 120000);
    expect(p.alerts.map((a) => a.target.userId).sort()).toEqual(['offcall', 'senior-off']);
    expect(p.alerts[0].alert.body).toBe('Video held for review · NSFW · 3 min left');
    p.alerts = [];
    await handleReviewAlert(env, all(p), { event: 'escalate', reviewId: 'rev-1', step: 2, at: MONDAY_10_UTC }, logger, MONDAY_10_UTC + 240000);
    expect(p.alerts.map((a) => a.target.userId)).toEqual(['owner']);
    expect(row()).toMatchObject({ escalated_at: MONDAY_10_UTC + 120000, seniors_at: MONDAY_10_UTC + 240000 });
  });

  it('senior-only items never reach a non-senior, not even on escalation', async () => {
    const p = new Recorder();
    await handleReviewAlert(env, all(p), held({ reason: 'minor', seniorOnly: true }), logger, MONDAY_10_UTC);
    for (const step of [1, 2] as const) await handleReviewAlert(env, all(p), { event: 'escalate', reviewId: 'rev-1', step, at: MONDAY_10_UTC }, logger, MONDAY_10_UTC + step * 120000);
    expect(p.alerts.map((a) => a.target.userId).sort()).toEqual(['owner', 'senior-off', 'senior-on']);
  });

  it('claim stops the escalations and silently clears the other reviewers’ devices', async () => {
    const p = new Recorder();
    await handleReviewAlert(env, all(p), held(), logger, MONDAY_10_UTC);
    await handleReviewAlert(env, all(p), { event: 'opened', reviewId: 'rev-1', userId: 'oncall', at: MONDAY_10_UTC + 30000 }, logger);
    p.alerts = [];
    await handleReviewAlert(env, all(p), { event: 'claimed', reviewId: 'rev-1', userId: 'oncall', at: MONDAY_10_UTC + 40000 }, logger);
    expect(p.alerts.map((a) => [a.target.userId, a.alert.kind])).toEqual([['senior-on', 'clear']]);
    expect(p.alerts[0].alert).toEqual({ kind: 'clear', reviewId: 'rev-1', ttlSeconds: 3600 });
    p.alerts = [];
    const esc = await handleReviewAlert(env, all(p), { event: 'escalate', reviewId: 'rev-1', step: 1, at: MONDAY_10_UTC }, logger, MONDAY_10_UTC + 120000);
    expect(esc).toMatchObject({ status: 'skipped', reason: 'already_handled' });
    expect(p.alerts).toEqual([]);
    await handleReviewAlert(env, all(p), { event: 'decided', reviewId: 'rev-1', userId: 'oncall', at: MONDAY_10_UTC + 150000 }, logger);
    expect(p.alerts.map((a) => a.target.userId).sort()).toEqual(['oncall', 'senior-on']);
    expect(row()).toMatchObject({ opened_at: MONDAY_10_UTC + 30000, opened_by: 'oncall', claimed_at: MONDAY_10_UTC + 40000, claimed_by: 'oncall', decided_at: MONDAY_10_UTC + 150000 });
  });

  it('a queue retry of the same hold does not alert anyone twice; a new hold (appeal) starts over', async () => {
    const p = new Recorder();
    await handleReviewAlert(env, all(p), held(), logger, MONDAY_10_UTC);
    await handleReviewAlert(env, all(p), held(), logger, MONDAY_10_UTC + 1000);
    expect(p.alerts).toHaveLength(2);
    const stale = await handleReviewAlert(env, all(p), { event: 'escalate', reviewId: 'rev-1', step: 1, at: MONDAY_10_UTC - 1 }, logger, MONDAY_10_UTC + 120000);
    expect(stale).toMatchObject({ status: 'skipped', reason: 'superseded' });
    await handleReviewAlert(env, all(p), held({ reason: 'appeal', at: MONDAY_10_UTC + 3600000 }), logger, MONDAY_10_UTC + 3600000);
    expect(p.alerts).toHaveLength(4);
    expect(row()).toMatchObject({ reason: 'appeal', claimed_at: null });
  });

  it('alerts off: nothing is pushed or scheduled, the timings are still recorded', async () => {
    setSettings(settings({ enabled: false }));
    const p = new Recorder();
    await handleReviewAlert(env, all(p), held(), logger, MONDAY_10_UTC);
    expect(p.alerts).toEqual([]);
    expect(queued).toEqual([]);
    expect(row()).toMatchObject({ held_at: MONDAY_10_UTC, alerted_at: null });
  });

  it('prunes tokens the provider rejected; a failed send leaves alerted_at unset', async () => {
    const p = new Recorder((t) => (t.userId === 'oncall' ? { ok: false, invalidToken: true, error: 'Unregistered' } : { ok: false, invalidToken: false, error: '503' }));
    await handleReviewAlert(env, all(p), held(), logger, MONDAY_10_UTC);
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM push_devices WHERE install_id = 'adm-oncall'").get()).toEqual({ n: 0 });
    expect(row().alerted_at).toBeNull();
  });

  it('batch: malformed messages are dropped (acked); a store failure retries', async () => {
    const ack = jest.fn();
    const retry = jest.fn();
    await processReviewAlertBatch({ messages: [{ body: { id: 'x', type: MessageType.ReviewAlert, timestamp: 0, payload: { event: 'held' } } as any, ack, retry }] }, env, all(new Recorder()), logger);
    expect(ack).toHaveBeenCalled();
    const broken = { ...env, NOTIFICATIONS_DB: { prepare: () => { throw new Error('D1 down'); } } };
    await processReviewAlertBatch({ messages: [{ body: { id: 'y', type: MessageType.ReviewAlert, timestamp: 0, payload: held() } as any, ack, retry }] }, broken, all(new Recorder()), logger);
    expect(retry).toHaveBeenCalled();
  });

  it('timings purge after the retention window', async () => {
    await handleReviewAlert(env, all(new Recorder()), held(), logger, MONDAY_10_UTC);
    expect(await purgeExpiredReviewAlerts(db, MONDAY_10_UTC + REVIEW_ALERT_RETENTION_MS - 1)).toBe(0);
    expect(await purgeExpiredReviewAlerts(db, MONDAY_10_UTC + REVIEW_ALERT_RETENTION_MS + 1)).toBe(1);
  });
});

describe('internal routes for admin-api', () => {
  let db: ReturnType<typeof createSqliteD1>;
  let env: any;
  const call = (method: string, path: string, body?: unknown) =>
    handleReviewAlertsInternal(new Request(`https://processor.internal${path}`, { method, ...(body ? { body: JSON.stringify(body) } : {}) }), new URL(`https://processor.internal${path}`), env, logger);

  beforeEach(() => {
    db = createSqliteD1();
    env = { NOTIFICATIONS_DB: db, REVIEW_ALERTS_QUEUE: { send: jest.fn() } };
    db.raw.prepare("INSERT INTO push_devices (install_id, user_id, app, platform, provider, token, created_at, updated_at) VALUES ('install-admin-1', 'staff1', 'admin', 'ios', 'apns', 'abcdef0123456789', 1, 2)").run();
    db.raw.prepare("INSERT INTO push_devices (install_id, user_id, app, platform, provider, token, created_at, updated_at) VALUES ('install-other-1', 'other', 'admin', 'ios', 'apns', 'zzz', 1, 2)").run();
  });

  it('lists a user’s devices with token hints only', async () => {
    const res = await call('GET', '/internal/push-devices?userId=staff1');
    const body = (await res.json()) as any;
    expect(body.devices).toEqual([expect.objectContaining({ installId: 'install-admin-1', app: 'admin', tokenHint: '…456789' })]);
    expect(JSON.stringify(body)).not.toContain('abcdef0123456789');
  });

  it('signs out one device of that user only', async () => {
    expect((await call('DELETE', '/internal/push-devices/install-other-1?userId=staff1')).status).toBe(404);
    expect((await call('DELETE', '/internal/push-devices/install-admin-1?userId=staff1')).status).toBe(200);
    expect(db.raw.prepare('SELECT install_id FROM push_devices').all()).toEqual([{ install_id: 'install-other-1' }]);
  });

  it('queues reviewer events but never an outside escalation', async () => {
    expect((await call('POST', '/internal/review-alerts/events', { event: 'claimed', reviewId: 'rev-1', userId: 'u', at: 1 })).status).toBe(202);
    expect((await call('POST', '/internal/review-alerts/events', { event: 'escalate', reviewId: 'rev-1', step: 1, at: 1 })).status).toBe(400);
    expect(env.REVIEW_ALERTS_QUEUE.send).toHaveBeenCalledTimes(1);
  });

  it('daily timings: median and p90 from held', async () => {
    const now = Date.now();
    const ins = db.raw.prepare("INSERT INTO review_alerts (review_id, reason, held_at, alerted_at, opened_at, claimed_at, decided_at) VALUES (?, 'nsfw', ?, ?, ?, ?, ?)");
    // One item held 10 s before its alert and decided after 300 s; another alerted after 20 s
    const startOfDay = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());
    const held = Math.max(now - 60000, startOfDay);
    ins.run('a', held, held + 10000, held + 30000, held + 40000, held + 300000);
    ins.run('b', held, held + 20000, null, null, null);
    const body = (await (await call('GET', '/internal/review-alerts/stats?days=1')).json()) as any;
    expect(body.days).toHaveLength(1);
    expect(body.days[0]).toMatchObject({ held: 2, decided: 1, toAlert: { p50: 10, p90: 20 }, toOpen: { p50: 30, p90: 30 }, toClaim: { p50: 40, p90: 40 } });
  });
});
