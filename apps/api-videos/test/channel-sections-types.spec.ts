/**
 * Channel section types (docs/specs/CHANNEL-SECTIONS.md): what each type
 * shows, that empty sections reach editors only, removed content is filtered,
 * the owner-only opt-in for subscriptions and likes, limits and the
 * spotlight's place.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ChannelSectionCreate } from '../src/endpoints/channel-section/channelSectionCreate';
import { ChannelSectionUpdate } from '../src/endpoints/channel-section/channelSectionUpdate';
import { ChannelSectionReorder } from '../src/endpoints/channel-section/channelSectionReorder';
import { ChannelSectionDelete } from '../src/endpoints/channel-section/channelSectionDelete';
import { ChannelSectionsList } from '../src/endpoints/channel-section/channelSectionList';
import { ChannelSectionsListPopulated } from '../src/endpoints/channel-section/channelSectionListPopulated';
import { populateSection } from '../src/lib/channelSectionPopulator';
import { CHANNEL_SECTION_CONSTRAINTS, SECTION_TYPE_GROUPS, CHANNEL_SECTION_TYPES } from '@al-ummah/shared-types';
import { MemoryBucket, MemoryQueue, buildApp, videoFixture } from './helpers';
import { createSqliteD1 } from './sqlite-d1';

const OWNER = 'owner';
const CH = 'ch';
const json = { 'Content-Type': 'application/json' };

const channel = (id: string, extra: Record<string, unknown> = {}) => ({ id, userId: `${id}-user`, name: `Channel ${id}`, isMain: true, ...extra });

function env() {
  const db = createSqliteD1();
  // The owner liked: a public video, a private one, then another public one
  db.raw.prepare("INSERT INTO liked_videos VALUES (?, 'o1', 3), (?, 'v-priv', 2), (?, 'v-long1', 1)").run(OWNER, OWNER, OWNER);
  // The owner subscribes to a listable channel and a suspended one
  db.raw.prepare("INSERT INTO channel_subscriptions VALUES ('ch-a', ?, ?, 's1', 1), ('ch-susp', ?, ?, 's2', 2)").run(CH, OWNER, CH, OWNER);

  const post = (id: string, extra: Record<string, unknown>) => ({
    id, channelId: CH, userId: OWNER, type: 'text', content: `Post ${id}`, likes: 0, comments: 0, shares: 0, views: 0,
    createdAt: `2026-03-0${id.slice(-1)}T00:00:00.000Z`, pinned: false, status: 'published', visibility: 'public',
    commentsEnabled: true, channelName: 'Channel', channelVerified: false, ...extra,
  });

  return {
    channels: new MemoryBucket({
      [CH]: { id: CH, userId: OWNER, name: 'Channel', isMain: true },
      'ch-a': channel('ch-a'),
      'ch-b': channel('ch-b'),
      'ch-del': channel('ch-del', { isDeleted: true }),
      'ch-hid': channel('ch-hid', { isHidden: true }),
      'ch-priv': channel('ch-priv', { isPrivate: true }),
      'ch-susp': channel('ch-susp', { isSuspended: true }),
    }),
    videos: new MemoryBucket({
      'v-long1': videoFixture({ id: 'v-long1', channelId: CH, userId: OWNER, duration: 600, views: 5, dateCreated: '2026-01-01T00:00:00.000Z' }),
      'v-long2': videoFixture({ id: 'v-long2', channelId: CH, userId: OWNER, duration: 900, views: 50, dateCreated: '2026-02-01T00:00:00.000Z' }),
      's1': videoFixture({ id: 's1', channelId: CH, userId: OWNER, duration: 30, views: 1, dateCreated: '2026-02-02T00:00:00.000Z' }),
      's2': videoFixture({ id: 's2', channelId: CH, userId: OWNER, duration: 40, views: 9, dateCreated: '2026-01-02T00:00:00.000Z' }),
      'v-priv': videoFixture({ id: 'v-priv', channelId: CH, userId: OWNER, isPublic: false }),
      'v-proc': videoFixture({ id: 'v-proc', channelId: CH, userId: OWNER, uploadStatus: 'processing', dateCreated: '2026-04-01T00:00:00.000Z' }),
      'v-del': videoFixture({ id: 'v-del', channelId: CH, userId: OWNER, isDeleted: true }),
      'o1': videoFixture({ id: 'o1', channelId: 'ch-a', userId: 'ch-a-user' }),
      'o-hidden-channel': videoFixture({ id: 'o-hidden-channel', channelId: 'ch-hid', userId: 'ch-hid-user' }),
      'livestream:l1': { id: 'livestream:l1', title: 'Live lesson', channelId: CH, userId: OWNER, status: 'live', actualStartTime: '2026-11-10T10:00:00.000Z', streamKey: 'SECRET', rtmpUrl: 'rtmp://x', dateCreated: '2026-11-10T00:00:00.000Z' },
      'livestream:l2': { id: 'livestream:l2', title: 'Next khutbah', channelId: CH, userId: OWNER, status: 'scheduled', scheduledStartTime: '2099-01-01T00:00:00.000Z', dateCreated: '2026-11-10T00:00:00.000Z' },
      'livestream:l3': { id: 'livestream:l3', title: 'Last week', channelId: CH, userId: OWNER, status: 'ended', actualStartTime: '2026-11-01T10:00:00.000Z', actualEndTime: '2026-11-01T11:00:00.000Z', dateCreated: '2026-11-01T00:00:00.000Z' },
      'livestream:l4': { id: 'livestream:l4', title: 'Private', channelId: CH, userId: OWNER, status: 'live', isPrivate: true, dateCreated: '2026-11-10T00:00:00.000Z' },
    }),
    playlists: new MemoryBucket({
      p1: { id: 'p1', title: 'Tafsir', channelId: CH, userId: OWNER, videos: ['v-priv', 'v-long2', 'v-long1'], isPublic: true, dateCreated: '2026-01-01T00:00:00.000Z' },
      p2: { id: 'p2', title: 'Seerah', channelId: CH, userId: OWNER, videos: ['v-long1'], isPublic: true, dateCreated: '2026-02-01T00:00:00.000Z' },
      'p-priv': { id: 'p-priv', title: 'Drafts', channelId: CH, userId: OWNER, videos: [], isPublic: false },
      'p-other': { id: 'p-other', title: 'Other', channelId: 'ch-a', userId: 'ch-a-user', videos: ['o1'], isPublic: true },
    }),
    community_posts: new MemoryBucket({
      [`posts/${CH}/index.json`]: { postIds: ['post5', 'post4', 'post3', 'post2', 'post1'] },
      [`posts/${CH}/post1.json`]: post('post1', {}),
      [`posts/${CH}/post2.json`]: post('post2', { visibility: 'subscribers' }),
      [`posts/${CH}/post3.json`]: post('post3', { pinned: true, images: [{ url: 'https://cdn/x.jpg', width: 10, height: 10, mimeType: 'image/jpeg', size: 1 }] }),
      [`posts/${CH}/post4.json`]: post('post4', { isDeleted: true }),
      [`posts/${CH}/post5.json`]: post('post5', { status: 'draft' }),
    }),
    channel_tabs: new MemoryBucket(),
    channel_sections: new MemoryBucket(),
    profiles: new MemoryBucket(),
    queue: new MemoryQueue(),
    NOTIFICATIONS_DB: db,
  };
}

function routes(r: any) {
  r.get('/api/channels/:channelId/sections', ChannelSectionsList);
  r.get('/api/channels/:channelId/sections/populated', ChannelSectionsListPopulated);
  r.patch('/api/channels/:channelId/sections/reorder', ChannelSectionReorder);
  r.post('/api/channels/:channelId/sections', ChannelSectionCreate);
  r.patch('/api/channels/:channelId/sections/:sectionId', ChannelSectionUpdate);
  r.delete('/api/channels/:channelId/sections/:sectionId', ChannelSectionDelete);
}

const ownerApp = buildApp(routes, { userId: OWNER });
const visitorApp = buildApp(routes, null);
const strangerApp = buildApp(routes, { userId: 'stranger' });
const staffApp = buildApp(routes, { userId: 'staff', roles: ['Super Admin'] });

const send = (app: any, e: any, method: string, path: string, body?: unknown) =>
  app.request(path, { method, headers: json, body: body === undefined ? undefined : JSON.stringify(body) }, e);

async function add(e: any, body: Record<string, unknown>, app = ownerApp) {
  const res = await send(app, e, 'POST', `/api/channels/${CH}/sections`, { title: 'T', ...body });
  return { status: res.status, body: (await res.json()) as any };
}

async function populated(e: any, app: any) {
  const res = await send(app, e, 'GET', `/api/channels/${CH}/sections/populated`);
  assert.equal(res.status, 200);
  return ((await res.json()) as any).result.sections as any[];
}

/** Adds one section and returns it as the owner and as a visitor see it */
async function addAndRead(e: any, body: Record<string, unknown>) {
  const created = await add(e, body);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.result.section.id;
  const asOwner = (await populated(e, ownerApp)).find((s) => s.id === id);
  const asVisitor = (await populated(e, visitorApp)).find((s) => s.id === id);
  return { id, asOwner, asVisitor };
}

