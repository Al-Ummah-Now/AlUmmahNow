/**
 * Prayer-time proxy admin settings (wiki Epic 21 §3, story 21.1c): defaults, bounded limits,
 * country method overrides used by method=auto, optimistic version, and the per-key cache purge.
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PrayerTimesGet, setPrayerSettingsForTests } from '../src/endpoints/prayer/prayerTimes';
import { aladhanProvider } from '../src/lib/prayer/aladhan';
import { forgetPrayerSettingsCache, normalizeSettings, PrayerSettingsError, readPrayerAdminSettings, writePrayerAdminSettings } from '../src/lib/prayer/settings';
import { prayerKey } from '../src/lib/prayer/service';
import adminRouter from '../src/routers/admin.router';
import { SqliteD1 } from './search-sqlite-d1';
import { MemoryBucket, buildApp } from './helpers';

beforeEach(() => forgetPrayerSettingsCache());
afterEach(() => setPrayerSettingsForTests(null));

const thisMonth = () => new Date().toISOString().slice(0, 7);

describe('prayer settings', () => {
	it('defaults, and reads damaged stored values as defaults', async () => {
		const s = await readPrayerAdminSettings({ global_settings: new MemoryBucket() } as never);
		assert.equal(s.version, 0);
		assert.equal(s.provider, 'aladhan');
		assert.equal(s.hijriSource, 'HJCoSA');
		assert.deepEqual(s.limits, { maxInFlight: 4, perSecond: 5 });
		const bad = normalizeSettings({ provider: 'x', hijriSource: 'lunar', limits: { maxInFlight: 500, perSecond: 0 }, countryMethods: { EG: 6, xx: 3, SA: 4 } });
		assert.equal(bad.provider, 'aladhan');
		assert.equal(bad.hijriSource, 'HJCoSA');
		assert.deepEqual(bad.limits, { maxInFlight: 4, perSecond: 5 });
		assert.deepEqual(bad.countryMethods, { SA: 4 });
	});

	it('saves with an optimistic version, refuses bad values, and null restores a country default', async () => {
		const env = { global_settings: new MemoryBucket() };
		const { settings } = await writePrayerAdminSettings(env as never, { version: 0, hijriSource: 'UAQ', limits: { maxInFlight: 2 }, countryMethods: { EG: 3, GB: 2 } }, 'admin-1');
		assert.equal(settings.version, 1);
		assert.equal(settings.hijriSource, 'UAQ');
		assert.deepEqual(settings.limits, { maxInFlight: 2, perSecond: 5 });
		assert.equal(settings.updatedBy, 'admin-1');
		await assert.rejects(writePrayerAdminSettings(env as never, { version: 0, hijriSource: 'HJCoSA' }, 'admin-2'), (e: unknown) => e instanceof PrayerSettingsError && e.status === 409);
		for (const bad of [{ limits: { perSecond: 51 } }, { countryMethods: { EG: 6 } }, { countryMethods: { egypt: 5 } }, { provider: 'other' }, { hijriSource: 'X' }]) {
			await assert.rejects(writePrayerAdminSettings(env as never, { version: 1, ...bad } as never, 'admin-2'), PrayerSettingsError, JSON.stringify(bad));
		}
		const after = await writePrayerAdminSettings(env as never, { version: 1, countryMethods: { GB: null } }, 'admin-2');
		assert.deepEqual(after.settings.countryMethods, { EG: 3 });
		assert.deepEqual(after.previous.countryMethods, { EG: 3, GB: 2 });
	});

	it('method=auto uses the admin country override', async () => {
		const env = { SEARCH_DB: new SqliteD1() as unknown as D1Database, global_settings: new MemoryBucket() };
		await writePrayerAdminSettings(env as never, { version: 0, countryMethods: { EG: 3 } }, 'admin-1');
		const urls: string[] = [];
		const fetchImpl = (async (u: RequestInfo | URL) => {
			urls.push(String(u));
			return new Response('down', { status: 503 });
		}) as typeof fetch;
		setPrayerSettingsForTests(() => ({ provider: aladhanProvider(fetchImpl, 'https://aladhan.test/v1'), hijriSource: 'HJCoSA', limits: { maxInFlight: 4, perSecond: 5 } }));
		await buildApp((r) => r.get('/api/prayer-times', PrayerTimesGet), null).request(`/api/prayer-times?city=360630&month=${thisMonth()}`, {}, env as never);
		assert.equal(new URL(urls[0]).searchParams.get('method'), '3');
	});

	it('the internal admin routes read, write and purge one stored month', async () => {
		const env = { global_settings: new MemoryBucket(), SEARCH_DB: new SqliteD1() as unknown as D1Database };
		const key = prayerKey('aladhan', 'HJCoSA', 5, 'standard', '360630', '2026-11');
		await env.global_settings.put(key, '{}');
		const req = (method: string, path: string, body?: unknown) =>
			adminRouter.request(path, { method, headers: { 'content-type': 'application/json', 'X-Admin-Actor': 'admin-9' }, ...(body ? { body: JSON.stringify(body) } : {}) }, env as never);
		const got = (await (await req('GET', '/prayer-settings')).json()) as any;
		assert.equal(got.result.settings.version, 0);
		assert.equal(got.result.countryDefaults.EG, 5);
		const put = (await (await req('PUT', '/prayer-settings', { version: 0, perSecond: 1 })).json()) as any;
		assert.equal(put.success, false, 'unknown fields are refused');
		const put2 = await req('PUT', '/prayer-settings', { version: 0, limits: { perSecond: 2 } });
		assert.equal(put2.status, 200);
		assert.equal(((await put2.json()) as any).result.settings.updatedBy, 'admin-9');
		const purge = await req('POST', '/prayer-cache/purge', { cityId: '360630', month: '2026-11', method: 5, asr: 'standard' });
		assert.equal(purge.status, 200);
		assert.equal(await env.global_settings.get(key), null);
	});
});
