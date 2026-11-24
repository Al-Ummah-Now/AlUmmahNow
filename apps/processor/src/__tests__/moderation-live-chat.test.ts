/** Live chat scans (wiki E17-D4): accepted, within their own share of the daily cap, never starving the rest. No AI is called. */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { MODERATION_SURFACES, type ModerationScanPayload } from '@al-ummah/shared-types';
import { handleModerationScan, isScanPayload, LIVE_CHAT_FEATURE } from '../moderation/consumer';

function reportsDb(config: Record<string, unknown>) {
  const raw = new DatabaseSync(':memory:');
  const dir = join(__dirname, '../../../admin-api/migrations');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) raw.exec(readFileSync(join(dir, f), 'utf8'));
  for (const [k, v] of Object.entries(config)) raw.prepare("INSERT OR REPLACE INTO moderation_config (key, value, updated_at) VALUES (?, ?, 'x')").run(k, JSON.stringify(v));
  const prepare = (sql: string) => {
    let args: never[] = [];
    const s: any = {
      bind: (...v: never[]) => ((args = v), s),
      all: async () => ({ results: raw.prepare(sql).all(...args) }),
      first: async () => raw.prepare(sql).get(...args) ?? null,
      run: async () => ({ meta: { changes: Number(raw.prepare(sql).run(...args).changes) } }),
      exec: () => { const p = raw.prepare(sql); return p.columns().length ? { results: p.all(...args) } : (p.run(...args), { results: [] }); },
    };
    return s;
  };
  return { raw, prepare, batch: async (list: any[]) => list.map((s) => s.exec()) };
}

const logger = { debug() {}, info() {}, warn() {}, error() {} } as never;
const scan = (over: Partial<ModerationScanPayload> = {}): ModerationScanPayload => ({ surface: 'live_chat', subjectId: `m${Math.random()}`, parentId: 's1', authorId: 'u1', event: 'create', text: 'hello there', timestamp: '2026-11-23T00:00:00Z', ...over });

let guardCalls = 0;
const AI = { run: async () => { guardCalls++; return { response: 'safe', usage: { prompt_tokens: 450, completion_tokens: 5 } }; } };
const reserved = (db: ReturnType<typeof reportsDb>, feature: string) => Number((db.raw.prepare('SELECT reserved FROM ai_budget_daily WHERE feature = ?').get(feature) as { reserved: number } | undefined)?.reserved ?? 0);

beforeEach(() => { guardCalls = 0; });

test('every surface a producer may send is accepted', () => {
  for (const surface of MODERATION_SURFACES) expect(isScanPayload(scan({ surface }))).toBe(true);
  expect(isScanPayload(scan({ surface: 'nope' as never }))).toBe(false);
});

test('live chat stops at its share; other surfaces go on', async () => {
  const db = reportsDb({ enabled: true, daily_neuron_cap: 400, live_chat_share: 0.25 });
  const env = { REPORTS_DB: db as never, AI: AI as never };
  const outcomes: string[] = [];
  for (let i = 0; i < 12; i++) outcomes.push(((await handleModerationScan(scan(), env, logger)) as { decision: string }).decision);
  expect(outcomes.filter((d) => d === 'skipped:budget').length).toBeGreaterThan(0);
  expect(outcomes[0]).not.toBe('skipped:budget');
  const used = guardCalls;
  expect(((await handleModerationScan(scan({ surface: 'video_comment' }), env, logger)) as { decision: string }).decision).not.toBe('skipped:budget');
  expect(guardCalls).toBe(used + 1);
  const skipped = db.raw.prepare("SELECT surface, skip_reason FROM moderation_signals WHERE decision = 'skipped' LIMIT 1").get();
  expect({ ...(skipped as object) }).toEqual({ surface: 'live_chat', skip_reason: 'budget' });
});

