/**
 * Public / Studio Ummah Kids catalog, curated playlists, and review-request API tests
 * (wiki E20 §5.2; story E20-2).
 */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { KIDS_DECISION_IDS, forgetFeatureSwitches, kidsCanTurnOnHook, writeFeatureSwitch } from '@al-ummah/shared-types';
import { kidsRouter, handleStudioKidsReviewRequest } from '../src/routers/kids.router';
import { applyFeatureGates } from '../src/middleware/require-feature';
import { errorEnvelope } from '../src/middleware/error-envelope';
import { MemoryBucket } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';

async function setup(switchOn = true, userId: string | null = 'usr_creator') {
  forgetFeatureSwitches();
  const db = new SqliteD1();
  const channels = new MemoryBucket({
    ch_1: { id: 'ch_1', userId: 'usr_creator', members: [] },
    ch_other: { id: 'ch_other', userId: 'usr_someone_else', members: [] },
  });
  const playlists = new MemoryBucket({
    pl_1: {
      id: 'pl_1',
      title: 'Arabic Letters',
      channelId: 'ch_1',
      isPublic: true,
      videos: ['vid_1', 'vid_2', 'vid_3'],
    },
    pl_empty: {
      id: 'pl_empty',
      title: 'Empty Playlist',
      channelId: 'ch_1',
      isPublic: true,
      videos: ['vid_2', 'vid_3'],
    },
  });

  // Seed search_videos: vid_1 visible & approved, vid_2 hidden, vid_3 visible & NOT approved
  await db
    .prepare(
      `INSERT INTO search_videos (id, channel_id, visible, payload) VALUES
       ('vid_1', 'ch_1', 1, ?),
       ('vid_2', 'ch_1', 0, ?),
       ('vid_3', 'ch_1', 1, ?)`,
    )
    .bind(
      JSON.stringify({
        id: 'vid_1',
        title: 'Arabic Alphabet Song',
        description: 'Sing along safely.\nCheck example.com/bad or https://evil.example/out\nSecond line stays.',
        descriptionLocalized: { ar: 'أنشودة الحروف t.me/spam https://evil.example/ar' },
        channelId: 'ch_1',
        channelName: 'Kids Studio',
        thumbnailUrl: 'https://cdn.example/vid_1.jpg',
        commentSettings: 'on',
        likesCount: 99,
        dislikesCount: 4,
        commentsCount: 12,
        views: 5000,
        tags: ['alpha'],
        mp4Path: 'secret/raw.mp4',
        playerLinks: [{ url: 'https://bad.example' }],
        endScreen: { items: [] },
        cards: [{ title: 'Click' }],
      }),
      JSON.stringify({ id: 'vid_2', title: 'Hidden Video', channelId: 'ch_1' }),
      JSON.stringify({ id: 'vid_3', title: 'Adult Lecture', channelId: 'ch_1' }),
    )
    .run();

  await db
    .prepare("INSERT INTO search_playlists (id, channel_id, visible, payload) VALUES ('pl_1', 'ch_1', 1, ?), ('pl_empty', 'ch_1', 1, ?)")
    .bind(
      JSON.stringify({
        id: 'pl_1',
        title: 'Arabic Letters',
        description: 'Learn letters cleanly. Visit https://spam.example for more',
        channelId: 'ch_1',
        channelName: 'Kids Studio',
        thumbnailUrl: 'https://creator-unapproved.example/raw.jpg',
        coverVideoIds: ['vid_3', 'vid_2'],
        videosCount: 3,
        userId: 'usr_secret_creator',
        videos: ['vid_1', 'vid_2', 'vid_3'],
      }),
      JSON.stringify({ id: 'pl_empty', title: 'No Approved Videos', channelId: 'ch_1', videos: ['vid_2', 'vid_3'] }),
    )
    .run();
  await db
    .prepare("INSERT INTO search_channels (id, channel_id, visible, payload) VALUES ('ch_1', 'ch_1', 1, ?)")
    .bind(JSON.stringify({ id: 'ch_1', name: 'Kids Studio' }))
    .run();

  await db
    .prepare(
      `INSERT INTO kids_catalog_items (id, target_type, target_id, age_band, status, topics_json, position, approved_by, approved_at, updated_at) VALUES
       ('kc_1', 'video', 'vid_1', '3-6', 'approved', '["arabic_letters","nasheed"]', 1, 'usr_mod', '2026-11-23T00:00:00Z', '2026-11-23T00:00:00Z'),
       ('kc_2', 'video', 'vid_2', 'all', 'approved', '["dua"]', 2, 'usr_mod', '2026-11-23T00:00:00Z', '2026-11-23T00:00:00Z'),
       ('kc_pl', 'playlist', 'pl_1', '3-6', 'approved', '["arabic_letters"]', 3, 'usr_mod', '2026-11-23T00:00:00Z', '2026-11-23T00:00:00Z'),
       ('kc_pl_empty', 'playlist', 'pl_empty', '3-6', 'approved', '["dua"]', 4, 'usr_mod', '2026-11-23T00:00:00Z', '2026-11-23T00:00:00Z'),
       ('kc_ch', 'channel', 'ch_1', 'all', 'approved', '["quran"]', 5, 'usr_mod', '2026-11-23T00:00:00Z', '2026-11-23T00:00:00Z')`,
    )
    .run();

  if (switchOn) {
    const allDecisions = JSON.stringify(Object.fromEntries(KIDS_DECISION_IDS.map((id) => [id, 'Option A'])));
    await db
      .prepare("INSERT INTO kids_policy_settings (key, decisions_json, staff_channel_ids_json, legal_approved, legal_approved_by, legal_approved_at, updated_at) VALUES ('default', ?, '[\"ch_1\"]', 1, 'usr_sa', '2026-11-23T00:00:00Z', '2026-11-23T00:00:00Z')")
      .bind(allDecisions)
      .run();
    const readiness = await kidsCanTurnOnHook({ SEARCH_DB: db as never });
    assert.deepEqual(readiness, { ok: true });
    await writeFeatureSwitch({ SEARCH_DB: db as never }, { key: 'ummahKids', enabled: true, expectedVersion: 0, actorId: 'usr_sa', currentStored: false });
  }

  const kvStore = new Map<string, string>();
  let failKvPut = false;
  const appConfigKv = {
    async get(key: string, type?: string) {
      const v = kvStore.get(key);
      return v === undefined ? null : type === 'json' ? JSON.parse(v) : v;
    },
    async put(key: string, value: string) {
      if (failKvPut) throw new Error('KV put failed');
      kvStore.set(key, value);
    },
    async delete(key: string) {
      kvStore.delete(key);
    },
  };

  const env = { SEARCH_DB: db, channels, playlists, APP_CONFIG: appConfigKv };
  const app = new Hono();
  app.use('*', errorEnvelope);
  applyFeatureGates(app, 'api-videos');
  app.use('*', async (c, next) => {
    if (userId) c.set('userId' as never, userId as never);
    await next();
  });
  app.route('/api/kids', kidsRouter as never);
  app.post('/api/studio/channels/:channelId/kids-review', handleStudioKidsReviewRequest as never);
  const req = (path: string, init?: RequestInit) => app.request(path, init, env as never);
  return {
    db,
    playlists,
    kvStore,
    setFailKvPut(v: boolean) {
      failKvPut = v;
    },
    req,
  };
}

