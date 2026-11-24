/**
 * Epic 14 (E14-S4 / E14-D1 / E14-D2 / E14-D3):
 * - Migration 0104 drops download_licenses table (no encryption/licenses)
 * - Download rate-limit settings read/write + internal router
 * - /api/me/features: both listenMode and offlineDownloads default OFF,
 *   stay OFF for signed-out visitors even when switches are ON (E14-D3),
 *   and apply equally to every signed-in viewer regardless of tier (E14-D2).
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SqliteD1 } from './search-sqlite-d1';
import { MemoryBucket, MemoryQueue } from './helpers';
import { assignTier, saveTier } from '../src/lib/creatorTiers';
import { computeFeatures, forgetFeatureCaches, type FeaturesEnv } from '../src/lib/features';
import {
	clearDownloadRateLimitCache,
	readDownloadRateLimit,
	toDownloadRateLimitConfig,
	writeDownloadRateLimit,
} from '../src/lib/downloads/rate-limit-settings';
import { createDownloadsInternalRouter } from '../src/endpoints/downloads/downloadsInternal';
import { API_ERROR_CATALOGUE, DEFAULT_DOWNLOAD_RATE_LIMIT, writeFeatureSwitch } from '@al-ummah/shared-types';

beforeEach(() => {
	forgetFeatureCaches();
	clearDownloadRateLimitCache();
});
afterEach(() => {
	forgetFeatureCaches();
	clearDownloadRateLimitCache();
});

describe('E14-S4: download rate-limit settings, migration 0104, and E14-D2/D3 switches', () => {
	it('drops unused download_licenses table in migration 0104 (owner decision E14-D1)', async () => {
		const sqlite = new SqliteD1();
		const d1 = sqlite as unknown as D1Database;
		const row = await d1
			.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'download_licenses'`)
			.first<{ name: string }>();
		assert.equal(row, null);
	});

	it('reads defaults, persists admin-configured download rate limits, and rejects invalid inputs (E14-D2)', async () => {
		const bucket = new MemoryBucket();
		const env = { global_settings: bucket as never };

		const initial = await readDownloadRateLimit(env, true);
		assert.deepEqual(initial, DEFAULT_DOWNLOAD_RATE_LIMIT);

		const saved = await writeDownloadRateLimit(env, { perDay: 200, burstPerMinute: 15 }, 'admin-1');
		assert.equal(saved.perDay, 200);
		assert.equal(saved.burstPerMinute, 15);
		assert.equal(saved.updatedBy, 'admin-1');
		assert.ok(saved.updatedAt);

		clearDownloadRateLimitCache();
		const reloaded = await readDownloadRateLimit(env);
		assert.equal(reloaded.perDay, 200);
		assert.equal(reloaded.burstPerMinute, 15);

		const cfg = toDownloadRateLimitConfig(reloaded);
		assert.equal(cfg.perMinute, 15);
		assert.equal(cfg.perDay, 200);

		const app = createDownloadsInternalRouter();
		const badRes = await app.request(
			'/rate-limit',
			{
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ perDay: 5, burstPerMinute: 10, actorId: 'admin-1' }),
			},
			env,
		);
		assert.equal(badRes.status, 400);

		const okRes = await app.request(
			'/rate-limit',
			{
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ perDay: 50, burstPerMinute: 5, actorId: 'admin-2' }),
			},
			env,
		);
		assert.equal(okRes.status, 200);
		const body = (await okRes.json()) as { success: boolean; result: { perDay: number; burstPerMinute: number; updatedBy: string } };
		assert.equal(body.success, true);
		assert.equal(body.result.perDay, 50);
		assert.equal(body.result.burstPerMinute, 5);
		assert.equal(body.result.updatedBy, 'admin-2');
		assert.equal(API_ERROR_CATALOGUE.download_rate_limited.action, 'retry');
		assert.ok(API_ERROR_CATALOGUE.download_rate_limited.en.length > 10);
		assert.ok(API_ERROR_CATALOGUE.download_rate_limited.ar.length > 10);
	});

	it('requires sign-in for both listenMode and offlineDownloads and ignores tier differences (E14-D2 & E14-D3)', async () => {
		const d1 = new SqliteD1() as unknown as D1Database;
		await saveTier(d1, 'basic-tier', { name: 'Basic', perHour: 5, perDay: 10, maxConcurrent: 2 }, 'admin-1', { create: true });
		await assignTier(d1, 'u_basic', 'basic-tier', 'admin-1');
		await assignTier(d1, 'u_free', 'member', 'admin-1');
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
		const memberOff = await computeFeatures(env, { userId: 'u_free', roles: [] });
		assert.equal(memberOff.listenMode, false);
		assert.equal(memberOff.offlineDownloads, false);

		// Turn both switches ON
		await writeFeatureSwitch(env, { key: 'listenMode', enabled: true, expectedVersion: 0, actorId: 'admin-1', currentStored: false });
		await writeFeatureSwitch(env, { key: 'offlineDownloads', enabled: true, expectedVersion: 0, actorId: 'admin-1', currentStored: false });
		forgetFeatureCaches();

		// Signed out: BOTH listenMode and offlineDownloads stay OFF (E14-D3)
		const anonOn = await computeFeatures(env, { userId: null });
		assert.equal(anonOn.listenMode, false);
		assert.equal(anonOn.offlineDownloads, false);

		// Every signed-in viewer gets both equally regardless of tier (E14-D2)
		const freeOn = await computeFeatures(env, { userId: 'u_free', roles: [] });
		assert.equal(freeOn.listenMode, true);
		assert.equal(freeOn.offlineDownloads, true);

		const basicOn = await computeFeatures(env, { userId: 'u_basic', roles: [] });
		assert.equal(basicOn.listenMode, true);
		assert.equal(basicOn.offlineDownloads, true);
	});
});
