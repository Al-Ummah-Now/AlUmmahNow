/**
 * The Member tier and tier requests (wiki AUN-TIER-REQUESTS; lib/tierRequests.ts,
 * lib/creatorTiers.ts, migrations/search/0039) on real SQLite with the search
 * migrations.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TIER_REQUEST_ERRORS, TIER_REQUESTS_PER_30_DAYS, SUPER_ADMIN_TIER_ASSIGNER } from '@al-ummah/shared-types';
import { assignTier, readAssignment, readTiers, resolveCreator, saveTier } from '../src/lib/creatorTiers';
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

describe('the Member tier', () => {
	it('is shipped by the migration with no uploads and no channels, and is requestable', async () => {
		const { d1 } = setup();
		const member = (await readTiers(d1)).find((t) => t.id === 'member');
		assert.deepEqual(
			member && [member.uploads, member.channels, member.requestable, member.unlimited, member.nameAr],
			[false, false, true, false, 'مجاني'],
		);
		const creator = (await readTiers(d1)).find((t) => t.id === 'creator');
		assert.deepEqual(creator && [creator.uploads, creator.channels, creator.requestable], [true, true, true], 'existing tiers keep what they allowed');
		const unlimited = (await readTiers(d1)).find((t) => t.id === 'unlimited');
		assert.deepEqual(unlimited && [unlimited.requestable, 'pages' in unlimited], [false, false]);
		assert.deepEqual((await readTiers(d1)).map((t) => t.id).slice(0, 3), ['member', 'creator', 'unlimited'], 'listed in sortOrder');
	});

	it('is what every user without an assignment holds; nothing changes for them (no uploads, no channels)', async () => {
		const { d1 } = setup();
		const resolved = await resolveCreator(d1, { userId: 'usr_new' });
		assert.deepEqual([resolved.tier?.id, resolved.via], ['member', 'none']);
		const access = await creatorAccess(d1, 'usr_new', []);
		assert.deepEqual([access.canUpload, access.canCreateChannel, access.tier?.name], [false, false, 'Free']);
	});

	it('its flags are real: an admin turning uploads and channels on for Member lets every unassigned user do both', async () => {
		const { d1 } = setup();
		await saveTier(d1, 'member', { uploads: true, channels: true, maxChannels: 1 }, 'admin-1');
		const access = await creatorAccess(d1, 'usr_new', []);
		assert.deepEqual([access.canUpload, access.canCreateChannel, access.maxChannels], [true, true, 1]);
		// No "pages" flag (owner 2026-11-16: a switch that controls nothing does not exist)
		assert.equal('canCreatePages' in access, false);
	});

	it('assigning Member (or removing a tier) leaves no row: Member has one representation', async () => {
		const { d1 } = setup();
		await assignTier(d1, 'usr_a', 'creator', 'admin');
		await assignTier(d1, 'usr_a', 'member', 'admin');
		assert.equal(await readAssignment(d1, 'usr_a'), null);
		assert.equal((await resolveCreator(d1, { userId: 'usr_a' })).tier?.id, 'member');
	});

	it('an assignment to a tier that is gone falls back to Member, never to more', async () => {
		const { db, d1 } = setup();
		db.db.prepare("INSERT INTO creator_tier_assignments (user_id, tier_id, source, assigned_by, assigned_at) VALUES ('usr_b', 'vanished', 'admin', 'x', 'now')").run();
		const resolved = await resolveCreator(d1, { userId: 'usr_b' });
		assert.deepEqual([resolved.tier?.id, resolved.tier?.uploads], ['member', false]);
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
		await assert.rejects(ask(d1, 'usr_2', 'member'), (e: { code: string }) => e.code === TIER_REQUEST_ERRORS.alreadyHeld);
		await assignTier(d1, 'usr_3', 'creator', 'admin');
		await assert.rejects(ask(d1, 'usr_3', 'creator'), (e: { code: string }) => e.code === TIER_REQUEST_ERRORS.alreadyHeld);
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
		assert.deepEqual(anon.tiers.map((t) => t.id), ['member', 'creator']);
		assert.equal(anon.currentTierId, null);
		const creator = anon.tiers.find((t) => t.id === 'creator');
		assert.deepEqual(creator && [creator.uploads, creator.channels, creator.maxChannels, creator.uploadsPerDay], [true, true, 3, 2000]);
		assert.equal('perHour' in (creator ?? {}), false, 'no internal limits beyond what the card shows');
		await assignTier(d1, 'usr_u', 'unlimited', 'admin');
		const unlimitedHolder = await upgradeOverview(d1, { userId: 'usr_u' }, 'site-key');
		assert.deepEqual(unlimitedHolder.tiers.map((t) => t.id), ['member', 'creator', 'unlimited'], 'their own tier is shown even when not requestable');
		assert.deepEqual([unlimitedHolder.currentTierId, unlimitedHolder.turnstileSiteKey], ['unlimited', 'site-key']);
		await ask(d1, 'usr_m');
		const pending = await upgradeOverview(d1, { userId: 'usr_m' }, null);
		assert.deepEqual([pending.currentTierId, pending.request?.status], ['member', 'pending']);
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

	it('approving a request for Member (a step down) removes the assignment row', async () => {
		const { d1 } = setup();
		await assignTier(d1, 'usr_9', 'creator', 'admin');
		const r = await ask(d1, 'usr_9', 'member');
		assert.equal(r.fromTierId, 'creator');
		await decideTierRequest(d1, r.id, { approve: true, actorId: 'usr_admin' });
		assert.equal(await readAssignment(d1, 'usr_9'), null);
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
