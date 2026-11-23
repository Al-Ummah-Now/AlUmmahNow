import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { QURAN_CURRENT_KEY, captionQuranMarker } from '@al-ummah/shared-types';
import { VideoRecitationGet, VideoRecitationMetadataPut } from '../src/endpoints/recitation/recitation';
import adminRouter from '../src/routers/admin.router';
import { clearQuranCopyCache } from '../src/lib/quran/copy';
import { assignTier, saveTier } from '../src/lib/creatorTiers';
import { SqliteD1 } from './search-sqlite-d1';
import { MemoryBucket, buildApp, videoFixture } from './helpers';

const RANGE = '112:1:1-112:1:4';
const OTHER = '112:2:1-112:2:2';

async function env(opts: { copy?: boolean; recitationMetadata?: boolean; isPublic?: boolean } = {}) {
  const d1 = new SqliteD1() as unknown as D1Database;
  await saveTier(d1, 'full', {
    name: 'Full',
    perHour: 5,
    perDay: 10,
    maxConcurrent: 2,
    maxChannels: 2,
    recitationMetadata: opts.recitationMetadata ?? true,
  }, 'admin-1', { create: true });
  await assignTier(d1, 'owner', 'full', 'admin-1');
  const MEDIA_PRIVATE = new MemoryBucket();
  if (opts.copy !== false) {
    const now = new Date().toISOString();
    MEDIA_PRIVATE.store.set(QURAN_CURRENT_KEY, JSON.stringify({ v: 1, version: 'fixture', syncedAt: now, builtAt: now, surahs: 114, words: 77429 }));
  }
  const subtitles = new MemoryBucket({
    'v1/metadata.json': {
      videoId: 'v1',
      tracks: [
        { id: 't1', language: 'ar', label: 'Arabic', kind: 'subtitles', origin: 'machine_edited', uploadedBy: 'owner', uploadedAt: 'x', fileSize: 1, format: 'vtt', url: 'u', status: 'ready' },
        { id: 't2', language: 'en', label: 'English', kind: 'subtitles', origin: 'upload', uploadedBy: 'owner', uploadedAt: 'x', fileSize: 1, format: 'vtt', url: 'u', status: 'ready' },
      ],
    },
  });
  subtitles.store.set('v1/ar.vtt', [
    'WEBVTT',
    'NOTE synthetic-ASR-must-not-leak',
    `00:00:01.250 --> 00:00:04.800\n${captionQuranMarker(RANGE, 'text')}`,
    `00:00:05.000 --> 00:00:06.500\n${captionQuranMarker(OTHER, 'reference')}`,
  ].join('\n\n'));
  subtitles.store.set('v1/en.vtt', `WEBVTT\n\n00:00:09.000 --> 00:00:10.000\n${captionQuranMarker(OTHER, 'text')}`);
  return {
    SEARCH_DB: d1,
    MEDIA_PRIVATE,
    subtitles,
    videos: new MemoryBucket({ v1: videoFixture({ isPublic: opts.isPublic ?? true }) }),
    channels: new MemoryBucket({ 'owner-ch': { id: 'owner-ch', userId: 'owner', members: [{ userId: 'ed', role: 'editor' }, { userId: 'mod', role: 'moderator' }] } }),
    ENVIRONMENT: 'test',
  };
}

