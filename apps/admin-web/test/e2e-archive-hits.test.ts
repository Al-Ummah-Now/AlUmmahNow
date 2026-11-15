import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { archiveHits, processorBatchTimeoutMs, quietPeriodState } from '../e2e/support/archive-hits';
import { parseJsonc } from '../../../scripts/release/jsonc';

test('the run\'s message-archive and backup copies archived after the sweep are found by their scan keys', () => {
  // The two objects that escaped on #1403's Local admin run (ReportResolve, dismissed as A11Y-02 ended)
  const hits = [
    { store: 'r2:al-ummah-now-messages', location: '2026-11-15T09-41-26.53e796cd-125b-4d48-9c63-a270e8b92d8d' },
    { store: 'r2:al-ummah-now-messages', location: '2026-11-15T09-41-26.aa38ff78-9f3b-4215-b51c-3dc4831f523c' },
    { store: 'r2:al-ummah-now-messages', location: '2026-11-15T09-41-26.aa38ff78-9f3b-4215-b51c-3dc4831f523c' },
    { store: 'r2:admin-backups', location: 'restore/usr_1.json' },
    // everything else waits for its own erasure step or stays a leftover
    { store: 'r2:reports', location: 'report:e2e-admin-x' },
    { store: 'r2:al-ummah-now-messages-other', location: 'k' },
    { store: 'd1:al-ummah-now-reports', location: 'reports' },
    { store: 'kv:TOKEN_REVOCATIONS', location: 'u:usr_1' },
  ];
  assert.deepEqual(archiveHits(hits), [
    { bucket: 'al-ummah-now-messages', key: '2026-11-15T09-41-26.53e796cd-125b-4d48-9c63-a270e8b92d8d' },
    { bucket: 'al-ummah-now-messages', key: '2026-11-15T09-41-26.aa38ff78-9f3b-4215-b51c-3dc4831f523c' },
    { bucket: 'admin-backups', key: 'restore/usr_1.json' },
  ]);
  assert.deepEqual(archiveHits([]), []);
});

test('the batch window comes from the processor config: its longest queue consumer batch timeout', () => {
  const config = parseJsonc(fs.readFileSync(path.join(__dirname, '../../processor/wrangler.jsonc'), 'utf8'));
  assert.equal(processorBatchTimeoutMs(config), 30_000);
  assert.equal(processorBatchTimeoutMs({ queues: { consumers: [{ max_batch_timeout: 5 }, { max_batch_timeout: 12 }, {}] } }), 12_000);
  assert.throws(() => processorBatchTimeoutMs({ queues: { consumers: [] } }), /max_batch_timeout/);
});

test('quiet period: sweeps until no new archive copy for 10 s past the batch window, then fails at the hard limit', () => {
  const t0 = 1_000_000;
  const p = { startedAt: t0, batchMs: 30_000 };
  // Nothing left early on is not final: a message sent as the last spec ended is only archived after its batch
  assert.equal(quietPeriodState(p, t0 + 5_000, null, 0), 'wait');
  assert.equal(quietPeriodState(p, t0 + 39_999, null, 0), 'wait');
  assert.equal(quietPeriodState(p, t0 + 40_000, null, 0), 'done');
  // #1403 mobile: copies sent at the teardown's start, archived 31.6 s later (batch + processing):
  // the old fixed 31 s wait had ended; now the new copy restarts the quiet period
  assert.equal(quietPeriodState(p, t0 + 33_000, t0 + 32_000, 0), 'wait');
  assert.equal(quietPeriodState(p, t0 + 41_999, t0 + 32_000, 0), 'wait');
  assert.equal(quietPeriodState(p, t0 + 42_000, t0 + 32_000, 0), 'done');
  // Other rows still pending (queued erasure steps): wait
  assert.equal(quietPeriodState(p, t0 + 60_000, t0 + 32_000, 2), 'wait');
  // Hard limit: batch window + 60 s, copies still arriving or rows still pending
  assert.equal(quietPeriodState(p, t0 + 90_000, t0 + 88_000, 0), 'timeout');
  assert.equal(quietPeriodState(p, t0 + 90_000, null, 1), 'timeout');
  assert.equal(quietPeriodState({ ...p, maxMs: 50_000 }, t0 + 50_000, null, 1), 'timeout');
});