describe('channel section types: content per type', () => {
  it('lists exactly 13 types, each in one dialog group', () => {
    const grouped = Object.values(SECTION_TYPE_GROUPS).flat();
    assert.equal(CHANNEL_SECTION_TYPES.length, 13);
    assert.deepEqual([...grouped].sort(), [...CHANNEL_SECTION_TYPES].sort());
  });

  it('channel_spotlight: trailer and returning video, own public videos only; first in order', async () => {
    const e = env();
    await add(e, { type: 'recent_uploads' });
    const { asVisitor } = await addAndRead(e, { type: 'channel_spotlight', trailerVideoId: 'v-long1', returningVideoId: 'v-long2' });
    assert.equal(asVisitor.populatedContent.spotlight.trailer.id, 'v-long1');
    assert.equal(asVisitor.populatedContent.spotlight.returning.id, 'v-long2');
    const order = (await populated(e, visitorApp)).map((s) => s.type);
    assert.equal(order[0], 'channel_spotlight', 'spotlight leads even when created last');

    const other = await add(env(), { type: 'channel_spotlight', trailerVideoId: 'o1' });
    assert.equal(other.status, 400);
    assert.equal(other.body.code, 'invalid_video');
    assert.equal((await add(env(), { type: 'channel_spotlight' })).body.code, 'validation_failed');
    assert.equal((await add(env(), { type: 'channel_spotlight', trailerVideoId: 'v-priv' })).body.code, 'invalid_video');
  });

  it('featured_videos: keeps order, drops videos that went private or whose channel is hidden', async () => {
    const e = env();
    const { id, asVisitor } = await addAndRead(e, { type: 'featured_videos', videoIds: ['o1', 'v-long1'] });
    assert.deepEqual(asVisitor.populatedContent.videos.map((v: any) => v.id), ['o1', 'v-long1']);
    assert.equal(asVisitor.populatedContent.videos[0].channelName, 'Channel ch-a', 'each video carries its own channel');

    // Stored ids that later became unavailable are filtered at read time
    const stored = e.channel_sections.read(`${CH}/${id}`);
    await e.channel_sections.put(`${CH}/${id}`, JSON.stringify({ ...stored, videoIds: ['v-del', 'o-hidden-channel', 'v-proc'] }));
    assert.equal((await populated(e, visitorApp)).find((s) => s.id === id), undefined, 'empty: hidden from visitors');
    const owner = (await populated(e, ownerApp)).find((s) => s.id === id);
    assert.equal(owner.isEmpty, true);
    assert.equal(owner.emptyHint, 'noContent');
    assert.equal(owner.canEdit, true);

    assert.equal((await add(env(), { type: 'featured_videos', videoIds: ['v-priv'] })).body.code, 'invalid_video');
  });

  it('recent_uploads and popular_uploads: long-form public ready videos, newest / most viewed first', async () => {
    const e = env();
    const recent = await addAndRead(e, { type: 'recent_uploads' });
    assert.deepEqual(recent.asVisitor.populatedContent.videos.map((v: any) => v.id), ['v-long2', 'v-long1']);
    const popular = await addAndRead(e, { type: 'popular_uploads' });
    assert.deepEqual(popular.asVisitor.populatedContent.videos.map((v: any) => v.id), ['v-long2', 'v-long1']);
    assert.ok(recent.asVisitor.populatedContent.videos.every((v: any) => Array.isArray(v.comments) && v.comments.length === 0), 'shelf videos carry no comment list');
  });

  it('shorts: Shorts only, by sort; one section per sort', async () => {
    const e = env();
    const latest = await addAndRead(e, { type: 'shorts' });
    assert.deepEqual(latest.asVisitor.populatedContent.videos.map((v: any) => v.id), ['s1', 's2']);
    assert.equal(latest.asVisitor.sort, 'latest');
    const popular = await addAndRead(e, { type: 'shorts', sort: 'popular' });
    assert.deepEqual(popular.asVisitor.populatedContent.videos.map((v: any) => v.id), ['s2', 's1']);
    assert.equal((await add(e, { type: 'shorts', sort: 'popular' })).status, 409);
  });

  it('live_streams: live first then upcoming; past separately; no private streams or stream keys', async () => {
    const e = env();
    const now = await addAndRead(e, { type: 'live_streams' });
    assert.deepEqual(now.asVisitor.populatedContent.streams.map((s: any) => s.id), ['livestream:l1', 'livestream:l2']);
    const body = JSON.stringify(now.asVisitor);
    assert.ok(!body.includes('SECRET') && !body.includes('rtmp://'), 'no stream key or RTMP URL');
    const past = await addAndRead(e, { type: 'live_streams', liveFilter: 'past' });
    assert.deepEqual(past.asVisitor.populatedContent.streams.map((s: any) => s.id), ['livestream:l3']);
    assert.equal(past.asVisitor.populatedContent.streams[0].duration, 3600);
  });

  it('single_playlist: own public playlist as a shelf of its listable videos in playlist order', async () => {
    const e = env();
    const { asVisitor } = await addAndRead(e, { type: 'single_playlist', playlistId: 'p1' });
    assert.equal(asVisitor.populatedContent.playlist.id, 'p1');
    assert.deepEqual(asVisitor.populatedContent.videos.map((v: any) => v.id), ['v-long2', 'v-long1']);
    assert.equal((await add(env(), { type: 'single_playlist', playlistId: 'p-other' })).body.code, 'invalid_playlist');
    assert.equal((await add(env(), { type: 'single_playlist', playlistId: 'p-priv' })).body.code, 'invalid_playlist');
  });

  it('multiple_playlists and created_playlists: public playlists of this channel', async () => {
    const e = env();
    const picked = await addAndRead(e, { type: 'multiple_playlists', playlistIds: ['p2', 'p1'] });
    assert.deepEqual(picked.asVisitor.populatedContent.playlists.map((p: any) => p.id), ['p2', 'p1']);
    const created = await addAndRead(e, { type: 'created_playlists' });
    assert.deepEqual(created.asVisitor.populatedContent.playlists.map((p: any) => p.id), ['p2', 'p1'], 'newest first, private left out');
  });

  it('featured_channels: hand-picked, in order; never this channel; unavailable channels filtered', async () => {
    const e = env();
    const { id, asVisitor } = await addAndRead(e, { type: 'featured_channels', title: 'Our scholars', channelIds: ['ch-b', 'ch-a'] });
    assert.equal(asVisitor.title, 'Our scholars');
    assert.deepEqual(asVisitor.populatedContent.channels.map((c: any) => c.id), ['ch-b', 'ch-a']);
    assert.ok(!JSON.stringify(asVisitor).includes('ch-b-user'), 'no owner account ids in channel summaries');

    for (const bad of ['ch-del', 'ch-hid', 'ch-priv', 'ch-susp', 'missing']) {
      assert.equal((await add(env(), { type: 'featured_channels', channelIds: [bad] })).body.code, 'invalid_channel', bad);
    }
    assert.equal((await add(env(), { type: 'featured_channels', channelIds: [CH] })).body.code, 'invalid_channel');

    // A featured channel suspended later disappears at once
    const channels = e.channels as MemoryBucket;
    await channels.put('ch-b', JSON.stringify({ ...channels.read('ch-b'), isSuspended: true }));
    const after = (await populated(e, visitorApp)).find((s) => s.id === id);
    assert.deepEqual(after.populatedContent.channels.map((c: any) => c.id), ['ch-a']);
  });

  it('community_posts: published public posts newest first; pinned mode; never subscriber posts', async () => {
    const e = env();
    const latest = await addAndRead(e, { type: 'community_posts', itemCount: 6 });
    assert.deepEqual(latest.asVisitor.populatedContent.posts.map((p: any) => p.id), ['post3', 'post1']);
    assert.equal(latest.asVisitor.populatedContent.posts[0].image.url, 'https://cdn/x.jpg');
    assert.equal(latest.asVisitor.itemCount, 6);

    const e2 = env();
    const pinned = await addAndRead(e2, { type: 'community_posts', postMode: 'pinned' });
    assert.deepEqual(pinned.asVisitor.populatedContent.posts.map((p: any) => p.id), ['post3']);
    assert.equal(pinned.asVisitor.itemCount, CHANNEL_SECTION_CONSTRAINTS.DEFAULT_POST_COUNT);
  });

  it('community_posts: hidden while the Community tab is hidden', async () => {
    const e = env();
    await e.channel_tabs.put(`channel-tabs/${CH}`, JSON.stringify({ tabs: [{ id: 'community', visible: false }] }));
    const { asOwner, asVisitor } = await addAndRead(e, { type: 'community_posts' });
    assert.equal(asVisitor, undefined);
    assert.equal(asOwner.emptyHint, 'communityTabHidden');
  });
});

