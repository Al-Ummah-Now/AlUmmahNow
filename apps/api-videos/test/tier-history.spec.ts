/**
 * Request history and tier-change notices (wiki AUN-TIER-REQUESTS "Telling the
 * user"; lib/tierRequests.ts listMyRequests, lib/tierChanges.ts) on real
 * SQLite with the search migrations.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TIER_REQUEST_HISTORY_PAGE } from '@al-ummah/shared-types';
import { assignTier, resolveCreator } from '../src/lib/creatorTiers';
import { createTierRequest, decideTierRequest, listMyRequests, receivedNotificationPayload, upgradeOverview, withdrawTierRequest } from '../src/lib/tierRequests';
import { eraseTierHistory, readTierChange, recordTierChange, tierChangeNotification } from '../src/lib/tierChanges';
import { SqliteD1 } from './search-sqlite-d1';

const ABOUT = 'I run a small masjid channel and record the Friday khutbah every week.';

function setup() {
	const db = new SqliteD1();
	const d1 = db as unknown as D1Database;
	const notices: { payload: { notificationKey: string; params: Record<string, string>; dedupeKey: string; actionUrl: string } }[] = [];
	const mails: unknown[] = [];
	const env = {
		SEARCH_DB: d1,
		queue: { send: async (m: unknown) => void notices.push(m as (typeof notices)[number]) },
		CONTACT_MAIL_QUEUE: { send: async (m: unknown) => void mails.push(m) },
	};
	return { db, d1, env, notices, mails };
}

const ask = (d1: D1Database, userId: string, tierId: string, now: Date) => createTierRequest(d1, { userId }, { tierId, name: 'Yusuf Ali', about: ABOUT }, now);

describe('"Your requests" history', () => {
	it('lists every request of the user, newest first, with status, decided date and the team note; never another user\'s', async () => {
		const { d1 } = setup();
		const first = await ask(d1, 'usr_h', 'creator', new Date('2026-11-01T10:00:00Z'));
		await decideTierRequest(d1, first.id, { approve: false, reason: 'Please add a channel link', actorId: 'admin-1' }, new Date('2026-11-02T10:00:00Z'));
		const second = await ask(d1, 'usr_h', 'creator', new Date('2026-11-03T10:00:00Z'));
		await withdrawTierRequest(d1, 'usr_h', second.id, new Date('2026-11-03T11:00:00Z'));
		const third = await ask(d1, 'usr_h', 'creator', new Date('2026-11-04T10:00:00Z'));
		await ask(d1, 'usr_other', 'creator', new Date('2026-11-05T10:00:00Z'));

		const page = await listMyRequests(d1, 'usr_h');
		assert.deepEqual(page.items.map((r) => [r.id, r.status]), [[third.id, 'pending'], [second.id, 'withdrawn'], [first.id, 'declined']]);
		assert.equal(page.items[2].declineReason, 'Please add a channel link');
		assert.equal(page.items[2].decidedAt, '2026-11-02T10:00:00.000Z');
		assert.equal(page.next, null);
		assert.ok(page.items.every((r) => r.userId === 'usr_h'));
	});

	it(`pages ${TIER_REQUEST_HISTORY_PAGE} at a time with a keyset cursor (no repeats, no gaps)`, async () => {
		const { db, d1 } = setup();
		const insert = db.db.prepare(
			"INSERT INTO tier_requests (id, user_id, tier_id, tier_name, from_tier_id, name, about, status, created_at) VALUES (?, 'usr_p', 'creator', 'Creator', 'member', 'n', 'a', 'withdrawn', ?)",
		);
		for (let i = 0; i < 23; i++) insert.run(`tr_${String(i).padStart(2, '0')}`, `2026-10-${String(1 + (i % 20)).padStart(2, '0')}T00:00:00.000Z`);
		const seen: string[] = [];
		let cursor: string | null = null;
		let pages = 0;
		do {
			const page = await listMyRequests(d1, 'usr_p', { cursor });
			assert.ok(page.items.length <= TIER_REQUEST_HISTORY_PAGE);
			seen.push(...page.items.map((r) => r.id));
			cursor = page.next;
			pages++;
		} while (cursor);
		assert.equal(pages, 3);
		assert.equal(new Set(seen).size, 23);
		const dates = seen.map((id) => db.db.prepare('SELECT created_at FROM tier_requests WHERE id = ?').get(id) as { created_at: string });
		assert.deepEqual(dates.map((d) => d.created_at), [...dates.map((d) => d.created_at)].sort().reverse(), 'newest first');
	});

	it('the "we received your request" notice names the tier in both languages and links to /upgrade, once per request', async () => {
		const { d1 } = setup();
		const request = await ask(d1, 'usr_r', 'creator', new Date('2026-11-01T10:00:00Z'));
		const payload = receivedNotificationPayload(request, { name: 'Creator', nameAr: 'منشئ' } as never);
		assert.equal(payload.notificationKey, 'tierRequestReceived');
		assert.deepEqual(payload.params, { tier: 'Creator', tier_en: 'Creator', tier_ar: 'منشئ' });
		assert.equal(payload.actionUrl, '/upgrade');
		assert.equal(payload.dedupeKey, `tier-request-received:${request.id}`);
	});
});

describe('tier changes', () => {
	it('stores the change and tells the user: an in-app notice (old → new, both languages) and the email job', async () => {
		const { d1, env, notices, mails } = setup();
		const id = await recordTierChange(env, { userId: 'usr_c', from: 'member', to: 'creator', reason: 'admin' }, new Date('2026-11-05T10:00:00Z'));
		assert.ok(id);
		const change = await readTierChange(d1, id);
		assert.deepEqual([change?.fromTierName, change?.toTierName, change?.reason, change?.emailStatus], ['Free', 'Creator', 'admin', 'queued']);
		assert.equal(change?.toTier?.id, 'creator', 'what the new tier allows, for the email');
		assert.equal(notices.length, 1);
		assert.equal(notices[0].payload.notificationKey, 'tierChanged');
		assert.equal(notices[0].payload.params.from_en, 'Free');
		assert.equal(notices[0].payload.params.to_en, 'Creator');
		assert.equal(notices[0].payload.params.to_ar, 'صانع محتوى');
		assert.equal(notices[0].payload.actionUrl, '/upgrade');
		assert.equal(notices[0].payload.dedupeKey, `tier-change:${id}`);
		assert.deepEqual(mails, [{ v: 1, kind: 'tier_changed', changeId: id }]);
	});

	it('quiet changes (an approved request, told by its decision delivery) are stored but send nothing', async () => {
		const { d1, env, notices, mails } = setup();
		const id = await recordTierChange(env, { userId: 'usr_q', from: 'member', to: 'creator', reason: 'request', quiet: true });
		assert.ok(id && (await readTierChange(d1, id)));
		assert.deepEqual([notices.length, mails.length], [0, 0]);
	});

	it('no change when the tier stays the same; a downgrade is a change like any other', async () => {
		const { env, notices } = setup();
		assert.equal(await recordTierChange(env, { userId: 'usr_s', from: 'creator', to: 'creator', reason: 'admin' }), null);
		assert.ok(await recordTierChange(env, { userId: 'usr_s', from: 'creator', to: 'member', reason: 'subscription' }));
		assert.equal(notices.length, 1);
	});

	it('a failed email queue marks the change failed and never throws (the tier is already changed)', async () => {
		const { d1, env } = setup();
		env.CONTACT_MAIL_QUEUE.send = async () => {
			throw new Error('queue down');
		};
		const id = await recordTierChange(env, { userId: 'usr_f', from: 'member', to: 'creator', reason: 'admin' });
		assert.equal((await readTierChange(d1, id as string))?.emailStatus, 'failed');
	});

	it('the notice payload keeps a deleted tier\'s id as its name', () => {
		const payload = tierChangeNotification({ id: 'tch_1', userId: 'u', reason: 'admin', fromTierName: 'gone', fromTierNameAr: 'gone', toTierName: 'Creator', toTierNameAr: 'منشئ' });
		assert.equal(payload.params?.from, 'gone');
	});

	it('Settings › Tier shows since when: the stored assignment time', async () => {
		const { d1 } = setup();
		await assignTier(d1, 'usr_since', 'creator', 'admin-1', 'admin', '2026-11-06T09:00:00.000Z');
		assert.equal((await resolveCreator(d1, { userId: 'usr_since' })).since, '2026-11-06T09:00:00.000Z');
		const overview = await upgradeOverview(d1, { userId: 'usr_since' }, null);
		assert.equal(overview.currentTierSince, '2026-11-06T09:00:00.000Z');
		assert.equal((await upgradeOverview(d1, null, null)).currentTierSince, null);
	});

	it('GDPR erase removes the user\'s requests and tier changes', async () => {
		const { db, d1, env } = setup();
		await ask(d1, 'usr_e', 'creator', new Date('2026-11-01T10:00:00Z'));
		await recordTierChange(env, { userId: 'usr_e', from: 'member', to: 'creator', reason: 'admin' });
		await eraseTierHistory(d1, 'usr_e');
		const count = (table: string) => (db.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = 'usr_e'`).get() as { n: number }).n;
		assert.deepEqual([count('tier_requests'), count('creator_tier_changes')], [0, 0]);
	});
});

describe('admin tier changes reach the user', () => {
	async function call(path: string, method: string, json: unknown) {
		const { Hono } = await import('hono');
		const { default: adminRouter } = await import('../src/routers/admin.router');
		const s = setup();
		const app = new Hono();
		app.route('/internal/admin', adminRouter as never);
		const run = (p: string, m: string, j: unknown) =>
			app.request(`/internal/admin${p}`, { method: m, headers: { 'content-type': 'application/json', 'x-admin-actor': 'admin-1' }, body: JSON.stringify(j) }, s.env as never);
		return { s, run, first: await run(path, method, json) };
	}

	it('one user (PUT users/:id/creator-tier): the change takes effect at once and the user gets the notice and the email', async () => {
		const { s, first } = await call('/users/usr_a/creator-tier', 'PUT', { tierId: 'creator' });
		assert.equal(first.status, 200);
		assert.equal((await resolveCreator(s.d1, { userId: 'usr_a' })).tier?.id, 'creator', 'no sign-out needed: the next call already sees it');
		assert.deepEqual(s.notices.map((n) => [n.payload.notificationKey, n.payload.params.to_en]), [['tierChanged', 'Creator']]);
		assert.equal(s.mails.length, 1);
	});

	it('an invite\'s tier (quiet) is stored without a notice; a selection (bulk) tells each changed user', async () => {
		const { s, run, first } = await call('/users/usr_i/creator-tier', 'PUT', { tierId: 'creator', quiet: true });
		assert.equal(first.status, 200);
		assert.deepEqual([s.notices.length, s.mails.length], [0, 0]);
		const bulk = await run('/creators/tier', 'POST', { userIds: ['usr_b', 'usr_c'], tierId: 'creator' });
		assert.equal(bulk.status, 200);
		assert.deepEqual(s.notices.map((n) => n.payload.notificationKey), ['tierChanged', 'tierChanged']);
		assert.equal(s.mails.length, 2);
	});
});