test('when the site is at its cap, the chat reservation is given back', async () => {
  const db = reportsDb({ enabled: true, daily_neuron_cap: 100, live_chat_share: 1 });
  db.raw.prepare("INSERT INTO ai_budget_daily (day, feature, reserved) VALUES (date('now'), 'moderation', 100)").run();
  const out = await handleModerationScan(scan(), { REPORTS_DB: db as never, AI: AI as never }, logger);
  expect((out as { decision: string }).decision).toBe('skipped:budget');
  expect(guardCalls).toBe(0);
  expect(reserved(db, LIVE_CHAT_FEATURE)).toBe(0);
});

test('both budgets settle to what was spent, and a failed call gives both back', async () => {
  const db = reportsDb({ enabled: true, daily_neuron_cap: 1000 });
  await handleModerationScan(scan(), { REPORTS_DB: db as never, AI: AI as never }, logger);
  expect(reserved(db, LIVE_CHAT_FEATURE)).toBeCloseTo(reserved(db, 'moderation'), 6);
  const before = reserved(db, LIVE_CHAT_FEATURE);
  const broken = { run: async () => { throw new Error('AI down'); } };
  await handleModerationScan(scan(), { REPORTS_DB: db as never, AI: broken as never }, logger, { lastAttempt: true });
  expect(reserved(db, LIVE_CHAT_FEATURE)).toBeCloseTo(before, 6);
});

test('a share of zero scans nothing', async () => {
  const db = reportsDb({ enabled: true, daily_neuron_cap: 1000, live_chat_share: 0 });
  expect(((await handleModerationScan(scan(), { REPORTS_DB: db as never, AI: AI as never }, logger)) as { decision: string }).decision).toBe('skipped:budget');
  expect(guardCalls).toBe(0);
});

describe('holding what the AI flags (E17-D4)', () => {
  const UNSAFE = { run: async () => ({ response: 'unsafe\nS10', usage: { prompt_tokens: 450, completion_tokens: 5 } }) };
  const search = (over: { fail?: boolean } = {}) => {
    const runs: unknown[][] = [];
    return { runs, prepare: () => ({ bind: (...args: unknown[]) => ({ run: async () => { if (over.fail) throw new Error('D1 is down'); runs.push(args); return { meta: { changes: 1 } }; } }) }) };
  };
  const enforced = { enabled: true, daily_neuron_cap: 100000, policies: { S10: { mode: 'enforce', threshold: 0.5, action: 'flag', enabled: true } } };
  const decisionOf = (db: ReturnType<typeof reportsDb>) => (db.raw.prepare('SELECT decision FROM moderation_signals').all() as Array<{ decision: string }>).map((r) => r.decision);

  it('only for chat, only in an enforced category, and the signal is written first', async () => {
    const db = reportsDb(enforced);
    const s = search();
    const run = (over = {}) => handleModerationScan(scan({ subjectId: 'm1', ...over }), { REPORTS_DB: db as never, AI: UNSAFE as never, SEARCH_DB: s }, logger, { lastAttempt: true });
    await run();
    expect(decisionOf(db)).toEqual(['flag']);
    expect(s.runs).toHaveLength(1);
    expect(s.runs[0].slice(1)).toEqual(['m1', 's1', 's1']);
    await run({ surface: 'video_comment' });
    expect(s.runs).toHaveLength(1);
    const shadow = reportsDb({ enabled: true, daily_neuron_cap: 100000 });
    await handleModerationScan(scan(), { REPORTS_DB: shadow as never, AI: UNSAFE as never, SEARCH_DB: s }, logger, { lastAttempt: true });
    expect(decisionOf(shadow)).toEqual(['would_flag']);
    expect(s.runs).toHaveLength(1);
  });

  it('a hold that fails keeps the signal and does not scan again', async () => {
    const db = reportsDb(enforced);
    const out = await handleModerationScan(scan(), { REPORTS_DB: db as never, AI: UNSAFE as never, SEARCH_DB: search({ fail: true }) }, logger, { lastAttempt: false });
    expect(out).toMatchObject({ status: 'done', decision: 'flag' });
    expect(decisionOf(db)).toEqual(['flag']);
  });
});
