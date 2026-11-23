/**
 * Unclaimed creator balances (wiki AUN-MEMBERS MEM-D22, owner 2026-11-23): reminders at 3, 6 and 12
 * months; after 12 the available balance moves to the Waqf as a 'dormant_transfer' entry, only with
 * the supportDormantTransfer switch on, every reminder delivered and the last one 14 days old. Held
 * gifts and channels with an active payee never move. Real SQL on the search migrations.
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { forgetFeatureSwitches, money, UNDECIDED_SUPPORT_POLICY, writeFeatureSwitch } from '@al-ummah/shared-types';
import { SqliteD1 } from './search-sqlite-d1';
import { runDormant, markDormantNoticeSent } from '../src/lib/support/dormant';
import { accountTotal, creatorBalance, giftLines, postEntry, releaseLines } from '../src/lib/support/ledger';

const CH = 'ch_quiet';
const DAY = 86_400_000;
const NOW = new Date('2027-12-20T01:00:00.000Z');
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

const realFetch = globalThis.fetch;
let reported: string[] = [];
beforeEach(() => {
	reported = [];
	forgetFeatureSwitches();
	globalThis.fetch = (async (_i: RequestInfo | URL, init?: RequestInit) => {
		reported.push(String(init?.body ?? ''));
		return new Response('{}', { status: 202 });
	}) as typeof fetch;
});
afterEach(() => {
	globalThis.fetch = realFetch;
	forgetFeatureSwitches();
});

async function setup(opts: { giftDaysAgo?: number; available?: number; held?: number; switchOn?: boolean; payeeActive?: boolean } = {}) {
	const db = new SqliteD1();
	const env = { SEARCH_DB: db, ENVIRONMENT: 'qa', ERRORS_INGEST_URL: 'https://admin.api.qa.example/x', INTERNAL_API_KEY: 'k' };
	const at = ago(opts.giftDaysAgo ?? 400);
	await db.prepare("INSERT INTO support_payments (id, supporter_user_id, channel_id, collector, mode, collector_payment_ref, gross, currency, status, created_at, updated_at) VALUES ('spay_1', 'usr_fan', ?, 'test', 'test', 'tpay_1', 1100, 'USD', 'succeeded', ?, ?)").bind(CH, at, at).run();
	const available = opts.available ?? 1000;
	await postEntry(db as never, { entryKey: 'gift:1', kind: 'gift', createdBy: 'system', channelId: CH, lines: giftLines(CH, money(available + (opts.held ?? 0) + 100, 'USD'), money(100, 'USD')) });
	await postEntry(db as never, { entryKey: 'release:1', kind: 'release', createdBy: 'system', channelId: CH, lines: releaseLines(CH, money(available, 'USD')) });
	if (opts.payeeActive) {
		await db.prepare("INSERT INTO support_payees (id, channel_id, owner_user_id, rail, mode, rail_payee_ref, country, status, tax_form, sanctions_status, created_at, updated_at) VALUES ('pe', ?, 'o', 'trolley', 'test', 'tr_1', 'GB', 'active', 'w8ben', 'clear', 'now', 'now')").bind(CH).run();
	}
	if (opts.switchOn) {
		await writeFeatureSwitch(env as never, { key: 'creatorSupport', enabled: true, expectedVersion: 0, actorId: 'usr_super', currentStored: false });
		await writeFeatureSwitch(env as never, { key: 'supportDormantTransfer', enabled: true, expectedVersion: 0, actorId: 'usr_super', currentStored: false });
		forgetFeatureSwitches();
	}
	const run = (now = NOW) => runDormant(env, UNDECIDED_SUPPORT_POLICY, now);
	const sendAll = async (daysAgo: number) => {
		const due = await db.prepare("SELECT cycle_start, months FROM support_dormant_notices WHERE channel_id = ? AND status = 'due'").bind(CH).all<{ cycle_start: string; months: number }>();
		for (const n of due.results ?? []) await markDormantNoticeSent(db as never, CH, n.cycle_start, n.months, new Date(NOW.getTime() - daysAgo * DAY));
	};
	return { db, env, run, sendAll };
}

const notices = async (db: SqliteD1) => (await db.prepare('SELECT months, status FROM support_dormant_notices ORDER BY months').all<{ months: number; status: string }>()).results.map((r) => ({ ...r }));

describe('MEM-D22 unclaimed balances', () => {
	it('records the 3, 6 and 12 month reminders once each as the period reaches them', async () => {
		const t = await setup({ giftDaysAgo: 200 });
		assert.equal((await t.run()).remindersDue, 2);
		assert.deepEqual(await notices(t.db), [{ months: 3, status: 'due' }, { months: 6, status: 'due' }]);
		assert.equal((await t.run()).remindersDue, 0, 'never twice');
		assert.equal((await t.run(new Date(NOW.getTime() + 200 * DAY))).remindersDue, 1);
	});

	it('nothing moves while the transfer switch is off, whatever the reminders say', async () => {
		const t = await setup();
		await t.run();
		await t.sendAll(30);
		const r = await t.run();
		assert.equal(r.transfers, 0);
		assert.equal(r.waiting, 1);
		assert.equal(await accountTotal(t.db as never, 'org:waqf_dormant', 'USD'), 0);
	});

	it('with the switch on it waits for every reminder to be delivered and the last one to be 14 days old', async () => {
		const t = await setup({ switchOn: true });
		assert.equal((await t.run()).transfers, 0, 'reminders recorded, none delivered');
		await t.sendAll(3);
		assert.equal((await t.run()).transfers, 0, 'the last reminder is only 3 days old');
		await t.db.prepare("UPDATE support_dormant_notices SET sent_at = ?").bind(ago(15)).run();
		const r = await t.run();
		assert.equal(r.transfers, 1);
		assert.equal(await accountTotal(t.db as never, 'org:waqf_dormant', 'USD'), -1000, 'owed to the Waqf');
		assert.equal((await creatorBalance(t.db as never, CH)).USD!.available, 0);
		const entry = await t.db.prepare("SELECT kind FROM support_ledger_entries WHERE entry_key LIKE 'dormant:%'").first<{ kind: string }>();
		assert.equal(entry!.kind, 'dormant_transfer');
		assert.equal(t.db.count('support_dormant_transfers'), 1);
		assert.ok(reported.some((b) => b.includes('support-dormant:')), 'finance is asked to move the money');
		assert.equal((await t.run()).transfers, 0, 'once');
	});

	it('held gifts stay with the creator; a channel with an active payee is never dormant', async () => {
		const held = await setup({ switchOn: true, held: 500 });
		await held.run();
		await held.sendAll(30);
		await held.run();
		assert.equal((await creatorBalance(held.db as never, CH)).USD!.pending, 500);
		const paid = await setup({ switchOn: true, payeeActive: true });
		const r = await paid.run();
		assert.equal(r.channels, 0);
		assert.equal(paid.db.count('support_dormant_notices'), 0);
	});

	it('the other policies only remind and list', async () => {
		const t = await setup({ switchOn: true });
		const policy = { ...UNDECIDED_SUPPORT_POLICY, dormantPolicy: 'unclaimedPropertyRule' as const };
		await runDormant(t.env, policy, NOW);
		await t.sendAll(30);
		assert.equal((await runDormant(t.env, policy, NOW)).transfers, 0);
		assert.equal(await accountTotal(t.db as never, 'org:waqf_dormant', 'USD'), 0);
	});

	it('the migration keeps the ledger append-only and accepts Trolley payees', async () => {
		const t = await setup({ payeeActive: true });
		await assert.rejects(t.db.prepare("UPDATE support_ledger SET amount = 1").run());
		await assert.rejects(t.db.prepare('DELETE FROM support_ledger').run());
		assert.equal((await t.db.prepare("SELECT rail FROM support_payees").first<{ rail: string }>())!.rail, 'trolley');
	});
});