const app = (userId = 'owner') => buildApp((router) => {
  router.get('/api/videos/:videoId/recitation', VideoRecitationGet);
  router.put('/api/videos/:videoId/recitation-metadata', VideoRecitationMetadataPut);
}, userId ? { userId } : null);
const json = (body: unknown) => ({ method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(() => clearQuranCopyCache());

describe('video recitation', () => {
  it('returns accepted references, timings, reciter metadata and credits, never Quran or ASR text', async () => {
    const e = await env();
    const response = await app('').request('/api/videos/v1/recitation', {}, e as never);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'public, max-age=60');
    const body = (await response.json()) as any;
    assert.deepEqual(body.data.items, [{ range: RANGE, startMs: 1250, endMs: 4800, boundary: 'cue' }]);
    assert.equal(body.data.reciter, null);
    assert.equal(body.data.credit.url, 'https://quran.foundation/');
    assert.equal(body.data.creditsPath, '/credits');
    assert.equal(JSON.stringify(body).includes('synthetic-ASR'), false);
    assert.equal(Object.hasOwn(body.data.items[0], 'text'), false);
  });

  it('uses the video read rule and never publicly caches a private answer', async () => {
    const e = await env({ isPublic: false });
    assert.equal((await app('').request('/api/videos/v1/recitation', {}, e as never)).status, 404);
    const owner = await app().request('/api/videos/v1/recitation', {}, e as never);
    assert.equal(owner.status, 200);
    assert.equal(owner.headers.get('cache-control'), 'private, no-store');
    assert.equal((await app('stranger').request('/api/videos/v1/recitation', {}, e as never)).status, 404);
  });

  it('is feature_off without a fresh Quran Foundation copy', async () => {
    const e = await env({ copy: false });
    const response = await app('').request('/api/videos/v1/recitation', {}, e as never);
    assert.equal(response.status, 404);
    assert.equal((await response.json() as any).code, 'feature_off');
  });

  it('saves bilingual human-supplied reciter metadata for the owner and a channel editor', async () => {
    const e = await env();
    const input = { reciter: { nameLocalized: { en: '  Example   Reciter  ', ar: 'قارئ تجريبي' }, riwayah: 'Hafs' } };
    for (const user of ['owner', 'ed']) {
      const response = await app(user).request('/api/videos/v1/recitation-metadata', json(input), e as never);
      assert.equal(response.status, 200, user);
      const body = (await response.json()) as any;
      assert.equal(body.data.recitation.reciter.name, 'Example Reciter');
      assert.equal(body.data.recitation.reciter.nameLocalized.ar, 'قارئ تجريبي');
      assert.equal(body.data.recitation.updatedBy, user);
    }
    assert.equal(e.videos.read<any>('v1').recitation.reciter.riwayah, 'Hafs');
    const cleared = await app().request('/api/videos/v1/recitation-metadata', json({ reciter: null }), e as never);
    assert.equal(cleared.status, 200);
    assert.equal(e.videos.read<any>('v1').recitation.reciter, null);
  });

  it('admin tier create and update accept recitationMetadata', async () => {
    const d1 = new SqliteD1() as unknown as D1Database;
    const admin = new Hono();
    admin.route('/internal/admin', adminRouter as never);
    const created = await admin.request('/internal/admin/creator-tiers', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-actor': 'admin-1' },
      body: JSON.stringify({
        name: 'Recitation admins', nameAr: 'فئة', description: 'A tier', descriptionAr: 'فئة',
        perHour: 5, perDay: 10, maxConcurrent: 1, maxChannels: 1, recitationMetadata: false,
      }),
    }, { SEARCH_DB: d1 } as never);
    assert.equal(created.status, 200);
    assert.equal((await created.json() as any).result.tier.recitationMetadata, false);
    const updated = await admin.request('/internal/admin/creator-tiers/recitation-admins', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-admin-actor': 'admin-1' },
      body: JSON.stringify({ recitationMetadata: true }),
    }, { SEARCH_DB: d1 } as never);
    assert.equal(updated.status, 200);
    assert.equal((await updated.json() as any).result.tier.recitationMetadata, true);
  });

  it('rejects empty metadata, other channel roles, and a tier without the capability', async () => {
    const allowed = await env();
    const empty = await app().request('/api/videos/v1/recitation-metadata', json({ reciter: { nameLocalized: {} } }), allowed as never);
    assert.equal(empty.status, 400);
    const tooLong = await app().request('/api/videos/v1/recitation-metadata', json({ reciter: { nameLocalized: { en: 'x'.repeat(201) } } }), allowed as never);
    assert.equal(tooLong.status, 400);
    assert.equal((await app('mod').request('/api/videos/v1/recitation-metadata', json({ reciter: null }), allowed as never)).status, 403);
    assert.equal((await app('stranger').request('/api/videos/v1/recitation-metadata', json({ reciter: null }), allowed as never)).status, 403);

    const denied = await env({ recitationMetadata: false });
    const response = await app().request('/api/videos/v1/recitation-metadata', json({ reciter: null }), denied as never);
    assert.equal(response.status, 404);
    assert.equal((await response.json() as any).code, 'feature_off');
  });
});
