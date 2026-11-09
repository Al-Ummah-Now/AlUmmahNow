/**
 * Daily AI budget under concurrency (SCALABILITY-AUDIT PR-9).
 *
 * 200 scans run at once against the real schema (node:sqlite, batches are
 * transactions like D1) with a slow mocked Workers AI. With check-then-act,
 * all 200 passed the check; with reservations the cap is crossed by at most
 * one scan, and the reservations settle to exactly what was spent.
 */
import { createLogger } from '@al-ummah/logger';
import type { ModerationScanPayload } from '@al-ummah/shared-types';
import { handleModerationScan } from '../moderation/consumer';
import { estimateScanNeurons } from '../moderation/budget';
import { createSqliteD1, REPORTS_MIGRATIONS_DIR } from './sqlite-d1';

const logger = createLogger('processor-test', { logLevel: 'error' });
const NOW = Date.parse('2026-11-08T12:00:00Z');
const slow = () => new Promise<void>((r) => setTimeout(r, 2 + Math.random() * 8));

function setup(cap: number | null) {
  const db = createSqliteD1(REPORTS_MIGRATIONS_DIR);
  const set = (key: string, value: unknown) =>
    db.raw.prepare('INSERT INTO moderation_config (key, value, updated_at) VALUES (?, ?, ?)').run(key, JSON.stringify(value), 'now');
  set('enabled', true);
  if (cap !== null) set('daily_neuron_cap', cap);
  const ai = {
    run: jest.fn(async () => {
      await slow();
      return { response: { safe: true, categories: [] }, usage: { prompt_tokens: 400, completion_tokens: 2 } };
    }),
  };
  return { db, ai, env: { REPORTS_DB: db, AI: ai, AI_MODERATION_ENABLED: 'true' } };
}

const payload = (i: number): ModerationScanPayload => ({
  surface: 'video_comment', subjectId: `c-${i}`, parentId: 'v-1', authorId: 'u-1', event: 'create',
  text: `hello there number ${i}`, timestamp: new Date(NOW).toISOString(),
});

const spent = (db: ReturnType<typeof createSqliteD1>) =>
  Number(db.raw.prepare("SELECT COALESCE(SUM(neurons), 0) AS n FROM ai_usage_daily WHERE day = '2026-11-08'").get()?.n ?? 0);
const reserved = (db: ReturnType<typeof createSqliteD1>) =>
  Number(db.raw.prepare("SELECT reserved FROM ai_budget_daily WHERE day = '2026-11-08'").get()?.reserved ?? 0);

describe('AI budget reservations', () => {
  it('200 parallel scans never overshoot the cap by more than one scan', async () => {
    const perScan = 400 * 44003 / 1e6 + 2 * 2730 / 1e6; // what the mock reports per guard call
    const cap = perScan * 10.5; // room for 10 scans, the 11th starts below the cap
    const { db, ai, env } = setup(cap);
    const outcomes = await Promise.all(
      Array.from({ length: 200 }, (_, i) => handleModerationScan(payload(i), env, logger, { lastAttempt: true, now: NOW })),
    );
    const scanned = outcomes.filter((o) => o.decision !== 'skipped:budget').length;
    const maxScan = estimateScanNeurons(payload(199).text, { arabic: false, latin: true, extensions: false });
    expect(spent(db)).toBeLessThanOrEqual(cap + maxScan);
    expect(scanned).toBeGreaterThan(0);
    expect(scanned).toBeLessThan(20);
    expect(ai.run).toHaveBeenCalledTimes(scanned);
    // Every reservation settled: the ledger equals the real spend
    expect(reserved(db)).toBeCloseTo(spent(db), 6);
  });

  it('without a cap every scan runs and the ledger still tracks the spend', async () => {
    const { db, env } = setup(null);
    await Promise.all(Array.from({ length: 50 }, (_, i) => handleModerationScan(payload(i), env, logger, { lastAttempt: true, now: NOW })));
    expect(reserved(db)).toBeCloseTo(spent(db), 6);
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM moderation_signals WHERE decision = 'skipped'").get()?.n).toBe(0);
  });

  it('spend recorded before the ledger existed counts against the cap', async () => {
    const { db, ai, env } = setup(10);
    db.raw.prepare("INSERT INTO ai_usage_daily (day, model, neurons) VALUES ('2026-11-08', 'm', 10)").run();
    expect((await handleModerationScan(payload(1), env, logger, { lastAttempt: true, now: NOW })).decision).toBe('skipped:budget');
    expect(ai.run).not.toHaveBeenCalled();
  });

  it('a failed AI call gives back the unspent part of its reservation', async () => {
    const { db, env } = setup(1000);
    env.AI.run = jest.fn(async () => { throw new Error('3040: capacity'); });
    await handleModerationScan(payload(1), env, logger, { lastAttempt: false, now: NOW });
    expect(reserved(db)).toBe(0);
  });
});
