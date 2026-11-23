/**
 * Account erasure stops monthly support at the collector first (wiki AUN-MEMBERS §9.8; cross-provider
 * review of #1758): no charge follows an erasure. When the collector can't be reached the pledge is
 * still marked canceled here (the webhook job stops it on its next renewal). Real SQL; no network.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { money } from '@al-ummah/shared-types';
import { stopSupportBeforeErasure } from '../src/lib/support/erasure';
import { vendorContext, type SupportJobEnv } from '../src/lib/support/jobs';
import { testPay } from '../src/lib/support/test-collector';
import { SqliteD1 } from './search-sqlite-d1';

async function setup(environment = 'qa') {
	const sql = new SqliteD1();
	const env = { SEARCH_DB: sql, ENVIRONMENT: environment, SUPPORT_TEST_PROVIDERS: '1', VIDEOS_API_URL: 'https://videos.api.qa.example' } as unknown as SupportJobEnv;
	const ctx = vendorContext({ ...env, ENVIRONMENT: 'qa' } as SupportJobEnv, 'test');
	const { events } = await testPay(ctx, { checkoutId: 'sco_e', kind: 'monthly', charged: money(1000, 'USD') });
	const pledgeRef = (events[0] as { pledgeRef: string }).pledgeRef;
	await sql.prepare("INSERT INTO support_pledges (id, supporter_user_id, channel_id, collector, mode, collector_pledge_ref, amount, currency, status, started_at, created_at, updated_at) VALUES ('spl_e', 'usr_gone', 'ch_1', 'test', 'test', ?, 1000, 'USD', 'active', 'now', 'now', 'now')").bind(pledgeRef).run();
	return { sql, env, ctx, pledgeRef };
}

describe('erasure stops monthly support', () => {
	it('at the collector, then here', async () => {
		const t = await setup();
		assert.deepEqual(await stopSupportBeforeErasure(t.env, 'usr_gone', () => t.ctx), { stopped: 1, unreachable: 0 });
		assert.equal((await t.ctx.testState!.get<{ status: string }>(`collector:pledge:${t.pledgeRef}`))!.status, 'canceled');
		assert.deepEqual({ ...(await t.sql.prepare('SELECT status, cancel_reason FROM support_pledges').first()) }, { status: 'canceled', cancel_reason: 'erasure' });
		assert.deepEqual(await stopSupportBeforeErasure(t.env, 'usr_gone', () => t.ctx), { stopped: 0, unreachable: 0 }, 'a second run changes nothing');
	});

	it('when the collector can’t be reached, the erasure goes on and the pledge is canceled here', async () => {
		const t = await setup('production');
		assert.deepEqual(await stopSupportBeforeErasure(t.env, 'usr_gone', () => t.ctx), { stopped: 0, unreachable: 1 });
		assert.equal((await t.sql.prepare('SELECT status FROM support_pledges').first<{ status: string }>())!.status, 'canceled');
	});
});
