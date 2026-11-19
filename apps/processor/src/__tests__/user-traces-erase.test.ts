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
    search.raw.prepare(`INSERT INTO caption_minute_usage (user_id, period, minutes, updated_at) VALUES (?, '2026-11', 12, ?)`).run(userId, now);
    search.raw.prepare(`INSERT INTO caption_minute_overdraft (user_id, minutes, updated_at) VALUES (?, 3, ?)`).run(userId, now);
    search.raw
      .prepare(`INSERT INTO caption_minute_grants (id, user_id, minutes, scope, period, reason, created_by, created_at) VALUES (?, ?, 60, 'month', '2026-11', 'pilot', 'usr_admin', ?)`)
      .run(`grant_${userId}`, userId, now);
    search.raw
      .prepare(`INSERT INTO caption_minute_holds (hold_id, user_id, period, minutes, month_minutes, state, created_at, updated_at) VALUES (?, ?, '2026-11', 5, 5, 'committed', ?, ?)`)
      .run(`hold_${userId}`, userId, now, now);
    search.raw
      .prepare(`INSERT INTO caption_minute_ledger (id, user_id, hold_id, kind, minutes, balance_after, period, created_at) VALUES (?, ?, ?, 'settle', 5, 55, '2026-11', ?)`)
      .run(`led_${userId}`, userId, `hold_${userId}`, now);
    search.raw
      .prepare(`INSERT INTO tier_requests (id, user_id, tier_id, tier_name, from_tier_id, name, about, status, created_at) VALUES (?, ?, 'creator', 'Creator', 'member', 'Name', 'About me and my channel', 'pending', '2026-11-14')`)
      .run(`tr_${userId}`, userId);
  }
  // A request the erased user decided as staff: the decision stays, the decider becomes the placeholder
  search.raw
    .prepare(`INSERT INTO tier_requests (id, user_id, tier_id, tier_name, from_tier_id, name, about, status, created_at, decided_at, decided_by) VALUES ('tr_decided', 'usr_third', 'creator', 'Creator', 'member', 'N', 'About me and my channel', 'approved', '2026-11-14', '2026-11-14', ?)`)
    .run(USER);
  // Billing (wiki AUN-SUBS): bookkeeping stays under the marker; links, checkouts and payloads go
  for (const userId of [USER, OTHER]) {
    search.raw
      .prepare(`INSERT INTO billing_subscriptions (id, user_id, tier_id, tier_name, provider, mode, provider_ref, customer_ref, status, comp_reason, created_at, updated_at) VALUES (?, ?, 'creator', 'Creator', 'paygood', 'test', ?, ?, 'active', 'thanks', ?, ?)`)
      .run(`bsub_${userId}`, userId, `sub_${userId}`, `fake_cus_${userId}`, now, now);
    search.raw
      .prepare(`INSERT INTO billing_payments (id, user_id, subscription_id, provider, mode, provider_ref, status, amount, currency, receipt_url, occurred_at) VALUES (?, ?, ?, 'paygood', 'test', ?, 'succeeded', 500, 'USD', ?, ?)`)
      .run(`bpay_${userId}`, userId, `bsub_${userId}`, `txn_${userId}`, `https://receipts.example/${userId}`, now);
    search.raw
      .prepare(`INSERT INTO billing_events (id, provider, mode, event_id, type, user_id, payload, status, received_at) VALUES (?, 'paygood', 'test', ?, 'subscription.created', ?, '{"email":"x@example.com"}', 'processed', ?)`)
      .run(`bev_${userId}`, `evt_${userId}`, userId, now);
    search.raw.prepare(`INSERT INTO billing_customers (provider, mode, user_id, provider_ref, created_at) VALUES ('paygood', 'test', ?, ?, ?)`).run(userId, `ctm_${userId}`, now);
    search.raw
      .prepare(`INSERT INTO billing_checkouts (id, user_id, tier_id, price_id, provider, mode, created_at) VALUES (?, ?, 'creator', 'bpr_1', 'paygood', 'test', ?)`)
      .run(`bco_${userId}`, userId, now);
  }
  // A comp the erased user granted as staff: the grant stays, the granter becomes the placeholder
  search.raw.prepare(`UPDATE billing_subscriptions SET comp_by = ? WHERE user_id = ?`).run(USER, OTHER);
  return { reports, search };
}

describe('eraseUserTraces (#1059)', () => {
  it('deletes invites, error-group membership and category suggestions; anonymises error events, keeping the errors', async () => {
    const { reports, search } = seed();
    const result = await eraseUserTraces(reports, search, USER, ERASED);
    expect(result).toEqual({ invites: 1, errorUsers: 1, errorEvents: 2, categorySuggestions: 1, rateLimits: 2, creatorTier: 1, captionMinutes: 5, tierRequests: 2, billing: 6, adminDeletions: 0, adminJobs: 0 });

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
    // Caption minutes (usage, overdraft, holds, ledger, grants): the erased user's rows only
    for (const table of ['caption_minute_usage', 'caption_minute_overdraft', 'caption_minute_holds', 'caption_minute_ledger', 'caption_minute_grants']) {
      expect(search.raw.prepare(`SELECT user_id FROM ${table}`).all()).toEqual([{ user_id: OTHER }]);
    }
    expect(search.raw.prepare("SELECT user_id FROM tier_requests WHERE id != 'tr_decided'").all()).toEqual([{ user_id: OTHER }]);
    expect(search.raw.prepare("SELECT status, decided_by FROM tier_requests WHERE id = 'tr_decided'").get()).toEqual({ status: 'approved', decided_by: ERASED });
    expect(search.raw.prepare('SELECT user_id, comp_reason, comp_by, customer_ref FROM billing_subscriptions ORDER BY id').all()).toEqual([
      { user_id: ERASED, comp_reason: null, comp_by: null, customer_ref: null },
      { user_id: OTHER, comp_reason: 'thanks', comp_by: ERASED, customer_ref: `fake_cus_${OTHER}` },
    ]);
    expect(search.raw.prepare('SELECT user_id, amount, receipt_url FROM billing_payments ORDER BY id').all()).toEqual([
      { user_id: ERASED, amount: 500, receipt_url: null },
      { user_id: OTHER, amount: 500, receipt_url: `https://receipts.example/${OTHER}` },
    ]);
    expect(search.raw.prepare("SELECT payload FROM billing_events WHERE user_id = ?").get(ERASED)).toEqual({ payload: '{}' });
    expect(search.raw.prepare('SELECT user_id FROM billing_customers').all()).toEqual([{ user_id: OTHER }]);
    expect(search.raw.prepare('SELECT user_id FROM billing_checkouts').all()).toEqual([{ user_id: OTHER }]);
  });

  it('is idempotent and works without the search database', async () => {
    const { reports, search } = seed();
    await eraseUserTraces(reports, search, USER, ERASED);
    expect(await eraseUserTraces(reports, search, USER, ERASED)).toEqual({ invites: 0, errorUsers: 0, errorEvents: 0, categorySuggestions: 0, rateLimits: 0, creatorTier: 0, captionMinutes: 0, tierRequests: 0, billing: 0, adminDeletions: 0, adminJobs: 0 });
    expect((await eraseUserTraces(reports, undefined, OTHER, ERASED)).categorySuggestions).toBe(0);
  });
});
