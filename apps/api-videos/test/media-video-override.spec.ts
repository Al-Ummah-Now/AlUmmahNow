/**
 * Per-video playback override (docs/media-delivery/PROVIDERS.md §Playback): the admin pins one
 * video's providers; a legacy row stays legacy; an override that leaves the video unplayable is
 * refused; the planner and the admin video page both see it.
 */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { DEFAULT_MEDIA_SETTINGS } from '@al-ummah/shared-types';
import { clearDeliverySettingsCache } from '../src/lib/media/r2-delivery';
import { clearMediaSettingsCache, saveMediaSettings } from '../src/lib/media/settings';
import { clearHealthCache } from '../src/lib/media/health';
import { choosePlayback } from '../src/lib/media/playback';
import { bunnyRef } from '../src/lib/media/providers';
import { adminVideoMedia, setVideoOverride } from '../src/lib/media/video-override';
import { createMediaInternalRouter } from '../src/endpoints/media/mediaInternal';
import { MemoryBucket, videoFixture } from './helpers';

const ID = '912859ed-e618-4d04-8438-874a74a251dd';
const BUNNY_HOST = 'vz-cb79844a-c5d.b-cdn.net';
const READY = { status: 'ready', jobId: 'j', rev: 'abcdefgh12345678', access: 'pub', attempts: 1, queuedAt: 'x' };
const BOTH = ['bunny', 'r2'] as const;

function setup(video: Record<string, unknown> = {}) {
	clearDeliverySettingsCache();
	clearMediaSettingsCache();
	clearHealthCache();
	const env = {
		videos: new MemoryBucket({
			[ID]: videoFixture({ id: ID, uploadStatus: 'ready', isPublic: true, playUrl: `https://${BUNNY_HOST}/${ID}/playlist.m3u8`, thumbnailUrl: `https://${BUNNY_HOST}/${ID}/thumbnail.jpg`, r2: READY, ...video }),
		}),
		global_settings: new MemoryBucket(),
		MEDIA_SIGN_KEY: 'sign-key',
		MEDIA_PUBLIC_HOST: 'media.qa.alummahnow.net',
		bunny_hostname: BUNNY_HOST,
	};
	const read = async () => JSON.parse(await (await env.videos.get(ID))!.text()) as Record<string, unknown>;
	return { env: env as never, raw: env, read };
}

