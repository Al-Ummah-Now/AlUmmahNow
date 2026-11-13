/**
 * The identity tour shows once per account (docs/features/HELP-AND-TOUR.md): GET/PUT
 * /api/profile/onboarding keeps the highest tour version seen on the profile, never lowers it,
 * and never shows on public profile reads.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { OnboardingGet, OnboardingUpdate } from '../src/endpoints/profile/onboarding';
import { ProfileFetch } from '../src/endpoints/profile/profileFetch';
import { MemoryBucket, buildApp } from './helpers';

const ROUTES = (r: any) => {
	r.get('/api/profile/onboarding', OnboardingGet);
	r.put('/api/profile/onboarding', OnboardingUpdate);
	r.get('/api/profiles/:id', ProfileFetch);
};

async function call(env: unknown, userId: string | null, method: string, path: string, body?: unknown) {
	const res = await buildApp(ROUTES, userId ? { userId } : null).request(path, {
		method,
		headers: { 'content-type': 'application/json' },
		...(body !== undefined ? { body: JSON.stringify(body) } : {}),
	}, env as never);
	const text = await res.text();
	return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe('GET/PUT /api/profile/onboarding', () => {
	it('starts at 0, keeps the version seen on the account, and stays off public reads', async () => {
		const profiles = new MemoryBucket({ u1: { id: 'u1', email: 'u1@test.local', displayName: 'U', dateCreated: '2026-01-01T00:00:00.000Z', dateModified: '2026-01-01T00:00:00.000Z', channels: [] } });
		const env = { profiles };
		assert.deepEqual((await call(env, 'u1', 'GET', '/api/profile/onboarding')).body, { identityTour: 0 });

		const seen = await call(env, 'u1', 'PUT', '/api/profile/onboarding', { identityTour: 1 });
		assert.equal(seen.status, 200);
		assert.deepEqual(seen.body, { identityTour: 1 });
		// Another device of the same account reads the same state
		assert.deepEqual((await call(env, 'u1', 'GET', '/api/profile/onboarding')).body, { identityTour: 1 });
		assert.equal(profiles.read('u1').displayName, 'U', 'the rest of the profile is kept');

		const pub = await call(env, null, 'GET', '/api/profiles/u1');
		assert.doesNotMatch(JSON.stringify(pub.body), /onboarding|identityTour/);
	});

	it('never lowers the version (an older client cannot re-show a newer tour)', async () => {
		const profiles = new MemoryBucket({ u1: { id: 'u1', email: 'u1@test.local', onboarding: { identityTour: 3 } } });
		const env = { profiles };
		assert.deepEqual((await call(env, 'u1', 'PUT', '/api/profile/onboarding', { identityTour: 2 })).body, { identityTour: 3 });
		assert.deepEqual((await call(env, 'u1', 'PUT', '/api/profile/onboarding', { identityTour: 4 })).body, { identityTour: 4 });
	});

	it('a user without a profile yet gets one; bad bodies and signed-out callers are refused', async () => {
		const profiles = new MemoryBucket();
		const env = { profiles };
		assert.deepEqual((await call(env, 'u2', 'PUT', '/api/profile/onboarding', { identityTour: 1 })).body, { identityTour: 1 });
		assert.equal(profiles.read('u2').onboarding.identityTour, 1);
		assert.equal((await call(env, 'u2', 'PUT', '/api/profile/onboarding', { identityTour: 'yes' })).status, 400);
		assert.equal((await call(env, 'u2', 'PUT', '/api/profile/onboarding', { identityTour: -1 })).status, 400);
		assert.equal((await call(env, null, 'GET', '/api/profile/onboarding')).status, 401);
	});
});