describe('channel section types: owner opt-in for subscriptions and likes (spec §6)', () => {
  for (const type of ['subscribed_channels', 'liked_videos'] as const) {
    it(`${type}: needs consent from the owner`, async () => {
      const e = env();
      const missing = await add(e, { type });
      assert.equal(missing.status, 400);
      assert.equal(missing.body.code, 'consent_required');

      // A site role grants nothing on a channel
      const staff = await add(e, { type, consent: true }, staffApp);
      assert.equal(staff.status, 403);
    });
  }

  it('subscribed_channels: lists listable subscriptions only with consent; withdrawing hides it', async () => {
    const e = env();
    const { id, asVisitor } = await addAndRead(e, { type: 'subscribed_channels', consent: true });
    assert.deepEqual(asVisitor.populatedContent.channels.map((c: any) => c.id), ['ch-a'], 'suspended channel left out');
    assert.equal(asVisitor.consented, true);

    const res = await send(ownerApp, e, 'PATCH', `/api/channels/${CH}/sections/${id}`, { consent: false });
    assert.equal(res.status, 200);
    assert.equal((await populated(e, visitorApp)).find((s) => s.id === id), undefined);
    const owner = (await populated(e, ownerApp)).find((s) => s.id === id);
    assert.equal(owner.emptyHint, 'consentMissing');
    assert.equal(owner.consented, false);
  });

  it('liked_videos: public likes only, newest first', async () => {
    const e = env();
    const { asVisitor } = await addAndRead(e, { type: 'liked_videos', consent: true });
    assert.deepEqual(asVisitor.populatedContent.videos.map((v: any) => v.id), ['o1', 'v-long1']);
  });

  it('a stored section without consent (created before this release) is hidden from visitors', async () => {
    const e = env();
    await e.channel_sections.put(`${CH}/old`, JSON.stringify({
      id: 'old', channelId: CH, userId: OWNER, type: 'subscribed_channels', title: 'Subs', position: 0, style: 'horizontal_row',
      videoIds: [], playlistIds: [], channelIds: [], itemCount: 12, showTimestamp: true, showChannelName: false,
      dateCreated: '2026-01-01T00:00:00.000Z', dateModified: '2026-01-01T00:00:00.000Z',
    }));
    assert.equal((await populated(e, visitorApp)).length, 0);
    assert.equal((await populated(e, ownerApp))[0].emptyHint, 'consentMissing');
  });

  it("consent lapses when the channel changes owner", async () => {
    const e = env();
    await addAndRead(e, { type: 'liked_videos', consent: true });
    const channels = e.channels as MemoryBucket;
    await channels.put(CH, JSON.stringify({ ...channels.read(CH), userId: 'new-owner' }));
    assert.equal((await populated(e, visitorApp)).length, 0);
  });
});

