import { test } from 'node:test';
import assert from 'node:assert/strict';
import { archiveHits } from '../e2e/support/archive-hits';

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
