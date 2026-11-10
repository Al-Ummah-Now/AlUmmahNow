/** admin-api cron dispatch: one Worker, two schedules (wrangler triggers.crons). */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index';

function recordingDb() {
  const sql: string[] = [];
  const stmt = (q: string) => {
    const s = {
      bind: () => s,
      all: async () => (sql.push(q), { results: [] }),
      run: async () => (sql.push(q), { meta: { changes: 0 } }),
      first: async () => (sql.push(q), null),
    };
    return s;
  };
  return { sql, db: { prepare: stmt, batch: async (list: unknown[]) => list.map(() => ({ meta: { changes: 0 } })) } };
}

async function runCron(cron: string) {
  const { sql, db } = recordingDb();
  const pending: Promise<unknown>[] = [];
  await worker.scheduled({ cron, scheduledTime: Date.now() } as never, { REPORTS_DB: db } as never, { waitUntil: (p: Promise<unknown>) => void pending.push(p) } as never);
  await Promise.all(pending);
  return sql.join('\n');
}

describe('cron dispatch', () => {
  it('03:17 UTC runs error data retention only', async () => {
    const sql = await runCron('17 3 * * *');
    assert.match(sql, /error_/);
    assert.doesNotMatch(sql, /auth_moderation_requests/);
  });

  it('every 5 minutes reads the status of open requests to auth only', async () => {
    const sql = await runCron('*/5 * * * *');
    assert.match(sql, /auth_moderation_requests/);
    assert.doesNotMatch(sql, /error_/);
  });
});
