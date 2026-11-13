import { test } from 'node:test';
import assert from 'node:assert/strict';
import { historyDeletes, isHistory, keptOnPurpose } from '../run-teardown.ts';

test('only revocations and tombstones are kept on purpose', () => {
  assert.ok(keptOnPurpose({ store: 'kv:TOKEN_REVOCATIONS', location: 'u:usr_1' }));
  assert.ok(keptOnPurpose({ store: 'd1:al-ummah-now-d1', location: 'user_revocations' }));
  assert.ok(keptOnPurpose({ store: 'd1:al-ummah-now-search', location: 'search_tombstones' }));
  for (const location of ['content_ownership', 'upload_rate_windows', 'search_meta', 'admin_jobs']) {
    assert.ok(!keptOnPurpose({ store: 'd1:al-ummah-now-search', location }), location);
  }
  assert.ok(!keptOnPurpose({ store: 'r2:al-ummah-now-messages', location: 'x' }));
});

test('history is the admin registry and logs and the message archive; personal data never is', () => {
  assert.ok(isHistory({ store: 'd1:al-ummah-now-search', location: 'admin_jobs' }));
  assert.ok(isHistory({ store: 'd1:al-ummah-now-search', location: 'admin_deletions' }));
  assert.ok(isHistory({ store: 'r2:al-ummah-now-messages', location: '2026-11-13T18-05-19.abc' }));
  for (const [store, location] of [
    ['d1:al-ummah-now-search', 'content_ownership'],
    ['d1:al-ummah-now-search', 'upload_rate_windows'],
    ['d1:al-ummah-now-reports', 'contact_messages'],
    ['d1:al-ummah-now-notifications', 'notifications'],
    ['r2:profiles', 'usr_1'],
    ['r2:subtitles', 'v/metadata.json'],
  ]) assert.ok(!isHistory({ store, location }), `${store} ${location}`);
});

test('history rows are deleted by primary key, quoted, per table', () => {
  const deletes = historyDeletes([
    { store: 'd1:al-ummah-now-search', location: 'admin_jobs', sample: JSON.stringify({ id: "j'1", kind: 'video.purge' }) },
    { store: 'd1:al-ummah-now-search', location: 'admin_jobs', sample: JSON.stringify({ id: 'j2' }) },
    { store: 'd1:al-ummah-now-search', location: 'admin_deletions', sample: JSON.stringify({ kind: 'video', target_id: 'v1', title: 't' }) },
    { store: 'd1:al-ummah-now-search', location: 'admin_deletions', sample: '{"kind":"video","target_id":"v2","title":"trunc' },
    { store: 'd1:al-ummah-now-search', location: 'content_ownership', sample: JSON.stringify({ kind: 'profile', id: 'usr_1' }) },
    { store: 'r2:al-ummah-now-messages', location: 'k', sample: '{}' },
  ]);
  assert.deepEqual(deletes, [
    { database: 'al-ummah-now-search', sql: "DELETE FROM admin_jobs WHERE (id = 'j''1') OR (id = 'j2')" },
    { database: 'al-ummah-now-search', sql: "DELETE FROM admin_deletions WHERE (kind = 'video' AND target_id = 'v1')" },
  ]);
});
