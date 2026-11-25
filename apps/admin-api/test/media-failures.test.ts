/** GET /api/media/failures: why videos failed (api-videos), with the imported file's name (REPORTS_DB, one index seek each). */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import mediaRouter from '../src/routers/media.router';
import { sqliteD1 } from './d1-sqlite';

const V1 = '00000000-0000-4000-8000-000000000001';
const V2 = '00000000-0000-4000-8000-000000000002';
const failure = (videoId: string) => ({ videoId, where: 'r2', reason: 'audio_only', cause: 'file', step: 'send_with_picture', title: 'Talk', plays: false, jobId: 'j', error: null, source: null, failedAt: null, fileName: 'picked.mov', importBatchId: null });

function setup(roles = ['Admin'], reports: unknown = undefined) {
  const db = sqliteD1();
  const asked: string[] = [];
  const env = {
    REPORTS_DB: reports ?? db,
    INTERNAL_API_KEY: 'internal-key-of-at-least-16',
    VIDEOS: {
      fetch: async (input: string | Request) => {
        const url = new URL(typeof input === 'string' ? input : input.url);
        asked.push(url.pathname + url.search);
        return Response.json({ success: true, result: { items: url.searchParams.get('ids')!.split(',').filter((id) => id !== 'not-failed').map(failure) } });
      },
    },
  };
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('auth' as never, { userId: 'usr_admin', roles } as never);
    await next();
  });
  app.route('/api/media', mediaRouter as never);
  const get = async (path: string) => {
    const res = await app.request(`/api/media${path}`, {}, env as never);
    return { status: res.status, body: (await res.json()) as any };
  };
  return { db, get, asked };
}

describe('GET /api/media/failures', () => {
  it('adds the name of the file an import sent, the newest one', async () => {
    const { db, get, asked } = setup();
    const add = (id: string, video: string | null, name: string, at: string) =>
      db.prepare("INSERT INTO import_items (id, batch_id, channel_id, sha256, file_name, file_size, video_id, state, created_by, created_at, updated_at) VALUES (?, ?, 'c', ?, ?, 1, ?, 'uploaded', 'u', ?, ?)").bind(id, `b-${id}`, id, name, video, at, at).run();
    await add('i1', V1, 'old.mp4', '2026-01-01');
    await add('i2', V1, 'محاضرة.mp4', '2026-02-01');
    await add('i3', null, 'never sent.mp4', '2026-03-01');
    const { status, body } = await get(`/failures?ids=${V1},${V2},${V1}`);
    assert.equal(status, 200);
    assert.deepEqual(body.result.items.map((f: any) => [f.videoId, f.fileName, f.importBatchId, f.reason]), [
      [V1, 'محاضرة.mp4', 'b-i2', 'audio_only'],
      [V2, 'picked.mov', null, 'audio_only'],
    ]);
    assert.deepEqual(asked, [`/internal/media/failures?ids=${encodeURIComponent(`${V1},${V2}`)}`]);
    const { results } = await db.prepare('EXPLAIN QUERY PLAN SELECT i.file_name FROM json_each(?) j CROSS JOIN import_items i INDEXED BY idx_import_items_video ON i.video_id = j.value WHERE i.video_id IS NOT NULL').bind('[]').all<{ detail: string }>();
    const plan = results.map((r) => r.detail).join(' | ');
    assert.match(plan, /SEARCH i USING INDEX idx_import_items_video \(video_id=\?\)/);
  });

  it('without the names the failures still say why', async () => {
    const { get } = setup(['Admin'], { prepare: () => { throw new Error('D1 down'); } });
    const { status, body } = await get(`/failures?ids=${V1}`);
    assert.deepEqual([status, body.result.items[0].fileName], [200, 'picked.mov']);
  });

  it('needs media:manage, and 1 to 100 video ids', async () => {
    assert.equal((await setup(['Moderator']).get(`/failures?ids=${V1}`)).status, 403);
    const { get, asked } = setup();
    for (const ids of ['', 'a/b', Array.from({ length: 101 }, (_, i) => `${V1}${i}`).join(',')]) assert.equal((await get(`/failures?ids=${ids}`)).status, 400, ids.slice(0, 20));
    assert.deepEqual(asked, []);
  });
});

describe('GET /api/media/troubleshoot', () => {
  it('passes the linked video on, only when it is an id', async () => {
    for (const [query, sent] of [[`?video=${V1}`, `/internal/media/troubleshoot?video=${V1}`], ['?video=../x', '/internal/media/troubleshoot']] as const) {
      const { get, asked } = setup();
      await get(`/troubleshoot${query}`);
      assert.ok(asked.includes(sent), asked.join());
    }
  });
});
