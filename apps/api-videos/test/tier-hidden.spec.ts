/**
 * Hidden tiers (owner, 2026-11-19; lib/creatorTiers.ts, lib/tierRequests.ts): a hidden tier never shows on
 * /upgrade to anyone not on it, cannot be requested, is never the default, and stays fully visible and
 * assignable for admins (invites and grants). Real SQLite with the search migrations.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TIER_REQUEST_ERRORS } from '@al-ummah/shared-types';
import { assignTier, readTiers, resolveCreator, saveTier, setDefaultTier } from '../src/lib/creatorTiers';
import { createTierRequest, upgradeOverview } from '../src/lib/tierRequests';
import { SqliteD1 } from './search-sqlite-d1';

const ABOUT = 'I run a small masjid channel and record the Friday khutbah every week.';
const ids = (o: { tiers: { id: string }[] }) => o.tiers.map((t) => t.id);

async function setup() {
	const d1 = new SqliteD1() as unknown as D1Database;
	// A requestable tier above Creator, then hidden by an admin
	await saveTier(d1, 'scholar', { name: 'Scholar', perHour: 5, perDay: 50, maxConcurrent: 2, requestable: true }, 'admin', { create: true });
	await saveTier(d1, 'scholar', { hidden: true }, 'admin');
	return d1;
}

describe('hidden tiers', () => {
	it('the flag is stored, defaults to shown, and admins still list the tier', async () => {
		const d1 = new SqliteD1() as unknown as D1Database;
		await saveTier(d1, 'scholar', { name: 'Scholar', perHour: 5, perDay: 50, maxConcurrent: 2 }, 'admin', { create: true });
		assert.equal((await readTiers(d1)).find((t) => t.id === 'scholar')?.hidden, false, 'a new tier is shown');
		const saved = await saveTier(d1, 'scholar', { hidden: true }, 'admin');
		assert.equal(saved.previous?.hidden, false, 'the audit has the value before');
		assert.equal(saved.tier.hidden, true);
		assert.ok((await readTiers(d1)).some((t) => t.id === 'scholar' && t.hidden), 'admin lists keep it');
		// Undo: saving the previous value back
		assert.equal((await saveTier(d1, 'scholar', { hidden: false }, 'admin')).tier.hidden, false);
		await assert.rejects(saveTier(d1, 'scholar', { hidden: 'yes' }, 'admin'), (e: { code: string }) => e.code === 'invalid_tier');
	});

	it('not on it: /upgrade never shows it (signed out or signed in), and a request is a 404 like an unknown tier', async () => {
		const d1 = await setup();
		assert.ok(!ids(await upgradeOverview(d1, null, null)).includes('scholar'), 'signed out');
		const free = await upgradeOverview(d1, { userId: 'usr_free' }, null);
		assert.deepEqual(ids(free), ['member', 'creator'], 'Free sees Creator, never the hidden Scholar');
		await assert.rejects(createTierRequest(d1, { userId: 'usr_free' }, { tierId: 'scholar', name: 'Yusuf Ali', about: ABOUT }), (e: { status: number; code: string }) => e.status === 404 && e.code === TIER_REQUEST_ERRORS.tierNotRequestable);
		// Shown again: back on the page and requestable
		await saveTier(d1, 'scholar', { hidden: false }, 'admin');
		assert.ok(ids(await upgradeOverview(d1, { userId: 'usr_free' }, null)).includes('scholar'));
	});

	it('on it: the user sees it as their current tier, as usual', async () => {
		const d1 = await setup();
		await assignTier(d1, 'usr_s', 'scholar', 'admin');
		const own = await upgradeOverview(d1, { userId: 'usr_s' }, null);
		assert.equal(own.currentTierId, 'scholar');
		assert.ok(ids(own).includes('scholar'), 'their own card is there');
		assert.equal((await resolveCreator(d1, { userId: 'usr_s' })).tier?.id, 'scholar', 'its limits apply');
	});

	it('admins: grant it (user page, invites) and see it; the default tier is never hidden', async () => {
		const d1 = await setup();
		// Grant (the user page and invites both assign through assignTier)
		await assignTier(d1, 'usr_invited', 'scholar', 'admin');
		assert.equal((await resolveCreator(d1, { userId: 'usr_invited' })).tier?.id, 'scholar');
		// A hidden tier cannot become the default
		await assert.rejects(setDefaultTier(d1, 'scholar', 'admin'), (e: { status: number; code: string }) => e.status === 409 && e.code === 'default_tier_hidden');
		// The default cannot be hidden
		await setDefaultTier(d1, 'creator', 'admin');
		await assert.rejects(saveTier(d1, 'creator', { hidden: true }, 'admin'), (e: { status: number; code: string }) => e.status === 409 && e.code === 'default_tier_hidden');
		// Shown again, it can be the default
		await saveTier(d1, 'scholar', { hidden: false }, 'admin');
		assert.equal((await setDefaultTier(d1, 'scholar', 'admin')).defaultTierId, 'scholar');
	});
});
