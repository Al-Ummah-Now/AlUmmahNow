/**
 * Hidden when off (shared-types features.ts, lib/features): GET /api/me/features answers each
 * feature from its config (switched on and configured) and the tier that applies (the channel
 * owner's, with the caller's role there), and the gated APIs answer 404 feature_off while their
 * feature is off. Real SQL (node:sqlite with the search migrations), in-memory R2 and queues.
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { CATEGORIZE_VISIBILITY_KEY, NO_FEATURES, QURAN_CURRENT_KEY, USER_FEATURE_KEYS, isFeatureOff, siteSettingsKey, writeFeatureSwitch } from '@al-ummah/shared-types';
import { timedBindings } from '@al-ummah/shared-types/request-steps';
import { SqliteD1 } from './search-sqlite-d1';
import { MemoryBucket, MemoryQueue, buildApp, rpcSecret } from './helpers';
import { assignTier, saveTier } from '../src/lib/creatorTiers';
import { addGrant } from '../src/lib/captions/minutes';
import { forgetLiveRouting, writeLiveRouting } from '../src/lib/live/store';
import { clearQuranCopyCache } from '../src/lib/quran/copy';
import { captionFeatureFor, computeFeatures, forgetFeatureCaches, liveConfigured, saasConfigured, type FeaturesEnv } from '../src/lib/features';
import { handleUserFeatures } from '../src/endpoints/creator/features';
import { TranslateCreate, TranslateUsageGet } from '../src/endpoints/translate/translate';
import { QuranTranslationsList } from '../src/endpoints/quran/quranTranslations';
import billingInternalRouter from '../src/routers/billing.router';
import { socialInternalRouter, socialRouter } from '../src/routers/social.router';
import { withSearchSync } from '../src/lib/search/sync';
import { YT_SETTINGS_KEY } from '../src/lib/youtube-import/settings';

const KEK = `1:${Buffer.alloc(32, 5).toString('base64')}`;
const CLIENT_ID = '123456789012-unittestclient.apps.googleusercontent.com';

// Use the runtime class names so timedBindings wraps these test doubles too.
const RuntimeD1 = class D1Database extends SqliteD1 {};
const RuntimeR2 = class R2Bucket extends MemoryBucket {};

function requestEnv(env: FeaturesEnv): FeaturesEnv {
	return withSearchSync(timedBindings(env), { waitUntil() {} });
}

async function setup(over: Record<string, unknown> = {}) {
	const d1 = new RuntimeD1() as unknown as D1Database;
	await saveTier(d1, 'full', { name: 'Full', perHour: 5, perDay: 10, maxConcurrent: 2, maxChannels: 2, live: true, liveHoursMonth: 2, liveMaxConcurrent: 1, liveMaxStreamMinutes: 30, captionMinutesMonth: 60, audioTracksPerVideo: 2 }, 'admin-1', { create: true });
	await saveTier(d1, 'bare', { name: 'Bare', perHour: 5, perDay: 10, maxConcurrent: 2, maxChannels: 1 }, 'admin-1', { create: true });
	await assignTier(d1, 'alice', 'full', 'admin-1');
	await assignTier(d1, 'bob', 'bare', 'admin-1');
	const global = new RuntimeR2();
	const env: FeaturesEnv = {
		SEARCH_DB: d1,
		channels: new MemoryBucket({
			ch1: { id: 'ch1', userId: 'alice', members: [{ userId: 'bob', role: 'editor' }] },
			ch2: { id: 'ch2', userId: 'bob', members: [{ userId: 'alice', role: 'admin' }] },
		}) as never,
		channel_sections: new MemoryBucket(),
		channel_tabs: new MemoryBucket(),
		global_settings: global as never,
		queue: new MemoryQueue() as never,
		TRANSCODE_QUEUE: new MemoryQueue() as never,
		PROCESSOR: { fetch: async () => new Response('{}') },
		MEDIA_ORIGINALS: new MemoryBucket(),
		LIVE_MEDIA: new MemoryBucket() as never,
		LIVE_PUBLIC_HOST: 'live.test',
		LIVE_INGEST_SECRET: 'secret',
		BUNNY_LIVE_ENABLED: 'false',
		ENVIRONMENT: 'test',
		...over,
	};
	return { env, d1, global };
}

const ROLES_NONE: string[] = [];

beforeEach(() => {
	forgetFeatureCaches();
	forgetLiveRouting();
});
afterEach(() => {
	forgetFeatureCaches();
	forgetLiveRouting();
});

describe('feature answer', () => {
	it('signed out: only the viewer-facing switch, every creator feature hidden', async () => {
		const { env } = await setup();
		const f = await computeFeatures(env, { userId: null });
		assert.deepEqual(Object.keys(f).sort(), [...USER_FEATURE_KEYS].sort());
		assert.equal(f.viewerTranslatedTitles, true);
		assert.equal(f.playerCredits, true);
		for (const key of USER_FEATURE_KEYS.filter((k) => k !== 'viewerTranslatedTitles' && k !== 'playerCredits')) assert.equal(f[key], false, key);
	});

	it('config on + tier on: the tier\'s features show', async () => {
		const { env } = await setup();
		const f = await computeFeatures(env, { userId: 'alice', roles: ROLES_NONE });
		assert.equal(f.upload, true);
		assert.equal(f.createChannel, true);
		assert.equal(f.live, true);
		assert.equal(f.captionsTranscribe, true);
		assert.equal(f.captionsTranslate, true);
		assert.equal(f.inlineTranslate, true);
		assert.equal(f.audioTracks, true);
		assert.equal(f.aiCategorySuggest, true);
		assert.equal(f.bulkSchedule, true);
	});

	it('tier off: a tier without live, minutes or tracks hides them; no tier hides upload and channels', async () => {
		const { env } = await setup();
		const bob = await computeFeatures(env, { userId: 'bob', roles: ROLES_NONE });
		assert.equal(bob.upload, true);
		assert.equal(bob.live, false);
		assert.equal(bob.captionsTranscribe, false);
		assert.equal(bob.captionsTranslate, false);
		assert.equal(bob.audioTracks, false);
		const nobody = await computeFeatures(env, { userId: 'nobody', roles: ROLES_NONE });
		assert.equal(nobody.upload, false);
		assert.equal(nobody.createChannel, false);
		assert.equal(nobody.live, false);
		// Free, config-only features stay
		assert.equal(nobody.inlineTranslate, true);
	});

	it('config off: the switch or a missing binding hides the feature even inside the tier', async () => {
		const { env, d1, global } = await setup({ PROCESSOR: undefined, MEDIA_ORIGINALS: undefined, AI_CATEGORIZE_ENABLED: 'false' });
		await writeLiveRouting(d1, { providers: { selfhosted: { enabled: false } } }, 'admin-1');
		await global.put('captions/settings.json', JSON.stringify({ translation: { enabled: false } }));
		forgetFeatureCaches();
		const f = await computeFeatures(env, { userId: 'alice', roles: ROLES_NONE });
		assert.equal(f.live, false);
		assert.equal(f.captionsTranslate, false);
		assert.equal(f.captionsTranscribe, true);
		assert.equal(f.inlineTranslate, false);
		assert.equal(f.viewerTranslatedTitles, false);
		assert.equal(f.audioTracks, false);
		assert.equal(f.aiCategorySuggest, false);
	});

	it('viewer caption download: off unless the admin turns it on, then on for everyone', async () => {
		const { env, global } = await setup();
		assert.equal((await computeFeatures(env, { userId: null })).viewerCaptionDownload, false);
		assert.equal((await computeFeatures(env, { userId: 'alice', roles: ROLES_NONE })).viewerCaptionDownload, false);
		await global.put('captions/settings.json', JSON.stringify({ viewerDownload: { enabled: true } }));
		forgetFeatureCaches();
		assert.equal((await computeFeatures(env, { userId: null })).viewerCaptionDownload, true);
		assert.equal((await computeFeatures(env, { userId: 'carol', roles: ROLES_NONE }, 'ch1')).viewerCaptionDownload, true);
	});

	it('live: a provider over its budget hides live; one at its concurrency cap does not', async () => {
		const { env, d1 } = await setup();
		await writeLiveRouting(d1, { providers: { selfhosted: { monthlyBudgetUsd: 0 } } }, 'admin-1');
		assert.equal(await liveConfigured(env), false);
		forgetFeatureCaches();
		await writeLiveRouting(d1, { providers: { selfhosted: { monthlyBudgetUsd: null, maxConcurrent: 0 } } }, 'admin-1');
		assert.equal(await liveConfigured(env), true);
	});

	it('channel scope: the owner\'s tier and the caller\'s role there decide', async () => {
		const { env } = await setup();
		// bob (no live in his tier) is an editor on alice's channel: live follows alice's tier, but
		// an editor cannot manage live
		const bobOnAlice = await computeFeatures(env, { userId: 'bob', roles: ROLES_NONE }, 'ch1');
		assert.equal(bobOnAlice.live, false);
		assert.equal(bobOnAlice.upload, true);
		assert.equal(bobOnAlice.captionsTranscribe, true);
		assert.equal(bobOnAlice.audioTracks, true);
		assert.equal(bobOnAlice.createChannel, false);
		// alice is a channel admin on bob's channel: bob's tier has no live, no minutes, no tracks
		const aliceOnBob = await computeFeatures(env, { userId: 'alice', roles: ROLES_NONE }, 'ch2');
		assert.equal(aliceOnBob.live, false);
		assert.equal(aliceOnBob.captionsTranscribe, false);
		assert.equal(aliceOnBob.audioTracks, false);
		// Not on the team: nothing of that channel's Studio
		const stranger = await computeFeatures(env, { userId: 'carol', roles: ROLES_NONE }, 'ch1');
		assert.deepEqual({ ...stranger, viewerTranslatedTitles: false }, { ...NO_FEATURES, playerCredits: true });
	});

	it('caption minutes from an admin grant count as a plan', async () => {
		const { env, d1 } = await setup();
		assert.equal(await captionFeatureFor(env, 'transcribe', { userId: 'bob' }), false);
		await addGrant(d1, 'bob', { minutes: 30, scope: 'until_used', reason: 'pilot' }, 'admin-1');
		assert.equal(await captionFeatureFor(env, 'transcribe', { userId: 'bob' }), true);
		assert.equal((await computeFeatures(env, { userId: 'bob', roles: ROLES_NONE })).captionsTranscribe, true);
	});

	it('the Quran text is shown only while our copy is synced and fresh, signed in or not', async () => {
		const { env } = await setup();
		clearQuranCopyCache();
		assert.equal((await computeFeatures(env, { userId: null })).quranText, false, 'no bucket bound');
		const bucket = new MemoryBucket();
		env.MEDIA_PRIVATE = bucket;
		clearQuranCopyCache();
		assert.equal((await computeFeatures(env, { userId: 'alice', roles: ROLES_NONE })).quranText, false, 'no copy yet');
		await bucket.put('quran/current.json', JSON.stringify({ v: 1, version: 'v1', syncedAt: new Date().toISOString(), builtAt: new Date().toISOString(), surahs: 114, words: 77429 }));
		clearQuranCopyCache();
		assert.equal((await computeFeatures(env, { userId: null })).quranText, true);
		const disabled = await computeFeatures({ ...env, FEATURES_FORCE_OFF: 'playerCredits' }, { userId: null });
		assert.equal(disabled.playerCredits, false);
		assert.equal(disabled.quranText, false);
		await bucket.put('quran/current.json', JSON.stringify({ v: 1, version: 'v1', syncedAt: new Date(Date.now() - 8 * 86400_000).toISOString(), builtAt: 'x', surahs: 114, words: 1 }));
		clearQuranCopyCache();
		assert.equal((await computeFeatures(env, { userId: 'alice', roles: ROLES_NONE })).quranText, false, 'older than 7 days');
		clearQuranCopyCache();
	});

	it('recitation follows its switch, fresh text, the channel owner tier and the caller role', async () => {
		const bucket = new MemoryBucket();
		const { env, d1 } = await setup({ MEDIA_PRIVATE: bucket });
		const now = new Date().toISOString();
		await bucket.put(QURAN_CURRENT_KEY, JSON.stringify({ v: 1, version: 'fixture', syncedAt: now, builtAt: now, surahs: 114, words: 77429 }));
		clearQuranCopyCache();
		assert.equal((await computeFeatures(env, { userId: null })).recitationTools, false, 'switch off by default');

		await writeFeatureSwitch(env, { key: 'recitationTools', enabled: true, expectedVersion: 0, actorId: 'usr_admin1', currentStored: false });
		forgetFeatureCaches();
		assert.equal((await computeFeatures(env, { userId: null })).recitationTools, true);
		assert.equal((await computeFeatures(env, { userId: 'alice', roles: [] })).recitationMetadata, true, 'own videos need no channel scope');
		const editor = await computeFeatures(env, { userId: 'bob', roles: [] }, 'ch1');
		assert.equal(editor.recitationMetadata, true, 'editor works under the channel owner tier');
		assert.equal((await computeFeatures(env, { userId: 'carol', roles: [] }, 'ch1')).recitationMetadata, false, 'not a channel member');

		await saveTier(d1, 'full', { recitationMetadata: false }, 'admin-1');
		forgetFeatureCaches();
		assert.equal((await computeFeatures(env, { userId: 'bob', roles: [] }, 'ch1')).recitationMetadata, false);
		assert.equal((await computeFeatures(env, { userId: 'alice', roles: [] })).recitationMetadata, false);
	});

	it('Quran editions, social, YouTube import and AI categories follow their configuration', async () => {
		const off = await setup();
		let f = await computeFeatures(off.env, { userId: 'alice', roles: ROLES_NONE });
		assert.equal(f.quranEditions, false);
		assert.equal(f.socialAutopost, false);
		assert.equal(f.youtubeImport, false);

		const on = await setup({ QF_CLIENT_ID: 'id', QF_CLIENT_SECRET: 'secret', SOCIAL_TOKEN_KEK: KEK, GOOGLE_OAUTH_CLIENT_SECRET: 'google-secret' });
		await on.global.put(YT_SETTINGS_KEY, JSON.stringify({ enabled: true, clientId: CLIENT_ID }));
		f = await computeFeatures(on.env, { userId: 'alice', roles: ROLES_NONE });
		assert.equal(f.quranEditions, true);
		assert.equal(f.socialAutopost, true);
		assert.equal(f.youtubeImport, true);
		// Signed-out visitors also see quranEditions so the Credits page link follows the same switch
		assert.equal((await computeFeatures(on.env, { userId: null })).quranEditions, true);

		// Turning the quranEditions admin switch off hides it for both signed-in and signed-out visitors
		await writeFeatureSwitch(on.env as never, { key: 'quranEditions', enabled: false, expectedVersion: 0, actorId: 'admin-1' });
		forgetFeatureCaches();
		assert.equal((await computeFeatures(on.env, { userId: null })).quranEditions, false);
		assert.equal((await computeFeatures(on.env, { userId: 'alice', roles: ROLES_NONE })).quranEditions, false);

		// The placeholder secret is no secret; the admin switch off hides AI categories
		on.env.GOOGLE_OAUTH_CLIENT_SECRET = 'unset';
		await on.global.put(CATEGORIZE_VISIBILITY_KEY, JSON.stringify({ enabled: false }));
		forgetFeatureCaches();
		f = await computeFeatures(on.env, { userId: 'alice', roles: ROLES_NONE });
		assert.equal(f.youtubeImport, false);
		assert.equal(f.aiCategorySuggest, false);
	});

	it('reuses shared settings and Secrets Store reads while resolving each caller’s permissions', async (t) => {
		t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
		let secretCalls = 0;
		const secret = (value: string) => ({ get: async () => { secretCalls++; return value; } });
		const { env, d1, global } = await setup({
			QF_CLIENT_ID: secret('id'),
			QF_CLIENT_SECRET: secret('secret'),
			SOCIAL_TOKEN_KEK: secret(KEK),
			GOOGLE_OAUTH_CLIENT_SECRET: secret('google-secret'),
		});
		await global.put(YT_SETTINGS_KEY, JSON.stringify({ enabled: true, clientId: CLIENT_ID }));
		const traced = d1 as unknown as SqliteD1;
		const reads = () => traced.trace!.filter(({ sql }) => /FROM (feature_switches|billing_providers|social_settings)\b/i.test(sql));
		const first = requestEnv(env);
		const second = requestEnv(env);
		assert.notEqual(first, second);
		assert.notEqual(first.SEARCH_DB, env.SEARCH_DB);
		assert.notEqual(first.global_settings, env.global_settings);
		assert.equal(first.SEARCH_DB, second.SEARCH_DB);
		assert.equal(first.global_settings, second.global_settings);
		const forUser = (userId: string) => computeFeatures(requestEnv(env), { userId, roles: [] });
		traced.trace = [];

		const alice = await computeFeatures(first, { userId: 'alice', roles: [] });
		assert.equal(alice.upload, true);
		assert.equal(alice.socialAutopost, true);
		assert.equal(alice.youtubeImport, true);
		assert.equal(alice.quranEditions, true);
		assert.equal(reads().filter(({ sql }) => sql.includes('FROM feature_switches')).length, 1);
		assert.equal(secretCalls, 4);
		const coldBucketCalls = global.calls;
		const coldConfigQueries = reads().length;

		const other = await computeFeatures(second, { userId: 'nobody', roles: [] });
		assert.equal(other.upload, false);
		assert.equal(other.captionsTranscribe, false);
		assert.equal(other.youtubeImport, true);
		assert.equal(global.calls, coldBucketCalls);
		assert.equal(reads().length, coldConfigQueries);
		assert.equal(secretCalls, 4);

		await global.put(CATEGORIZE_VISIBILITY_KEY, JSON.stringify({ enabled: false }));
		assert.equal((await forUser('alice')).aiCategorySuggest, true);
		t.mock.timers.tick(10_000);
		assert.equal((await forUser('alice')).aiCategorySuggest, false);
		assert.equal(secretCalls, 4);

		// A stored switch takes precedence without waiting for the settings TTL.
		await writeFeatureSwitch(env as never, { key: 'youtubeImport', enabled: false, expectedVersion: 0, actorId: 'admin-1' });
		assert.equal((await forUser('alice')).youtubeImport, false);
		t.mock.timers.tick(5 * 60_000);
		await forUser('alice');
		assert.equal(secretCalls, 7); // YouTube stays off.
	});

	it('invalidates the billing snapshot when an admin updates a provider or clears a credential', async (t) => {
		t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
		const { env } = await setup({ PAYMENTS_FAKE_PROVIDER: '1' });
		const features = () => computeFeatures(requestEnv(env), { userId: 'alice', roles: [] });
		const write = (path: string, method: string, data: object) => billingInternalRouter.request(path, {
			method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
		}, requestEnv(env));

		assert.equal((await features()).billing, false);
		assert.equal((await write('/providers/fake', 'PUT', { enabled: true })).status, 200);
		assert.equal((await features()).billing, true);
		assert.equal((await write('/providers/fake/credentials', 'POST', { field: 'apiKey', mode: 'test', cleared: true })).status, 200);
		assert.equal((await features()).billing, false);
	});

	it('invalidates the social snapshot when an admin changes platform settings or credentials', async (t) => {
		t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
		const { env } = await setup({ SOCIAL_TOKEN_KEK: KEK });
		const features = () => computeFeatures(requestEnv(env), { userId: 'alice', roles: [] });
		const write = (path: string, method: string, data?: object) => socialInternalRouter.request(path, {
			method, headers: { 'Content-Type': 'application/json' }, body: data ? JSON.stringify(data) : undefined,
		}, requestEnv(env));

		assert.equal((await features()).socialAutopost, true);
		assert.equal((await write('/admin/settings', 'PUT', {
			networks: { x: { enabled: true }, telegram: { enabled: false }, bluesky: { enabled: false }, mastodon: { enabled: false } },
		})).status, 200);
		assert.equal((await features()).socialAutopost, false);
		assert.equal((await write('/admin/credentials/x', 'PUT', { clientId: 'test-client', clientSecret: 'test-secret' })).status, 200);
		assert.equal((await features()).socialAutopost, true);
		assert.equal((await write('/admin/credentials/x', 'DELETE')).status, 200);
		assert.equal((await features()).socialAutopost, false);
	});

	it('own domains: the channel\'s site must allow one and SaaS must be ready (admin-api, cached)', async () => {
		const { env } = await setup({ SITES_SAAS_AVAILABLE: 'true' });
		const sections = env.channel_sections as MemoryBucket;
		assert.equal((await computeFeatures(env, { userId: 'alice', roles: ROLES_NONE }, 'ch1')).siteDomains, false);
		await sections.put(siteSettingsKey('ch1'), JSON.stringify({ status: 'active', limits: { customDomainsMax: 0 } }));
		assert.equal((await computeFeatures(env, { userId: 'alice', roles: ROLES_NONE }, 'ch1')).siteDomains, false);
		await sections.put(siteSettingsKey('ch1'), JSON.stringify({ status: 'active', limits: { customDomainsMax: 2 } }));
		assert.equal((await computeFeatures(env, { userId: 'alice', roles: ROLES_NONE }, 'ch1')).siteDomains, true);
		// An editor cannot change the site
		assert.equal((await computeFeatures(env, { userId: 'bob', roles: ROLES_NONE }, 'ch1')).siteDomains, false);

		let calls = 0;
		const probe = async (url: string | URL | Request, init?: RequestInit) => {
			calls++;
			assert.equal(String(url), 'https://admin.test/internal/site-domains-status');
			assert.equal((init?.headers as Record<string, string>)['X-API-Key'], 'k');
			return new Response(JSON.stringify({ success: true, result: { available: false } }));
		};
		const real = { ADMIN_API_URL: 'https://admin.test', INTERNAL_API_KEY: 'k' } as FeaturesEnv;
		assert.equal(await saasConfigured(real, probe as typeof fetch), false);
		assert.equal(await saasConfigured(real, probe as typeof fetch), false);
		assert.equal(calls, 1);
	});

	it('credentials in a Worker’s secret bindings show Quran editions and own domains; without them both stay hidden (#1974)', async () => {
		const unreadable = { get: async () => { throw new Error('Secret not found'); } };
		const none = [undefined, '', ' ', 'unset', rpcSecret(''), rpcSecret('unset'), rpcSecret('unset\n'), unreadable, {}];
		const editions = async (id: unknown, secret: unknown) => {
			const { env } = await setup({ QF_CLIENT_ID: id, QF_CLIENT_SECRET: secret });
			const app = buildApp((router) => router.get('/api/quran/translations', QuranTranslationsList), null);
			const res = await app.request('/api/quran/translations?language=en', {}, { ...env, NODE_ENV: 'test' });
			const shown = (await computeFeatures(env, { userId: null })).quranEditions;
			assert.equal((await computeFeatures(env, { userId: 'alice', roles: ROLES_NONE })).quranEditions, shown);
			// The entry point and its API agree
			assert.equal(isFeatureOff(res.status, await res.json().catch(() => null)), !shown);
			return shown;
		};
		assert.equal(await editions(rpcSecret('id'), rpcSecret('secret')), true);
		for (const missing of none) {
			assert.equal(await editions(missing, rpcSecret('secret')), false);
			assert.equal(await editions(rpcSecret('id'), missing), false);
		}

		const domains = async (key: unknown, available: boolean) => {
			forgetFeatureCaches();
			const keys: string[] = [];
			const { env } = await setup({ ADMIN_API_URL: 'https://admin.test', INTERNAL_API_KEY: key });
			const probe = async (_url: unknown, init?: RequestInit) => {
				keys.push((init?.headers as Record<string, string>)['X-API-Key']);
				return Response.json({ success: true, result: { available } });
			};
			return { shown: await saasConfigured(env, probe as typeof fetch), keys };
		};
		assert.deepEqual(await domains(rpcSecret('k'), true), { shown: true, keys: ['k'] });
		assert.deepEqual(await domains(rpcSecret('k'), false), { shown: false, keys: ['k'] }, 'SaaS not set up');
		for (const missing of none) assert.deepEqual(await domains(missing, true), { shown: false, keys: [] }, 'admin-api not asked');
	});

	it('GET /api/me/features: version 1, revalidated every time, all hidden when the lookup fails', async () => {
		const { env } = await setup();
		const app = new Hono();
		app.use('*', async (c, next) => {
			c.set('userId' as never, 'alice' as never);
			c.set('auth' as never, { payload: { roles: [] } } as never);
			await next();
		});
		app.get('/api/me/features', handleUserFeatures);
		const res = await app.request('/api/me/features', {}, env);
		assert.equal(res.status, 200);
		assert.equal(res.headers.get('cache-control'), 'private, max-age=0, must-revalidate');
		const body = (await res.json()) as { version: number; features: Record<string, boolean> };
		assert.equal(body.version, 1);
		assert.equal(body.features.live, true);

		const broken = await app.request('/api/me/features?channelId=ch1', {}, { ...env, channels: { get: async () => { throw new Error('R2 down'); } } });
		assert.equal(broken.status, 200);
		assert.deepEqual(((await broken.json()) as { features: unknown }).features, NO_FEATURES);
	});
});

describe('gated APIs answer 404 feature_off', () => {
	it('Translate button switched off: POST /api/translate', async () => {
		const { env, global } = await setup();
		await global.put('captions/settings.json', JSON.stringify({ inline: { enabled: false } }));
		const app = buildApp((router) => {
			router.post('/api/translate', TranslateCreate);
			router.get('/api/translate/usage', TranslateUsageGet);
		}, { userId: 'alice' });
		const res = await app.request('/api/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [{ id: 'a', text: 'one' }], from: 'en', to: 'ar', field: 'title' }) }, env);
		assert.equal(res.status, 404);
		assert.ok(isFeatureOff(res.status, await res.json()));
		const usage = (await (await app.request('/api/translate/usage', {}, env)).json()) as { data: { enabled: boolean } };
		assert.equal(usage.data.enabled, false);
	});

	it('Quran Foundation not configured: GET /api/quran/translations', async () => {
		const { env } = await setup();
		const app = buildApp((router) => router.get('/api/quran/translations', QuranTranslationsList), null);
		const res = await app.request('/api/quran/translations?language=en', {}, env);
		assert.equal(res.status, 404);
		assert.ok(isFeatureOff(res.status, await res.json()));
	});

	it('social auto-post off: connecting and templates answer quietly; disconnecting still works', async () => {
		const { env } = await setup();
		const app = new Hono();
		app.use('*', async (c, next) => {
			c.set('userId' as never, 'alice' as never);
			await next();
		});
		app.route('/api/social', socialRouter as never);
		for (const [method, path] of [
			['POST', '/api/social/channel/ch1/connect'],
			['PUT', '/api/social/channel/ch1/templates'],
			['PATCH', '/api/social/channel/ch1/accounts/a1'],
		] as const) {
			const res = await app.request(path, { method, headers: { 'Content-Type': 'application/json' }, body: '{}' }, env);
			assert.equal(res.status, 404, `${method} ${path}`);
			assert.ok(isFeatureOff(res.status, await res.json()), `${method} ${path}`);
		}
		const del = await app.request('/api/social/channel/ch1/accounts/a1', { method: 'DELETE' }, env);
		assert.notEqual(((await del.json().catch(() => ({}))) as { code?: string }).code, 'feature_off');
	});

	it('social overview lists only the networks a creator can connect', async () => {
		const { env } = await setup({ SOCIAL_TOKEN_KEK: KEK });
		const app = new Hono();
		app.use('*', async (c, next) => {
			c.set('userId' as never, 'alice' as never);
			await next();
		});
		app.route('/api/social', socialRouter as never);
		const res = await app.request('/api/social/channel/ch1', {}, env);
		assert.equal(res.status, 200);
		const body = (await res.json()) as { networks: Record<string, { available: boolean }> };
		// X has no app keys and Telegram no bot here: only Bluesky and Mastodon are listed
		assert.deepEqual(Object.keys(body.networks).sort(), ['bluesky', 'mastodon']);
	});
});

describe('gated APIs answer 404 feature_off: live, captions, audio tracks', () => {
	async function studio(over: Record<string, unknown> = {}) {
		const s = await setup(over);
		const videos = new MemoryBucket({ v1: { id: 'v1', userId: 'bob', channelId: 'ch2', title: 'Talk', language: 'en', duration: 120, uploadStatus: 'ready', isPublic: true } });
		const env = { ...s.env, videos, profiles: new MemoryBucket(), TUS_SESSIONS: { get: async () => null, put: async () => {}, delete: async () => {} } };
		return { ...s, env };
	}
	const post = (app: Hono, env: unknown, path: string, body: unknown, channelId?: string) =>
		app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(channelId ? { channelId } : {}) }, body: JSON.stringify(body) }, env as never);

	it('live: a channel owner whose tier has no live, and no provider that may take streams', async () => {
		const { LiveStreamCreate } = await import('../src/endpoints/live/liveStreamCreate');
		const s = await studio();
		// bob's tier has no live: create on his own channel
		const asBob = buildApp((router) => router.post('/api/live', LiveStreamCreate), { userId: 'bob' });
		let res = await post(asBob, s.env, '/api/live', { title: 'Live' }, 'ch2');
		assert.equal(res.status, 404);
		assert.ok(isFeatureOff(res.status, await res.json()));
		// alice's tier has live, but self-hosted is switched off and Bunny is off here
		await writeLiveRouting(s.d1, { providers: { selfhosted: { enabled: false } } }, 'admin-1');
		const asAlice = buildApp((router) => router.post('/api/live', LiveStreamCreate), { userId: 'alice' });
		res = await post(asAlice, s.env, '/api/live', { title: 'Live' }, 'ch1');
		assert.equal(res.status, 404);
		assert.ok(isFeatureOff(res.status, await res.json()));
		// Nothing was left behind
		assert.equal([...(s.env.videos as MemoryBucket).store.keys()].filter((k) => k.startsWith('livestream:')).length, 0);
	});

	it('captions: transcribe and translate on a video whose owner has no caption minutes at all', async () => {
		const { CaptionJobCreate, CaptionTranslateCreate } = await import('../src/endpoints/captions/captionJobs');
		const s = await studio();
		// bob owns the video; his tier has no caption minutes and no grant
		const app = buildApp((router) => {
			router.post('/api/videos/:videoId/captions/jobs', CaptionJobCreate);
			router.post('/api/videos/:videoId/captions/translate', CaptionTranslateCreate);
		}, { userId: 'bob' });
		let res = await post(app, s.env, '/api/videos/v1/captions/jobs', { language: 'en' });
		assert.equal(res.status, 404);
		assert.ok(isFeatureOff(res.status, await res.json()));
		res = await post(app, s.env, '/api/videos/v1/captions/translate', { sourceLanguage: 'en', languages: ['ar'] });
		assert.equal(res.status, 404);
		assert.ok(isFeatureOff(res.status, await res.json()));
	});

	it('audio tracks: a tier that allows none (the limit itself is a plain 402)', async () => {
		const { addTrack, AudioTrackError } = await import('../src/lib/audio-tracks/service');
		const s = await studio();
		const video = (s.env.videos as MemoryBucket).read('v1');
		await assert.rejects(
			addTrack(s.env as never, undefined, { video, userId: 'bob', body: { language: 'ar', kind: 'dub', source: { type: 'upload', bytes: 10, fileName: 'a.mp3' } } as never }),
			(e: InstanceType<typeof AudioTrackError>) => e.status === 404 && e.code === 'feature_off',
		);
	});
});
