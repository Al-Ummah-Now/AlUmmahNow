/**
 * Verifies S-N across EVERY video edit path in api-videos:
 * editing an approved Kids video's metadata, localized title/description, thumbnail,
 * bulk edit / undo, admin update, or media upload completion synchronously revokes
 * its `kids_catalog_items` approval, writes an audit entry, and clears KV snapshot.
 */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VideoUpdate } from '../src/endpoints/video/videoUpdate';
import { VideoThumbnailUpload } from '../src/endpoints/video/videoThumbnailUpload';
import { VideoBulkUndo, VideoBulkUpdate } from '../src/endpoints/video/videoBulkUpdate';
import { UploadCompleteEndpoint } from '../src/endpoints/video/uploadComplete';
import { VideoChaptersUpdate } from '../src/endpoints/video/chaptersUpdate';
import { SubtitlesUpload } from '../src/endpoints/video/subtitlesUpload';
import { SubtitlesDelete } from '../src/endpoints/video/subtitlesDelete';
import { AudioTrackUpdate } from '../src/endpoints/audio/audioTracks';
import { updateVideo } from '../src/lib/admin/service';
import { KIDS_SNAPSHOT_KV_KEY } from '../src/lib/kids/revoke-on-edit';
import { MemoryBucket, MemoryQueue, buildApp, videoFixture } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';

class MemoryKV {
  store = new Map<string, string>();
  async get(key: string, type?: string) {
    const v = this.store.get(key);
    return v === undefined ? null : type === 'json' ? JSON.parse(v) : v;
  }
  async put(key: string, value: string) {
    this.store.set(key, value);
  }
  async delete(key: string) {
    this.store.delete(key);
  }
}

function png16x9(): Uint8Array {
  // Minimal valid PNG header with 320x180 IHDR dimensions, padded past minimum validator size
  const header = [
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x01, 0x40, // width = 320
    0x00, 0x00, 0x00, 0xb4, // height = 180
    0x08, 0x06, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
  ];
  return new Uint8Array([...header, ...new Array(2048).fill(0)]);
}

async function setupHarness(videoId = 'vid_kids_1') {
  const db = new SqliteD1();
  const kv = new MemoryKV();
  const videos = new MemoryBucket({
    [videoId]: videoFixture({
      id: videoId,
      userId: 'usr_owner',
      channelId: 'ch_1',
      title: 'Original Kids Title',
      description: 'Original safe description',
      width: 320,
      height: 180,
      thumbnailUrl: 'https://cdn.example/old.jpg',
      thumbnailType: 'custom',
      uploadStatus: 'ready',
      duration: 120,
      audioTracks: [
        { id: 'orig', language: 'en', label: 'English', kind: 'original', isDefault: true, state: 'ready', source: { type: 'source_stream', streamIndex: 0 }, createdAt: '2026-11-01T00:00:00Z' },
        { id: 'dub_ar', language: 'ar', label: 'Arabic', kind: 'dub', isDefault: false, state: 'ready', source: { type: 'upload', bytes: 1000 }, createdAt: '2026-11-01T00:00:00Z' },
      ],
    }),
  });
  const channels = new MemoryBucket({
    ch_1: { id: 'ch_1', userId: 'usr_owner', members: [] },
  });
  const playlists = new MemoryBucket({});
  const subtitles = new MemoryBucket({});
  const queue = new MemoryQueue();

  await db
    .prepare(
      `INSERT INTO kids_catalog_items (id, target_type, target_id, age_band, status, topics_json, position, approved_by, approved_at, updated_at)
       VALUES ('kc_1', 'video', ?, '3-6', 'approved', '["dua"]', 0, 'usr_mod', '2026-11-23T00:00:00Z', '2026-11-23T00:00:00Z')`,
    )
    .bind(videoId)
    .run();
  await kv.put(KIDS_SNAPSHOT_KV_KEY, JSON.stringify({ builtAt: 1, exhausted: true, cutoff: null, entries: [] }));

  const env = {
    SEARCH_DB: db,
    APP_CONFIG: kv,
    TUS_SESSIONS: kv,
    videos,
    channels,
    playlists,
    subtitles,
    queue,
    bunny_hostname: 'cdn.example',
    bunny_storage_zone: 'zone',
    'bunny-storage-key': 'secret',
    ZONE: 'zone',
    image_storage_key: 'storage-key',
    'bunny-stream-key': 'key',
    bunny_stream_library_id: '7',
  };

  async function statusOf(): Promise<{ status: string; preDeleteStatus: string | null }> {
    const row = await db
      .prepare("SELECT status, pre_delete_status FROM kids_catalog_items WHERE id = 'kc_1'")
      .first<{ status: string; pre_delete_status: string | null }>();
    return { status: row?.status ?? '', preDeleteStatus: row?.pre_delete_status ?? null };
  }
  async function resetApproval() {
    await db.prepare("UPDATE kids_catalog_items SET status = 'approved', pre_delete_status = NULL WHERE id = 'kc_1'").run();
    await kv.put(KIDS_SNAPSHOT_KV_KEY, JSON.stringify({ builtAt: 1, exhausted: true, cutoff: null, entries: [] }));
  }

  return { db, kv, videos, env, statusOf, resetApproval };
}

