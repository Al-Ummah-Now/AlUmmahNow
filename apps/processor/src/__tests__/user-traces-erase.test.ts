/**
 * #1059: account erasure removes what the processor's databases keep about the user beyond reports:
 * the admin's invite rows, the user's error-group membership, the user id and identifying details of
 * their error events (the errors themselves stay for grouping and trends), AI category
 * suggestions, the upload rate counters and slots and the creator tier keyed by them. Real SQL on the real schemas (admin-api and search migrations).
 */
import { join } from 'path';
import { createSqliteD1, REPORTS_MIGRATIONS_DIR } from './sqlite-d1';
import { eraseUserTraces } from '../erasure/user-traces';

const SEARCH_MIGRATIONS_DIR = join(__dirname, '..', '..', '..', 'api-videos', 'migrations', 'search');
const USER = 'usr_erased';
const OTHER = 'usr_kept';
const ERASED = 'deleted-user';

function seed() {
  const reports = createSqliteD1(REPORTS_MIGRATIONS_DIR);
  const search = createSqliteD1(SEARCH_MIGRATIONS_DIR);
  const now = '2026-11-12T00:00:00.000Z';
  for (const [id, userId, email] of [['inv_1', USER, 'erased@example.com'], ['inv_2', OTHER, 'kept@example.com']]) {
    reports.raw
      .prepare(`INSERT INTO creator_invites (id, user_id, email, name, delivery_status, created_by, created_at, updated_at) VALUES (?, ?, ?, 'Name', 'sent', 'admin', ?, ?)`)
      .run(id, userId, email, now, now);
  }
  reports.raw
    .prepare(`INSERT INTO error_groups (id, fingerprint, environment, app, kind, message, users, occurrences, first_seen, last_seen, updated_at) VALUES ('eg_1', 'fp', 'qa', 'web', 'caught', 'Boom', 2, 3, ?, ?, ?)`)
    .run(now, now, now);
  reports.raw.prepare(`INSERT INTO error_group_users (group_id, user_key) VALUES ('eg_1', ?), ('eg_1', ?)`).run(USER, OTHER);
  const event = (id: string, userId: string, extra: string | null) =>
    reports.raw
      .prepare(`INSERT INTO error_events (id, group_id, ref, kind, occurred_at, received_at, user_id, message, stack, extra_json) VALUES (?, 'eg_1', ?, 'caught', ?, ?, ?, 'Boom', 'at x', ?)`)
      .run(id, `ERR-${id}`, now, now, userId, extra);
  event('ev_1', USER, JSON.stringify({ email: 'erased@example.com', ip: '203.0.113.9', name: 'Erased', step: 'upload' }));
  event('ev_2', USER, 'not json');
  event('ev_3', OTHER, JSON.stringify({ email: 'kept@example.com' }));
  for (const [subject, userId] of [['vid_1', USER], ['vid_2', OTHER]]) {
    search.raw
      .prepare(`INSERT INTO category_suggestions (subject_id, subject_type, user_id, reason, status, created_at, updated_at) VALUES (?, 'video', ?, 'upload', 'done', 1, 1)`)
      .run(subject, userId);
  }
  for (const userId of [USER, OTHER]) {
    search.raw.prepare(`INSERT INTO upload_rate_windows (user_id, operation, period, window_start, count) VALUES (?, 'upload', 'day', 1, 3)`).run(userId);
    search.raw.prepare(`INSERT INTO upload_rate_leases (user_id, operation, lease_id, expires_at) VALUES (?, 'upload', 'lease_1', 9999999999999)`).run(userId);
    search.raw.prepare(`INSERT INTO creator_tier_assignments (user_id, tier_id, source, assigned_by, assigned_at) VALUES (?, 'creator', 'admin', 'usr_admin', '2026-11-13')`).run(userId);
  }
  return { reports, search };
}

describe('eraseUserTraces (#1059)', () => {
  it('deletes invites, error-group membership and category suggestions; anonymises error events, keeping the errors', async () => {
    const { reports, search } = seed();
    const result = await eraseUserTraces(reports, search, USER, ERASED);
    expect(result).toEqual({ invites: 1, errorUsers: 1, errorEvents: 2, categorySuggestions: 1, rateLimits: 2, creatorTier: 1 });

    expect(reports.raw.prepare('SELECT id FROM creator_invites ORDER BY id').all()).toEqual([{ id: 'inv_2' }]);
    expect(reports.raw.prepare('SELECT user_key FROM error_group_users').all()).toEqual([{ user_key: OTHER }]);
    const events = reports.raw.prepare('SELECT id, user_id, message, stack, extra_json FROM error_events ORDER BY id').all();
    expect(events).toEqual([
      { id: 'ev_1', user_id: ERASED, message: 'Boom', stack: 'at x', extra_json: JSON.stringify({ step: 'upload' }) },
      { id: 'ev_2', user_id: ERASED, message: 'Boom', stack: 'at x', extra_json: null },
      { id: 'ev_3', user_id: OTHER, message: 'Boom', stack: 'at x', extra_json: JSON.stringify({ email: 'kept@example.com' }) },
    ]);
    // The group and its counts survive
    expect(reports.raw.prepare('SELECT users, occurrences FROM error_groups').all()).toEqual([{ users: 2, occurrences: 3 }]);
    expect(search.raw.prepare('SELECT subject_id FROM category_suggestions').all()).toEqual([{ subject_id: 'vid_2' }]);
    expect(search.raw.prepare('SELECT user_id FROM upload_rate_windows').all()).toEqual([{ user_id: OTHER }]);
    expect(search.raw.prepare('SELECT user_id FROM upload_rate_leases').all()).toEqual([{ user_id: OTHER }]);
    expect(search.raw.prepare('SELECT user_id FROM creator_tier_assignments').all()).toEqual([{ user_id: OTHER }]);
  });

  it('is idempotent and works without the search database', async () => {
    const { reports, search } = seed();
    await eraseUserTraces(reports, search, USER, ERASED);
    expect(await eraseUserTraces(reports, search, USER, ERASED)).toEqual({ invites: 0, errorUsers: 0, errorEvents: 0, categorySuggestions: 0, rateLimits: 0, creatorTier: 0 });
    expect((await eraseUserTraces(reports, undefined, OTHER, ERASED)).categorySuggestions).toBe(0);
  });
});
