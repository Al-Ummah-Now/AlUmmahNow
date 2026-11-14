/**
 * The shared provider model (packages/shared-types/src/media-providers.ts): legacy switch migration
 * (same primary source for every bucket), the planner, settings validation and the health machine.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	DEFAULT_MEDIA_SETTINGS,
	deliveryBucket,
	effectiveRules,
	ingestTargets,
	legacyFromSettings,
	nextProviderHealth,
	normaliseMediaSettings,
	pickDeliverySource,
	planSources,
	settingsFromLegacy,
	settingsProblems,
	unhealthyProviders,
	type DeliverySettings,
	type MediaProviderId,
	type MediaSettings,
} from '@al-ummah/shared-types';

const ENABLED: MediaProviderId[] = ['bunny', 'r2'];

describe('legacy delivery switch → provider settings', () => {
	const legacies: DeliverySettings[] = [
		{ mode: 'bunny', r2Percent: 10, assign: 'video', transcode: true },
		{ mode: 'r2', r2Percent: 10, assign: 'video', transcode: true },
		{ mode: 'split', r2Percent: 0, assign: 'video', transcode: true },
		{ mode: 'split', r2Percent: 37, assign: 'view', transcode: false },
		{ mode: 'split', r2Percent: 100, assign: 'video', transcode: true },
	];

	for (const legacy of legacies) {
		it(`${legacy.mode} ${legacy.r2Percent}%: same primary source for every bucket, R2 ready or not`, () => {
			const s = settingsFromLegacy(legacy);
			for (const r2Ready of [true, false]) {
				for (let bucket = 0; bucket < 100; bucket++) {
					// The legacy rule with this bucket (pickDeliverySource hashes a key; find one per bucket)
					const legacyPick = legacy.mode === 'bunny' || !r2Ready ? 'bunny' : legacy.mode === 'r2' ? 'r2' : bucket < legacy.r2Percent ? 'r2' : 'bunny';
					const plan = planSources({ rules: s.playback, enabled: ENABLED, ready: r2Ready ? ['bunny', 'r2'] : ['bunny'], bucket });
					assert.equal(plan.order[0], legacyPick, `bucket ${bucket}, r2Ready ${r2Ready}`);
				}
			}
			assert.deepEqual(s.ingest, legacy.transcode ? ['bunny', 'r2'] : ['bunny']);
			assert.equal(s.playback.assign, legacy.assign);
		});
	}

	it('agrees with pickDeliverySource on hashed video ids', () => {
		const s = settingsFromLegacy({ mode: 'split', r2Percent: 25, assign: 'video', transcode: true });
		const legacy = { mode: 'split', r2Percent: 25, assign: 'video', transcode: true } as DeliverySettings;
		for (let i = 0; i < 500; i++) {
			const id = `video-${i}-${i * 7919}`;
			const plan = planSources({ rules: s.playback, enabled: ENABLED, ready: ['bunny', 'r2'], bucket: deliveryBucket(id) });
			assert.equal(plan.order[0], pickDeliverySource(legacy, true, id));
		}
	});

	it('an unversioned stored object is migrated; a v2 one is kept', () => {
		assert.deepEqual(normaliseMediaSettings({ mode: 'r2', r2Percent: 5, assign: 'video', transcode: true }).playback.order, ['r2', 'bunny']);
		assert.deepEqual(normaliseMediaSettings(null), DEFAULT_MEDIA_SETTINGS);
		const v2 = normaliseMediaSettings({ ...DEFAULT_MEDIA_SETTINGS, ingest: ['r2'], playback: { ...DEFAULT_MEDIA_SETTINGS.playback, order: ['r2', 'bunny'] } });
		assert.deepEqual(v2.ingest, ['r2']);
		assert.deepEqual(v2.playback.order, ['r2', 'bunny']);
	});

	it('the legacy mirror written beside v2 keeps a rollback on the same behaviour', () => {
		for (const legacy of [
			{ mode: 'bunny', r2Percent: 10, assign: 'video', transcode: true },
			{ mode: 'r2', r2Percent: 10, assign: 'view', transcode: false },
			{ mode: 'split', r2Percent: 40, assign: 'view', transcode: true },
		] as DeliverySettings[]) {
			const back = legacyFromSettings(settingsFromLegacy(legacy));
			assert.equal(back.mode, legacy.mode);
			assert.equal(back.assign, legacy.assign);
			assert.equal(back.transcode, legacy.transcode);
			if (legacy.mode === 'split') assert.equal(back.r2Percent, legacy.r2Percent);
		}
		// R2 only: mode r2, no Bunny transcode flag meaning
		const r2Only = normaliseMediaSettings({ ...DEFAULT_MEDIA_SETTINGS, providers: { bunny: { enabled: false }, r2: { enabled: true } }, ingest: ['r2'], playback: { ...DEFAULT_MEDIA_SETTINGS.playback, order: ['r2'] } });
		assert.equal(legacyFromSettings(r2Only).mode, 'r2');
	});

	it('normalising drops unknown providers, duplicates and bad numbers', () => {
		const s = normaliseMediaSettings({
			version: 2,
			providers: { bunny: { enabled: true }, r2: { enabled: true }, nope: { enabled: true } },
			ingest: ['r2', 'r2', 'nope'],
			playback: { strategy: 'weighted', order: ['nope', 'bunny', 'r2'], weights: { bunny: 250, r2: -4, nope: 3 }, assign: 'x' },
			health: { failureThreshold: 'abc', cooldownMinutes: 999999 },
			channels: { 'ok-1': { order: ['r2'] }, 'bad id!': { order: ['r2'] }, empty: {} },
		});
		assert.deepEqual(s.ingest, ['r2']);
		assert.deepEqual(s.playback.order, ['bunny', 'r2']);
		assert.deepEqual(s.playback.weights, { bunny: 100, r2: 0 });
		assert.equal(s.playback.assign, 'video');
		assert.equal(s.health.failureThreshold, DEFAULT_MEDIA_SETTINGS.health.failureThreshold);
		assert.equal(s.health.cooldownMinutes, 24 * 60);
		assert.deepEqual(Object.keys(s.channels), ['ok-1']);
	});
});

describe('planSources', () => {
	const rules = (over: Partial<MediaSettings['playback']>) => ({ ...DEFAULT_MEDIA_SETTINGS.playback, ...over });

	it('priority: ready providers in order; the rest are fallbacks', () => {
		const plan = planSources({ rules: rules({ order: ['r2', 'bunny'] }), enabled: ENABLED, ready: ['bunny', 'r2'], bucket: 0 });
		assert.deepEqual(plan.order, ['r2', 'bunny']);
		assert.equal(plan.reason, 'priority');
	});

	it('only enabled, ready, listed, not excluded providers take part', () => {
		const r = rules({ order: ['r2', 'bunny'] });
		assert.deepEqual(planSources({ rules: r, enabled: ['bunny'], ready: ['bunny', 'r2'], bucket: 0 }).order, ['bunny']);
		assert.deepEqual(planSources({ rules: r, enabled: ENABLED, ready: ['bunny'], bucket: 0 }).order, ['bunny']);
		assert.deepEqual(planSources({ rules: rules({ order: ['bunny'] }), enabled: ENABLED, ready: ['bunny', 'r2'], bucket: 0 }).order, ['bunny']);
		assert.deepEqual(planSources({ rules: r, enabled: ENABLED, ready: ['bunny', 'r2'], exclude: ['r2'], bucket: 0 }).order, ['bunny']);
		const none = planSources({ rules: r, enabled: ENABLED, ready: [], bucket: 0 });
		assert.deepEqual(none, { order: [], reason: 'none_ready' });
	});

	it('weighted: buckets split by weight, renormalised over ready providers', () => {
		const r = rules({ strategy: 'weighted', order: ['r2', 'bunny'], weights: { r2: 30, bunny: 70 } });
		const firsts = Array.from({ length: 100 }, (_, bucket) => planSources({ rules: r, enabled: ENABLED, ready: ['bunny', 'r2'], bucket }).order[0]);
		assert.equal(firsts.filter((p) => p === 'r2').length, 30);
		assert.deepEqual(planSources({ rules: r, enabled: ENABLED, ready: ['bunny', 'r2'], bucket: 10 }).order, ['r2', 'bunny']);
		assert.deepEqual(planSources({ rules: r, enabled: ENABLED, ready: ['bunny', 'r2'], bucket: 90 }).order, ['bunny', 'r2']);
		// R2 not ready: all of them Bunny
		assert.deepEqual(planSources({ rules: r, enabled: ENABLED, ready: ['bunny'], bucket: 10 }).order, ['bunny']);
	});

	it('weighted with zero weights falls back to the order', () => {
		const plan = planSources({ rules: rules({ strategy: 'weighted', order: ['r2', 'bunny'], weights: {} }), enabled: ENABLED, ready: ['bunny', 'r2'], bucket: 50 });
		assert.deepEqual(plan, { order: ['r2', 'bunny'], reason: 'weighted_zero_weights' });
	});

	it('health moves an unhealthy provider behind healthy ones, never drops the last one', () => {
		const r = rules({ order: ['r2', 'bunny'] });
		const moved = planSources({ rules: r, enabled: ENABLED, ready: ['bunny', 'r2'], unhealthy: ['r2'], bucket: 0 });
		assert.deepEqual(moved, { order: ['bunny', 'r2'], reason: 'unhealthy_moved', demoted: ['r2'] });
		const only = planSources({ rules: r, enabled: ENABLED, ready: ['r2'], unhealthy: ['r2'], bucket: 0 });
		assert.deepEqual(only.order, ['r2']);
		const both = planSources({ rules: r, enabled: ENABLED, ready: ['bunny', 'r2'], unhealthy: ['r2', 'bunny'], bucket: 0 });
		assert.deepEqual(both.order, ['r2', 'bunny']);
	});
});

describe('overrides and ingest targets', () => {
	const s = normaliseMediaSettings({
		...DEFAULT_MEDIA_SETTINGS,
		channels: { chanA: { ingest: ['r2'], order: ['r2', 'bunny'] }, chanB: { strategy: 'weighted', weights: { r2: 50, bunny: 50 }, order: ['bunny', 'r2'] } },
	});

	it('a channel override replaces only the fields it sets; a video override applies last', () => {
		assert.deepEqual(effectiveRules(s, s.channels.chanA).order, ['r2', 'bunny']);
		assert.equal(effectiveRules(s, s.channels.chanA).strategy, 'priority');
		const r = effectiveRules(s, s.channels.chanB, { order: ['r2'] });
		assert.equal(r.strategy, 'weighted');
		assert.deepEqual(r.order, ['r2']);
		assert.deepEqual(effectiveRules(s).order, ['bunny']);
	});

	it('ingest targets: the channel override, else global; off providers left out', () => {
		assert.deepEqual(ingestTargets(s, 'chanA'), ['r2']);
		assert.deepEqual(ingestTargets(s, 'other'), ['bunny', 'r2']);
		const off = normaliseMediaSettings({ ...s, providers: { bunny: { enabled: true }, r2: { enabled: false } } });
		assert.deepEqual(ingestTargets(off, 'other'), ['bunny']);
	});
});

describe('settingsProblems', () => {
	it('the default and the legacy migrations are valid', () => {
		assert.deepEqual(settingsProblems(DEFAULT_MEDIA_SETTINGS), []);
		for (const mode of ['bunny', 'r2', 'split'] as const) assert.deepEqual(settingsProblems(settingsFromLegacy({ mode, r2Percent: 20, assign: 'video', transcode: true })), []);
	});

	it('R2 only for new videos is valid when R2 plays', () => {
		const s = normaliseMediaSettings({ ...DEFAULT_MEDIA_SETTINGS, ingest: ['r2'], playback: { ...DEFAULT_MEDIA_SETTINGS.playback, order: ['r2', 'bunny'] } });
		assert.deepEqual(settingsProblems(s), []);
	});

	it('refuses settings that would leave new uploads unplayable or use an off provider', () => {
		const kinds = (s: unknown) => settingsProblems(normaliseMediaSettings(s)).map((p) => p.problem);
		assert.ok(kinds({ ...DEFAULT_MEDIA_SETTINGS, ingest: ['r2'] }).includes('ingest_not_playable'));
		assert.ok(kinds({ ...DEFAULT_MEDIA_SETTINGS, providers: { bunny: { enabled: false }, r2: { enabled: true } } }).includes('ingest_disabled'));
		assert.ok(kinds({ ...DEFAULT_MEDIA_SETTINGS, providers: { bunny: { enabled: false }, r2: { enabled: false } } }).includes('no_provider_enabled'));
		assert.ok(kinds({ ...DEFAULT_MEDIA_SETTINGS, playback: { strategy: 'weighted', order: ['bunny', 'r2'], weights: { bunny: 0, r2: 0 }, assign: 'video' } }).includes('weights_zero'));
		assert.ok(kinds({ ...DEFAULT_MEDIA_SETTINGS, providers: { bunny: { enabled: false }, r2: { enabled: true } }, ingest: ['r2'], playback: { ...DEFAULT_MEDIA_SETTINGS.playback, order: ['r2'] } }).includes('thumbnail_store_disabled'));
		assert.ok(kinds({ ...DEFAULT_MEDIA_SETTINGS, channels: { c1: { ingest: ['r2'] } } }).includes('override_not_playable'));
	});
});

describe('provider health', () => {
	const h = DEFAULT_MEDIA_SETTINGS.health;
	const t0 = new Date('2026-11-14T10:00:00Z');
	const at = (min: number) => new Date(t0.getTime() + min * 60_000);

	it('fallbacks over the threshold mark it unhealthy for the cooldown, then healthy again', () => {
		const ok = nextProviderHealth(undefined, { recentFailures: 0, probeOk: true }, h, t0);
		assert.equal(ok.state, 'healthy');
		const bad = nextProviderHealth(ok, { recentFailures: h.failureThreshold, probeOk: true }, h, at(1));
		assert.equal(bad.state, 'unhealthy');
		assert.match(bad.reason!, /fallbacks/);
		const still = nextProviderHealth(bad, { recentFailures: 0, probeOk: true }, h, at(5));
		assert.equal(still.state, 'unhealthy');
		assert.equal(still.since, bad.since);
		const back = nextProviderHealth(still, { recentFailures: 0, probeOk: true }, h, at(1 + h.cooldownMinutes + 1));
		assert.equal(back.state, 'healthy');
	});

	it('consecutive failed probes mark it unhealthy; one good probe resets the count', () => {
		let s = nextProviderHealth(undefined, { recentFailures: 0, probeOk: false }, h, t0);
		s = nextProviderHealth(s, { recentFailures: 0, probeOk: false }, h, at(1));
		assert.equal(s.state, 'healthy');
		s = nextProviderHealth(s, { recentFailures: 0, probeOk: false }, h, at(2));
		assert.equal(s.state, 'unhealthy');
		assert.equal(s.consecutiveProbeFailures, 3);
		const reset = nextProviderHealth(s, { recentFailures: 0, probeOk: true }, h, at(3));
		assert.equal(reset.consecutiveProbeFailures, 0);
	});

	it('unhealthyProviders honours the switch and the cooldown', () => {
		const snap = { checkedAt: t0.toISOString(), providers: { r2: { state: 'unhealthy' as const, since: t0.toISOString(), until: at(10).toISOString(), recentFailures: 20, consecutiveProbeFailures: 0 } } };
		assert.deepEqual(unhealthyProviders(snap, h, at(5).getTime()), ['r2']);
		assert.deepEqual(unhealthyProviders(snap, h, at(11).getTime()), []);
		assert.deepEqual(unhealthyProviders(snap, { ...h, enabled: false }, at(5).getTime()), []);
	});
});