describe('S-N revokeKidsVideoOnEdit across all video edit paths', () => {
  beforeEach(() => {
    // No global state shared across tests
  });

  it('revokes synchronously on PUT /api/videos/:id metadata/localized change but skips non-sensitive tag edits', async () => {
    const h = await setupHarness();
    const app = buildApp((r) => r.put('/api/videos/:id', VideoUpdate as never), { userId: 'usr_owner' });

    // Tags-only change should keep approved status intact
    const tagRes = await app.request(
      '/api/videos/vid_kids_1',
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tags: ['new-tag'] }) },
      h.env as never,
    );
    assert.equal(tagRes.status, 200);
    assert.equal((await h.statusOf()).status, 'approved');

    // Localized title change must synchronously revoke & invalidate snapshot KV
    const titleRes = await app.request(
      '/api/videos/vid_kids_1',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ titleLocalized: { ar: 'عنوان جديد https://bad.test' } }),
      },
      h.env as never,
    );
    assert.equal(titleRes.status, 200);
    assert.equal((await h.statusOf()).status, 'revoked');
    assert.equal(h.kv.store.has(KIDS_SNAPSHOT_KV_KEY), false);

    const audit = await h.db.prepare("SELECT action FROM kids_catalog_audit WHERE entity_id = 'kc_1'").first<{ action: string }>();
    assert.equal(audit?.action, 'metadata_changed');
  });

  it('revokes on POST /api/videos/:id/thumbnail upload', async () => {
    const h = await setupHarness();
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response('ok', { status: 201 })) as typeof fetch;
    try {
      const app = buildApp((r) => r.post('/api/videos/:id/thumbnail', VideoThumbnailUpload as never), { userId: 'usr_owner' });
      const form = new FormData();
      form.append('thumbnail', new File([png16x9()], 'thumb.png', { type: 'image/png' }));
      const res = await app.request('/api/videos/vid_kids_1/thumbnail', { method: 'POST', body: form }, h.env as never);
      assert.equal(res.status, 200);
      assert.equal((await h.statusOf()).status, 'revoked');
      assert.equal(h.kv.store.has(KIDS_SNAPSHOT_KV_KEY), false);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('revokes on PATCH /api/videos/bulk and POST /api/videos/bulk/undo', async () => {
    const h = await setupHarness();
    const app = buildApp(
      (r) => {
        r.patch('/api/videos/bulk', VideoBulkUpdate as never);
        r.post('/api/videos/bulk/undo', VideoBulkUndo as never);
      },
      { userId: 'usr_owner' },
    );

    const opId = 'op_kids_12345678';
    const bulkRes = await app.request(
      '/api/videos/bulk',
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operationId: opId,
          videoIds: ['vid_kids_1'],
          changes: { description: { en: { mode: 'append', text: 'Updated by bulk' } } },
        }),
      },
      h.env as never,
    );
    assert.equal(bulkRes.status, 200);
    assert.equal((await h.statusOf()).status, 'revoked');

    // Moderator re-approves; creator then runs bulk/undo -> must revoke again!
    await h.resetApproval();
    const undoRes = await app.request(
      '/api/videos/bulk/undo',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operationId: opId, ids: ['vid_kids_1'] }),
      },
      h.env as never,
    );
    assert.equal(undoRes.status, 200);
    assert.equal((await h.statusOf()).status, 'revoked');
    assert.equal(h.kv.store.has(KIDS_SNAPSHOT_KV_KEY), false);
  });

  it('revokes on admin updateVideo, POST /api/videos/upload/complete, chapters, subtitles, and audio tracks', async () => {
    const h = await setupHarness();
    await updateVideo(h.env as never, 'vid_kids_1', { title: 'Admin Updated Title' }, 'usr_admin');
    assert.equal((await h.statusOf()).status, 'revoked');

    await h.resetApproval();
    const uploadApp = buildApp((r) => r.post('/api/videos/upload/complete', UploadCompleteEndpoint as never), { userId: 'usr_owner' });
    const completeRes = await uploadApp.request(
      '/api/videos/upload/complete',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId: 'vid_kids_1', fileSize: 12345, duration: 90 }),
      },
      h.env as never,
    );
    assert.equal(completeRes.status, 200);
    assert.equal((await h.statusOf()).status, 'revoked');

    // Chapters update revokes approval
    await h.resetApproval();
    const chaptersApp = buildApp((r) => r.put('/api/videos/:id/chapters', VideoChaptersUpdate as never), { userId: 'usr_owner' });
    const chapRes = await chaptersApp.request(
      '/api/videos/vid_kids_1/chapters',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chapters: [
            { id: '11111111-1111-4111-8111-111111111111', startTime: 0, endTime: 30, title: 'Intro' },
            { id: '22222222-2222-4222-8222-222222222222', startTime: 30, endTime: 90, title: 'Lesson' },
          ],
        }),
      },
      h.env as never,
    );
    assert.equal(chapRes.status, 200);
    assert.equal((await h.statusOf()).status, 'revoked');

    // Subtitles upload + delete revoke approval
    await h.resetApproval();
    const subApp = buildApp(
      (r) => {
        r.post('/api/videos/:videoId/subtitles', SubtitlesUpload as never);
        r.delete('/api/videos/:videoId/subtitles/:language', SubtitlesDelete as never);
      },
      { userId: 'usr_owner' },
    );
    const subForm = new FormData();
    subForm.append('language', 'en');
    subForm.append('subtitle', new File(['WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nBismillah\n'], 'en.vtt', { type: 'text/vtt' }));
    const subUpRes = await subApp.request('/api/videos/vid_kids_1/subtitles', { method: 'POST', body: subForm }, h.env as never);
    assert.equal(subUpRes.status, 200);
    assert.equal((await h.statusOf()).status, 'revoked');

    await h.resetApproval();
    const subDelRes = await subApp.request('/api/videos/vid_kids_1/subtitles/en', { method: 'DELETE' }, h.env as never);
    assert.equal(subDelRes.status, 200);
    assert.equal((await h.statusOf()).status, 'revoked');

    // Audio track edit revokes approval
    await h.resetApproval();
    const audioApp = buildApp((r) => r.patch('/api/videos/:videoId/audio-tracks/:trackId', AudioTrackUpdate as never), { userId: 'usr_owner' });
    const audioRes = await audioApp.request(
      '/api/videos/vid_kids_1/audio-tracks/dub_ar',
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'Arabic Updated' }),
      },
      h.env as never,
    );
    assert.equal(audioRes.status, 200);
    assert.equal((await h.statusOf()).status, 'revoked');
  });

  it('sets pre_delete_status = revoked when edited in trash and fails closed BEFORE mutating R2 if D1 errors', async () => {
    const h = await setupHarness();
    // 1. Trashed approved row: edit updates pre_delete_status -> 'revoked' so restore stays revoked
    await h.db.prepare("UPDATE kids_catalog_items SET status = 'deleted', pre_delete_status = 'approved' WHERE id = 'kc_1'").run();
    const app = buildApp(
      (r) => {
        r.put('/api/videos/:id', VideoUpdate as never);
        r.put('/api/videos/:id/chapters', VideoChaptersUpdate as never);
      },
      { userId: 'usr_owner' },
    );
    const trashEditRes = await app.request(
      '/api/videos/vid_kids_1',
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Edited In Trash' }) },
      h.env as never,
    );
    assert.equal(trashEditRes.status, 200);
    assert.deepEqual(await h.statusOf(), { status: 'deleted', preDeleteStatus: 'revoked' });

    // 2. Fail closed on D1 error BEFORE mutating R2
    await h.resetApproval();
    const failingEnv = {
      ...h.env,
      SEARCH_DB: {
        prepare: () => {
          throw new Error('D1 unavailable');
        },
      },
    };
    const failUpdateRes = await app.request(
      '/api/videos/vid_kids_1',
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Must Not Persist' }) },
      failingEnv as never,
    );
    assert.equal(failUpdateRes.status, 500);
    const storedAfterFail = await (await h.videos.get('vid_kids_1'))!.json<any>();
    assert.equal(storedAfterFail.title, 'Edited In Trash', 'R2 title must stay unmutated when D1 revocation fails');
    assert.equal((await h.statusOf()).status, 'approved');

    const failChaptersRes = await app.request(
      '/api/videos/vid_kids_1/chapters',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chapters: [{ id: '33333333-3333-4333-8333-333333333333', startTime: 0, endTime: 25, title: 'Blocked' }],
        }),
      },
      failingEnv as never,
    );
    assert.equal(failChaptersRes.status, 500);
    const storedAfterChapFail = await (await h.videos.get('vid_kids_1'))!.json<any>();
    assert.equal(storedAfterChapFail.chapters, undefined, 'R2 chapters must stay unmutated when D1 revocation fails');
  });
});
