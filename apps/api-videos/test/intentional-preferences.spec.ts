/**
 * Intentional-viewing preferences (wiki Epic 21 §4 21.6): synced on the private profile, bounded,
 * strict, and never on public profile reads.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { IntentionalPreferencesGet, IntentionalPreferencesUpdate } from '../src/endpoints/profile/intentionalPreferences';
import { ProfileFetch } from '../src/endpoints/profile/profileFetch';
import { intentionalPreferencesOf } from '../src/lib/intentional-preferences';
import { MemoryBucket, buildApp } from './helpers';

const ROUTES = (r: any) => {
	r.get('/api/profile/intentional', IntentionalPreferencesGet);
	r.put('/api/profile/intentional', IntentionalPreferencesUpdate);
	r.get('/api/profiles/:id', ProfileFetch);
};

async function call(e: unknown, userId: string | null, method: string, path: string, body?: unknown) {
	const res = await buildApp(ROUTES, userId ? { userId } : null).request(path, {
		method,
		headers: { 'content-type': 'application/json' },
		...(body !== undefined ? { body: JSON.stringify(body) } : {}),
	}, e as never);
	const text = await res.text();
	return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe('GET/PUT /api/profile/intentional', () => {
	it('defaults to no reminder and a normal Lamahat, saves changes, and stays off public reads', async () => {
		const e = { profiles: new MemoryBucket({ u1: { id: 'u1', email: 'u1@test.local', displayName: 'U', dateCreated: '2026-01-01T00:00:00.000Z', dateModified: '2026-01-01T00:00:00.000Z', channels: [] } }) };
		assert.deepEqual((await call(e, 'u1', 'GET', '/api/profile/intentional')).body, { dailyLimitMinutes: null, finiteLamahat: false, updatedAt: null });
		const saved = await call(e, 'u1', 'PUT', '/api/profile/intentional', { dailyLimitMinutes: 45 });
		assert.equal(saved.status, 200);
		assert.equal(saved.body.dailyLimitMinutes, 45);
		assert.equal(saved.body.finiteLamahat, false);
		const both = await call(e, 'u1', 'PUT', '/api/profile/intentional', { finiteLamahat: true, dailyLimitMinutes: null });
		assert.equal(both.body.dailyLimitMinutes, null);
		assert.equal(both.body.finiteLamahat, true);
		assert.equal(e.profiles.read('u1').displayName, 'U');
		const pub = await call(e, null, 'GET', '/api/profiles/u1');
		assert.doesNotMatch(JSON.stringify(pub.body), /intentional|dailyLimit|finiteLamahat/);
	});

	it('refuses out-of-range limits and unknown fields such as streaks', async () => {
		const e = { profiles: new MemoryBucket() };
		for (const body of [{ dailyLimitMinutes: 2 }, { dailyLimitMinutes: 601 }, { dailyLimitMinutes: 10.5 }, { streak: 3 }]) {
			assert.equal((await call(e, 'u2', 'PUT', '/api/profile/intentional', body)).status, 400, JSON.stringify(body));
		}
		assert.equal(intentionalPreferencesOf({ intentional: { dailyLimitMinutes: 9999 } }).dailyLimitMinutes, null);
	});
});
