/**
 * Creator-support ledger (wiki AUN-MEMBERS §9.3, MEM-3): real SQL on the search migrations.
 * Double entry, append-only (the database refuses UPDATE/DELETE), idempotent posting, balances
 * from sums, and the owner decisions MEM-D20 / MEM-D21 as parameters that refuse while open.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { money } from '@al-ummah/shared-types';
import { accountTotal, creatorBalance, debitCreator, disputeLines, disputeWonLines, giftLines, LedgerError, payoutFailedLines, payoutPaidLines, payoutReturnedLines, payoutSentLines, postEntry, railFundingLines, refundLines, releaseLines, settlementLines, unbalancedEntries, validateEntry } from '../src/lib/support/ledger';
import { SqliteD1 } from './search-sqlite-d1';

const usd = (n: number) => money(n, 'USD');
const CH = 'ch_amina';
const sys = { createdBy: 'system' } as const;
const db = () => new SqliteD1() as never as import('@al-ummah/shared-types').SearchDb & SqliteD1;

describe('validation', () => {
	it('refuses unbalanced, empty, fractional and unknown lines', () => {
		assert.throws(() => validateEntry([]), (e: LedgerError) => e.code === 'empty');
		assert.throws(() => validateEntry([{ account: 'bank:creator_funds', amount: 5, currency: 'USD' }]), (e: LedgerError) => e.code === 'unbalanced');
		assert.throws(() => validateEntry([{ account: 'bank:creator_funds', amount: 0.5, currency: 'USD' }, { account: 'rail:funding', amount: -0.5, currency: 'USD' }]), (e: LedgerError) => e.code === 'invalid_line');
		assert.throws(() => validateEntry([{ account: 'platform:cut' as never, amount: 5, currency: 'USD' }, { account: 'rail:funding', amount: -5, currency: 'USD' }]), (e: LedgerError) => e.code === 'invalid_line');
		// Balanced per currency, not across currencies
		assert.throws(() => validateEntry([{ account: 'bank:creator_funds', amount: 5, currency: 'USD' }, { account: 'rail:funding', amount: -5, currency: 'EUR' }]), (e: LedgerError) => e.code === 'unbalanced');
	});
});

describe('posting', () => {
	it('a gift, its release, settlement and a payout: balances follow the spec example', async () => {
		const d = db();
		await postEntry(d, { ...sys, entryKey: 'gift:p1', kind: 'gift', lines: giftLines(CH, usd(500), usd(45)), channelId: CH, refTable: 'support_payments', refId: 'p1' });
		assert.deepEqual((await creatorBalance(d, CH)).USD, { pending: 455, available: 0, in_payout: 0, reserve: 0 });
		await postEntry(d, { ...sys, entryKey: 'settle:s1', kind: 'settlement', lines: settlementLines(usd(455)) });
		await postEntry(d, { ...sys, entryKey: 'release:p1', kind: 'release', lines: releaseLines(CH, usd(455)), channelId: CH });
		assert.deepEqual((await creatorBalance(d, CH)).USD, { pending: 0, available: 455, in_payout: 0, reserve: 0 });
		await postEntry(d, { ...sys, entryKey: 'fund:f1', kind: 'rail_funding', lines: railFundingLines(usd(455)) });
		await postEntry(d, { ...sys, entryKey: 'payout:po1:sent', kind: 'payout', lines: payoutSentLines(CH, usd(400)), channelId: CH });
		assert.deepEqual((await creatorBalance(d, CH)).USD, { pending: 0, available: 55, in_payout: 400, reserve: 0 });
		await postEntry(d, { ...sys, entryKey: 'payout:po1:paid', kind: 'payout_paid', lines: payoutPaidLines(CH, usd(400), usd(10), 'creatorFromPayout'), channelId: CH });
		assert.deepEqual((await creatorBalance(d, CH)).USD, { pending: 0, available: 55, in_payout: 0, reserve: 0 });
		assert.equal(await accountTotal(d, 'rail:funding', 'USD'), 455 - 390);
		assert.equal(await accountTotal(d, 'fees:rail', 'USD'), -10);
		assert.equal(await accountTotal(d, 'clearing:collector', 'USD'), 45); // the fee PayGood netted
		assert.equal(await unbalancedEntries(d), 0);
	});

	it('posting the same key twice writes nothing new', async () => {
		const d = db();
		const a = await postEntry(d, { ...sys, entryKey: 'gift:p1', kind: 'gift', lines: giftLines(CH, usd(500), usd(45)), channelId: CH });
		const b = await postEntry(d, { ...sys, entryKey: 'gift:p1', kind: 'gift', lines: giftLines(CH, usd(500), usd(45)), channelId: CH });
		assert.equal(a.created, true);
		assert.equal(b.created, false);
		assert.equal(a.entryId, b.entryId);
		assert.equal(d.count('support_ledger'), 3);
	});

	it('the database refuses to edit or delete ledger lines', async () => {
		const d = db();
		await postEntry(d, { ...sys, entryKey: 'gift:p1', kind: 'gift', lines: giftLines(CH, usd(500), usd(45)), channelId: CH });
		await assert.rejects(d.prepare('UPDATE support_ledger SET amount = 1').run(), /append-only/);
		await assert.rejects(d.prepare('DELETE FROM support_ledger').run(), /append-only/);
		await assert.rejects(d.prepare('DELETE FROM support_ledger_entries').run(), /append-only/);
		assert.equal(d.count('support_ledger'), 3);
	});

	it('an entry that fails half way leaves nothing behind', async () => {
		const d = db();
		await d.prepare("INSERT INTO support_ledger (id, entry_id, entry_key, account, amount, currency, kind, created_by, created_at) VALUES ('le_clash_1', 'x', 'k', 'bank:creator_funds', 1, 'USD', 'adjustment', 'system', 'now')").run();
		// Forge an id clash on the second line by posting with a fixed random id is impossible; instead clash the entry row
		await d.prepare("INSERT INTO support_ledger_entries (entry_key, entry_id, kind, created_by, created_at) VALUES ('other', 'le_clash', 'adjustment', 'system', 'now')").run();
		const before = d.count('support_ledger');
		const origRandom = crypto.randomUUID;
		(crypto as { randomUUID: () => string }).randomUUID = () => 'clash' as never;
		try {
			await assert.rejects(postEntry(d, { ...sys, entryKey: 'gift:p9', kind: 'gift', lines: giftLines(CH, usd(500), usd(45)), channelId: CH }));
		} finally {
			(crypto as { randomUUID: () => string }).randomUUID = origRandom;
		}
		assert.equal(d.count('support_ledger'), before);
	});
});

describe('owner decisions are parameters', () => {
	const owed = { pending: 100, available: 50, in_payout: 0, reserve: 0 };

	it('MEM-D21: taking more than is owed refuses while the decision is open', () => {
		assert.throws(() => debitCreator(CH, usd(200), owed, null), (e: LedgerError) => e.code === 'decision_open');
		// Within what is owed, no decision is needed
		assert.doesNotThrow(() => validateEntry([...debitCreator(CH, usd(120), owed, null), { account: 'clearing:collector', amount: -120, currency: 'USD' }]));
	});

	it('MEM-D21 "net against future gifts": the available balance goes negative', async () => {
		const d = db();
		await postEntry(d, { ...sys, entryKey: 'gift:p1', kind: 'gift', lines: giftLines(CH, usd(500), usd(45)), channelId: CH });
		const bal = (await creatorBalance(d, CH)).USD!;
		await postEntry(d, { ...sys, entryKey: 'refund:r1', kind: 'refund', lines: refundLines(CH, usd(500), bal, 'netAgainstFutureGifts'), channelId: CH });
		assert.deepEqual((await creatorBalance(d, CH)).USD, { pending: 0, available: -45, in_payout: 0, reserve: 0 });
		assert.equal(await unbalancedEntries(d), 0);
	});

	it('MEM-D21 "organization absorbs": the shortfall is a write-off, the creator never goes negative', async () => {
		const d = db();
		await postEntry(d, { ...sys, entryKey: 'gift:p1', kind: 'gift', lines: giftLines(CH, usd(500), usd(45)), channelId: CH });
		const bal = (await creatorBalance(d, CH)).USD!;
		await postEntry(d, { ...sys, entryKey: 'dispute:d1', kind: 'dispute', lines: disputeLines(CH, usd(500), usd(1500), bal, 'organizationAbsorbs'), channelId: CH });
		assert.deepEqual((await creatorBalance(d, CH)).USD, { pending: 0, available: 0, in_payout: 0, reserve: 0 });
		assert.equal(await accountTotal(d, 'loss:org_reserve', 'USD'), 2000 - 455);
		// Won: the organization's write-off is repaid first (review of #1758); the creator gets the rest
		await postEntry(d, { ...sys, entryKey: 'dispute:d1:won', kind: 'dispute_reversal', lines: disputeWonLines(CH, usd(500), usd(0), usd(2000 - 455)), channelId: CH });
		assert.equal((await creatorBalance(d, CH)).USD!.available, 0);
		assert.equal(await accountTotal(d, 'loss:org_reserve', 'USD'), 2000 - 455 - 500);
		assert.equal(await unbalancedEntries(d), 0);
	});

	it('MEM-D20: payout fee bearer changes who pays the rail fee; open refuses', async () => {
		assert.throws(() => payoutPaidLines(CH, usd(4000), usd(100), null), (e: LedgerError) => e.code === 'decision_open');
		const org = payoutPaidLines(CH, usd(4000), usd(100), 'organization');
		validateEntry(org);
		assert.equal(org.find((l) => l.account === 'rail:funding')!.amount, -4000);
		const creator = payoutPaidLines(CH, usd(4000), usd(100), 'creatorFromPayout');
		assert.equal(creator.find((l) => l.account === 'rail:funding')!.amount, -3900);
	});

	it('failed and returned payouts put the money back', async () => {
		const d = db();
		await postEntry(d, { ...sys, entryKey: 'gift:p1', kind: 'gift', lines: giftLines(CH, usd(1045), usd(45)), channelId: CH });
		await postEntry(d, { ...sys, entryKey: 'release:p1', kind: 'release', lines: releaseLines(CH, usd(1000)), channelId: CH });
		await postEntry(d, { ...sys, entryKey: 'po:sent', kind: 'payout', lines: payoutSentLines(CH, usd(1000)), channelId: CH });
		await postEntry(d, { ...sys, entryKey: 'po:failed', kind: 'payout_return', lines: payoutFailedLines(CH, usd(1000)), channelId: CH });
		assert.equal((await creatorBalance(d, CH)).USD!.available, 1000);
		await postEntry(d, { ...sys, entryKey: 'po2:sent', kind: 'payout', lines: payoutSentLines(CH, usd(1000)), channelId: CH });
		await postEntry(d, { ...sys, entryKey: 'po2:paid', kind: 'payout_paid', lines: payoutPaidLines(CH, usd(1000), usd(20), 'creatorFromPayout'), channelId: CH });
		await postEntry(d, { ...sys, entryKey: 'po2:returned', kind: 'payout_return', lines: payoutReturnedLines(CH, usd(980)), channelId: CH });
		assert.equal((await creatorBalance(d, CH)).USD!.available, 980);
		assert.equal(await unbalancedEntries(d), 0);
	});
});

describe('the sanctions seed', () => {
	it('blocks the embargoed countries and nothing else', async () => {
		const d = db();
		const rows = await d.prepare('SELECT country FROM support_country_rules ORDER BY country').all<{ country: string }>();
		assert.deepEqual(rows.results.map((r) => r.country), ['CU', 'IR', 'KP']);
	});
});

describe('support settings (owner decisions)', () => {
	it('reads every decision as open until written, and refuses invalid or stale writes', async () => {
		const { readSupportConfig, writeSupportPolicy, SupportConfigError } = await import('../src/lib/support/config');
		const d = db();
		const c0 = await readSupportConfig(d);
		assert.equal(c0.version, 0);
		assert.equal(c0.organizationFormed, false);
		assert.ok(Object.values(c0.policy).every((v) => v === null));
		const w = await writeSupportPolicy(d, { holdDays: 30 }, 'usr_finance', 0);
		assert.equal(w.before.holdDays, null);
		assert.equal(w.after.holdDays, 30);
		assert.equal((await readSupportConfig(d)).policy.holdDays, 30);
		await assert.rejects(writeSupportPolicy(d, { holdDays: 14 }, 'usr_other', 0), (e: InstanceType<typeof SupportConfigError>) => e.code === 'stale');
		await assert.rejects(writeSupportPolicy(d, { payoutDayOfMonth: 31 }, 'usr_finance', 1), (e: InstanceType<typeof SupportConfigError>) => e.code === 'invalid' && e.problems[0].field === 'payoutDayOfMonth');
		// Re-opening a decision is allowed
		await writeSupportPolicy(d, { holdDays: null }, 'usr_finance', 1);
		assert.equal((await readSupportConfig(d)).policy.holdDays, null);
	});

});

describe('test adapter state in D1', () => {
	it('round-trips and lists by prefix without LIKE', async () => {
		const { d1TestState, testStateFor } = await import('../src/lib/support/d1-test-state');
		const d = db();
		const s = d1TestState(d);
		await s.put('rail:funding:USD', { amount: 5, currency: 'USD' });
		await s.put('rail:funding:EUR', { amount: 7, currency: 'EUR' });
		await s.put('rail:payee:x', { a: 1 });
		assert.deepEqual(await s.get('rail:funding:USD'), { amount: 5, currency: 'USD' });
		assert.equal((await s.list('rail:funding:')).length, 2);
		assert.equal(testStateFor({ ENVIRONMENT: 'production', SUPPORT_TEST_PROVIDERS: '1', SEARCH_DB: d }), undefined);
		assert.ok(testStateFor({ ENVIRONMENT: 'qa', SUPPORT_TEST_PROVIDERS: '1', SEARCH_DB: d }));
	});
});

describe('supportCanTurnOn (the Features page precondition)', () => {
	it('is not ready on a fresh database, and lists why', async () => {
		const { supportCanTurnOn } = await import('../src/lib/support/readiness');
		const d = db();
		const r = await supportCanTurnOn({ SEARCH_DB: d, ENVIRONMENT: 'qa', SUPPORT_TEST_PROVIDERS: '1' });
		assert.equal(r.ready, false);
		assert.deepEqual(r.blockers, ['organization_not_formed', 'no_finance_approver', 'decisions_open', 'no_rail']);
		assert.equal((await supportCanTurnOn({})).ready, false);
	});

	it('is ready on QA once everything is recorded, and never in production with test adapters', async () => {
		const { supportCanTurnOn } = await import('../src/lib/support/readiness');
		const { writeSupportPolicy } = await import('../src/lib/support/config');
		const d = db();
		await writeSupportPolicy(d, { primaryRail: 'test', fallbackRail: 'none', holdDays: 1, payoutThresholdUsdMinor: 100, payoutDayOfMonth: 15, creatorMayRaiseThreshold: true, payoutFeeBearer: 'creatorFromPayout', negativeBalancePolicy: 'netAgainstFutureGifts', dormantPolicy: 'unclaimedPropertyRule', dormantReminderMonths: [3, 6, 12], collectBeforePayeeActive: false, batchApprovers: 1, adjustmentApprovers: 1, collectorFeePayer: 'creatorSupporterMayCover', amounts: { USD: { minimum: 300, presets: [500, 1000] } }, minSupporterAge: 18, minCreatorAge: 18, receiversRule: 'everyAdultOwner', appsEnabled: false }, 'usr_fin', 0);
		await d.prepare("UPDATE support_config SET organisation_formed = 1 WHERE id = 'default'").run();
		await d.prepare("INSERT INTO support_finance_members (user_id, roles, added_by, approved_by, added_at) VALUES ('usr_fin', '[\"support:payouts\"]', 'usr_board', 'usr_board2', 'now')").run();
		assert.equal((await supportCanTurnOn({ SEARCH_DB: d, ENVIRONMENT: 'qa', SUPPORT_TEST_PROVIDERS: '1' })).ready, true);
		assert.deepEqual((await supportCanTurnOn({ SEARCH_DB: d, ENVIRONMENT: 'production', SUPPORT_TEST_PROVIDERS: '1' })).blockers, ['no_collector', 'no_rail']);
	});
});

describe('readiness needs a fee for every method (cross-provider review of #1810)', () => {
	it('a method-only fee schedule leaves the currency unpriced; a method-wide one prices it', async () => {
		const { collectorFeesKnown } = await import('@al-ummah/shared-types');
		const { addFeeSchedule } = await import('../src/lib/support/fees');
		const d = db();
		const past = '2026-01-01T00:00:00.000Z';
		await addFeeSchedule(d, { kind: 'collector', provider: 'paygood', currency: 'USD', method: 'card', basisPoints: 290, fixedMinor: 30, effectiveFrom: past }, 'usr_fin');
		assert.equal(await collectorFeesKnown(d, 'paygood', ['USD']), false, 'card only');
		await addFeeSchedule(d, { kind: 'collector', provider: 'paygood', currency: 'USD', method: null, basisPoints: 290, fixedMinor: 30, effectiveFrom: past }, 'usr_fin');
		assert.equal(await collectorFeesKnown(d, 'paygood', ['USD']), true);
		assert.equal(await collectorFeesKnown(d, 'paygood', ['USD', 'EUR']), false, 'every currency');
	});
});

describe('the FEAT-4 hook shape', () => {
	it('answers ok=false with the first reason, in en and ar', async () => {
		const { supportCanTurnOnHook, SUPPORT_TURN_ON_REASONS } = await import('../src/lib/support/readiness');
		const r = await supportCanTurnOnHook({ SEARCH_DB: db(), ENVIRONMENT: 'qa', SUPPORT_TEST_PROVIDERS: '1' });
		assert.equal(r.ok, false);
		assert.ok(!r.ok && r.reasonKey === 'organization_not_formed' && r.reason.ar.length > 0);
		for (const t of Object.values(SUPPORT_TURN_ON_REASONS)) {
			assert.ok(t.en && t.ar);
			assert.doesNotMatch(t.ar, /[0-9]|فيديو/);
			assert.doesNotMatch(t.en, /'/);
		}
	});
});

describe('readiness counts only real approvers (cross-provider review of #1757, #1773)', () => {
	it('members without support:payouts, or marked tech staff, don’t count', async () => {
		const { supportCanTurnOn } = await import('../src/lib/support/readiness');
		const d = db();
		await d.prepare("INSERT INTO support_finance_members (user_id, roles, added_by, approved_by, added_at) VALUES ('a', '[\"support:refund\"]', 'x', 'y', 'now'), ('b', '[\"support:payouts\"]', 'x', 'y', 'now')").run();
		await d.prepare("INSERT INTO support_tech_staff (user_id, marked_by, marked_at) VALUES ('b', 'x', 'now')").run();
		assert.ok((await supportCanTurnOn({ SEARCH_DB: d, ENVIRONMENT: 'qa', SUPPORT_TEST_PROVIDERS: '1' })).blockers.includes('no_finance_approver'));
	});

	it('an unreadable database is not ready (fails closed)', async () => {
		const { supportCanTurnOn } = await import('../src/lib/support/readiness');
		const broken = { prepare: () => { throw new Error('D1 down'); }, batch: async () => [] };
		assert.equal((await supportCanTurnOn({ SEARCH_DB: broken as never, ENVIRONMENT: 'qa', SUPPORT_TEST_PROVIDERS: '1' })).ready, false);
	});
});