describe('channel section types: limits, permissions, failures', () => {
  it('one of each automatic type; 12 sections in total', async () => {
    const e = env();
    assert.equal((await add(e, { type: 'recent_uploads' })).status, 201);
    const again = await add(e, { type: 'recent_uploads' });
    assert.equal(again.status, 409);
    assert.equal(again.body.code, 'section_type_limit');
    assert.equal((await add(e, { type: 'channel_spotlight', trailerVideoId: 'v-long1' })).status, 201);
    assert.equal((await add(e, { type: 'channel_spotlight', trailerVideoId: 'v-long2' })).status, 409);

    for (let i = 2; i < CHANNEL_SECTION_CONSTRAINTS.MAX_SECTIONS_PER_CHANNEL; i++) {
      assert.equal((await add(e, { type: 'featured_videos', videoIds: ['v-long1'] })).status, 201);
    }
    const over = await add(e, { type: 'featured_videos', videoIds: ['v-long1'] });
    assert.equal(over.status, 400);
    assert.equal(over.body.code, 'section_limit');
  });

  it('reorder keeps the spotlight first', async () => {
    const e = env();
    const a = (await add(e, { type: 'recent_uploads' })).body.result.section.id;
    const spot = (await add(e, { type: 'channel_spotlight', trailerVideoId: 'v-long1' })).body.result.section.id;
    const b = (await add(e, { type: 'popular_uploads' })).body.result.section.id;
    const res = await send(ownerApp, e, 'PATCH', `/api/channels/${CH}/sections/reorder`, { sectionIds: [b, a, spot] });
    assert.equal(res.status, 200);
    const ids = ((await res.json()) as any).result.sections.map((s: any) => s.id);
    assert.deepEqual(ids, [spot, b, a]);
  });

  it('only the channel owner writes sections', async () => {
    const e = env();
    const res = await add(e, { type: 'recent_uploads' }, strangerApp);
    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'forbidden');
  });

  it('the spotlight can drop one video but not both', async () => {
    const e = env();
    const id = (await add(e, { type: 'channel_spotlight', trailerVideoId: 'v-long1', returningVideoId: 'v-long2' })).body.result.section.id;
    const path = `/api/channels/${CH}/sections/${id}`;
    assert.equal((await send(ownerApp, e, 'PATCH', path, { returningVideoId: null })).status, 200);
    const cleared = await send(ownerApp, e, 'PATCH', path, { trailerVideoId: null });
    assert.equal(cleared.status, 400);
    assert.equal(e.channel_sections.read(`${CH}/${id}`).trailerVideoId, 'v-long1');
  });

  it('a section whose source fails is empty (loadFailed), never a failed response', async () => {
    const e = env();
    await add(e, { type: 'created_playlists' });
    await add(e, { type: 'recent_uploads' });
    (e.playlists as any).list = async () => { throw new Error('R2 unavailable'); };
    const visitor = await populated(e, visitorApp);
    assert.deepEqual(visitor.map((s) => s.type), ['recent_uploads']);
    const owner = await populated(e, ownerApp);
    assert.equal(owner.find((s) => s.type === 'created_playlists').emptyHint, 'loadFailed');
  });

  it('populateSection reports empty content for every type with nothing to show', async () => {
    const bare = {
      channels: new MemoryBucket({ [CH]: { id: CH, userId: OWNER, name: 'Channel' } }),
      videos: new MemoryBucket(), playlists: new MemoryBucket(), community_posts: new MemoryBucket(),
      channel_tabs: new MemoryBucket(), profiles: new MemoryBucket(), NOTIFICATIONS_DB: createSqliteD1(),
    };
    for (const type of CHANNEL_SECTION_TYPES) {
      const result = await populateSection({ id: 'x', channelId: CH, type, title: '', position: 0, itemCount: 12, consent: { grantedBy: OWNER, grantedAt: '' } } as never, bare);
      assert.equal(result.isEmpty, true, type);
      assert.ok(result.emptyHint, type);
    }
  });
});

