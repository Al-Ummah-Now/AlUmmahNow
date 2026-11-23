/**
 * Supporting a channel (wiki AUN-MEMBERS §2.1, §2.2, §5.4; MEM-7): the sheet, the breakdown, the
 * hosted test checkout through the signed webhook to the ledger, monthly consent kept word for word,
 * stopping a pledge at the collector, the owner's settings, and every refusal (switch off, ineligible,
 * self-support, age, consent, minimum, rate limit). Real SQL; no network, no money.
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { forgetFeatureSwitches, writeFeatureSwitch } from '@al-ummah/shared-types';
import { SqliteD1 } from './search-sqlite-d1';
import { MemoryBucket } from './helpers';
import { handleAdminJobBatch, type JobMessage } from '../src/lib/admin/jobs';
import { ADMIN_JOB_HANDLERS } from '../src/lib/admin/service';
import { writeSupportPolicy } from '../src/lib/support/config';
import { computeFeatures } from '../src/lib/features';
import { creatorBalance } from '../src/lib/support/ledger';
import { onSupportJobFailed, vendorContext, type SupportJobEnv } from '../src/lib/support/jobs';
import { handleMySupport, handleMySupportCheckout, handleStopMyPledge, handleSupportCheckout, handleSupportQuote, handleSupportSettingsSave, handleSupportSheet } from '../src/endpoints/support/supportCheckout';
import { handleTestCheckoutPage, handleTestCheckoutSubmit } from '../src/endpoints/support/supportTestCheckout';

const OWNER = 'usr_owner';
const FAN = 'usr_fan';
const CH = 'ch_amina';
const DECIDED = { primaryRail: 'test', fallbackRail: 'none', holdDays: 30, payoutThresholdUsdMinor: 2500, payoutDayOfMonth: 15, creatorMayRaiseThreshold: true, payoutFeeBearer: 'creatorFromPayout', negativeBalancePolicy: 'netAgainstFutureGifts', dormantPolicy: 'unclaimedPropertyRule', dormantReminderMonths: [3, 6, 12], collectBeforePayeeActive: false, batchApprovers: 2, adjustmentApprovers: 2, collectorFeePayer: 'creatorSupporterMayCover', amounts: { USD: { minimum: 300, presets: [500, 1000, 2500] } }, minSupporterAge: 18, minCreatorAge: 18, receiversRule: 'everyAdultOwner' };

class JobsQueue {
	pending: unknown[] = [];
	async send(body: unknown) {
		this.pending.push(body);
	}
	async drain(env: unknown) {
		while (this.pending.length) {
			const body = this.pending.shift();
			const msg: JobMessage = { body, attempts: 1, ack: () => undefined, retry: () => undefined };
			await handleAdminJobBatch({ messages: [msg] }, env as never, ADMIN_JOB_HANDLERS, (job, error) => onSupportJobFailed(env as SupportJobEnv, job, error));
		}
	}
}

const realFetch = globalThis.fetch;
beforeEach(() => {
	forgetFeatureSwitches();
	globalThis.fetch = (async () => new Response('{}', { status: 202 })) as typeof fetch;
});
afterEach(() => {
	globalThis.fetch = realFetch;
	forgetFeatureSwitches();
});

async function setup(opts: { switchOn?: boolean } = {}) {
	const db = new SqliteD1();
	const queue = new JobsQueue();
	const channels = new MemoryBucket();
	await channels.put(CH, JSON.stringify({ id: CH, userId: OWNER, members: [] }));
	const env = { SEARCH_DB: db, channels, ADMIN_JOBS_QUEUE: queue, ENVIRONMENT: 'qa', SUPPORT_TEST_PROVIDERS: '1', VIDEOS_API_URL: 'https://videos.api.qa.example', VIDEOS_WEB_URL: 'https://qa.example', ERRORS_INGEST_URL: 'https://admin.api.qa.example/x', INTERNAL_API_KEY: 'k' } as unknown as SupportJobEnv;
	if (opts.switchOn !== false) await writeFeatureSwitch(env as never, { key: 'creatorSupport', enabled: true, expectedVersion: 0, actorId: 'usr_super', currentStored: false });
	await writeSupportPolicy(db as never, DECIDED, 'usr_fin', 0);
	await db.prepare("INSERT INTO support_settings (channel_id, enabled, one_time_enabled, monthly_enabled, presets, updated_at, updated_by) VALUES (?, 1, 1, 1, '[500,1500]', 'now', ?)").bind(CH, OWNER).run();
	await db.prepare("INSERT INTO support_payees (id, channel_id, owner_user_id, rail, mode, rail_payee_ref, country, status, tax_form, sanctions_status, created_at, updated_at) VALUES ('pe1', ?, ?, 'test', 'test', 'trpe_x', 'GB', 'active', 'w8ben', 'clear', 'now', 'now')").bind(CH, OWNER).run();
	forgetFeatureSwitches();
	const as = (userId: string | null) => {
		const app = new Hono();
		app.use('*', async (c, next) => {
			if (userId) c.set('userId' as never, userId as never);
			await next();
		});
		app.get('/api/channels/:channelId/support', handleSupportSheet);
		app.get('/api/channels/:channelId/support/quote', handleSupportQuote);
		app.post('/api/channels/:channelId/support/checkout', handleSupportCheckout);
		app.put('/api/channels/:channelId/support/settings', handleSupportSettingsSave);
		app.get('/api/me/support', handleMySupport);
		app.get('/api/me/support/checkouts/:id', handleMySupportCheckout);
		app.post('/api/me/support/pledges/:id/stop', handleStopMyPledge);
		app.get('/webhooks/support/test/checkout/:id', handleTestCheckoutPage);
		app.post('/webhooks/support/test/checkout/:id', handleTestCheckoutSubmit);
		return async (method: string, path: string, json?: unknown, form?: Record<string, string>) => {
			const res = await app.request(path, { method, body: form ? new URLSearchParams(form) : json === undefined ? undefined : JSON.stringify(json), headers: form ? {} : { 'Content-Type': 'application/json' } }, env as never);
			const text = await res.text();
			let body: any = null;
			try {
				body = JSON.parse(text);
			} catch {
				body = text;
			}
			return { status: res.status, body, location: res.headers.get('Location') };
		};
	};
	return { db, env, queue, as, drain: () => queue.drain(env) };
}

const GIFT = { kind: 'one_time', amount: 500, currency: 'USD', ageConfirmed: true, locale: 'en', message: 'JazakAllah khair' };

describe('the sheet and the breakdown', () => {
	it('answers feature_off while the switch is off', async () => {
		const t = await setup({ switchOn: false });
		const r = await t.as(FAN)('GET', `/api/channels/${CH}/support`);
		assert.equal(r.status, 404);
		assert.equal(r.body.code, 'feature_off');
	});

	it('shows the channel’s presets and the rules; the breakdown says the platform takes nothing', async () => {
		const t = await setup();
		const sheet = await t.as(null)('GET', `/api/channels/${CH}/support`);
		assert.deepEqual({ presets: sheet.body.result.presets, minimum: sheet.body.result.minimum, coverFeesChoice: sheet.body.result.coverFeesChoice }, { presets: [500, 1500], minimum: 300, coverFeesChoice: true });
		const q = await t.as(null)('GET', `/api/channels/${CH}/support/quote?amount=500&currency=USD&lang=ar`);
		assert.equal(q.body.result.creatorReceives.amount, 455);
		assert.equal(q.body.result.platformFee.amount, 0);
		assert.match(q.body.result.text.platformFee, /٠٫٠٠/);
		const covered = await t.as(null)('GET', `/api/channels/${CH}/support/quote?amount=500&coverFees=1`);
		assert.ok(covered.body.result.creatorReceives.amount >= 500);
		assert.equal((await t.as(null)('GET', `/api/channels/${CH}/support/quote?amount=100`)).body.code, 'support_amount_too_small');
		assert.equal((await t.as(null)('GET', `/api/channels/${CH}/support/quote?amount=500&currency=EUR`)).body.code, 'support_currency_unavailable');
	});
});

describe('the owner’s tier is only read', () => {
	it('a super admin owner keeps their automatic Unlimited tier after the sheet and the feature keys check it', async () => {
		const t = await setup();
		await t.db.prepare("INSERT INTO creator_tier_assignments (user_id, tier_id, source, assigned_by, assigned_at) VALUES (?, 'unlimited', 'admin', 'system:super-admin', 'now')").bind(OWNER).run();
		const sheet = await t.as(FAN)('GET', `/api/channels/${CH}/support`);
		assert.equal(sheet.status, 200);
		const keys = await computeFeatures(t.env as never, { userId: FAN, roles: [] }, CH);
		assert.equal(keys.support, true);
		const row = await t.db.prepare('SELECT tier_id, assigned_by FROM creator_tier_assignments WHERE user_id = ?').bind(OWNER).first();
		assert.deepEqual({ ...row }, { tier_id: 'unlimited', assigned_by: 'system:super-admin' });
	});
});

describe('checkout', () => {
	it('a one-time gift: hosted test checkout → Pay → webhook → ledger; the supporter sees it', async () => {
		const t = await setup();
		const fan = t.as(FAN);
		const r = await fan('POST', `/api/channels/${CH}/support/checkout`, { ...GIFT, returnPath: '/channel/ch_amina' });
		assert.equal(r.status, 200, JSON.stringify(r.body));
		const { checkoutId, url } = r.body.result;
		const path = new URL(url).pathname;
		const page = await fan('GET', path);
		assert.match(page.body, /No card is asked for/);
		const paid = await fan('POST', path, undefined, { action: 'pay' });
		assert.equal(paid.status, 303);
		assert.equal(paid.location, `https://qa.example/channel/ch_amina?support=${checkoutId}`);
		await t.drain();
		assert.equal((await fan('GET', `/api/me/support/checkouts/${checkoutId}`)).body.result.status, 'completed');
		assert.equal((await creatorBalance(t.db as never, CH)).USD!.pending, 455);
		const mine = await fan('GET', '/api/me/support');
		assert.equal(mine.body.result.payments.length, 1);
		// Another person can't read this checkout
		assert.equal((await t.as('usr_other')('GET', `/api/me/support/checkouts/${checkoutId}`)).status, 404);
	});

	it('monthly: the consent line is kept word for word; stopping cancels at the collector at once', async () => {
		const t = await setup();
		const fan = t.as(FAN);
		assert.equal((await fan('POST', `/api/channels/${CH}/support/checkout`, { ...GIFT, kind: 'monthly' })).body.code, 'support_consent_required');
		const r = await fan('POST', `/api/channels/${CH}/support/checkout`, { ...GIFT, kind: 'monthly', amount: 1000, consent: true });
		const row = await t.db.prepare('SELECT consent_text FROM support_checkouts WHERE id = ?').bind(r.body.result.checkoutId).first<{ consent_text: string }>();
		assert.equal(row!.consent_text, 'Charge me $10.00 every month until I stop.');
		await fan('POST', new URL(r.body.result.url).pathname, undefined, { action: 'pay' });
		await t.drain();
		const pledge = (await fan('GET', '/api/me/support')).body.result.pledges[0];
		assert.equal(pledge.status, 'active');
		assert.equal((await fan('POST', `/api/me/support/pledges/${pledge.id}/stop`)).body.result.status, 'canceled');
		const ref = await t.db.prepare('SELECT collector_pledge_ref FROM support_pledges').first<{ collector_pledge_ref: string }>();
		assert.equal((await vendorContext(t.env, 'test').testState!.get<{ status: string }>(`collector:pledge:${ref!.collector_pledge_ref}`))!.status, 'canceled');
		// Stopping is never taken away, even after the switch goes off
		await writeFeatureSwitch(t.env as never, { key: 'creatorSupport', enabled: false, expectedVersion: 1, actorId: 'usr_super', currentStored: true });
		forgetFeatureSwitches();
		assert.equal((await fan('GET', '/api/me/support')).status, 200);
		assert.equal((await t.as('usr_nobody')('GET', '/api/me/support')).body.code, 'feature_off');
	});

	it('refusals: signed out, own channel, age, minimum, closed kind, too many', async () => {
		const t = await setup();
		assert.equal((await t.as(null)('POST', `/api/channels/${CH}/support/checkout`, GIFT)).status, 401);
		assert.equal((await t.as(OWNER)('POST', `/api/channels/${CH}/support/checkout`, GIFT)).body.code, 'feature_off');
		const fan = t.as(FAN);
		assert.equal((await fan('POST', `/api/channels/${CH}/support/checkout`, { ...GIFT, ageConfirmed: false })).body.code, 'support_age_required');
		assert.equal((await fan('POST', `/api/channels/${CH}/support/checkout`, { ...GIFT, amount: 200 })).body.code, 'support_amount_too_small');
		await t.db.prepare('UPDATE support_settings SET monthly_enabled = 0').run();
		assert.equal((await fan('POST', `/api/channels/${CH}/support/checkout`, { ...GIFT, kind: 'monthly', consent: true })).status, 400);
		for (let i = 0; i < 10; i++) assert.equal((await fan('POST', `/api/channels/${CH}/support/checkout`, GIFT)).status, 200);
		assert.equal((await fan('POST', `/api/channels/${CH}/support/checkout`, GIFT)).status, 429);
	});

	it('a channel that can’t receive (payee not ready) answers feature_off', async () => {
		const t = await setup();
		await t.db.prepare("UPDATE support_payees SET status = 'pending'").run();
		assert.equal((await t.as(FAN)('POST', `/api/channels/${CH}/support/checkout`, GIFT)).body.code, 'feature_off');
	});
});

describe('the owner’s settings', () => {
	it('only the owner saves; presets must be at or above the minimum', async () => {
		const t = await setup();
		assert.equal((await t.as(FAN)('PUT', `/api/channels/${CH}/support/settings`, { enabled: false })).status, 404);
		assert.equal((await t.as(OWNER)('PUT', `/api/channels/${CH}/support/settings`, { presets: [100] })).status, 400);
		const ok = await t.as(OWNER)('PUT', `/api/channels/${CH}/support/settings`, { presets: [500, 2000], thankYouNote: 'Thank you' });
		assert.deepEqual(ok.body.result.presets, [500, 2000]);
		assert.equal(ok.body.result.thankYouNote, 'Thank you');
	});
});

describe('review fixes (cross-provider review of #1774, #1764)', () => {
	it('a stopped pledge stays stopped when an older collector event arrives afterwards', async () => {
		const t = await setup();
		const fan = t.as(FAN);
		const before = new Date().toISOString();
		const r = await fan('POST', `/api/channels/${CH}/support/checkout`, { ...GIFT, kind: 'monthly', amount: 1000, consent: true });
		await fan('POST', new URL(r.body.result.url).pathname, undefined, { action: 'pay' });
		await t.drain();
		const pledge = (await fan('GET', '/api/me/support')).body.result.pledges[0];
		await fan('POST', `/api/me/support/pledges/${pledge.id}/stop`);
		const ref = (await t.db.prepare('SELECT collector_pledge_ref FROM support_pledges').first<{ collector_pledge_ref: string }>())!.collector_pledge_ref;
		const { applyCollectorEvents } = await import('../src/lib/support/events');
		const { readSupportConfig } = await import('../src/lib/support/config');
		await applyCollectorEvents({ db: t.db as never, collector: 'test', mode: 'test', policy: (await readSupportConfig(t.db as never)).policy, now: new Date() }, [{ type: 'pledge.updated', pledgeRef: ref, status: 'active', currentPeriodEnd: null, occurredAt: before }]);
		assert.equal((await t.db.prepare('SELECT status FROM support_pledges').first<{ status: string }>())!.status, 'canceled');
	});

	it('a channel editor can’t support their own channel (the role comes from the record already read)', async () => {
		const t = await setup();
		await (t.env as unknown as { channels: MemoryBucket }).channels.put(CH, JSON.stringify({ id: CH, userId: OWNER, members: [{ userId: 'usr_editor', role: 'editor' }] }));
		const r = await t.as('usr_editor')('POST', `/api/channels/${CH}/support/checkout`, GIFT);
		assert.equal(r.body.code, 'feature_off');
	});

	it('a gift the card fee would swallow is refused', async () => {
		const t = await setup();
		await t.db.prepare("UPDATE support_config SET policy = json_set(policy, '$.amounts.USD.minimum', 1)").run();
		const q = await t.as(null)('GET', `/api/channels/${CH}/support/quote?amount=30`);
		assert.equal(q.body.code, 'support_amount_too_small');
	});

	it('a vendor event in the same millisecond as the stop never brings the pledge back', async () => {
		const t = await setup();
		const fan = t.as(FAN);
		const r = await fan('POST', `/api/channels/${CH}/support/checkout`, { ...GIFT, kind: 'monthly', amount: 1000, consent: true });
		await fan('POST', new URL(r.body.result.url).pathname, undefined, { action: 'pay' });
		await t.drain();
		const pledge = (await fan('GET', '/api/me/support')).body.result.pledges[0];
		const { stopMyPledge } = await import('../src/lib/support/checkout');
		const now = new Date();
		await stopMyPledge(t.env, FAN, pledge.id, (mode) => vendorContext(t.env, mode, () => now), now);
		const ref = (await t.db.prepare('SELECT collector_pledge_ref FROM support_pledges').first<{ collector_pledge_ref: string }>())!.collector_pledge_ref;
		const { applyCollectorEvents } = await import('../src/lib/support/events');
		const { readSupportConfig } = await import('../src/lib/support/config');
		const policy = (await readSupportConfig(t.db as never)).policy;
		for (const at of [now, new Date(now.getTime() + 60_000)]) {
			await applyCollectorEvents({ db: t.db as never, collector: 'test', mode: 'test', policy, now }, [{ type: 'pledge.updated', pledgeRef: ref, status: 'active', currentPeriodEnd: null, occurredAt: at.toISOString() }]);
			assert.equal((await t.db.prepare('SELECT status FROM support_pledges').first<{ status: string }>())!.status, 'canceled', at.toISOString());
		}
	});

	it('stopping uses the pledge’s own mode, not today’s setting (#1774-3)', async () => {
		const t = await setup();
		const fan = t.as(FAN);
		const r = await fan('POST', `/api/channels/${CH}/support/checkout`, { ...GIFT, kind: 'monthly', amount: 1000, consent: true });
		await fan('POST', new URL(r.body.result.url).pathname, undefined, { action: 'pay' });
		await t.drain();
		const pledge = (await fan('GET', '/api/me/support')).body.result.pledges[0];
		await t.db.prepare("UPDATE support_config SET mode = 'live' WHERE id = 'default'").run();
		const modes: string[] = [];
		const { stopMyPledge } = await import('../src/lib/support/checkout');
		const now = new Date();
		assert.deepEqual(await stopMyPledge(t.env, FAN, pledge.id, (mode) => (modes.push(mode), vendorContext(t.env, mode, () => now)), now), { status: 'canceled' });
		assert.deepEqual(modes, ['test']);
	});

	it('with the human check enforced, someone who may not support gets feature_off before any captcha refusal (#1774-4)', async () => {
		const t = await setup();
		Object.assign(t.env, { TURNSTILE_MODE: 'enforce', TURNSTILE_SITE_KEY: 'site', TURNSTILE_SECRET: { get: async () => 'secret' } });
		assert.equal((await t.as(OWNER)('POST', `/api/channels/${CH}/support/checkout`, GIFT)).body.code, 'feature_off', 'own channel, no token');
		const fan = await t.as(FAN)('POST', `/api/channels/${CH}/support/checkout`, GIFT);
		assert.equal(fan.status, 403, 'an eligible supporter without a token meets the check');
		assert.equal(fan.body.code, 'human_check_failed');
	});

	it('the chosen rails’ payee wins over a newer payee row on another rail (#1764-2)', async () => {
		const t = await setup();
		await t.db.prepare("INSERT INTO support_payees (id, channel_id, owner_user_id, rail, mode, rail_payee_ref, country, status, tax_form, sanctions_status, created_at, updated_at) VALUES ('pe_other', ?, ?, 'wise', 'test', 'wise_x', 'GB', 'pending', 'none', 'clear', '2099-01-01', '2099-01-01')").bind(CH, OWNER).run();
		assert.equal((await t.as(FAN)('GET', `/api/channels/${CH}/support`)).status, 200, 'the active payee on the primary rail counts');
		await t.db.prepare("UPDATE support_config SET policy = json_set(policy, '$.primaryRail', 'wise', '$.fallbackRail', 'test')").run();
		assert.equal((await t.as(FAN)('GET', `/api/channels/${CH}/support`)).body.code, 'feature_off', 'now the pending Wise payee is the one that counts');
	});
});

describe('owner decisions O43 (MEM-D3, D4, fee settings)', () => {
	it('the sheet always shows the fee and starts with "cover the fees" unticked', async () => {
		const t = await setup();
		const sheet = await t.as(null)('GET', `/api/channels/${CH}/support`);
		assert.equal(sheet.body.result.coverFeesChoice, true);
		assert.equal(sheet.body.result.coverFeesDefault, false);
	});

	it('amounts are per currency: a currency without its minimum and presets can’t be given in', async () => {
		const t = await setup();
		assert.equal((await t.as(null)('GET', `/api/channels/${CH}/support/quote?amount=500&currency=EUR`)).body.code, 'support_currency_unavailable');
		await t.db.prepare(`UPDATE support_config SET policy = json_set(policy, '$.amounts.EUR', json('{"minimum":400,"presets":[500]}'))`).run();
		assert.equal((await t.as(null)('GET', `/api/channels/${CH}/support/quote?amount=300&currency=EUR`)).body.code, 'support_amount_too_small');
		const q = await t.as(null)('GET', `/api/channels/${CH}/support/quote?amount=500&currency=EUR`);
		assert.equal(q.body.result.gift.currency, 'EUR');
	});

	it('without a live quote the fee setting in force is used; with neither, nobody can pay', async () => {
		const t = await setup();
		const { readSupportConfig } = await import('../src/lib/support/config');
		const { quote } = await import('../src/lib/support/checkout');
		const { addFeeSchedule } = await import('../src/lib/support/fees');
		// A collector with no live quote here (PayGood's adapter is not built): only the setting can give the fee
		await t.db.prepare("UPDATE support_config SET collector = 'paygood' WHERE id = 'default'").run();
		const config = await readSupportConfig(t.db as never);
		const ctx = vendorContext(t.env, 'test');
		await assert.rejects(quote(t.env, config, { amount: 1000, currency: 'USD', supporterTicked: false }, 'en', ctx, new Date()), (e: { code: string }) => e.code === 'support_currency_unavailable');
		await addFeeSchedule(t.db as never, { kind: 'collector', provider: 'paygood', currency: 'USD', basisPoints: 290, fixedMinor: 30, effectiveFrom: '2026-01-01T00:00:00Z', presetId: 'paygood-standard-usd' }, 'usr_fin');
		await addFeeSchedule(t.db as never, { kind: 'collector', provider: 'paygood', currency: 'USD', basisPoints: 190, fixedMinor: 30, effectiveFrom: '2999-01-01T00:00:00Z' }, 'usr_fin');
		const q = await quote(t.env, config, { amount: 1000, currency: 'USD', supporterTicked: false }, 'en', ctx, new Date());
		assert.equal(q.collectorFee.amount, 29 + 30, 'the rate in force today, not the future one');
		await assert.rejects(t.db.prepare('DELETE FROM support_fee_schedules').run(), /append-only/);
	});

	it('the checkout charges the fee for the method the quote was for (cross-provider review of #1810)', async () => {
		const t = await setup();
		await t.db.prepare("UPDATE support_config SET policy = json_set(policy, '$.collectorFeePayer', 'supporterAlways')").run();
		const { testCollector } = await import('../src/lib/support/test-collector');
		const original = testCollector.liveFee;
		testCollector.liveFee = async (_ctx, currency, method) => ({ basisPoints: method === 'bank_transfer' ? 100 : 290, fixed: { amount: method === 'bank_transfer' ? 0 : 30, currency } });
		try {
			const fan = t.as(FAN);
			const q = await fan('GET', `/api/channels/${CH}/support/quote?amount=1000&method=bank_transfer`);
			const r = await fan('POST', `/api/channels/${CH}/support/checkout`, { ...GIFT, amount: 1000, method: 'bank_transfer' });
			assert.equal(r.status, 200);
			assert.equal(r.body.result.quote.charged.amount, q.body.result.charged.amount);
			const card = await fan('POST', `/api/channels/${CH}/support/checkout`, { ...GIFT, amount: 1000 });
			assert.notEqual(card.body.result.quote.charged.amount, r.body.result.quote.charged.amount, 'a different method, a different fee');
		} finally {
			testCollector.liveFee = original;
		}
	});

	it('the owner’s presets follow the currency’s configured minimum, not a USD default (cross-provider review of #1810)', async () => {
		const t = await setup();
		const owner = t.as(OWNER);
		assert.equal((await owner('PUT', `/api/channels/${CH}/support/settings`, { currency: 'EUR', presets: [500] })).status, 400, 'no EUR amounts set');
		await t.db.prepare("UPDATE support_config SET policy = json_set(policy, '$.amounts.EUR', json('{\"minimum\":200,\"presets\":[200]}'))").run();
		assert.equal((await owner('PUT', `/api/channels/${CH}/support/settings`, { currency: 'EUR', presets: [150] })).status, 400, 'under the EUR minimum');
		const ok = await owner('PUT', `/api/channels/${CH}/support/settings`, { currency: 'EUR', presets: [250, 1_500_000] });
		assert.equal(ok.status, 200, 'over the old fixed ceiling is fine');
		assert.equal((await t.db.prepare('SELECT currency FROM support_settings WHERE channel_id = ?').bind(CH).first<{ currency: string }>())!.currency, 'EUR');
		assert.equal((await owner('PUT', `/api/channels/${CH}/support/settings`, { presets: [2_000_000_000] })).status, 400);
	});
});
