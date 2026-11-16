/**
 * Add tier never asks for an id (owner rule: admins never type raw ids):
 * api-videos makes it from the English name, or a random one for an
 * Arabic-only name; unique (deleted tiers included) and immutable.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import adminRouter from '../src/routers/admin.router';
import { createTier, deleteTier, newTierId, readTier, saveTier, tierIdBase } from '../src/lib/creatorTiers';
import { SqliteD1 } from './search-sqlite-d1';

const LIMITS = { perHour: 5, perDay: 10, maxConcurrent: 1, maxChannels: 1 };
const setup = () => new SqliteD1() as unknown as D1Database;

describe('tier ids are made from the name', () => {
	it('slugs the English name; accents dropped; no Latin letters or digits → none', () => {
		assert.equal(tierIdBase('Gold Plus'), 'gold-plus');
		assert.equal(tierIdBase('  Café — Scholars!! '), 'cafe-scholars');
		assert.equal(tierIdBase('Tier 2'), 'tier-2');
		assert.equal(tierIdBase('ذهبي'), null);
		assert.equal(tierIdBase('A'), null, 'too short');
		assert.equal(tierIdBase('x'.repeat(80))?.length, 32);
	});

	it('never takes a shipped, reserved, existing or deleted id: it numbers the next one', async () => {
		const d1 = setup();
		assert.equal(await newTierId(d1, 'Creator'), 'creator-2');
		assert.equal(await newTierId(d1, 'Default'), 'default-2', 'audit keys use "default"');
		assert.equal(await newTierId(d1, 'None'), 'none-2');
		const { tier } = await createTier(d1, { name: 'Gold', ...LIMITS }, 'admin-1');
		assert.equal(tier.id, 'gold');
		await deleteTier(d1, 'gold', { actorId: 'admin-1' });
		assert.equal((await createTier(d1, { name: 'Gold', ...LIMITS }, 'admin-1')).tier.id, 'gold-2', 'a deleted tier keeps its id (restore)');
	});

	it('an Arabic-only name gets a random id; the names stay as typed', async () => {
		const d1 = setup();
		const { tier } = await createTier(d1, { name: 'ذهبي', nameAr: 'ذهبي', ...LIMITS }, 'admin-1');
		assert.match(tier.id, /^tier-[0-9a-f]{8}$/);
		assert.equal(tier.name, 'ذهبي');
	});

	it('renaming never changes the id', async () => {
		const d1 = setup();
		await createTier(d1, { name: 'Silver', ...LIMITS }, 'admin-1');
		await saveTier(d1, 'silver', { name: 'Platinum', nameAr: 'بلاتيني' }, 'admin-1');
		const tier = await readTier(d1, 'silver');
		assert.deepEqual([tier?.id, tier?.name, tier?.nameAr], ['silver', 'Platinum', 'بلاتيني']);
	});

	it('POST /creator-tiers ignores any id sent and answers with the made one; a name is required', async () => {
		const d1 = setup();
		const app = new Hono();
		app.route('/internal/admin', adminRouter as never);
		const post = (json: unknown) =>
			app.request('/internal/admin/creator-tiers', { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-actor': 'admin-1' }, body: JSON.stringify(json) }, { SEARCH_DB: d1 } as never);
		const res = await post({ id: 'typed-by-hand', name: 'Scholars Plus', ...LIMITS });
		assert.equal(res.status, 200);
		const body = (await res.json()) as { result: { tier: { id: string } } };
		assert.equal(body.result.tier.id, 'scholars-plus');
		assert.equal(await readTier(d1, 'typed-by-hand'), null);
		assert.equal((await post({ name: '  ', ...LIMITS })).status, 400);
	});
});
