/**
 * Epic 27 PR 2: GET /api/entitlements and D1/KV resolution against the real migrations.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { EntitlementsGet } from '../src/endpoints/entitlements/entitlementsGet';
import { getEntitlements, getUsage, requestLanguage, subjectCacheKey, upgradeRequiredBody } from '../src/lib/entitlements';
import { buildApp, MemoryBucket } from './helpers';
import { createSqliteD1 } from './sqlite-d1';

const MIGRATIONS = join(__dirname, '..', '..', 'admin-api', 'migrations');

class MemoryKV {
	store = new Map<string, string>();
	async get(k: string) { return this.store.get(k) ?? null; }
	async put(k: string, v: string) { this.store.set(k, v); }
	async delete(k: string) { this.store.delete(k); }
}

function env() {
	return {
		REPORTS_DB: createSqliteD1(MIGRATIONS),
		RATE_LIMIT_KV: new MemoryKV(),
		channels: new MemoryBucket({ c1: { id: 'c1', userId: 'owner', name: 'One' } }),
	} as any;
}

const call = (e: any, subject: string, auth: { userId: string; roles?: string[] }) =>
	buildApp((r) => r.get('/api/entitlements', EntitlementsGet), auth).request(`/api/entitlements?subject=${encodeURIComponent(subject)}`, {}, e);

const override = (e: any, type: string, id: string, key: string, value: unknown, expires: string | null = null) =>
	e.REPORTS_DB.raw.prepare("INSERT INTO entitlement_overrides (id, subject_type, subject_id, key, value_json, expires_at, reason, created_by) VALUES (?, ?, ?, ?, ?, ?, 'test', 'admin')").run(`${type}${id}${key}`, type, id, key, JSON.stringify(value), expires);

describe('GET /api/entitlements', () => {
	it('puts a subject with no assignment on Free', async () => {
		const res = await call(env(), 'channel:c1', { userId: 'owner' });
		assert.equal(res.status, 200);
		const { result } = (await res.json()) as any;
		assert.equal(result.plan.slug, 'free');
		assert.equal(result.entitlements['channel.about.links.max'].value, 5);
		assert.equal(result.entitlements['channel.about.links.max'].source, 'default_plan');
		assert.equal(result.degraded, false);
	});

	it('refuses another user', async () => {
		assert.equal((await call(env(), 'channel:c1', { userId: 'stranger' })).status, 403);
		assert.equal((await call(env(), 'user:owner', { userId: 'stranger' })).status, 403);
	});

	it('lets an admin read any subject, including a display-name role', async () => {
		assert.equal((await call(env(), 'channel:c1', { userId: 'a', roles: ['Super Admin'] })).status, 200);
	});

	it('does not treat a moderator as an admin', async () => {
		assert.equal((await call(env(), 'channel:c1', { userId: 'm', roles: ['moderator'] })).status, 403);
	});

	it('returns 404 for a missing channel and 400 for a bad subject', async () => {
		assert.equal((await call(env(), 'channel:nope', { userId: 'owner' })).status, 404);
		for (const bad of ['nope', 'organisation:1', 'channel:', ':x']) assert.equal((await call(env(), bad, { userId: 'owner' })).status, 400, bad);
	});
});

describe('getEntitlements', () => {
	const user = { type: 'user', id: 'owner' } as const;
	const channel = { type: 'channel', id: 'c1' } as const;

	it('applies a user override to that user\'s channel', async () => {
		const e = env();
		override(e, 'user', 'owner', 'channel.about.links.max', 20);
		assert.equal((await getEntitlements(e, [channel, user])).entitlements['channel.about.links.max'].value, 20);
	});

	it('prefers a channel override over the owner\'s', async () => {
		const e = env();
		override(e, 'user', 'owner', 'channel.about.links.max', 20);
		override(e, 'channel', 'c1', 'channel.about.links.max', 7);
		assert.equal((await getEntitlements(e, [channel, user])).entitlements['channel.about.links.max'].value, 7);
	});

	it('pins a subscriber to its plan version', async () => {
		const e = env();
		const db = e.REPORTS_DB.raw;
		db.exec("INSERT INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_plus', 1, 'channel.max', '3'), ('plan_plus', 2, 'channel.max', '9')");
		db.exec("UPDATE plans SET version = 2 WHERE id = 'plan_plus'");
		db.exec("INSERT INTO subscriptions (id, subject_type, subject_id, plan_id, plan_version, status, assigned_by) VALUES ('s', 'user', 'owner', 'plan_plus', 1, 'active', 'a')");
		const r = await getEntitlements(e, [user]);
		assert.equal(r.plan?.slug, 'plus');
		assert.equal(r.entitlements['channel.max'].value, 3);
	});

	it('ends a trial at its period end, even from cache', async () => {
		const e = env();
		e.REPORTS_DB.raw.exec("INSERT INTO subscriptions (id, subject_type, subject_id, plan_id, plan_version, status, current_period_end, assigned_by) VALUES ('s', 'user', 'owner', 'plan_plus', 1, 'trialing', '2026-12-01T00:00:00Z', 'a')");
		assert.equal((await getEntitlements(e, [user], new Date('2026-11-15T00:00:00Z'))).plan?.slug, 'plus');
		assert.equal((await getEntitlements(e, [user], new Date('2026-12-02T00:00:00Z'))).plan?.slug, 'free');
	});

	it('serves from cache until the key is invalidated', async () => {
		const e = env();
		await getEntitlements(e, [user]);
		override(e, 'user', 'owner', 'channel.max', 4);
		assert.equal((await getEntitlements(e, [user])).entitlements['channel.max'].value, 1);
		await e.RATE_LIMIT_KV.delete(subjectCacheKey(user));
		assert.equal((await getEntitlements(e, [user])).entitlements['channel.max'].value, 4);
	});

	it('fails open when D1 is missing or throws', async () => {
		assert.equal((await getEntitlements({}, [user])).entitlements['channel.max'].value, 'unlimited');
		const broken = { REPORTS_DB: { prepare() { throw new Error('D1 down'); } } };
		const r = await getEntitlements(broken, [user]);
		assert.equal(r.degraded, true);
		assert.equal(r.entitlements['upload.monthlyUploads'].value, 'unlimited');
	});

	it('still resolves when KV throws', async () => {
		const e = env();
		e.RATE_LIMIT_KV = { get() { throw new Error('KV down'); }, put() { throw new Error('KV down'); } };
		const r = await getEntitlements(e, [user]);
		assert.equal(r.degraded, false);
		assert.equal(r.entitlements['channel.max'].value, 1);
	});
});

describe('usage and refusals', () => {
	it('warns at 80% of a limit', async () => {
		const e = env();
		const now = new Date('2026-11-08T00:00:00Z');
		e.REPORTS_DB.raw.exec("INSERT INTO usage_counters (subject_type, subject_id, key, period, value) VALUES ('user', 'owner', 'upload.monthlyUploads', '2026-11', 8), ('user', 'owner', 'storage.gb', 'all', 1000000000)");
		const snapshot = await getEntitlements(e, [{ type: 'user', id: 'owner' }], now);
		const usage = await getUsage(e, 'owner', snapshot, now);
		assert.deepEqual(usage['upload.monthlyUploads'], { current: 8, limit: 10, warning: true });
		assert.deepEqual(usage['storage.gb'], { current: 1, limit: 5, warning: false });
	});

	it('builds a localized upgrade_required body', () => {
		const body = upgradeRequiredBody('channel.max', 1, 1, requestLanguage('ar-SA,ar;q=0.9'));
		assert.equal(body.error, 'upgrade_required');
		assert.equal(body.entitlement, 'channel.max');
		assert.match(body.message, /[؀-ۿ]/);
		assert.equal(requestLanguage('fr'), 'en');
		assert.equal(requestLanguage(null), 'en');
	});
});
