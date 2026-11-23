/**
 * Feature switches in api-videos (FEAT-4, wiki AUN-FEATURES §5.3): a switch row overrides the old
 * setting in every old reader, so gates and /api/me/features follow it; a required switch that is
 * off blocks its dependants; FEATURES_FORCE_OFF wins; rows are memoised for 30 s; the answer has a
 * body ETag and 304s; the admin state report reads old settings raw and set-up with the switch on.
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { buildErrorEnvelope, featureGate, isKidsClientApp, writeFeatureSwitch } from '@al-ummah/shared-types';
import { SqliteD1 } from './search-sqlite-d1';
import { MemoryBucket, MemoryQueue } from './helpers';
import { assignTier, saveTier } from '../src/lib/creatorTiers';
import { captionFeatureFor, computeFeatures, featureSwitchState, forgetFeatureCaches, type FeaturesEnv } from '../src/lib/features';
import { overlaySwitch, readSwitchRows, forgetFeatureSwitches } from '../src/lib/features/switches';
import { readCaptionSettings, writeCaptionSettings } from '../src/lib/captions/jobs';
import { readYtSettings } from '../src/lib/youtube-import/settings';
import { readRequestsAllowed, setRequestsAllowed } from '../src/lib/upgradeMode';
import { bodyEtag, etagMatches, handleUserFeatures } from '../src/endpoints/creator/features';

async function setup(over: Record<string, unknown> = {}) {
	const d1 = new SqliteD1() as unknown as D1Database;
	await saveTier(d1, 'full', { name: 'Full', perHour: 5, perDay: 10, maxConcurrent: 2, maxChannels: 2, live: false, captionMinutesMonth: 60, audioTracksPerVideo: 2 }, 'admin-1', { create: true });
	await assignTier(d1, 'alice', 'full', 'admin-1');
	const env: FeaturesEnv = {
		SEARCH_DB: d1,
		channels: new MemoryBucket() as never,
		channel_sections: new MemoryBucket(),
		channel_tabs: new MemoryBucket(),
		global_settings: new MemoryBucket() as never,
		queue: new MemoryQueue() as never,
		TRANSCODE_QUEUE: new MemoryQueue() as never,
		PROCESSOR: { fetch: async () => new Response('{}') },
		MEDIA_ORIGINALS: new MemoryBucket(),
		ENVIRONMENT: 'test',
		...over,
	} as FeaturesEnv;
	// The migration made the tierRequests row (version 1)
	const version = new Map<string, number>([['tierRequests', 1]]);
	const set = async (key: string, enabled: boolean) => {
		const v = version.get(key) ?? 0;
		await writeFeatureSwitch(env, { key, enabled, expectedVersion: v, actorId: 'usr_admin1', currentStored: true });
		version.set(key, v + 1);
		forgetFeatureCaches();
	};
	return { env, d1, set };
}

beforeEach(() => forgetFeatureCaches());
afterEach(() => forgetFeatureCaches());

describe('old readers follow the switch once it has a row', () => {
	it('captions: the four enabled fields', async () => {
		const { env, set } = await setup();
		await writeCaptionSettings(env as never, { viewerDownload: { enabled: true } });
		assert.equal((await readCaptionSettings(env)).viewerDownload.enabled, true, 'no row: the old setting');
		await set('viewerCaptionDownload', false);
		await set('captionsTranslate', false);
		const s = await readCaptionSettings(env);
		assert.equal(s.viewerDownload.enabled, false);
		assert.equal(s.translation.enabled, false);
		assert.equal(s.inline.enabled, true);
		// The raw read (and so the admin's captions page saves) keeps the old setting untouched
		const raw = await readCaptionSettings(env, { raw: true });
		assert.equal(raw.viewerDownload.enabled, true);
		await writeCaptionSettings(env as never, { monthlyBudgetUsd: 5 });
		assert.equal((await readCaptionSettings(env, { raw: true })).viewerDownload.enabled, true, 'a captions save never writes the overlay back');
	});

	it('YouTube import is off while uploads are off (required switch), without a row of its own', async () => {
		const { env, set } = await setup({ YOUTUBE_IMPORT_DEFAULT_ENABLED: 'true' });
		assert.equal((await readYtSettings(env)).enabled, true);
		await set('upload', false);
		assert.equal((await readYtSettings(env)).enabled, false);
		assert.equal((await readYtSettings(env, { raw: true })).enabled, true);
	});

	it('tier requests: the migrated row decides', async () => {
		const { d1, set } = await setup();
		assert.equal((await readRequestsAllowed(d1)).allowed, true);
		await set('tierRequests', false);
		assert.equal((await readRequestsAllowed(d1)).allowed, false);
		// The old page's own toggle still works: it moves the row (source legacy_page)
		await setRequestsAllowed(d1, true, 'usr_admin2');
		forgetFeatureCaches();
		assert.equal((await readRequestsAllowed(d1)).allowed, true);
		const last = await d1.prepare("SELECT source, actor_id FROM feature_switch_changes WHERE key = 'tierRequests' AND source = 'legacy_page'").first();
		assert.deepEqual({ ...(last as object) }, { source: 'legacy_page', actor_id: 'usr_admin2' });
	});

	it('FEATURES_FORCE_OFF beats rows and old settings', async () => {
		const { env } = await setup({ FEATURES_FORCE_OFF: 'inlineTranslate,nope' });
		assert.equal((await readCaptionSettings(env)).inline.enabled, false);
		assert.equal((await readCaptionSettings(env)).translation.enabled, true);
		assert.equal(await overlaySwitch({ ...env, FEATURES_FORCE_OFF: 'all' }, 'socialAutopost', true), false);
	});
});

describe('the 30 s memo', () => {
	it('serves rows from memory for 30 s, then reads again', async () => {
		const { env } = await setup();
		const t0 = Date.now();
		await readSwitchRows(env, { now: t0 });
		await writeFeatureSwitch(env, { key: 'live', enabled: false, expectedVersion: 0, actorId: 'usr_admin1', currentStored: true });
		// A write in this isolate clears it at once
		assert.equal((await readSwitchRows(env, { now: t0 + 1 })).get('live')?.enabled, false);
		// A write elsewhere (another isolate): seen after the TTL
		await (env.SEARCH_DB as D1Database).prepare("UPDATE feature_switches SET enabled = 1 WHERE key = 'live'").run();
		assert.equal((await readSwitchRows(env, { now: t0 + 29_000 })).get('live')?.enabled, false);
		assert.equal((await readSwitchRows(env, { now: t0 + 31_000 })).get('live')?.enabled, true);
		forgetFeatureSwitches();
	});
});

describe('/api/me/features', () => {
	const app = (env: FeaturesEnv, userId: string | null) => {
		const a = new Hono();
		a.use('*', async (c, next) => {
			if (userId) c.set('userId' as never, userId as never);
			c.set('auth' as never, { payload: { roles: [] } } as never);
			await next();
		});
		a.get('/api/me/features', handleUserFeatures);
		return (headers: Record<string, string> = {}) => a.request('/api/me/features', { headers }, env);
	};

	it('ANDs the switches in: an off switch hides its keys, a blocked one too', async () => {
		const { env, set } = await setup();
		const before = await computeFeatures(env, { userId: 'alice', roles: [] });
		assert.equal(before.upload, true);
		assert.equal(before.bulkSchedule, true);
		await set('upload', false);
		await set('bulkSchedule', false);
		const after = await computeFeatures(env, { userId: 'alice', roles: [] });
		assert.equal(after.upload, false);
		assert.equal(after.bulkSchedule, false);
		assert.equal(after.audioTracks, false, 'audio tracks require uploads');
		assert.equal(after.support, false, 'creator support is off by default');
		assert.equal(after.eventCalendar, false, 'event calendar is off by default');
		await set('eventCalendar', true);
		assert.equal((await computeFeatures(env, { userId: null })).eventCalendar, true, 'eventCalendar turns on for viewers');
		assert.equal(
			(await computeFeatures(env, { userId: 'alice', roles: [] }, null, { client: 'aun-kids-ios/1.0.0 (iOS 18.1)' })).eventCalendar,
			false,
			'eventCalendar stays hidden on Ummah Kids clients',
		);
	});

	it('has a body ETag: a match gets 304; signed out is public for 30 s', async () => {
		const { env, set } = await setup();
		const get = app(env, 'alice');
		const first = await get();
		const etag = first.headers.get('etag')!;
		assert.match(etag, /^W\/"[0-9a-f]{32}"$/);
		assert.equal(first.headers.get('cache-control'), 'private, max-age=0, must-revalidate');
		const again = await get({ 'If-None-Match': etag });
		assert.equal(again.status, 304);
		assert.equal(await again.text(), '');
		await set('bulkSchedule', false);
		const changed = await get({ 'If-None-Match': etag });
		assert.equal(changed.status, 200, 'a switch change changes the ETag');
		const anon = await app(env, null)();
		assert.equal(anon.headers.get('cache-control'), 'public, max-age=30');
	});

	it('etagMatches compares weakly and accepts lists and *', async () => {
		const tag = await bodyEtag('{"a":1}');
		assert.equal(etagMatches(tag.replace('W/', ''), tag), true);
		assert.equal(etagMatches(`"x", ${tag}`, tag), true);
		assert.equal(etagMatches('*', tag), true);
		assert.equal(etagMatches('"other"', tag), false);
		assert.equal(etagMatches(undefined, tag), false);
	});
});

describe('the admin state report', () => {
	it('reads old settings raw and set-up with the switch taken as on', async () => {
		const { env, set } = await setup();
		await writeCaptionSettings(env as never, { viewerDownload: { enabled: true }, translation: { enabled: false } });
		await set('viewerCaptionDownload', false);
		const report = await featureSwitchState(env);
		assert.equal(report.legacy.viewerCaptionDownload, true, 'raw, not overlaid');
		assert.equal(report.legacy.captionsTranslate, false);
		assert.equal(report.ready.audioTracks, true);
		assert.equal(report.ready.youtubeImport, false);
		assert.equal(report.ready.newsletter, null);
	});
});

describe('featureGate', () => {
	it('says why a switch is off: its own row, a required switch, or the override', async () => {
		const { env, set } = await setup();
		assert.deepEqual(await featureGate(env, 'live'), { on: true });
		await set('live', false);
		assert.deepEqual(await featureGate(env, 'live'), { on: false, reason: 'switched_off' });
		await set('upload', false);
		assert.deepEqual(await featureGate(env, 'audioTracks'), { on: false, reason: 'required_off' });
		assert.deepEqual(await featureGate({ ...env, FEATURES_FORCE_OFF: 'bulkSchedule' }, 'bulkSchedule'), { on: false, reason: 'env_override' });
	});

	it('a switch with an old setting and no row counts as on (its old reader decides)', async () => {
		const { env } = await setup();
		assert.deepEqual(await featureGate(env, 'viewerCaptionDownload'), { on: true });
	});

	it('caption jobs: the handler check follows the transcribe and translate switches', async () => {
		const { env, set } = await setup();
		await writeCaptionSettings(env as never, { monthlyBudgetUsd: 5 });
		assert.equal(await captionFeatureFor(env, 'transcribe', { userId: 'alice' }), true);
		await set('captionsTranscribe', false);
		assert.equal(await captionFeatureFor(env, 'transcribe', { userId: 'alice' }), false);
		assert.equal(await captionFeatureFor(env, 'translate', { userId: 'alice' }), true);
	});

	it('isKidsClientApp and kids_mode_restricted localized envelope', () => {
		assert.equal(isKidsClientApp('kids/1.0.0 (iOS 18.1)'), true);
		assert.equal(isKidsClientApp('aun-kids-ios/1.2.0 (iOS 18.1)'), true);
		assert.equal(isKidsClientApp('aun-kids-android/1.2.0 (Android 15)'), true);
		assert.equal(isKidsClientApp('aun-ios/1.4.0 (iOS 18.1)'), false);
		assert.equal(isKidsClientApp(null), false);
		const en = buildErrorEnvelope({ success: false, code: 'kids_mode_restricted' }, { status: 403, lang: 'en' });
		const ar = buildErrorEnvelope({ success: false, code: 'kids_mode_restricted' }, { status: 403, lang: 'ar' });
		assert.equal(en.message, 'This isn’t available in Ummah Kids.');
		assert.equal(ar.message, 'هذا غير متاح في أمة الصغار.');
	});
});
