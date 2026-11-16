/**
 * Every account has a stored tier (owner, 2026-11-15): creating a profile
 * (sign-up) writes the current default; a later default never changes it,
 * and an account that already has a tier (an invite's) keeps it.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SIGNUP_TIER_ASSIGNER } from '@al-ummah/shared-types';
import { ProfileCreate } from '../src/endpoints/profile/profileCreate';
import { assignTier, readAssignment, setDefaultTier } from '../src/lib/creatorTiers';
import { MemoryBucket, MemoryQueue, buildApp } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';

const json = { 'Content-Type': 'application/json' };

function setup(userId: string) {
	const db = new SqliteD1();
	const d1 = db as unknown as D1Database;
	const env = { SEARCH_DB: d1, profiles: new MemoryBucket(), queue: new MemoryQueue() };
	const app = buildApp((r: any) => r.post('/api/profiles', ProfileCreate), { userId });
	const create = () => app.request('/api/profiles', { method: 'POST', headers: json, body: JSON.stringify({ email: `${userId}@test.local`, displayName: 'New user' }) }, env);
	return { d1, create };
}

describe('sign-up writes the default tier', () => {
	it('a new profile gets the current default (Free as shipped), stored as given at sign-up', async () => {
		const { d1, create } = setup('usr_new');
		assert.equal((await create()).status, 200);
		const row = await readAssignment(d1, 'usr_new');
		assert.deepEqual([row?.tierId, row?.assignedBy], ['member', SIGNUP_TIER_ASSIGNER]);
	});

	it('after the admin changes the default, new sign-ups get the new one and older accounts keep theirs', async () => {
		const { d1, create } = setup('usr_late');
		await assignTier(d1, 'usr_old', 'member', SIGNUP_TIER_ASSIGNER);
		await setDefaultTier(d1, 'creator', 'admin-1');
		assert.equal((await create()).status, 200);
		assert.equal((await readAssignment(d1, 'usr_late'))?.tierId, 'creator');
		assert.equal((await readAssignment(d1, 'usr_old'))?.tierId, 'member');
	});

	it("an invited account keeps its invite's tier; creating the profile again changes nothing", async () => {
		const { d1, create } = setup('usr_inv');
		await assignTier(d1, 'usr_inv', 'member', 'admin-1');
		assert.equal((await create()).status, 200);
		assert.equal((await create()).status, 200);
		assert.equal((await readAssignment(d1, 'usr_inv'))?.tierId, 'member');
	});
});
