/**
 * Payee onboarding (wiki AUN-MEMBERS §2.4, MEM-22): hosted onboarding at the rail, country rules,
 * MEM-D17 open = refused, idempotent per channel, the test rail's onboarding page going through the
 * signed webhook → payee-sync path, nothing but status and "form on file" kept, and the Studio API
 * answering feature_off while creatorSupport is off. No network, no money.
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { handleAdminJobBatch, type JobMessage } from '../src/lib/admin/jobs';
import { ADMIN_JOB_HANDLERS } from '../src/lib/admin/service';
import { writeSupportPolicy } from '../src/lib/support/config';
import { onSupportJobFailed, vendorContext, type SupportJobEnv } from '../src/lib/support/jobs';
import { PayeeError, payeeView, startPayeeOnboarding } from '../src/lib/support/payees';
import { handleSupportPayee, handleSupportPayeeOnboard } from '../src/endpoints/support/supportPayee';
import { handleTestRailOnboardPage, handleTestRailOnboardSubmit } from '../src/endpoints/support/supportTestRail';
import { SqliteD1 } from './search-sqlite-d1';

const NOW = new Date('2026-11-22T12:00:00.000Z');

class JobsQueue {
	pending: { body: unknown; attempts: number }[] = [];
	async send(body: unknown) {
		this.pending.push({ body, attempts: 1 });
	}
	async drain(env: unknown) {
		for (let guard = 0; this.pending.length && guard < 100; guard++) {
			const d = this.pending.shift()!;
			const msg: JobMessage = { body: d.body, attempts: d.attempts, ack: () => undefined, retry: () => undefined };
			await handleAdminJobBatch({ messages: [msg] }, env as never, ADMIN_JOB_HANDLERS, (job, error) => onSupportJobFailed(env as SupportJobEnv, job, error));
		}
	}
}

const realFetch = globalThis.fetch;
beforeEach(() => {
	globalThis.fetch = (async () => new Response('{}', { status: 202 })) as typeof fetch;
});
afterEach(() => {
	globalThis.fetch = realFetch;
});

async function setup(opts: { decided?: boolean; environment?: string } = {}) {
	const sql = new SqliteD1();
	const queue = new JobsQueue();
	const env = { SEARCH_DB: sql, ENVIRONMENT: opts.environment ?? 'qa', SUPPORT_TEST_PROVIDERS: '1', VIDEOS_API_URL: 'https://videos.api.qa.example', VIDEOS_WEB_URL: 'https://qa.example', ADMIN_JOBS_QUEUE: queue, ERRORS_INGEST_URL: 'https://admin.api.qa.example/x', INTERNAL_API_KEY: 'k' } as unknown as SupportJobEnv & { VIDEOS_WEB_URL: string };
	if (opts.decided !== false) await writeSupportPolicy(sql as never, { primaryRail: 'test', fallbackRail: 'none' }, 'usr_fin', 0);
	const start = (channelId: string, country: string) => startPayeeOnboarding(env, { channelId, ownerUserId: `owner_${channelId}`, country, locale: 'en', returnUrl: 'https://qa.example/studio/support', ctx: vendorContext(env, 'test', () => NOW), now: NOW });
	return { sql, queue, env, start, drain: () => queue.drain(env) };
}

describe('starting onboarding', () => {
	it('is refused while MEM-D17 is open', async () => {
		const t = await setup({ decided: false });
		await assert.rejects(t.start('ch_1', 'GB'), (e: PayeeError) => e.code === 'decision_open');
	});

	it('follows the Countries page: sanctioned, waitlisted and external-link-only countries can’t start', async () => {
		const t = await setup();
		await assert.rejects(t.start('ch_1', 'IR'), (e: PayeeError) => e.code === 'country_blocked');
		await t.sql.prepare("INSERT INTO support_country_rules (country, supporters, creators, reason, changed_by, changed_at) VALUES ('IQ', 'allowed', 'external_link_only', 'rail_unsupported', 'usr_admin', 'now'), ('PK', 'allowed', 'waitlist', 'legal_review', 'usr_admin', 'now')").run();
		await assert.rejects(t.start('ch_1', 'IQ'), (e: PayeeError) => e.code === 'country_external_link_only');
		await assert.rejects(t.start('ch_1', 'PK'), (e: PayeeError) => e.code === 'country_waitlist');
		await assert.rejects(t.start('ch_1', 'gb'), (e: PayeeError) => e.code === 'invalid_country');
	});

	it('links to the rail’s hosted onboarding; one payee per channel however often it starts', async () => {
		const t = await setup();
		const a = await t.start('ch_1', 'GB');
		const b = await t.start('ch_1', 'GB');
		assert.equal(a.payeeId, b.payeeId);
		assert.match(a.url, /^https:\/\/videos\.api\.qa\.example\/webhooks\/support\/rail\/test\/onboard\/trpe_[0-9a-f]{24}\?return=/);
		assert.equal(t.sql.count('support_payees'), 1);
		assert.equal((await payeeView(t.sql as never, 'ch_1')).status, 'pending');
		assert.equal((await payeeView(t.sql as never, 'ch_none')).status, 'not_started');
	});
});

describe('the test rail’s onboarding page', () => {
	function app(env: unknown) {
		const a = new Hono();
		a.get('/webhooks/support/rail/test/onboard/:ref', handleTestRailOnboardPage);
		a.post('/webhooks/support/rail/test/onboard/:ref', handleTestRailOnboardSubmit);
		return { request: (path: string, init?: RequestInit) => a.request(path, init, env as never) };
	}

	it('finishing it goes through the signed webhook and payee-sync: the payee is active with a form on file, and nothing else is kept', async () => {
		const t = await setup();
		const { url } = await t.start('ch_1', 'GB');
		const path = new URL(url).pathname;
		const page = await app(t.env).request(`${path}?return=${encodeURIComponent('https://qa.example/studio/support')}`);
		assert.equal(page.status, 200);
		assert.match(await page.text(), /No money moves here[\s\S]*لا تنتقل أي أموال/);
		const done = await app(t.env).request(path, { method: 'POST', body: new URLSearchParams({ outcome: 'active', country: 'GB', return: 'https://evil.example/' }) });
		assert.equal(done.status, 303);
		assert.equal(done.headers.get('Location'), 'https://qa.example/studio/support');
		await t.drain();
		const view = await payeeView(t.sql as never, 'ch_1');
		assert.deepEqual({ status: view.status, taxForm: view.taxForm, sanctions: view.sanctions, method: view.method }, { status: 'active', taxForm: 'w8ben', sanctions: 'clear', method: 'bank' });
		const row = await t.sql.prepare('SELECT * FROM support_payees').first<Record<string, unknown>>();
		for (const k of Object.keys(row!)) assert.doesNotMatch(k, /iban|account_number|routing|ssn|tin|document/i);
	});

	it('a screening hold holds the payee’s payouts', async () => {
		const t = await setup();
		const { url } = await t.start('ch_2', 'GB');
		await app(t.env).request(new URL(url).pathname, { method: 'POST', body: new URLSearchParams({ outcome: 'sanctions', country: 'GB', return: '' }) });
		await t.drain();
		const view = await payeeView(t.sql as never, 'ch_2');
		assert.equal(view.sanctions, 'hold');
		assert.equal(view.payoutsHeld, true);
	});

	it('doesn’t exist in production', async () => {
		const t = await setup({ environment: 'production' });
		assert.equal((await app(t.env).request('/webhooks/support/rail/test/onboard/trpe_000000000000000000000000')).status, 404);
	});
});

describe('the Studio API while support is off', () => {
	it('answers 404 feature_off before looking at the channel', async () => {
		const t = await setup();
		const a = new Hono();
		a.use('*', async (c, next) => {
			c.set('userId' as never, 'owner_ch_1' as never);
			await next();
		});
		a.get('/api/channels/:channelId/support/payee', handleSupportPayee);
		a.post('/api/channels/:channelId/support/payee/onboard', handleSupportPayeeOnboard);
		for (const [method, path] of [['GET', '/api/channels/ch_1/support/payee'], ['POST', '/api/channels/ch_1/support/payee/onboard']] as const) {
			const res = await a.request(path, { method, body: method === 'POST' ? JSON.stringify({ country: 'GB' }) : undefined }, t.env as never);
			assert.equal(res.status, 404);
			assert.deepEqual(await res.json(), { success: false, code: 'feature_off', feature: 'creatorSupport' });
		}
		assert.equal(t.sql.count('support_payees'), 0);
	});
});

describe('review fixes (cross-provider review of #1764)', () => {
	it('starting again with another country updates the payee’s country', async () => {
		const t = await setup();
		await t.start('ch_move', 'GB');
		await t.start('ch_move', 'FR');
		assert.equal((await t.sql.prepare("SELECT country FROM support_payees WHERE channel_id = 'ch_move'").first<{ country: string }>())!.country, 'FR');
	});
});
