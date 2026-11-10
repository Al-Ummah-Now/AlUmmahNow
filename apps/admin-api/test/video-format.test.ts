import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { firstVideoFormatMessage, readVideoFormatRunFrom, startVideoFormatRunWith, VIDEO_FORMAT_JOB_KIND } from '@al-ummah/shared-types';
import { hasPermission } from '../src/lib/roles';
import { listFlaggedVideos, setVideoFormats } from '../src/lib/videoFormat';
import { MemoryR2 } from './r2-fake';

/** The search DB (api-videos migrations/search) on node:sqlite. */
function searchDb() {
  const dir = join(process.cwd(), '..', 'api-videos', 'migrations', 'search');
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) db.exec(readFileSync(join(dir, f), 'utf8'));
  const statement = (sql: string, args: unknown[] = []) => ({
    bind: (...next: unknown[]) => statement(sql, next),
    first: async () => (db.prepare(sql).all(...(args as never[]))[0] ?? null),
    all: async () => ({ results: db.prepare(sql).all(...(args as never[])) }),
  });
  return { raw: db, d1: { prepare: (sql: string) => statement(sql) } };
}

describe('video formats (admin)', () => {
  it('only admins and super admins hold videos:format', () => {
    for (const roles of [['Admin'], ['Super Admin']]) assert.equal(hasPermission(roles, 'videos:format'), true, String(roles));
    for (const roles of [['Moderator'], ['User'], []]) assert.equal(hasPermission(roles, 'videos:format'), false, String(roles));
  });

  it('sets a format with a conditional write, resolves the flag and queues the index refresh', async () => {
    const bucket = new MemoryR2();
    bucket.set('v1', { id: 'v1', title: 'Clip', duration: 50, formatIssue: { reason: 'no size', missing: ['dimensions'], at: 't0' } });
    const refreshed: Array<{ id: string; object: any; version: number }> = [];
    const refresh = async (id: string, object: Record<string, unknown>, version: number) => {
      refreshed.push({ id, object, version });
    };
    const results = await setVideoFormats(bucket as never, refresh, ['v1', 'v1', 'missing'], 'short', 'admin-1', '2026-11-10T00:00:00.000Z');
    assert.deepEqual(results, [{ id: 'v1', changed: true }, { id: 'missing', changed: false, error: 'Video not found' }]);
    const stored = bucket.read('v1');
    assert.equal(stored.format, 'short');
    assert.equal(stored.formatIssue, undefined);
    assert.deepEqual(stored.formatSetBy, { by: 'admin', userId: 'admin-1', at: '2026-11-10T00:00:00.000Z' });
    assert.equal(refreshed.length, 1);
    assert.equal(refreshed[0].object.format, 'short');
    assert.ok(refreshed[0].version > 0);

    // Same choice again: no write, no refresh
    assert.deepEqual(await setVideoFormats(bucket as never, refresh, ['v1'], 'short', 'admin-1'), [{ id: 'v1', changed: false }]);
    assert.equal(refreshed.length, 1);
    // auto: back to detection
    await setVideoFormats(bucket as never, refresh, ['v1'], 'auto', 'admin-1');
    assert.equal(bucket.read('v1').format, undefined);
  });

  it('lists flagged videos from the ownership index, newest first', async () => {
    const { raw, d1 } = searchDb();
    const insert = raw.prepare("INSERT INTO content_ownership (kind, id, is_deleted, needs_format, created_at) VALUES ('video', ?, ?, ?, ?)");
    insert.run('old', 0, 1, 1);
    insert.run('new', 0, 1, 2);
    insert.run('fine', 0, 0, 3);
    insert.run('gone', 1, 1, 4);
    const bucket = new MemoryR2();
    bucket.set('old', { id: 'old', title: 'Old', duration: 40, formatIssue: { reason: 'no size', missing: ['dimensions'], at: 't' } });
    bucket.set('new', { id: 'new', title: 'New', width: 720, height: 1280, formatIssue: { reason: 'no length', missing: ['duration'], at: 't' } });
    const page = await listFlaggedVideos(d1 as never, bucket, 10, 0);
    assert.equal(page.total, 2);
    assert.deepEqual(page.items.map((v) => v.id), ['new', 'old']);
    assert.deepEqual(page.items[0].detected, { format: 'video', source: 'unknown', missing: ['duration'] });
    assert.equal((await listFlaggedVideos(d1 as never, bucket, 1, 1)).items[0].id, 'old');
  });

  it('starting a run writes its state and queues page 0 on the processing-check queue', async () => {
    const bucket = new MemoryR2();
    const sent: unknown[] = [];
    const run = await startVideoFormatRunWith(bucket as never, { send: async (b: unknown) => { sent.push(b); } }, { dryRun: true, requestedBy: 'admin-1', runId: 'run-12345678' });
    assert.deepEqual(sent, [firstVideoFormatMessage(run)]);
    assert.equal((sent[0] as any).kind, VIDEO_FORMAT_JOB_KIND);
    assert.equal((sent[0] as any).dryRun, true);
    const latest = await readVideoFormatRunFrom(bucket as never);
    assert.equal(latest?.runId, 'run-12345678');
    assert.equal(latest?.status, 'running');
  });
});
