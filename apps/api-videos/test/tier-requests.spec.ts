/**
 * The Member tier and tier requests (wiki AUN-TIER-REQUESTS; lib/tierRequests.ts,
 * lib/creatorTiers.ts, migrations/search/0039) on real SQLite with the search
 * migrations.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SIGNUP_TIER_ASSIGNER, TIER_REQUEST_ERRORS, TIER_REQUESTS_PER_30_DAYS, SUPER_ADMIN_TIER_ASSIGNER, creatorTierOrigin } from '@al-ummah/shared-types';
import { assignTier, countTierUsers, deleteTier, purgeTiers, readAssignment, readDefaultTierId, readTiers, reorderTiers, resolveCreator, saveTier, setDefaultTier, writeSignupTier } from '../src/lib/creatorTiers';
import { listCreators } from '../src/lib/admin/creators';
import { creatorAccess } from '../src/endpoints/creator/creatorAccess';
import {
	createTierRequest,
	decideTierRequest,
	decisionNotificationPayload,
	latestRequest,
	listTierRequests,
	readTierRequestForAdmin,
	recordDelivery,
	upgradeOverview,
	validateRequestInput,
	withdrawTierRequest,
} from '../src/lib/tierRequests';
import { SqliteD1 } from './search-sqlite-d1';

const ABOUT = 'I run a small masjid channel and record the Friday khutbah every week.';
const profiles = (byId: Record<string, Record<string, unknown>> = {}) =>
	({ get: async (key: string) => (byId[key] ? { json: async () => byId[key], text: async () => JSON.stringify(byId[key]) } : null) }) as unknown as R2Bucket;

function setup() {
	const db = new SqliteD1();
	return { db, d1: db as unknown as D1Database };
}

const ask = (d1: D1Database, userId: string, tierId = 'creator', now?: Date) => createTierRequest(d1, { userId }, { tierId, name: 'Yusuf Ali', about: ABOUT }, now);

describe('the Free tier (the one minimum tier; id `member`)', () => {
	it('is Member renamed Free («مجاني») by the migration: no uploads, no channels, not requestable', async () => {
		const { d1 } = setup();
		const member = (await readTiers(d1)).find((t) => t.id === 'member');
		assert.deepEqual(
			member && [member.name, member.uploads, member.channels, member.requestable, member.unlimited, member.nameAr],
			['Free', false, false, false, false, 'مجاني'],
		);
		const creator = (await readTiers(d1)).find((t) => t.id === 'creator');
		assert.deepEqual(creator && [creator.uploads, creator.channels, creator.requestable], [true, true, true], 'existing tiers keep what they allowed');
		const unlimited = (await readTiers(d1)).find((t) => t.id === 'unlimited');
		assert.deepEqual(unlimited && [unlimited.requestable, 'pages' in unlimited], [false, false]);
		assert.deepEqual((await readTiers(d1)).map((t) => t.id), ['member', 'creator', 'unlimited'], 'one minimum tier; listed by rank');
	});

	it('as an assigned tier allows no uploads and no channels', async () => {
		const { d1 } = setup();
		await assignTier(d1, 'usr_m', 'member', 'admin');
		const access = await creatorAccess(d1, 'usr_m', []);
		assert.deepEqual([access.canUpload, access.canCreateChannel, access.tier?.name, access.via], [false, false, 'Free', 'tier']);
	});

	it("its flags are real: an admin turning uploads and channels on for the default (Free) lets every unassigned user do both", async () => {
		const { d1 } = setup();
		await saveTier(d1, 'member', { uploads: true, channels: true, maxChannels: 1 }, 'admin-1');
		const access = await creatorAccess(d1, 'usr_new', []);
		assert.deepEqual([access.canUpload, access.canCreateChannel, access.maxChannels], [true, true, 1]);
		// No "pages" flag (owner 2026-11-16: a switch that controls nothing does not exist)
		assert.equal('canCreatePages' in access, false);
	});

	it('every account keeps a tier: assigning Member stores it, and there is no "remove"', async () => {
		const { d1 } = setup();
		await assignTier(d1, 'usr_a', 'creator', 'admin');
		await assignTier(d1, 'usr_a', 'member', 'admin');
		assert.equal((await readAssignment(d1, 'usr_a'))?.tierId, 'member');
		assert.equal((await resolveCreator(d1, { userId: 'usr_a' })).via, 'tier');
		await assert.rejects(assignTier(d1, 'usr_a', null, 'admin'), (e: { code: string; status: number }) => e.code === 'tier_required' && e.status === 400);
		assert.equal((await readAssignment(d1, 'usr_a'))?.tierId, 'member');
	});

	it('an assignment to a tier that is gone falls back to Free, never to more', async () => {
		const { db, d1 } = setup();
		db.db.prepare("INSERT INTO creator_tier_assignments (user_id, tier_id, source, assigned_by, assigned_at) VALUES ('usr_b', 'vanished', 'admin', 'x', 'now')").run();
		const resolved = await resolveCreator(d1, { userId: 'usr_b' });
		assert.deepEqual([resolved.tier?.id, resolved.tier?.uploads], ['member', false]);
	});
});

describe('the default tier (what new sign-ups get)', () => {
	it('is Free after the migration: shipped with exactly what no tier allowed (nothing changes on deploy), never deletable, fully editable', async () => {
		const { d1 } = setup();
		assert.equal(await readDefaultTierId(d1), 'member');
		const free = (await readTiers(d1)).find((t) => t.id === 'member');
		assert.deepEqual(
			free && [free.name, free.nameAr, free.uploads, free.channels, free.pages, free.captionMinutesMonth, free.unlimited, free.requestable],
			['Free', 'مجاني', false, false, false, 0, false, false],
		);
		await assert.rejects(deleteTier(d1, 'member', { actorId: 'admin-1' }), (e: { code: string }) => e.code === 'tier_shipped');
		const edited = await saveTier(d1, 'member', { unlimited: true }, 'admin-1');
		assert.equal(edited.tier.unlimited, true, 'even unlimited (Member never is)');
	});

	it('a new account gets the current default written at sign-up; a later default never changes it', async () => {
		const { d1 } = setup();
		assert.equal(await writeSignupTier(d1, 'usr_early', '2026-11-15T10:00:00.000Z'), 'member');
		const early = await readAssignment(d1, 'usr_early');
		assert.deepEqual([early?.tierId, early?.assignedBy, early?.source], ['member', SIGNUP_TIER_ASSIGNER, 'admin']);
		assert.equal(creatorTierOrigin(early), 'signup');
		const set = await setDefaultTier(d1, 'creator', 'admin-1');
		assert.deepEqual(set, { previous: 'member', defaultTierId: 'creator' }, 'the previous default, for the audit and Undo');
		assert.equal((await creatorAccess(d1, 'usr_early', [])).tier?.id, 'member', 'existing users keep their stored tier');
		assert.equal(await writeSignupTier(d1, 'usr_late'), 'creator');
		const late = await creatorAccess(d1, 'usr_late', []);
		assert.deepEqual([late.tier?.id, late.via, late.canUpload, late.canCreateChannel], ['creator', 'tier', true, true]);
	});

	it('sign-up never overwrites a tier the account already has (an invite\'s, an admin\'s)', async () => {
		const { d1 } = setup();
		await assignTier(d1, 'usr_inv', 'creator', 'admin-1');
		assert.equal(await writeSignupTier(d1, 'usr_inv'), null);
		assert.equal((await readAssignment(d1, 'usr_inv'))?.tierId, 'creator');
	});

	it('an account without a row (before the backfill) is treated as Free, never as the current default', async () => {
		const { d1 } = setup();
		await setDefaultTier(d1, 'creator', 'admin-1');
		const access = await creatorAccess(d1, 'usr_old', []);
		assert.deepEqual([access.tier?.id, access.via, access.canUpload], ['member', 'none', false]);
	});

	it("None is gone: 'none' cannot be the default, and a stored 'none' reads as Free", async () => {
		const { db, d1 } = setup();
		await assert.rejects(setDefaultTier(d1, 'none', 'admin-1'), (e: { code: string; status: number }) => e.code === 'invalid_default' && e.status === 400);
		db.db.prepare("UPDATE creator_tier_settings SET value = 'none' WHERE key = 'default_tier_id'").run();
		assert.equal(await readDefaultTierId(d1), 'member');
		assert.equal(await writeSignupTier(d1, 'usr_new'), 'member');
	});

	it('a deleted or unknown tier cannot be the default, and the default tier cannot be deleted', async () => {
		const { d1 } = setup();
		await saveTier(d1, 'pro', { name: 'Pro', perHour: 10, perDay: 10, maxConcurrent: 1 }, 'admin', { create: true });
		await setDefaultTier(d1, 'pro', 'admin-1');
		await assert.rejects(deleteTier(d1, 'pro', { actorId: 'admin-1' }), (e: { code: string; status: number }) => e.code === 'tier_is_default' && e.status === 409);
		await setDefaultTier(d1, 'member', 'admin-1');
		await deleteTier(d1, 'pro', { actorId: 'admin-1' });
		await assert.rejects(setDefaultTier(d1, 'pro', 'admin-1'), (e: { code: string; status: number }) => e.code === 'default_tier_deleted' && e.status === 409);
		await assert.rejects(setDefaultTier(d1, 'nope', 'admin-1'), (e: { code: string; status: number }) => e.code === 'tier_not_found' && e.status === 404);
		assert.equal(await readDefaultTierId(d1), 'member', 'a refused change changes nothing');
	});

	it('a tier with users cannot be deleted: 409 with the count; purge checks again (users, default, pending invites)', async () => {
		const { db, d1 } = setup();
		await saveTier(d1, 'pro', { name: 'Pro', perHour: 10, perDay: 10, maxConcurrent: 1 }, 'admin', { create: true });
		await assignTier(d1, 'usr_1', 'pro', 'admin-1');
		await assignTier(d1, 'usr_2', 'pro', 'admin-1');
		await assert.rejects(deleteTier(d1, 'pro', { actorId: 'admin-1' }), (e: { code: string; status: number; details?: { users?: number } }) => e.code === 'tier_in_use' && e.status === 409 && e.details?.users === 2);
		assert.equal(await countTierUsers(d1, 'pro'), 2);
		await assignTier(d1, 'usr_1', 'member', 'admin-1');
		await assignTier(d1, 'usr_2', 'member', 'admin-1');
		await deleteTier(d1, 'pro', { actorId: 'admin-1' });
		// Someone is put on it again behind the admin's back (raw row): the purge refuses
		db.db.prepare("INSERT INTO creator_tier_assignments (user_id, tier_id, source, assigned_by, assigned_at) VALUES ('usr_3', 'pro', 'admin', 'x', 'now')").run();
		const cutoff = new Date(Date.now() + 86_400_000).toISOString();
		assert.deepEqual((await purgeTiers(d1, cutoff)).failed, [{ id: 'pro', error: 'held by users or restored' }]);
		db.db.prepare("DELETE FROM creator_tier_assignments WHERE user_id = 'usr_3'").run();
		assert.deepEqual((await purgeTiers(d1, cutoff, 100, ['pro'])).failed, [{ id: 'pro', error: 'pending invites carry it' }]);
		assert.deepEqual((await purgeTiers(d1, cutoff)).purged, ['pro']);
	});

	it('the Creators list reports the default; rows not yet backfilled count as Free', async () => {
		const { db, d1 } = setup();
		db.db.prepare("INSERT INTO content_ownership (kind, id, owner_id, is_deleted) VALUES ('profile', 'usr_c', 'usr_c', 0), ('channel', 'ch_c', 'usr_c', 0)").run();
		const env = { SEARCH_DB: d1, profiles: profiles() };
		await setDefaultTier(d1, 'creator', 'admin-1');
		const list = await listCreators(env, {}, Date.parse('2026-11-15T12:00:00Z'));
		assert.deepEqual([list.defaultTier?.id, list.needsTier, list.items.find((r) => r.userId === 'usr_c')?.needsTier], ['creator', 1, true], 'a new default does not cover old accounts');
	});
});

describe('tier requests', () => {
	it('validates and trims name and about (lengths in characters, Arabic included)', () => {
		assert.deepEqual(validateRequestInput({ tierId: 'creator', name: '  Yusuf   Ali ', about: `  ${ABOUT}  ` }), { tierId: 'creator', name: 'Yusuf Ali', about: ABOUT });
		assert.throws(() => validateRequestInput({ tierId: 'creator', name: 'Y', about: ABOUT }), /name/);
		assert.throws(() => validateRequestInput({ tierId: 'creator', name: 'Yusuf', about: 'too short' }), /about/);
		assert.throws(() => validateRequestInput({ tierId: 'creator', name: 'Yusuf', about: 'x'.repeat(1001) }), /about/);
		assert.throws(() => validateRequestInput({ tierId: 'BAD ID', name: 'Yusuf', about: ABOUT }), /tierId/);
		const arabic = 'أدير قناة صغيرة لمسجد الحي وأسجّل خطبة الجمعة كل أسبوع.';
		assert.equal(validateRequestInput({ tierId: 'creator', name: 'يوسف', about: arabic }).about, arabic);
		assert.equal(validateRequestInput({ tierId: 'creator', name: 'Yusuf', about: `${ABOUT}\n\n\n\nMore` }).about, `${ABOUT}\n\nMore`, 'at most one blank line');
	});

	it('files one request; a second while it is pending is refused', async () => {
		const { d1 } = setup();
		const request = await ask(d1, 'usr_1');
		assert.deepEqual([request.status, request.tierId, request.fromTierId, request.tierName], ['pending', 'creator', 'member', 'Creator']);
		await assert.rejects(ask(d1, 'usr_1'), (e: { code: string; status: number }) => e.code === TIER_REQUEST_ERRORS.alreadyPending && e.status === 409);
		assert.equal((await latestRequest(d1, 'usr_1'))?.id, request.id);
	});

	it('two parallel submits: the one-open-request index lets only one in', async () => {
		const { db, d1 } = setup();
		const results = await Promise.allSettled([ask(d1, 'usr_p'), ask(d1, 'usr_p'), ask(d1, 'usr_p')]);
		assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
		assert.equal((db.db.prepare("SELECT COUNT(*) AS n FROM tier_requests WHERE user_id = 'usr_p'").get() as { n: number }).n, 1);
	});

	it('refuses a tier that is not requestable or does not exist, and the tier the user already holds', async () => {
		const { d1 } = setup();
		await assert.rejects(ask(d1, 'usr_2', 'unlimited'), (e: { code: string }) => e.code === TIER_REQUEST_ERRORS.tierNotRequestable);
		await assert.rejects(ask(d1, 'usr_2', 'nope'), (e: { code: string }) => e.code === TIER_REQUEST_ERRORS.tierNotRequestable);
		await assert.rejects(ask(d1, 'usr_2', 'member'), (e: { code: string }) => e.code === TIER_REQUEST_ERRORS.tierNotRequestable, 'nobody requests the bottom tier (Free)');
		await assignTier(d1, 'usr_3', 'creator', 'admin');
		await assert.rejects(ask(d1, 'usr_3', 'creator'), (e: { code: string }) => e.code === TIER_REQUEST_ERRORS.alreadyHeld);
		// Only upgrades: a requestable tier ranked below the current one is refused
		await saveTier(d1, 'helper', { name: 'Helper', perHour: 5, perDay: 5, maxConcurrent: 1, requestable: true, sortOrder: 5 }, 'admin', { create: true });
		await assert.rejects(ask(d1, 'usr_3', 'helper'), (e: { code: string }) => e.code === TIER_REQUEST_ERRORS.alreadyHeld);
		assert.equal((await ask(d1, 'usr_4', 'helper')).tierId, 'helper', 'from Free, Helper is an upgrade');
	});

	it(`allows at most ${TIER_REQUESTS_PER_30_DAYS} requests in 30 days`, async () => {
		const { d1 } = setup();
		const start = Date.UTC(2026, 10, 1);
		for (let i = 0; i < TIER_REQUESTS_PER_30_DAYS; i++) {
			const r = await ask(d1, 'usr_4', 'creator', new Date(start + i * 86_400_000));
			await withdrawTierRequest(d1, 'usr_4', r.id, new Date(start + i * 86_400_000 + 1000));
		}
		await assert.rejects(ask(d1, 'usr_4', 'creator', new Date(start + 6 * 86_400_000)), (e: { code: string; status: number }) => e.code === TIER_REQUEST_ERRORS.tooMany && e.status === 429);
		const later = await ask(d1, 'usr_4', 'creator', new Date(start + 31 * 86_400_000));
		assert.equal(later.status, 'pending', 'a month later it works again');
	});

	it('the user withdraws a pending request; someone else cannot; a decided one cannot be withdrawn', async () => {
		const { d1 } = setup();
		const r = await ask(d1, 'usr_5');
		await assert.rejects(withdrawTierRequest(d1, 'usr_other', r.id), /not_found/);
		assert.equal((await withdrawTierRequest(d1, 'usr_5', r.id)).status, 'withdrawn');
		await assert.rejects(withdrawTierRequest(d1, 'usr_5', r.id), (e: { code: string }) => e.code === TIER_REQUEST_ERRORS.notPending);
	});

	it('/upgrade lists requestable tiers plus the viewer\'s own, with their latest request; signed out, no current tier', async () => {
		const { d1 } = setup();
		const anon = await upgradeOverview(d1, null, null);
		assert.deepEqual(anon.tiers.map((t) => t.id), ['creator'], 'signed out: the requestable tiers (Free is not one)');
		assert.equal(anon.currentTierId, null);
		const creator = anon.tiers.find((t) => t.id === 'creator');
		assert.deepEqual(creator && [creator.uploads, creator.channels, creator.maxChannels, creator.uploadsPerDay], [true, true, 3, 2000]);
		assert.equal('perHour' in (creator ?? {}), false, 'no internal limits beyond what the card shows');
		await assignTier(d1, 'usr_u', 'unlimited', 'admin');
		const unlimitedHolder = await upgradeOverview(d1, { userId: 'usr_u' }, 'site-key');
		assert.deepEqual(unlimitedHolder.tiers.map((t) => t.id), ['unlimited'], 'their own tier is shown even when not requestable; nothing ranks above Unlimited');
		assert.deepEqual([unlimitedHolder.currentTierId, unlimitedHolder.turnstileSiteKey], ['unlimited', 'site-key']);
		await ask(d1, 'usr_m');
		const pending = await upgradeOverview(d1, { userId: 'usr_m' }, null);
		assert.deepEqual([pending.currentTierId, pending.request?.status], ['member', 'pending']);
		assert.deepEqual(pending.tiers.map((t) => t.id), ['member', 'creator'], 'their own tier (Free) and the upgrade above it');
	});

	it('approving assigns the tier at once (the user can upload) in the same batch that marks it approved', async () => {
		const { d1 } = setup();
		const r = await ask(d1, 'usr_6');
		assert.equal((await creatorAccess(d1, 'usr_6', [])).canUpload, false);
		const { request } = await decideTierRequest(d1, r.id, { approve: true, actorId: 'usr_admin' }, new Date('2026-11-14T10:00:00Z'));
		assert.deepEqual([request.status, request.decidedBy, request.decidedAt], ['approved', 'usr_admin', '2026-11-14T10:00:00.000Z']);
		const assignment = await readAssignment(d1, 'usr_6');
		assert.deepEqual([assignment?.tierId, assignment?.assignedBy, assignment?.source], ['creator', 'usr_admin', 'admin']);
		const access = await creatorAccess(d1, 'usr_6', []);
		assert.deepEqual([access.canUpload, access.canCreateChannel, access.tier?.id], [true, true, 'creator']);
		assert.equal((await latestRequest(d1, 'usr_6'))?.status, 'approved');
		// The user sees the decision, never which staff member made it
		const own = (await upgradeOverview(d1, { userId: 'usr_6' }, null)).request;
		assert.deepEqual([own?.status, own?.decidedBy], ['approved', null]);
	});

	it('a request is decided once: a second decision (or a race) is refused and changes nothing', async () => {
		const { d1 } = setup();
		const r = await ask(d1, 'usr_7');
		const both = await Promise.allSettled([
			decideTierRequest(d1, r.id, { approve: true, actorId: 'admin-a' }),
			decideTierRequest(d1, r.id, { approve: false, reason: 'no', actorId: 'admin-b' }),
		]);
		assert.equal(both.filter((x) => x.status === 'fulfilled').length, 1);
		const final = await latestRequest(d1, 'usr_7');
		const assignment = await readAssignment(d1, 'usr_7');
		// The tier is assigned exactly when the request ended approved
		assert.equal(!!assignment, final?.status === 'approved');
		await assert.rejects(decideTierRequest(d1, r.id, { approve: true, actorId: 'admin-c' }), (e: { code: string }) => e.code === TIER_REQUEST_ERRORS.notPending);
	});

	it('declining keeps the tier, stores the optional reason (trimmed, capped) and lets the user ask again', async () => {
		const { d1 } = setup();
		const r = await ask(d1, 'usr_8');
		const { request } = await decideTierRequest(d1, r.id, { approve: false, reason: `  Please add a link to your channel.  ${'x'.repeat(600)}`, actorId: 'usr_admin' });
		assert.equal(request.status, 'declined');
		assert.equal(request.declineReason?.length, 500);
		assert.ok(request.declineReason?.startsWith('Please add a link'));
		assert.equal(await readAssignment(d1, 'usr_8'), null);
		assert.equal((await ask(d1, 'usr_8')).status, 'pending', 'a new request after a decline');
		const empty = await decideTierRequest(d1, (await latestRequest(d1, 'usr_8'))!.id, { approve: false, reason: '   ', actorId: 'usr_admin' });
		assert.equal(empty.request.declineReason, null);
	});

	it('ships Free lowest, Creator between, Unlimited on top; a reorder rewrites every rank in one go and returns the old order', async () => {
		const { d1 } = setup();
		assert.deepEqual((await readTiers(d1)).map((t) => t.id), ['member', 'creator', 'unlimited']);
		await saveTier(d1, 'pro', { name: 'Pro', perHour: 5, perDay: 5, maxConcurrent: 1, requestable: true }, 'admin', { create: true });
		assert.deepEqual((await readTiers(d1)).map((t) => t.id), ['member', 'creator', 'pro', 'unlimited'], 'a new tier sits between Creator and Unlimited');
		const moved = await reorderTiers(d1, ['member', 'pro', 'creator', 'unlimited'], 'admin-1');
		assert.deepEqual(moved, { previous: ['member', 'creator', 'pro', 'unlimited'], order: ['member', 'pro', 'creator', 'unlimited'] });
		assert.deepEqual((await readTiers(d1)).map((t) => [t.id, t.sortOrder]), [['member', 0], ['pro', 10], ['creator', 20], ['unlimited', 30]]);
		// Undo: the previous order back
		await reorderTiers(d1, moved.previous, 'admin-1');
		assert.deepEqual((await readTiers(d1)).map((t) => t.id), ['member', 'creator', 'pro', 'unlimited']);
		await assert.rejects(reorderTiers(d1, ['member', 'creator'], 'admin-1'), (e: { code: string }) => e.code === 'invalid_order', 'every tier, exactly once');
		await assert.rejects(reorderTiers(d1, ['member', 'member', 'pro', 'unlimited'], 'admin-1'), (e: { code: string }) => e.code === 'invalid_order');
		// The rank decides what an upgrade is: Pro above Creator now offers Pro to a Creator
		await reorderTiers(d1, ['member', 'creator', 'pro', 'unlimited'], 'admin-1');
		await assignTier(d1, 'usr_c', 'creator', 'admin');
		assert.deepEqual((await upgradeOverview(d1, { userId: 'usr_c' }, null)).tiers.map((t) => t.id), ['creator', 'pro']);
		await reorderTiers(d1, ['member', 'pro', 'creator', 'unlimited'], 'admin-1');
		assert.deepEqual((await upgradeOverview(d1, { userId: 'usr_c' }, null)).tiers.map((t) => t.id), ['creator'], 'Pro is now below Creator');
	});

	it('/upgrade shows the current tier and only the tiers ranked above it, in rank order', async () => {
		const { d1 } = setup();
		await saveTier(d1, 'helper', { name: 'Helper', perHour: 5, perDay: 5, maxConcurrent: 1, requestable: true, sortOrder: 5 }, 'admin', { create: true });
		await saveTier(d1, 'pro', { name: 'Pro', perHour: 5, perDay: 5, maxConcurrent: 1, requestable: true, sortOrder: 50 }, 'admin', { create: true });
		assert.deepEqual((await upgradeOverview(d1, { userId: 'usr_free' }, null)).tiers.map((t) => t.id), ['member', 'helper', 'creator', 'pro']);
		await assignTier(d1, 'usr_c', 'creator', 'admin');
		assert.deepEqual((await upgradeOverview(d1, { userId: 'usr_c' }, null)).tiers.map((t) => t.id), ['creator', 'pro'], 'Helper is below Creator: not an upgrade');
	});

	it('approving after the tier was deleted is refused; the request stays pending', async () => {
		const { db, d1 } = setup();
		await saveTier(d1, 'pro', { name: 'Pro', perHour: 10, perDay: 10, maxConcurrent: 1, requestable: true }, 'admin', { create: true });
		const r = await ask(d1, 'usr_10', 'pro');
		db.db.prepare("UPDATE creator_tiers SET deleted_at = 'x' WHERE id = 'pro'").run();
		await assert.rejects(decideTierRequest(d1, r.id, { approve: true, actorId: 'admin' }), /tier_not_found|no longer exists/);
		assert.equal((await latestRequest(d1, 'usr_10'))?.status, 'pending');
	});

	it('the decision notice is one per decision (dedupe key), bilingual, linking to /upgrade', async () => {
		const { d1 } = setup();
		const r = await ask(d1, 'usr_11');
		const { request } = await decideTierRequest(d1, r.id, { approve: true, actorId: 'admin' });
		const tier = (await readTiers(d1)).find((t) => t.id === 'creator') ?? null;
		const a = decisionNotificationPayload(request, tier);
		const b = decisionNotificationPayload(request, tier);
		assert.equal(a.notificationKey, 'tierRequestApproved');
		assert.equal(a.dedupeKey, b.dedupeKey, 'a retry stores nothing new');
		assert.deepEqual(a.params, { tier: 'Creator', tier_en: 'Creator', tier_ar: 'صانع محتوى' });
		assert.deepEqual([a.recipientUserId, a.actionUrl], ['usr_11', '/upgrade']);
		assert.equal(decisionNotificationPayload({ ...request, status: 'declined' }, tier).notificationKey, 'tierRequestDeclined');
	});

	it('the admin queue: pending oldest first with keyset paging, who asked and what they hold now; decided newest first', async () => {
		const { d1 } = setup();
		const t0 = Date.UTC(2026, 10, 14, 8);
		for (let i = 0; i < 5; i++) await ask(d1, `usr_q${i}`, 'creator', new Date(t0 + i * 60_000));
		await assignTier(d1, 'usr_q4', 'unlimited', SUPER_ADMIN_TIER_ASSIGNER);
		const env = { SEARCH_DB: d1, profiles: profiles({ usr_q0: { displayName: 'Zaid', userName: 'zaid', avatarUrl: 'https://img/z.png' } }) };
		const first = await listTierRequests(env, { pageSize: 2 });
		assert.deepEqual(first.items.map((r) => r.userId), ['usr_q0', 'usr_q1']);
		assert.equal(first.pending, 5);
		assert.deepEqual([first.items[0].displayName, first.items[0].userName, first.items[0].currentTierName], ['Zaid', 'zaid', 'Free']);
		const second = await listTierRequests(env, { pageSize: 2, cursor: first.next ?? undefined });
		assert.deepEqual(second.items.map((r) => r.userId), ['usr_q2', 'usr_q3']);
		const third = await listTierRequests(env, { pageSize: 2, cursor: second.next ?? undefined });
		assert.deepEqual([third.items.map((r) => r.userId), third.next], [['usr_q4'], null]);
		assert.equal(third.items[0].currentTierName, 'Unlimited', 'a super admin shows their automatic Unlimited');
		assert.deepEqual([first.items[0].currentTierNameAr, first.items[0].tierNameAr], ['مجاني', 'صانع محتوى'], 'Arabic names for the Arabic admin');

		await decideTierRequest(d1, first.items[0].id, { approve: false, actorId: 'admin' });
		await decideTierRequest(d1, first.items[1].id, { approve: true, actorId: 'admin' });
		const declined = await listTierRequests(env, { filter: 'declined' });
		assert.deepEqual(declined.items.map((r) => r.userId), ['usr_q0']);
		const all = await listTierRequests(env, { filter: 'all' });
		assert.deepEqual(all.items.map((r) => r.userId), ['usr_q4', 'usr_q3', 'usr_q2', 'usr_q1', 'usr_q0'], 'all: newest first');
		assert.equal(all.pending, 3);
		const approved = await readTierRequestForAdmin(env, first.items[1].id);
		assert.deepEqual([approved.status, approved.currentTierId], ['approved', 'creator']);
	});

	it('records delivery: the notice once (first time kept), the email outcome each time', async () => {
		const { db, d1 } = setup();
		const r = await ask(d1, 'usr_12');
		await recordDelivery(d1, r.id, { notified: true }, new Date('2026-11-14T10:00:00Z'));
		await recordDelivery(d1, r.id, { notified: true, emailStatus: 'failed', emailError: 'timeout' }, new Date('2026-11-14T11:00:00Z'));
		await recordDelivery(d1, r.id, { emailStatus: 'sent' });
		const row = db.db.prepare('SELECT notified_at, email_status, email_error FROM tier_requests WHERE id = ?').get(r.id) as Record<string, string | null>;
		assert.deepEqual({ ...row }, { notified_at: '2026-11-14T10:00:00.000Z', email_status: 'sent', email_error: null });
	});
});

describe('localized tier text (owner rule 2026-11-16)', () => {
	it('the admin create and edit need the name and the description in English and in Arabic (400 tier_text_missing)', async () => {
		const { Hono } = await import('hono');
		const { default: adminRouter } = await import('../src/routers/admin.router');
		const { d1 } = setup();
		const app = new Hono();
		app.route('/internal/admin', adminRouter as never);
		const call = (path: string, method: string, json: unknown) =>
			app.request(`/internal/admin${path}`, { method, headers: { 'content-type': 'application/json', 'x-admin-actor': 'admin-1' }, body: JSON.stringify(json) }, { SEARCH_DB: d1 } as never);
		const limits = { perHour: 5, perDay: 10, maxConcurrent: 1, maxChannels: 1 };
		const refused = await call('/creator-tiers', 'POST', { id: 'gold', name: 'Gold', ...limits });
		assert.equal(refused.status, 400);
		assert.equal(((await refused.json()) as { code?: string }).code, 'tier_text_missing');
		const made = await call('/creator-tiers', 'POST', { id: 'gold', name: 'Gold', nameAr: 'ذهبي', description: 'For weekly teachers', descriptionAr: 'لمن يعلّم كل أسبوع', ...limits });
		assert.equal(made.status, 200);
		assert.equal((await call('/creator-tiers/gold', 'PUT', { descriptionAr: '' })).status, 400, 'clearing one is refused too');
		const arabicOnly = await call('/creator-tiers', 'POST', { id: 'silver', name: 'فضي', nameAr: 'فضي', description: 'Silver', descriptionAr: 'فضي', ...limits });
		assert.equal(((await arabicOnly.json()) as { code?: string }).code, 'tier_name_not_english');
		// The shipped tiers come with both languages
		const shipped = await readTiers(d1);
		assert.ok(shipped.every((t) => t.nameAr && t.description && t.descriptionAr));
	});
});
