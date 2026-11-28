import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ADMIN_JOB_MAX_ATTEMPTS, createJob, getJobWithLog, handleAdminJobBatch, retryJob } from '../src/lib/admin/jobs';
import { SqliteD1 } from './search-sqlite-d1';

test('card jobs back off, exhaust their retry budget, and can be retried with the same ID', async () => {
  const sql = new SqliteD1();
  const deliveries: unknown[] = [];
  const env = { SEARCH_DB: sql, ADMIN_JOBS_QUEUE: { async send(message: unknown) { deliveries.push(message); } } };
  const job = await createJob(env as never, { kind: 'card.publish', actorId: 'usr_creator', targetId: 'ch_creator', targetKind: 'channel' });
  let finalError = '';
  const delays: number[] = [];
  for (let attempts = 1; attempts <= ADMIN_JOB_MAX_ATTEMPTS; attempts++) {
    await handleAdminJobBatch({
      messages: [{
        body: deliveries[0], attempts,
        ack() { assert.fail('failed jobs must go to the DLQ after retries'); },
        retry(options) { delays.push(options?.delaySeconds ?? 0); },
      }],
    }, env as never, { 'card.publish': async () => { throw new Error('Card capture failed'); } },
    async (_job, error) => { finalError = error; });
  }
  const failed = await getJobWithLog(env as never, job.id);
  assert.equal(failed?.status, 'failed');
  assert.equal(failed?.attempts, ADMIN_JOB_MAX_ATTEMPTS);
  assert.match(finalError, /Card capture failed/u);
  assert.ok(delays[1] > delays[0]);
  assert.equal(delays.length, ADMIN_JOB_MAX_ATTEMPTS);
  assert.equal(failed?.log?.at(-1)?.event, 'failed');

  await retryJob(env as never, job.id);
  await handleAdminJobBatch({
    messages: [{ body: deliveries[1], attempts: 1, ack() {}, retry() { assert.fail(); } }],
  }, env as never, { 'card.publish': async () => ({ done: true }) });
  assert.equal((await getJobWithLog(env as never, job.id))?.status, 'succeeded');
  sql.db.close();
});