describe('per-video playback override', () => {
	beforeEach(() => clearMediaSettingsCache());

	it('pins a legacy video to R2 without making it a new-style record', async () => {
		const { env, read } = setup();
		await saveMediaSettings(env, { ...DEFAULT_MEDIA_SETTINGS, playback: { ...DEFAULT_MEDIA_SETTINGS.playback, order: [...BOTH] } }, 'admin-1');
		const result = await setVideoOverride(env, ID, { order: ['r2', 'bunny'], note: 'Bunny buffering', ingest: ['r2'] }, 'admin-1', new Date('2026-11-14T10:00:00Z'));
		assert.ok(result.ok);
		const stored = await read();
		assert.equal(stored.media, undefined, 'a legacy row gets no media field');
		assert.deepEqual(stored.mediaOverride, { order: ['r2', 'bunny'], note: 'Bunny buffering', updatedAt: '2026-11-14T10:00:00.000Z', updatedBy: 'admin-1' });
		assert.equal(bunnyRef(stored as never), ID, 'Bunny still finds its copy by the video id');
		const choice = await choosePlayback(env, stored as never);
		assert.equal(choice.source, 'r2');
		assert.deepEqual(choice.sources.map((s) => s.provider), ['r2', 'bunny']);
	});

	it('the admin view shows each copy, the override and the effective rules', async () => {
		const { env, read } = setup({ channelId: 'ch_1' });
		await saveMediaSettings(env, { ...DEFAULT_MEDIA_SETTINGS, channels: { ch_1: { order: [...BOTH] } } }, 'admin-1');
		const before = await adminVideoMedia(env, { ...(await read()), id: ID } as never);
		assert.equal(before.override, null);
		assert.equal(before.channelOverride, true);
		assert.deepEqual(before.effective.order, ['bunny', 'r2']);
		assert.deepEqual(before.copies.map((c) => [c.provider, c.status, !!c.legacy]), [['bunny', 'ready', true], ['r2', 'ready', true]]);
		assert.ok(!JSON.stringify(before).includes('"ref"'), 'no provider-side ids');
		await setVideoOverride(env, ID, { strategy: 'weighted', order: [...BOTH], weights: { bunny: 30, r2: 70 } }, 'admin-1');
		const after = await adminVideoMedia(env, { ...(await read()), id: ID } as never);
		assert.equal(after.effective.strategy, 'weighted');
		assert.deepEqual(after.effective.weights, { bunny: 30, r2: 70 });
	});

	it('refuses an override whose providers hold no copy or are switched off', async () => {
		const { env, read } = setup({ r2: undefined });
		const noCopy = await setVideoOverride(env, ID, { order: ['r2'] }, 'admin-1');
		assert.deepEqual(noCopy, { ok: false, problem: 'not_playable' });
		await saveMediaSettings(env, { ...DEFAULT_MEDIA_SETTINGS, providers: { bunny: { enabled: true }, r2: { enabled: true } } }, 'admin-1');
		const zero = await setVideoOverride(env, ID, { strategy: 'weighted', order: ['bunny'], weights: { r2: 100 } }, 'admin-1');
		assert.deepEqual(zero, { ok: false, problem: 'weights_zero' });
		assert.equal((await read()).mediaOverride, undefined);
	});

	it('a failed copy does not count as playable', async () => {
		const { env } = setup({ r2: { ...READY, status: 'failed', error: 'ffmpeg exited 1' } });
		assert.deepEqual(await setVideoOverride(env, ID, { order: ['r2'] }, 'admin-1'), { ok: false, problem: 'not_playable' });
	});

	it('null clears it; unknown and deleted videos are refused', async () => {
		const { env, raw, read } = setup();
		await setVideoOverride(env, ID, { order: ['r2', 'bunny'] }, 'admin-1');
		const cleared = await setVideoOverride(env, ID, null, 'admin-1');
		assert.ok(cleared.ok);
		assert.equal((await read()).mediaOverride, undefined);
		assert.deepEqual(await setVideoOverride(env, '00000000-0000-4000-8000-000000000000', { order: ['bunny'] }, 'admin-1'), { ok: false, problem: 'not_found' });
		await raw.videos.put(ID, JSON.stringify({ ...(await read()), isDeleted: true }));
		assert.deepEqual(await setVideoOverride(env, ID, { order: ['bunny'] }, 'admin-1'), { ok: false, problem: 'deleted' });
	});

	it('an override with nothing meaningful clears instead of storing noise', async () => {
		const { env, read } = setup();
		await setVideoOverride(env, ID, { order: ['r2'] }, 'admin-1');
		const result = await setVideoOverride(env, ID, { note: 'only a note', order: ['nope'] }, 'admin-1');
		assert.ok(result.ok);
		assert.equal((await read()).mediaOverride, undefined);
	});
});

describe('PUT /internal/media/videos/:id/override', () => {
	function app(env: unknown) {
		const hono = new Hono();
		hono.route('/internal/media', createMediaInternalRouter());
		return (body: unknown, id = ID) =>
			hono.request(`/internal/media/videos/${id}/override`, { method: 'PUT', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }, env as never);
	}

	it('sets the override and returns the admin view', async () => {
		const { env, read } = setup();
		const res = await app(env)({ override: { order: ['r2', 'bunny'] }, actorId: 'admin-1' });
		assert.equal(res.status, 200);
		const body = (await res.json()) as { result: { override: { order: string[] }; media: { effective: { order: string[] } } } };
		assert.deepEqual(body.result.override.order, ['r2', 'bunny']);
		assert.deepEqual(body.result.media.effective.order, ['r2', 'bunny']);
		assert.deepEqual((await read()).mediaOverride && ((await read()).mediaOverride as { order: string[] }).order, ['r2', 'bunny']);
	});

	it('400 with the problem when unplayable, 404 for an unknown video, 400 without an actor or a bad id', async () => {
		const { env } = setup({ r2: undefined });
		const put = app(env);
		const unplayable = await put({ override: { order: ['r2'] }, actorId: 'admin-1' });
		assert.equal(unplayable.status, 400);
		assert.equal(((await unplayable.json()) as { problem: string }).problem, 'not_playable');
		assert.equal((await put({ override: { order: ['bunny'] }, actorId: 'admin-1' }, '00000000-0000-4000-8000-000000000000')).status, 404);
		assert.equal((await put({ override: { order: ['bunny'] } })).status, 400);
		assert.equal((await put({ override: 'r2', actorId: 'admin-1' })).status, 400);
		assert.equal((await put({ override: null, actorId: 'admin-1' }, 'not-a-video-id!')).status, 400);
	});
});