describe('channel section types: edge cache for signed-out visitors (spec §8.4)', () => {
  /** A Cache API stand-in on globalThis.caches.default */
  function stubCache() {
    const store = new Map<string, string>();
    const cache = {
      match: async (url: string) => (store.has(url) ? new Response(store.get(url)) : undefined),
      put: async (url: string, res: Response) => { store.set(url, await res.text()); },
      delete: async (url: string) => store.delete(url),
    };
    (globalThis as any).caches = { default: cache };
    return store;
  }

  it('a visitor asking for fewer sections never shrinks the cached list for everyone', async () => {
    const store = stubCache();
    try {
      const e = env();
      await add(e, { type: 'recent_uploads' });
      await add(e, { type: 'popular_uploads' });
      const small = await send(visitorApp, e, 'GET', `/api/channels/${CH}/sections/populated?limit=1`);
      assert.equal(((await small.json()) as any).result.sections.length, 1);
      assert.equal(store.size, 0, 'a limited response is not cached');
      assert.equal((await populated(e, visitorApp)).length, 2);
      assert.equal(store.size, 1, 'the full list is cached');
      assert.equal((await populated(e, visitorApp)).length, 2);

      // A write purges this colo's entry
      await add(e, { type: 'shorts' });
      assert.equal(store.size, 0);
    } finally {
      delete (globalThis as any).caches;
    }
  });
});