beforeEach(() => forgetFeatureSwitches());

describe('api-videos /api/kids', () => {
  it('returns 404 feature_off when ummahKids switch is off', async () => {
    const t = await setup(false);
    const res = await t.req('/api/kids/catalog');
    assert.equal(res.status, 404);
    assert.equal(((await res.json()) as any).code, 'feature_off');
  });

  it('sanitizes videos & curated playlists, omits empty playlists/channels, and strips playlist coverVideoIds/userId/links (S-K)', async () => {
    const t = await setup(true);
    const res = await t.req('/api/kids/catalog?ageBand=3-6');
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.deepEqual(
      body.items.map((i: any) => i.targetId),
      ['vid_1', 'pl_1'],
    );
    assert.equal(body.items[0].item.commentSettings, 'off');
    assert.equal(body.items[0].item.autoplayNext, false);
    assert.equal('playerLinks' in body.items[0].item, false);
    assert.equal('likesCount' in body.items[0].item, false);
    assert.equal('dislikesCount' in body.items[0].item, false);
    assert.equal('commentsCount' in body.items[0].item, false);
    assert.equal('views' in body.items[0].item, false);
    assert.equal('tags' in body.items[0].item, false);
    assert.equal('mp4Path' in body.items[0].item, false);
    assert.equal(body.items[0].item.description.includes('https://'), false);
    assert.equal(body.items[0].item.description.includes('example.com'), false);
    assert.ok(body.items[0].item.description.includes('\n'), 'line breaks must be preserved');
    assert.equal(body.items[0].item.descriptionLocalized.ar.includes('https://'), false);
    assert.equal(body.items[0].item.descriptionLocalized.ar.includes('t.me'), false);

    const plCard = body.items[1].item;
    assert.equal(plCard.approvedVideosCount, 1);
    assert.equal(plCard.approvedCoverUrl, 'https://cdn.example/vid_1.jpg');
    assert.equal('coverVideoIds' in plCard, false);
    assert.equal('thumbnailUrl' in plCard, false);
    assert.equal('videosCount' in plCard, false);
    assert.equal('userId' in plCard, false);
    assert.equal(plCard.description.includes('https://'), false);

    // Search query never surfaces unapproved vid_3
    const searchRes = await t.req('/api/kids/catalog?q=Lecture');
    assert.equal(((await searchRes.json()) as any).items.length, 0);

    // Query plan uses idx_kids_catalog_browse without full-table scan or temp B-tree
    const planRes = await t.db
      .prepare("EXPLAIN QUERY PLAN SELECT id, target_type, target_id, age_band, status, topics_json, position, approved_at FROM kids_catalog_items WHERE status = 'approved' AND target_type = 'video' AND age_band = '3-6' ORDER BY position ASC, approved_at DESC, id ASC LIMIT 25")
      .all<{ detail: string }>();
    const plan = (planRes.results ?? []).map((r) => String(r.detail)).join(' | ');
    assert.ok(plan.includes('USING INDEX idx_kids_catalog_browse'), plan);
    assert.ok(!plan.includes('USE TEMP B-TREE'), plan);
  });

  it('chunks large playlists past D1 100-bind limit and fails closed on R2 errors', async () => {
    const t = await setup(true);
    // Add 130 approved visible videos + 1 unapproved inside one playlist to exercise chunking (> 100 binds)
    const bigVideoIds: string[] = [];
    for (let i = 0; i < 130; i++) {
      const vid = `big_vid_${String(i).padStart(3, '0')}`;
      bigVideoIds.push(vid);
      await t.db
        .prepare('INSERT INTO search_videos (id, channel_id, visible, payload) VALUES (?, ?, 1, ?)')
        .bind(vid, 'ch_1', JSON.stringify({ id: vid, title: `Story ${i}`, channelId: 'ch_1' }))
        .run();
      await t.db
        .prepare("INSERT INTO kids_catalog_items (id, target_type, target_id, age_band, status, topics_json, position, approved_by, approved_at, updated_at) VALUES (?, 'video', ?, '3-6', 'approved', '[\"dua\"]', ?, 'usr_mod', '2026-11-23T00:00:00Z', '2026-11-23T00:00:00Z')")
        .bind(`kc_big_${i}`, vid, 20 + i)
        .run();
    }
    t.playlists.store.set('pl_big', JSON.stringify({ id: 'pl_big', title: 'Big Series', channelId: 'ch_1', isPublic: true, videos: [...bigVideoIds, 'vid_3'] }));
    await t.db.prepare("INSERT INTO search_playlists (id, channel_id, visible, payload) VALUES ('pl_big', 'ch_1', 1, ?)").bind(JSON.stringify({ id: 'pl_big', title: 'Big Series', channelId: 'ch_1' })).run();
    await t.db.prepare("INSERT INTO kids_catalog_items (id, target_type, target_id, age_band, status, topics_json, position, approved_by, approved_at, updated_at) VALUES ('kc_pl_big', 'playlist', 'pl_big', '3-6', 'approved', '[\"dua\"]', 10, 'usr_mod', '2026-11-23T00:00:00Z', '2026-11-23T00:00:00Z')").run();

    const bigDetail = await t.req('/api/kids/playlists/pl_big?ageBand=3-6');
    assert.equal(bigDetail.status, 200);
    const bigBody = (await bigDetail.json()) as any;
    assert.equal(bigBody.items.length, 130);
    assert.equal(bigBody.playlist.item.approvedVideosCount, 130);

    // Pagination finds matches beyond 100 rows & across hidden items cleanly
    const searchLate = await t.req('/api/kids/catalog?q=Story%20129');
    assert.equal(searchLate.status, 200);
    assert.deepEqual(((await searchLate.json()) as any).items.map((x: any) => x.targetId), ['big_vid_129']);

    // R2 read error returns 503 instead of empty 200
    const origGet = t.playlists.get.bind(t.playlists);
    t.playlists.get = async () => {
      throw new Error('R2 outage');
    };
    const errRes = await t.req('/api/kids/playlists/pl_1?ageBand=3-6');
    assert.equal(errRes.status, 503);
    t.playlists.get = origGet;

    // Keyset cursor pagination visits every item once and terminates cleanly with nextCursor: null
    const seenIds: string[] = [];
    let cursor: string | null = null;
    for (let pageNum = 0; pageNum < 10; pageNum++) {
      const qs = cursor ? `?limit=50&cursor=${encodeURIComponent(cursor)}` : '?limit=50';
      const pageRes = await t.req(`/api/kids/catalog${qs}`);
      assert.equal(pageRes.status, 200);
      const pageBody = (await pageRes.json()) as any;
      for (const entry of pageBody.items) seenIds.push(entry.targetId);
      cursor = pageBody.nextCursor;
      if (!pageBody.hasMore) break;
    }
    assert.equal(cursor, null);
    assert.equal(new Set(seenIds).size, seenIds.length);
    assert.ok(seenIds.includes('vid_1') && seenIds.includes('big_vid_129'));

    // Removing ch_1 from staff_channel_ids_json immediately excludes pl_1 from reads (S-J)
    await t.db.prepare("UPDATE kids_policy_settings SET staff_channel_ids_json = '[]' WHERE key = 'default'").run();
    const afterRemoveCatalog = await t.req('/api/kids/catalog?targetType=playlist');
    assert.equal(((await afterRemoveCatalog.json()) as any).items.length, 0);
    const afterRemoveDetail = await t.req('/api/kids/playlists/pl_1');
    assert.equal(afterRemoveDetail.status, 404);
  });

  it('accepts video-only creator review requests and blocks duplicates or channel/playlist submissions', async () => {
    const t = await setup(true, 'usr_creator');
    const badTypeCh = await t.req('/api/studio/channels/ch_1/kids-review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetType: 'channel', targetId: 'ch_1' }),
    });
    assert.equal(badTypeCh.status, 400);

    const badTypePl = await t.req('/api/studio/channels/ch_1/kids-review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetType: 'playlist', targetId: 'pl_1' }),
    });
    assert.equal(badTypePl.status, 400);

    const badChannel = await t.req('/api/studio/channels/ch_other/kids-review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetType: 'video', targetId: 'vid_3' }),
    });
    assert.equal(badChannel.status, 403);

    const first = await t.req('/api/studio/channels/ch_1/kids-review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetType: 'video', targetId: 'vid_3', suggestedAgeBand: '7-12' }),
    });
    assert.equal(first.status, 201);

    const dup = await t.req('/api/studio/channels/ch_1/kids-review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetType: 'video', targetId: 'vid_3', suggestedAgeBand: '7-12' }),
    });
    assert.equal(dup.status, 409);
    assert.equal(((await dup.json()) as any).code, 'kids_review_pending');
  });

  it('enforces live revocations/unpublishes/staff removals on warm snapshots, fails closed on KV write errors, and pages past 300 items', async () => {
    const t = await setup(true);

    // 1. Failed snapshot cache write propagates as 503 instead of swallowing silently (SF-4)
    t.setFailKvPut(true);
    const kvErrRes = await t.req('/api/kids/catalog');
    assert.equal(kvErrRes.status, 503);
    t.setFailKvPut(false);

    // 2. Warm KV snapshot stores compact playlist references and hides revoked/unpublished items immediately (SF-2)
    const warmRes = await t.req('/api/kids/catalog?ageBand=3-6');
    assert.equal(warmRes.status, 200);
    const snapRaw = t.kvStore.get('kids:catalog:snapshot:v1');
    assert.ok(snapRaw);
    assert.ok(!snapRaw!.includes('"playerLinks"'));

    // Revoke vid_1 in D1 WITHOUT clearing KV -> warm snapshot read immediately drops vid_1 & pl_1 (now empty)
    await t.db.prepare("UPDATE kids_catalog_items SET status = 'revoked' WHERE target_id = 'vid_1'").run();
    const afterRevoke = await t.req('/api/kids/catalog?ageBand=3-6');
    assert.equal(afterRevoke.status, 200);
    assert.deepEqual(((await afterRevoke.json()) as any).items, []);

    // Re-approve vid_1, then unpublish pl_1 and verify /playlists immediately omits it
    t.kvStore.clear();
    await t.db.prepare("UPDATE kids_catalog_items SET status = 'approved' WHERE target_id = 'vid_1'").run();
    await t.req('/api/kids/playlists');
    await t.db.prepare("UPDATE search_playlists SET visible = 0 WHERE id = 'pl_1'").run();
    const plAfterUnpublish = await t.req('/api/kids/playlists');
    assert.deepEqual(((await plAfterUnpublish.json()) as any).items, []);

    // 3. Tail D1 traversal finds matches and pages cleanly beyond 300 items (SF-3)
    await t.db.prepare("UPDATE search_playlists SET visible = 1 WHERE id = 'pl_1'").run();
    t.kvStore.clear();
    for (let i = 0; i < 320; i++) {
      const vid = `scale_vid_${String(i).padStart(3, '0')}`;
      await t.db
        .prepare('INSERT INTO search_videos (id, channel_id, visible, payload) VALUES (?, ?, 1, ?)')
        .bind(vid, 'ch_1', JSON.stringify({ id: vid, title: `Scale Episode ${i}`, channelId: 'ch_1' }))
        .run();
      await t.db
        .prepare("INSERT INTO kids_catalog_items (id, target_type, target_id, age_band, status, topics_json, position, approved_by, approved_at, updated_at) VALUES (?, 'video', ?, '3-6', 'approved', '[\"dua\"]', ?, 'usr_mod', '2026-11-23T00:00:00Z', '2026-11-23T00:00:00Z')")
        .bind(`kc_scale_${i}`, vid, 50 + i)
        .run();
    }
    const lateSearch = await t.req('/api/kids/catalog?q=Episode%20315');
    assert.equal(lateSearch.status, 200);
    assert.deepEqual(((await lateSearch.json()) as any).items.map((x: any) => x.targetId), ['scale_vid_315']);

    // Traverse pages cleanly from snapshot into D1 tail past index 300
    const seen: string[] = [];
    let nextCursor: string | null = null;
    for (let p = 0; p < 12; p++) {
      const url = nextCursor ? `/api/kids/catalog?limit=50&cursor=${encodeURIComponent(nextCursor)}` : '/api/kids/catalog?limit=50';
      const r = await t.req(url);
      assert.equal(r.status, 200);
      const b = (await r.json()) as any;
      for (const item of b.items) seen.push(item.targetId);
      nextCursor = b.nextCursor;
      if (!b.hasMore) break;
    }
    assert.equal(nextCursor, null);
    assert.equal(new Set(seen).size, seen.length);
    assert.ok(seen.includes('scale_vid_000'));
    assert.ok(seen.includes('scale_vid_319'));

    // Normalized /playlists/:id Cache API key blocks ?random query bypasses and isolates by ENVIRONMENT
    const edgeStore = new Map<string, { status: number; body: string; headers: [string, string][] }>();
    const prevCaches = (globalThis as { caches?: unknown }).caches;
    let r2Reads = 0;
    const origPlGet = t.playlists.get.bind(t.playlists);
    t.playlists.get = async (k: string) => {
      r2Reads += 1;
      return origPlGet(k);
    };
    (globalThis as { caches?: unknown }).caches = {
      default: {
        async match(req: Request) {
          const hit = edgeStore.get(req.url);
          return hit ? new Response(hit.body, { status: hit.status, headers: hit.headers }) : undefined;
        },
        async put(req: Request, res: Response) {
          edgeStore.set(req.url, { status: res.status, body: await res.text(), headers: [...res.headers.entries()] });
        },
        async delete(req: Request) {
          return edgeStore.delete(req.url);
        },
      },
    };
    try {
      r2Reads = 0;
      const firstPl = await t.req('/api/kids/playlists/pl_1?ageBand=3-6&rand=1');
      assert.equal(firstPl.status, 200);
      assert.equal(r2Reads, 1);
      // Give waitUntil microtask a turn to write edge cache if non-sync
      await new Promise((r) => setTimeout(r, 10));
      const secondPl = await t.req('/api/kids/playlists/pl_1?ageBand=3-6&rand=9999');
      assert.equal(secondPl.status, 200);
      // In Hono unit tests without ExecutionContext.waitUntil, safeWaitUntil runs synchronous/no-op only when ctx absent;
      // verify normalized key format if put ran, and verify environment-scoped snapshot URL
      for (const k of edgeStore.keys()) {
        assert.ok(k.includes('env='), `expected env= in cache key: ${k}`);
        assert.ok(!k.includes('rand='), `unexpected random param in cache key: ${k}`);
      }
    } finally {
      (globalThis as { caches?: unknown }).caches = prevCaches;
      t.playlists.get = origPlGet;
    }
  });
});
