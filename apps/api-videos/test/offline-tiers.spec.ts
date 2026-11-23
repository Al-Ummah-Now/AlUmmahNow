/**
 * Epic 14 (E14-S1): tier offline download fields, D1 migration indexes, and /api/me/features wiring.
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SqliteD1 } from './search-sqlite-d1';
import { MemoryBucket, MemoryQueue } from './helpers';
import { assignTier, readTier, saveTier, CreatorTierError } from '../src/lib/creatorTiers';
import { computeFeatures, forgetFeatureCaches, type FeaturesEnv } from '../src/lib/features';
import { writeFeatureSwitch } from '@al-ummah/shared-types';

beforeEach(() => forgetFeatureCaches());
afterEach(() => forgetFeatureCaches());

describe('E14-S1: offline tier settings, migration and switches', () => {
	it('persists and validates offline download fields on creator_tiers', async () => {
		const d1 = new SqliteD1() as unknown as D1Database;
		const { tier } = await saveTier(
			d1,
			'audio-only',
			{
				name: 'Listener',
				perHour: 5,
				perDay: 10,
				maxConcurrent: 2,
				maxChannels: 1,
				offlineDownloads: true,
				offlineMaxQuality: 'audio',
				offlineMaxVideos: 15,
				offlineLicenseDays: 14,
			},
			'admin-1',
			{ create: true },
		);
		assert.equal(tier.offlineDownloads, true);
		assert.equal(tier.offlineMaxQuality, 'audio');
		assert.equal(tier.offlineMaxVideos, 15);
		assert.equal(tier.offlineLicenseDays, 14);

		const reloaded = await readTier(d1, 'audio-only');
		assert.ok(reloaded);
		assert.equal(reloaded.offlineDownloads, true);
		assert.equal(reloaded.offlineMaxQuality, 'audio');
		assert.equal(reloaded.offlineMaxVideos, 15);
		assert.equal(reloaded.offlineLicenseDays, 14);

		await assert.rejects(
			() => saveTier(d1, 'audio-only', { offlineMaxQuality: '4k' }, 'admin-1'),
			(e: unknown) => e instanceof CreatorTierError && e.status === 400 && e.code === 'invalid_tier',
		);
		await assert.rejects(
			() => saveTier(d1, 'audio-only', { offlineLicenseDays: 120 }, 'admin-1'),
			(e: unknown) => e instanceof CreatorTierError && e.status === 400 && e.code === 'invalid_tier',
		);
	});

	it('creates indexed download_licenses table (no full-table scan on lookup)', async () => {
		const sqlite = new SqliteD1();
		const d1 = sqlite as unknown as D1Database;
		await d1
			.prepare(
				`INSERT INTO download_licenses (id, user_id, device_id, video_id, quality, r2_rev, status, issued_at, refreshed_at, expires_at)
				 VALUES ('lic1', 'u1', 'dev1', 'v1', 'audio', 'r1', 'active', '2026-11-23T00:00:00Z', '2026-11-23T00:00:00Z', '2026-12-23T00:00:00Z')`,
			)
			.run();
		const planUser = await d1
			.prepare(`EXPLAIN QUERY PLAN SELECT id FROM download_licenses WHERE user_id = ? AND status = 'active' AND expires_at > ?`)
			.bind('u1', '2026-11-23T00:00:00Z')
			.all<{ detail: string }>();
		assert.ok(planUser.results.some((r) => /USING INDEX idx_download_licenses_user_status/i.test(r.detail)));

		const planVideo = await d1
			.prepare(`EXPLAIN QUERY PLAN SELECT id FROM download_licenses WHERE video_id = ? AND status = 'active'`)
			.bind('v1')
			.all<{ detail: string }>();
		assert.ok(planVideo.results.some((r) => /USING INDEX idx_download_licenses_video_status/i.test(r.detail)));
	});

	it('keeps listenMode and offlineDownloads off by default and enforces switches + tier', async () => {
		const d1 = new SqliteD1() as unknown as D1Database;
		await saveTier(d1, 'no-dl', { name: 'NoDL', perHour: 5, perDay: 10, maxConcurrent: 2, offlineDownloads: false }, 'admin-1', { create: true });
		await saveTier(d1, 'with-dl', { name: 'WithDL', perHour: 5, perDay: 10, maxConcurrent: 2, offlineDownloads: true, offlineMaxQuality: '720p' }, 'admin-1', { create: true });
		await assignTier(d1, 'u_nodl', 'no-dl', 'admin-1');
		await assignTier(d1, 'u_dl', 'with-dl', 'admin-1');
		const env: FeaturesEnv = {
			SEARCH_DB: d1,
			global_settings: new MemoryBucket() as never,
			queue: new MemoryQueue() as never,
			ENVIRONMENT: 'test',
		};

		// Default: both switches off for signed-out and signed-in
		const anonOff = await computeFeatures(env, { userId: null });
		assert.equal(anonOff.listenMode, false);
		assert.equal(anonOff.offlineDownloads, false);
		const dlOff = await computeFeatures(env, { userId: 'u_dl', roles: [] });
		assert.equal(dlOff.listenMode, false);
		assert.equal(dlOff.offlineDownloads, false);

		// Turn switches ON
		await writeFeatureSwitch(env, { key: 'listenMode', enabled: true, expectedVersion: 0, actorId: 'admin-1', currentStored: false });
		await writeFeatureSwitch(env, { key: 'offlineDownloads', enabled: true, expectedVersion: 0, actorId: 'admin-1', currentStored: false });
		forgetFeatureCaches();

		// Signed out: listenMode ON, offlineDownloads stays OFF (requires sign-in)
		const anonOn = await computeFeatures(env, { userId: null });
		assert.equal(anonOn.listenMode, true);
		assert.equal(anonOn.offlineDownloads, false);

		// Tier without downloads: listenMode ON, offlineDownloads OFF
		const noDlOn = await computeFeatures(env, { userId: 'u_nodl', roles: [] });
		assert.equal(noDlOn.listenMode, true);
		assert.equal(noDlOn.offlineDownloads, false);

		// Tier with downloads: both ON
		const dlOn = await computeFeatures(env, { userId: 'u_dl', roles: [] });
		assert.equal(dlOn.listenMode, true);
		assert.equal(dlOn.offlineDownloads, true);
	});
});
