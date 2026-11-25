import { test } from 'node:test';
import assert from 'node:assert/strict';
import { historyDeletes, isHistory, keptOnPurpose, residueDeletes, signUpResidue } from '../run-teardown.ts';

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
  assert.ok(isHistory({ store: 'd1:al-ummah-now-search', location: 'media_erase_targets' }));
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

test('an abandoned sign-up (account never created) is found by the run marker: Auth code row and code-sink key', () => {
  const marker = '43699547929';
  const email = `e2e+${marker}-1-rel-mwhn63crupjs-rel-studio-links@e2e.alummahnow.net`;
  const other = 'e2e+999-1-rel-x@e2e.alummahnow.net';
  const residue = signUpResidue([
    { store: 'd1:al-ummah-now-d1', location: 'password_codes', sample: JSON.stringify({ email, code_hash: 'h', attempts: 0 }) },
    { store: 'kv:AUTH_STORAGE', location: `test:email:${email}`, sample: `test:email:${email}` },
    // another run's address, a non-run address and other stores are never touched
    { store: 'd1:al-ummah-now-d1', location: 'password_codes', sample: JSON.stringify({ email: other }) },
    { store: 'd1:al-ummah-now-d1', location: 'password_codes', sample: JSON.stringify({ email: `owner+${marker}@example.com` }) },
    { store: 'kv:AUTH_STORAGE', location: `session:${email}`, sample: email },
    { store: 'd1:al-ummah-now-d1', location: 'users', sample: JSON.stringify({ email }) },
    { store: 'd1:al-ummah-now-d1', location: 'password_codes', sample: 'not json' },
  ], marker);
  assert.deepEqual(residue, { emails: [email], sinkKeys: [`test:email:${email}`] });
  assert.deepEqual(residueDeletes([email, "e2e+o'q@e2e.alummahnow.net"]), [`DELETE FROM password_codes WHERE email IN ('${email}', 'e2e+o''q@e2e.alummahnow.net')`]);
  assert.equal(residueDeletes(Array.from({ length: 51 }, (_, i) => `e2e+${i}@e2e.alummahnow.net`)).length, 2);
});
