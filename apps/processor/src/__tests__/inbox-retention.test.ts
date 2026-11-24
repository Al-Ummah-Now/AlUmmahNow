/**
 * Notifications inbox retention (wiki AUN-D1-SCALING D1-2): batched 90-day purge, the hourly trim of
 * recently notified users (read rows after 30 days, newest 500 read, newest 1,000 unread), its
 * resumable cursor, and query plans that never scan the table.
 */
import {
  NOTIFICATION_READ_CAP,
  NOTIFICATION_UNREAD_CAP,
} from '@al-ummah/shared-types';
import type { D1Database } from '../types';
import {
  PURGE_BATCH,
  TRIM_JOB,
  TRIM_PAGE,
  purgeExpiredNotifications,
  trimNotificationInboxes,
} from '../lib/notifications-store';
import { createSqliteD1 } from './sqlite-d1';

const DAY = 86_400_000;
const NOW = 1_900_000_000_000;

describe('notifications inbox retention', () => {
  let db: ReturnType<typeof createSqliteD1>;
  let seq = 0;
  const add = (user: string, ageDays: number, read: boolean, n = 1) => {
    const stmt = db.raw.prepare(
      `INSERT INTO notifications (id, user_id, category, notification_type, notification_key, params_json, is_read, created_at)
       VALUES (?, ?, 'activity', 'activity', 'newSubscriber', '{}', ?, ?)`,
    );
    for (let i = 0; i < n; i++) {
      seq++;
      stmt.run(`n${seq}`, user, read ? 1 : 0, NOW - ageDays * DAY + seq);
    }
  };
  const count = (where: string) => (db.raw.prepare(`SELECT COUNT(*) AS n FROM notifications WHERE ${where}`).get() as { n: number }).n;
  const d1 = () => db as unknown as D1Database;

  beforeEach(() => {
    db = createSqliteD1();
    seq = 0;
  });

  it('drops the redundant user/unread index and keeps the one that covers it', () => {
    const names = (db.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'notifications'").all() as { name: string }[]).map((r) => r.name);
    expect(names).not.toContain('idx_notifications_user_unread');
    expect(names).toEqual(expect.arrayContaining(['idx_notifications_user_unread_created', 'idx_notifications_created']));
  });

  it('serves the inbox queries, the purge and the trim from indexes (no table scan, no temp b-tree for the walk)', () => {
    const plan = (sql: string) => (db.raw.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as { detail: string }[]).map((r) => r.detail).join(' | ');
    const queries = [
      "SELECT COUNT(*) FROM notifications WHERE user_id = 'u' AND is_read = 0 AND hidden_at IS NULL",
      "UPDATE notifications SET is_read = 1, read_at = 1 WHERE user_id = 'u' AND is_read = 0",
      'SELECT id FROM notifications WHERE created_at < 5 ORDER BY created_at LIMIT 10',
      "SELECT id FROM notifications WHERE user_id = 'u' AND is_read = 1 AND created_at < 5 LIMIT 10",
      "SELECT id FROM notifications WHERE user_id = 'u' AND is_read = 1 ORDER BY created_at DESC LIMIT -1 OFFSET 500",
      'SELECT rowid, created_at, user_id FROM notifications WHERE created_at > 5 OR (created_at = 5 AND rowid > 1) ORDER BY created_at, rowid LIMIT 10',
    ];
    for (const q of queries) {
      const p = plan(q);
      expect(p).not.toMatch(/SCAN notifications(?! USING)/);
      expect(p).toMatch(/USING (COVERING )?INDEX|MULTI-INDEX/);
    }
    expect(plan(queries[5])).not.toMatch(/TEMP B-TREE/);
  });

  it('purges rows older than 90 days in batches, read or not', async () => {
    add('a', 91, false, PURGE_BATCH + 5);
    add('a', 89, false);
    add('b', 100, true);
    expect(await purgeExpiredNotifications(d1(), NOW)).toBe(PURGE_BATCH + 6);
    expect(count('1')).toBe(1);
    expect(await purgeExpiredNotifications(d1(), NOW)).toBe(0);
  });

  it('trims recently notified users: read rows after 30 days, newest 500 read, newest 1,000 unread', async () => {
    add('heavy', 40, true, 20); // read and past 30 days: go
    add('heavy', 10, true, NOTIFICATION_READ_CAP + 30); // read: only the newest 500 stay
    add('heavy', 50, false, 10); // unread and old: stay (only the 90-day purge takes them)
    add('heavy', 5, false, NOTIFICATION_UNREAD_CAP + 7); // unread: 1,018 in all, the 18 oldest go (the 10 above + 8 of these)
    add('heavy', 0, false); // the new notification that brings the user into the walk
    add('quiet', 40, true, 5); // nothing new for this user: not visited this run
    const before = count("user_id = 'heavy' AND is_read = 0");
    const out = await trimNotificationInboxes(d1(), NOW);
    expect(out.caughtUp).toBe(true);
    expect(count("user_id = 'heavy' AND is_read = 1")).toBe(NOTIFICATION_READ_CAP);
    expect(count(`user_id = 'heavy' AND is_read = 1 AND created_at < ${NOW - 30 * DAY}`)).toBe(0);
    expect(count("user_id = 'heavy' AND is_read = 0")).toBe(NOTIFICATION_UNREAD_CAP);
    expect(before - NOTIFICATION_UNREAD_CAP).toBe(18);
    // The newest unread rows are the ones kept
    const newest = db.raw.prepare("SELECT MAX(created_at) AS t FROM notifications WHERE user_id = 'heavy'").get() as { t: number };
    expect(count(`user_id = 'heavy' AND created_at = ${newest.t}`)).toBe(1);
    expect(count("user_id = 'quiet'")).toBe(5);
    expect(out.deleted).toBe(20 + 30 + 18);
  });

  it('keeps an all-unread inbox up to 1,000 rows and touches no read rows of others', async () => {
    add('u1', 1, false, 600);
    add('u2', 1, true, 3);
    await trimNotificationInboxes(d1(), NOW);
    expect(count("user_id = 'u1'")).toBe(600);
    expect(count("user_id = 'u2'")).toBe(3);
  });

  it('resumes from its cursor and visits only users notified since the last run', async () => {
    add('first', 0, true, 600);
    const one = await trimNotificationInboxes(d1(), NOW);
    expect(one.users).toBe(1);
    expect(count("user_id = 'first'")).toBe(NOTIFICATION_READ_CAP);
    const state = db.raw.prepare('SELECT created_at FROM notification_trim_state WHERE job = ?').get(TRIM_JOB) as { created_at: number };
    expect(state.created_at).toBeGreaterThan(NOW - DAY);
    add('first', 1, true, 50); // older than the cursor: not a new notification
    add('second', 0, false);
    const two = await trimNotificationInboxes(d1(), NOW + 1000);
    expect(two.users).toBe(1);
    expect(count("user_id = 'first'")).toBe(NOTIFICATION_READ_CAP + 50);
  });

  it('walks several pages in one run and then has nothing new (one fan-out to many users)', async () => {
    for (let u = 0; u < TRIM_PAGE * 2 + 10; u++) add(`user-${u}`, 0, false);
    const pages = await trimNotificationInboxes(d1(), NOW);
    expect(pages.caughtUp).toBe(true);
    expect(pages.users).toBe(TRIM_PAGE * 2 + 10);
    const again = await trimNotificationInboxes(d1(), NOW);
    expect(again.users).toBe(0);
  });

  it('a fan-out page above the cap stays one statement (the cap is not enforced on insert)', async () => {
    add('cap', 1, true, NOTIFICATION_READ_CAP + 100);
    // Inserting past the cap leaves the rows until the trim runs
    expect(count("user_id = 'cap'")).toBe(NOTIFICATION_READ_CAP + 100);
    await trimNotificationInboxes(d1(), NOW);
    expect(count("user_id = 'cap'")).toBe(NOTIFICATION_READ_CAP);
  });
});
