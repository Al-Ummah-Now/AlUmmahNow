/** Report statistics in one scan, and the QA/stage purge of admin E2E reports. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sqliteD1 } from './d1-sqlite';
import { computeReportStats, purgeE2eReports } from '../src/lib/report-stats';

const NOW = new Date('2026-11-11T12:00:00.000Z');
const ago = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString();

async function seed(db: D1Database, rows: Array<[string, string, string, string | null, string]>) {
  let i = 0;
  for (const [entityType, entityId, status, action, createdAt] of rows) {
    await db
      .prepare(`INSERT INTO reports (id, entity_type, entity_id, reporter_id, reason, status, action, created_at) VALUES (?, ?, ?, 'u1', 'spam', ?, ?, ?)`)
      .bind(`r${i++}`, entityType, entityId, status, action, createdAt)
      .run();
  }
}

describe('report stats', () => {
  it('counts by status, entity type, action and recent activity', async () => {
    const db = sqliteD1();
    await seed(db, [
      ['video', 'v1', 'pending', null, ago(1)],
      ['video', 'v2', 'resolved', 'removed', ago(30)],
      ['comment', 'c1', 'dismissed', 'dismissed', ago(24 * 3)],
      ['comment', 'c2', 'reviewing', null, ago(24 * 10)],
      ['channel', 'ch1', 'resolved', 'warning', ago(24 * 40)],
    ]);
    const stats = await computeReportStats(db, NOW);
    assert.deepEqual(stats, {
      total: 5,
      byStatus: { pending: 1, reviewing: 1, resolved: 2, dismissed: 1 },
      byEntityType: { video: 2, comment: 2, channel: 1 },
      byAction: { removed: 1, dismissed: 1, warning: 1 },
      recentActivity: { last24Hours: 1, last7Days: 3, last30Days: 4 },
    });
  });

  it('is all zeros on an empty table', async () => {
    const stats = await computeReportStats(sqliteD1(), NOW);
    assert.equal(stats.total, 0);
    assert.deepEqual(stats.byStatus, { pending: 0, reviewing: 0, resolved: 0, dismissed: 0 });
    assert.deepEqual(stats.recentActivity, { last24Hours: 0, last7Days: 0, last30Days: 0 });
  });
});

describe('E2E report purge', () => {
  const rows: Array<[string, string, string, string | null, string]> = [
    ['comment', 'e2e-admin-123-chromium-r-old', 'pending', null, ago(7)],
    ['comment', 'e2e-admin-123-chromium-r-new', 'pending', null, ago(1)],
    ['comment', 'real-comment-old', 'pending', null, ago(48)],
  ];

  it('deletes only admin E2E reports older than six hours on QA/stage', async () => {
    const db = sqliteD1();
    await seed(db, rows);
    assert.equal(await purgeE2eReports(db, 'qa', NOW), 1);
    const left = await db.prepare('SELECT entity_id FROM reports ORDER BY entity_id').all<{ entity_id: string }>();
    assert.deepEqual(left.results.map((r) => r.entity_id), ['e2e-admin-123-chromium-r-new', 'real-comment-old']);
  });

  it('never touches production', async () => {
    const db = sqliteD1();
    await seed(db, rows);
    assert.equal(await purgeE2eReports(db, 'production', NOW), 0);
    assert.equal(await purgeE2eReports(db, undefined, NOW), 0);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM reports').first<{ n: number }>())!.n, 3);
  });
});
