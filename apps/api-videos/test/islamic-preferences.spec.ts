/**
 * Islamic-experience preferences (wiki Epic 21 §5.1, E21-D1 to E21-D3): synced on the private
 * profile, only a catalogue city id for location, optimistic version, hidden while every related
 * feature is off, and never on public profile reads.
 */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { forgetFeatureSwitches, writeFeatureSwitch } from '@al-ummah/shared-types';
import { IslamicPreferencesGet, IslamicPreferencesUpdate } from '../src/endpoints/profile/islamicPreferences';
import { ProfileFetch } from '../src/endpoints/profile/profileFetch';
import { islamicPreferencesOf } from '../src/lib/islamic-preferences';
import { SqliteD1 } from './search-sqlite-d1';
import { MemoryBucket, buildApp } from './helpers';

const ROUTES = (r: any) => {
	r.get('/api/profile/islamic', IslamicPreferencesGet);
	r.put('/api/profile/islamic', IslamicPreferencesUpdate);
	r.get('/api/profiles/:id', ProfileFetch);
};

async function env(on: string[] = ['hijriCalendar']) {
	const SEARCH_DB = new SqliteD1() as unknown as D1Database;
	const e = { SEARCH_DB, profiles: new MemoryBucket({ u1: { id: 'u1', email: 'u1@test.local', displayName: 'U', dateCreated: '2026-01-01T00:00:00.000Z', dateModified: '2026-01-01T00:00:00.000Z', channels: [] } }) };
	for (const key of on) await writeFeatureSwitch(e as never, { key, enabled: true, expectedVersion: 0, actorId: 'admin-1' });
	forgetFeatureSwitches();
	return e;
}

async function call(e: unknown, userId: string | null, method: string, path: string, body?: unknown) {
	const res = await buildApp(ROUTES, userId ? { userId } : null).request(path, {
		method,
		headers: { 'content-type': 'application/json' },
		...(body !== undefined ? { body: JSON.stringify(body) } : {}),
	}, e as never);
	const text = await res.text();
	return { status: res.status, body: text ? JSON.parse(text) : null };
}

beforeEach(() => forgetFeatureSwitches());

describe('GET/PUT /api/profile/islamic', () => {
	it('is 404 feature_off while prayer times, Qibla, Hijri and Ramadan mode are all off', async () => {
		const e = await env([]);
		const get = await call(e, 'u1', 'GET', '/api/profile/islamic');
		assert.equal(get.status, 404);
		assert.equal(get.body.code ?? get.body.error, 'feature_off');
		assert.equal((await call(e, 'u1', 'PUT', '/api/profile/islamic', { version: 0, hijriEnabled: true })).status, 404);
	});

	it('defaults, saves a city id and choices with an optimistic version, and stays off public reads', async () => {
		const e = await env(['hijriCalendar']);
		const first = await call(e, 'u1', 'GET', '/api/profile/islamic');
		assert.equal(first.status, 200);
		assert.equal(first.body.version, 0);
		assert.equal(first.body.cityId, null);
		assert.equal(first.body.calculationMethod, 'auto');
		assert.equal(first.body.asrMethod, 'standard');

		const saved = await call(e, 'u1', 'PUT', '/api/profile/islamic', {
			version: 0,
			cityId: '360630',
			calculationMethod: 5,
			asrMethod: 'hanafi',
			adjustmentsMinutes: { fajr: -2, isha: 3 },
			hijriEnabled: true,
			hijriShiftDays: -1,
		});
		assert.equal(saved.status, 200);
		assert.equal(saved.body.version, 1);
		assert.equal(saved.body.cityId, '360630');
		assert.deepEqual(saved.body.adjustmentsMinutes, { fajr: -2, sunrise: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 3 });
		assert.equal(saved.body.hijriShiftDays, -1);
		assert.equal(e.profiles.read('u1').displayName, 'U', 'the rest of the profile is kept');

		const stale = await call(e, 'u1', 'PUT', '/api/profile/islamic', { version: 0, hijriEnabled: false });
		assert.equal(stale.status, 409);
		assert.equal(stale.body.error, 'version_conflict');
		assert.equal(stale.body.current.version, 1);
		assert.equal(stale.body.current.hijriEnabled, true);

		const pub = await call(e, null, 'GET', '/api/profiles/u1');
		assert.doesNotMatch(JSON.stringify(pub.body), /islamic|cityId|hijri/);
	});

	it('refuses coordinates, out-of-range values and unknown fields', async () => {
		const e = await env(['prayerTimes']);
		for (const body of [
			{ version: 0, latitude: 21.4, longitude: 39.8 },
			{ version: 0, cityId: '21.42,39.82' },
			{ version: 0, hijriShiftDays: 3 },
			{ version: 0, adjustmentsMinutes: { fajr: 61 } },
			{ version: 0, calculationMethod: 'mwl' },
			{ version: 0, asrMethod: 'shafii' },
			{ version: 0, adjustmentsMinutes: { fajr: 1, tahajjud: 2 } },
		]) {
			assert.equal((await call(e, 'u1', 'PUT', '/api/profile/islamic', body)).status, 400, JSON.stringify(body));
		}
	});

	it('reads damaged stored values as defaults', () => {
		const out = islamicPreferencesOf({ islamic: { cityId: 'x', hijriShiftDays: 9, calculationMethod: 400 as never, adjustmentsMinutes: { fajr: 1.5 } as never } });
		assert.equal(out.cityId, null);
		assert.equal(out.hijriShiftDays, 0);
		assert.equal(out.calculationMethod, 'auto');
		assert.equal(out.adjustmentsMinutes.fajr, 0);
	});
});
