/**
 * Notifications inbox retention (wiki AUN-D1-SCALING D1-2): the purge (every read row after 30
 * days, notified recently or not; everything after 90 days), the hourly trim of recently notified
 * users (newest 500 read, newest 1,000 unread) in bounded rounds with a time box and a resumable
 * cursor, a real fan-out page over the cap, and query plans that never scan the table.
 */
import { NOTIFICATION_READ_CAP, NOTIFICATION_UNREAD_CAP } from '@al-ummah/shared-types';
import type { D1Database } from '../types';
import {
  FANOUT_PAGE,
  PURGE_BATCH,
  TRIM_DELETE_BATCH,
  TRIM_JOB,
  TRIM_PAGE,
  TRIM_TIME_BOX_MS,
  fanoutNotificationPage,
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

  it('drops the redundant user/unread index, keeps the one that covers it, adds the read-rows index', () => {
    const names = (db.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'notifications'").all() as { name: string }[]).map((r) => r.name);
    expect(names).not.toContain('idx_notifications_user_unread');
    expect(names).toEqual(expect.arrayContaining(['idx_notifications_user_unread_created', 'idx_notifications_created', 'idx_notifications_read_created']));
  });

  it('serves the inbox queries, both purges, the caps and the walk from indexes (no scan, no temp b-tree for the walk)', () => {
    const plan = (sql: string) => (db.raw.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as { detail: string }[]).map((r) => r.detail).join(' | ');
    const queries = [
      "SELECT COUNT(*) FROM notifications WHERE user_id = 'u' AND is_read = 0 AND hidden_at IS NULL",
      "UPDATE notifications SET is_read = 1, read_at = 1 WHERE user_id = 'u' AND is_read = 0",
      'SELECT id FROM notifications WHERE created_at < 5 ORDER BY created_at LIMIT 10',
      'SELECT id FROM notifications WHERE is_read = 1 AND created_at < 5 ORDER BY created_at LIMIT 10',
      "SELECT id FROM notifications WHERE user_id = 'u' AND is_read = 1 ORDER BY created_at DESC LIMIT 500 OFFSET 500",
      "SELECT id FROM notifications WHERE user_id = 'u' AND is_read = 0 ORDER BY created_at DESC LIMIT 500 OFFSET 1000",
      'SELECT rowid, created_at, user_id FROM notifications WHERE created_at > 5 OR (created_at = 5 AND rowid > 1) ORDER BY created_at, rowid LIMIT 10',
    ];
    for (const q of queries) {
      const p = plan(q);
      expect(p).not.toMatch(/SCAN notifications(?! USING)/);
      expect(p).toMatch(/USING (COVERING )?INDEX|MULTI-INDEX/);
    }
    expect(plan(queries[3])).toMatch(/idx_notifications_read_created/);
    expect(plan(queries[6])).not.toMatch(/TEMP B-TREE/);
  });

  it('purges every read row after 30 days, also for a user who gets nothing new; unread rows stay until 90 days', async () => {
    add('quiet', 40, true, 5); // read, 40 days old, no new notification: goes
    add('quiet', 40, false, 3); // unread, 40 days old: stays
    add('quiet', 20, true, 2); // read, 20 days old: stays
    add('a', 91, false, PURGE_BATCH + 5); // everything past 90 days goes, in batches
    expect(await purgeExpiredNotifications(d1(), NOW)).toBe(5 + PURGE_BATCH + 5);
    expect(count("user_id = 'quiet' AND is_read = 1")).toBe(2);
    expect(count("user_id = 'quiet' AND is_read = 0")).toBe(3);
    expect(count("user_id = 'a'")).toBe(0);
    expect(await purgeExpiredNotifications(d1(), NOW)).toBe(0);
  });

  it('trims recently notified users to the newest 500 read and 1,000 unread rows', async () => {
    add('heavy', 10, true, NOTIFICATION_READ_CAP + 30); // read: the 30 oldest go
    add('heavy', 5, false, NOTIFICATION_UNREAD_CAP + 7); // unread: the 7 oldest go
    add('heavy', 0, false); // the new notification that brings the user into the walk; it is kept
    add('quiet', 5, false, 5); // under every cap: untouched
    const out = await trimNotificationInboxes(d1(), NOW);
    expect(out).toMatchObject({ caughtUp: true, timedOut: false, deleted: 30 + 8 });
    expect(count("user_id = 'heavy' AND is_read = 1")).toBe(NOTIFICATION_READ_CAP);
    expect(count("user_id = 'heavy' AND is_read = 0")).toBe(NOTIFICATION_UNREAD_CAP);
    const newest = db.raw.prepare("SELECT MAX(created_at) AS t FROM notifications WHERE user_id = 'heavy'").get() as { t: number };
    expect(count(`user_id = 'heavy' AND created_at = ${newest.t}`)).toBe(1);
    expect(count("user_id = 'quiet'")).toBe(5);
  });

  it('deletes at most 500 rows per statement and repeats for a user far over the cap', async () => {
    add('flood', 1, true, NOTIFICATION_READ_CAP + 2 * TRIM_DELETE_BATCH + 100); // 1,100 over: three rounds
    const prepared: string[] = [];
    const real = db.prepare.bind(db);
    (db as unknown as { prepare: typeof db.prepare }).prepare = (sql: string) => {
      if (/^\s*DELETE/.test(sql)) prepared.push(sql);
      return real(sql);
    };
    const out = await trimNotificationInboxes(d1(), NOW);
    expect(count("user_id = 'flood'")).toBe(NOTIFICATION_READ_CAP);
    expect(out.deleted).toBe(2 * TRIM_DELETE_BATCH + 100);
    expect(prepared.every((sql) => /LIMIT \?3 OFFSET \?4/.test(sql) && !/LIMIT -1/.test(sql))).toBe(true);
    expect(prepared.length).toBe(3 * 2); // three rounds of the two cap statements
  });

  it('stops at its time box without moving the cursor past the unfinished page; the next run finishes', async () => {
    for (let u = 0; u < 30; u++) add(`user-${u}`, 0, true, NOTIFICATION_READ_CAP + 5);
    let t = 0;
    const clock = () => {
      t += TRIM_TIME_BOX_MS; // the first check is already past the box
      return t;
    };
    const first = await trimNotificationInboxes(d1(), NOW, clock);
    expect(first.timedOut).toBe(true);
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM notification_trim_state WHERE job = ?').get(TRIM_JOB)).toEqual({ n: 0 });
    const second = await trimNotificationInboxes(d1(), NOW);
    expect(second).toMatchObject({ timedOut: false, caughtUp: true });
    expect(count(`is_read = 1`)).toBe(30 * NOTIFICATION_READ_CAP);
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

  it('a real fan-out page reaching an inbox over the cap is still one set-based insert; the trim then caps it', async () => {
    const sub = db.raw.prepare("INSERT INTO channel_subscribers VALUES ('big', ?, 'all', 0, 0)");
    for (let i = 0; i < FANOUT_PAGE + 50; i++) sub.run(`s${String(i).padStart(5, '0')}`);
    add('s00000', 1, true, NOTIFICATION_READ_CAP + 40); // an inbox already over the read cap
    const inserts: string[] = [];
    const real = db.prepare.bind(db);
    (db as unknown as { prepare: typeof db.prepare }).prepare = (sql: string) => {
      if (/INSERT\s+OR\s+IGNORE\s+INTO\s+notifications/i.test(sql)) inserts.push(sql);
      return real(sql);
    };
    const page = await fanoutNotificationPage(d1(), { kind: 'new_video', channelId: 'big', entityId: 'v1', isHighlight: true, actorUserId: 'owner', actionUrl: '/video/v1' }, NOW);
    expect(page.more).toBe(true);
    expect(inserts).toHaveLength(1); // one INSERT … SELECT for the whole page, whatever the caps
    expect(inserts[0]).toMatch(/SELECT/);
    expect(count("dedupe_key = 'video:v1'")).toBe(FANOUT_PAGE);
    expect(count("user_id = 's00000'")).toBe(NOTIFICATION_READ_CAP + 40 + 1); // over the cap until the trim
    await trimNotificationInboxes(d1(), NOW);
    expect(count("user_id = 's00000' AND is_read = 1")).toBe(NOTIFICATION_READ_CAP);
    expect(count("user_id = 's00000' AND is_read = 0")).toBe(1);
  });
});
