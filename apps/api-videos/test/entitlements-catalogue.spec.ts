/**
 * Epic 27 PR 1: the plan migrations and the pure resolver.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ENTITLEMENT_CATALOGUE, UNLIMITED, checkNumericLimit, resolveEntitlements, validateEntitlementValue, usagePeriod } from '@al-ummah/shared-types';

const dir = join(__dirname, '..', '..', 'admin-api', 'migrations');
function db() {
	const raw = new DatabaseSync(':memory:');
	for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) raw.exec(readFileSync(join(dir, f), 'utf8'));
	return raw;
}
const freeRows = (raw: DatabaseSync) =>
	Object.fromEntries((raw.prepare("SELECT key, value_json FROM plan_entitlements WHERE plan_id='plan_free' AND plan_version=1").all() as any[]).map((r) => [r.key, JSON.parse(r.value_json)]));

describe('plan migrations', () => {
	it('seeds exactly one default plan, which is active Free', () => {
		const rows = db().prepare('SELECT slug, status FROM plans WHERE is_default = 1').all() as any[];
		assert.deepEqual(rows.map((r) => ({ ...r })), [{ slug: 'free', status: 'active' }]);
	});

	it('rejects a second default plan', () => {
		assert.throws(() => db().exec("INSERT INTO plans (id, slug, name_en, name_ar, audience, is_default, created_by) VALUES ('x','x','x','x','everyone',1,'t')"));
	});

	it('gives Free a valid value for every catalogue key and no unknown keys', () => {
		const free = freeRows(db());
		assert.deepEqual(Object.keys(free).sort(), ENTITLEMENT_CATALOGUE.map((d) => d.key).sort());
		for (const [k, v] of Object.entries(free)) assert.equal(validateEntitlementValue(k, v), null);
	});

	it('seeds the limits the owner chose', () => {
		const free = freeRows(db());
		for (const [k, v] of Object.entries({ 'upload.monthlyUploads': 10, 'storage.gb': 5, 'channel.max': 1, 'channel.about.links.max': 5, 'upload.maxDurationMinutes': 30 })) assert.equal(free[k], v);
	});

	it('leaves paid plans as non-public drafts with valid values', () => {
		const raw = db();
		// Only Free is public; the white-label site add-ons (AUN-SCHOLAR-SITES SS1) are active but admin-granted, never public
		assert.deepEqual((raw.prepare("SELECT slug FROM plans WHERE is_public = 1").all() as any[]).map((r) => r.slug), ['free']);
		assert.deepEqual((raw.prepare("SELECT slug FROM plans WHERE status <> 'draft' ORDER BY sort_order").all() as any[]).map((r) => r.slug), ['free', 'addon-white-label', 'addon-white-label-domain']);
		for (const r of raw.prepare("SELECT key, value_json FROM plan_entitlements WHERE plan_id <> 'plan_free'").all() as any[]) {
			assert.equal(validateEntitlementValue(r.key, JSON.parse(r.value_json)), null);
		}
	});

	it('allows one live subscription per subject', () => {
		const raw = db();
		const ins = "INSERT INTO subscriptions (id, subject_type, subject_id, plan_id, plan_version, status, assigned_by) VALUES (?, 'user', 'u', 'plan_free', 1, ?, 'a')";
		raw.prepare(ins).run('1', 'active');
		assert.throws(() => raw.prepare(ins).run('2', 'trialing'));
		raw.prepare(ins).run('3', 'canceled');
	});
});

describe('resolveEntitlements', () => {
	const now = new Date('2026-11-08T00:00:00Z');
	const base = { overrides: [], subscription: null, defaultPlan: null, now };
	const key = 'channel.max';

	it('falls back to the permissive catalogue value with no data (fail open)', () => {
		assert.deepEqual(resolveEntitlements(base)[key], { value: UNLIMITED, source: 'fallback' });
	});
	it('uses the default plan', () => {
		assert.deepEqual(resolveEntitlements({ ...base, defaultPlan: { [key]: 1 } })[key], { value: 1, source: 'default_plan' });
	});
	it('prefers a subscription over the default plan', () => {
		assert.equal(resolveEntitlements({ ...base, defaultPlan: { [key]: 1 }, subscription: { [key]: 5 } })[key].value, 5);
	});
	it('falls through a key the subscription plan does not set', () => {
		assert.equal(resolveEntitlements({ ...base, defaultPlan: { [key]: 1 }, subscription: {} })[key].source, 'default_plan');
	});
	it('prefers an override over everything', () => {
		const r = resolveEntitlements({ ...base, subscription: { [key]: 5 }, overrides: [{ key, value: 9, expires_at: null }] });
		assert.deepEqual(r[key], { value: 9, source: 'override' });
	});
	it('ignores an expired override', () => {
		const r = resolveEntitlements({ ...base, defaultPlan: { [key]: 1 }, overrides: [{ key, value: 9, expires_at: '2026-11-07T00:00:00Z' }] });
		assert.equal(r[key].value, 1);
	});
	it('takes the first override when a channel and its owner both have one', () => {
		const r = resolveEntitlements({ ...base, overrides: [{ key, value: 3, expires_at: null }, { key, value: 9, expires_at: null }] });
		assert.equal(r[key].value, 3);
	});
});

describe('checkNumericLimit (grandfathering)', () => {
	it('allows up to the limit and refuses beyond it', () => {
		assert.equal(checkNumericLimit(1, 0, 1).allowed, true);
		assert.equal(checkNumericLimit(1, 1, 1).allowed, false);
	});
	it('never refuses when nothing is added, even above the limit', () => {
		assert.equal(checkNumericLimit(5, 9, 0).allowed, true);
	});
	it('never refuses a reduction', () => {
		assert.equal(checkNumericLimit(5, 9, -2).allowed, true);
	});
	it('refuses growth when already above the limit', () => {
		assert.equal(checkNumericLimit(5, 9, 1).allowed, false);
	});
	it('treats unlimited as allowed', () => {
		assert.deepEqual(checkNumericLimit(UNLIMITED, 1e9, 1e9), { allowed: true, limit: UNLIMITED });
	});
});

describe('catalogue validation', () => {
	it('rejects unknown keys and wrong types', () => {
		assert.match(validateEntitlementValue('nope', 1) ?? '', /Unknown/);
		assert.ok(validateEntitlementValue('channel.max', -1));
		assert.ok(validateEntitlementValue('channel.handle', 1));
		assert.ok(validateEntitlementValue('discussions.theming', 'pink'));
	});
	it('has bilingual descriptions and unique keys', () => {
		assert.equal(new Set(ENTITLEMENT_CATALOGUE.map((d) => d.key)).size, ENTITLEMENT_CATALOGUE.length);
		for (const d of ENTITLEMENT_CATALOGUE) {
			assert.ok(d.description_en);
			assert.match(d.description_ar, /[؀-ۿ]/);
		}
	});
	it('computes the calendar-month period in UTC', () => {
		assert.equal(usagePeriod(new Date('2026-11-30T23:59:59Z')), '2026-11');
	});
});
