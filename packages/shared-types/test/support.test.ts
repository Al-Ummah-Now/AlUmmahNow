/**
 * Creator support money and policy rules (wiki AUN-MEMBERS §5.4, §9.3, §15): integer minor units,
 * explicit currency, explicit rounding, 0% to the platform, and every open owner decision unset.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as s from '../src/support.ts';

const usd = (n: number) => s.money(n, 'USD');

test('money refuses fractions, unsafe integers and unknown currencies', () => {
  assert.throws(() => s.money(1.5, 'USD'), s.MoneyError);
  assert.throws(() => s.money(Number.MAX_SAFE_INTEGER + 1, 'USD'), s.MoneyError);
  assert.throws(() => s.money(100, 'XXX'), s.MoneyError);
  assert.deepEqual(s.money(500, 'USD'), { amount: 500, currency: 'USD' });
});

test('arithmetic never mixes currencies', () => {
  assert.deepEqual(s.addMoney(usd(100), usd(250)), usd(350));
  assert.deepEqual(s.subMoney(usd(100), usd(250)), usd(-150));
  assert.throws(() => s.addMoney(usd(1), s.money(1, 'EUR')), /Currency mismatch/);
  assert.deepEqual(s.sumMoney('USD', [usd(1), usd(2), usd(3)]), usd(6));
  assert.deepEqual(s.negateMoney(usd(0)), usd(0));
});

test('divRound rounds explicitly, including negatives', () => {
  assert.equal(s.divRound(10, 4, 'down'), 2);
  assert.equal(s.divRound(10, 4, 'up'), 3);
  assert.equal(s.divRound(10, 4, 'halfUp'), 3);
  assert.equal(s.divRound(9, 4, 'halfUp'), 2);
  assert.equal(s.divRound(-10, 4, 'up'), -2);
  assert.equal(s.divRound(-10, 4, 'down'), -3);
  assert.equal(s.divRound(12, 4, 'up'), 3);
});

test('basis points are integer maths', () => {
  assert.deepEqual(s.basisPoints(usd(500), 290, 'up'), usd(15)); // 14.5 → 15
  assert.deepEqual(s.basisPoints(usd(500), 290, 'down'), usd(14));
  assert.throws(() => s.basisPoints(usd(1), 10_001, 'up'));
});

test('major strings parse and print without floats', () => {
  assert.deepEqual(s.parseMajor('5.00', 'USD'), usd(500));
  assert.deepEqual(s.parseMajor('0.1', 'USD'), usd(10));
  assert.deepEqual(s.parseMajor('7', 'JPY'), s.money(7, 'JPY'));
  assert.deepEqual(s.parseMajor('1.234', 'KWD'), s.money(1234, 'KWD'));
  assert.throws(() => s.parseMajor('1.234', 'USD'), /Too many decimals/);
  assert.throws(() => s.parseMajor('1e3', 'USD'));
  assert.equal(s.toMajorString(usd(5)), '0.05');
  assert.equal(s.toMajorString(usd(-1234)), '-12.34');
  assert.equal(s.toMajorString(s.money(1234, 'KWD')), '1.234');
  assert.equal(s.toMajorString(s.money(7, 'JPY')), '7');
  // 0.1 + 0.2 never appears: 10 + 20 minor units is exactly 30
  assert.equal(s.toMajorString(s.addMoney(s.parseMajor('0.1', 'USD'), s.parseMajor('0.2', 'USD'))), '0.30');
});

test('the breakdown: the platform takes nothing and the creator gets the rest', () => {
  const fee = { basisPoints: 290, fixed: usd(30) };
  const b = s.quoteGift({ gift: usd(500), fee, supporterCovers: false });
  assert.deepEqual(b.charged, usd(500));
  assert.deepEqual(b.platformFee, usd(0));
  assert.deepEqual(b.collectorFee, usd(45)); // 14.5 → 15, + 30
  assert.deepEqual(b.creatorReceives, usd(455));
  assert.deepEqual(b.coverFees, usd(0));
});

test('covering the fees grosses up so the creator receives at least the gift', () => {
  const fee = { basisPoints: 290, fixed: usd(30) };
  for (const amount of [100, 300, 500, 1000, 2500, 99_999]) {
    const b = s.quoteGift({ gift: usd(amount), fee, supporterCovers: true });
    assert.ok(b.creatorReceives.amount >= amount, `${amount}: ${b.creatorReceives.amount}`);
    assert.ok(b.creatorReceives.amount <= amount + 1, `${amount}: overshoot ${b.creatorReceives.amount}`);
    assert.equal(b.charged.amount, b.gift.amount + b.coverFees.amount);
    assert.equal(b.platformFee.amount, 0);
  }
});

test('tax, when set, is on top and never reaches the creator', () => {
  const b = s.quoteGift({ gift: usd(1000), fee: { basisPoints: 0, fixed: usd(0) }, supporterCovers: false, taxBasisPoints: 500 });
  assert.deepEqual(b.tax, usd(50));
  assert.deepEqual(b.charged, usd(1050));
  assert.deepEqual(b.creatorReceives, usd(1000));
});

test('MEM-D3 is a setting: open = no checkout', () => {
  assert.equal(s.effectiveCoverFees(null, true), null);
  assert.equal(s.effectiveCoverFees('supporterAlways', false), true);
  assert.equal(s.effectiveCoverFees('creatorAlways', true), false);
  assert.equal(s.effectiveCoverFees('creatorSupporterMayCover', true), true);
});

test('every owner decision starts undecided', () => {
  const open = s.undecidedSupportDecisions(s.UNDECIDED_SUPPORT_POLICY);
  for (const id of ['MEM-D17', 'MEM-D18', 'MEM-D19', 'MEM-D20', 'MEM-D21', 'MEM-D22', 'MEM-D23', 'MEM-D24']) assert.ok(open.includes(id as s.SupportDecisionId), id);
  for (const v of Object.values(s.UNDECIDED_SUPPORT_POLICY)) assert.equal(v, null);
});

test('policy parsing keeps nulls, refuses bad values and never fills a default', () => {
  const { policy, problems } = s.parseSupportPolicy({ holdDays: 30, payoutDayOfMonth: 31, primaryRail: 'stripe', bogus: 1 });
  assert.equal(policy.holdDays, 30);
  assert.equal(policy.payoutDayOfMonth, null);
  assert.equal(policy.primaryRail, null);
  assert.deepEqual(problems.map((p) => p.field).sort(), ['payoutDayOfMonth', 'primaryRail']);
  assert.ok(!('bogus' in policy));
  assert.ok(s.parseSupportPolicy({ amounts: { USD: { minimum: 300, presets: [100] } } }).problems.some((p) => p.field === 'amounts'));
  assert.ok(s.parseSupportPolicy({ primaryRail: 'wise', fallbackRail: 'wise' }).problems.some((p) => p.field === 'fallbackRail'));
});

test('MEM-D21 reserve option needs its numbers', () => {
  const decided = s.parseSupportPolicy({ negativeBalancePolicy: 'reserveFromPayouts' }).policy;
  assert.ok(s.undecidedSupportDecisions(decided).includes('MEM-D21'));
  const full = s.parseSupportPolicy({ negativeBalancePolicy: 'reserveFromPayouts', reserveBasisPoints: 1000, reserveDays: 90 }).policy;
  assert.ok(!s.undecidedSupportDecisions(full).includes('MEM-D21'));
});

test('ledger accounts are a closed chart', () => {
  assert.equal(s.creatorAccount('ch_1', 'pending'), 'creator:ch_1:pending');
  assert.throws(() => s.creatorAccount('a:b', 'pending'));
  assert.ok(s.isLedgerAccount('bank:creator_funds'));
  assert.ok(s.isLedgerAccount('creator:ch_1:in_payout'));
  assert.ok(!s.isLedgerAccount('creator:ch_1:spent'));
  assert.ok(!s.isLedgerAccount('platform:revenue'));
});

test('no Stripe anywhere', () => {
  assert.ok(!s.PAYOUT_RAIL_IDS.some((id) => /stripe/i.test(id)));
  assert.ok(!s.SUPPORT_COLLECTOR_IDS.some((id) => /stripe/i.test(id)));
});

test('review of #1757: the card fee is on everything charged, and a gift the fee would swallow is refused', () => {
  const fee = { basisPoints: 1000, fixed: usd(0) };
  const b = s.quoteGift({ gift: usd(1000), fee, supporterCovers: false, taxBasisPoints: 1000 });
  assert.deepEqual(b.charged, usd(1100));
  assert.deepEqual(b.collectorFee, usd(110));
  assert.deepEqual(b.creatorReceives, usd(890));
  const covered = s.quoteGift({ gift: usd(1000), fee, supporterCovers: true, taxBasisPoints: 1000 });
  assert.ok(covered.creatorReceives.amount >= 1000);
  assert.throws(() => s.quoteGift({ gift: usd(30), fee: { basisPoints: 290, fixed: usd(30) }, supporterCovers: false }), /more than the card fee/);
});

test('O43 settings: amounts per currency, 18+ only, fee entries checked, presets never applied by themselves', () => {
  const ok = s.parseSupportPolicy({ amounts: { USD: { minimum: 300, presets: [500, 1000] }, EUR: { minimum: 200, presets: [200] } } });
  assert.equal(ok.problems.length, 0);
  assert.ok(s.parseSupportPolicy({ amounts: { XXX: { minimum: 1, presets: [1] } } }).problems.length);
  assert.ok(s.parseSupportPolicy({ amounts: {} }).problems.length);
  assert.ok(s.parseSupportPolicy({ minSupporterAge: 16 }).problems.some((p) => p.field === 'minSupporterAge'));
  assert.ok(s.parseSupportPolicy({ minCreatorAge: 17 }).problems.some((p) => p.field === 'minCreatorAge'));
  assert.deepEqual(s.feeScheduleProblems({ kind: 'collector', provider: 'paygood', currency: 'USD', method: 'card', basisPoints: 290, fixedMinor: 30, effectiveFrom: '2026-12-01T00:00:00Z' }), []);
  assert.deepEqual(s.feeScheduleProblems({ kind: 'collector', provider: 'Stripe!', currency: 'USD', basisPoints: 2.9, fixedMinor: -1, effectiveFrom: 'soon' }).sort(), ['basisPoints', 'effectiveFrom', 'fixedMinor', 'provider']);
  assert.ok(s.FEE_PRESETS.every((p) => !/stripe/i.test(p.provider)));
  assert.ok(s.supportReadiness({ organizationFormed: true, financeApprovers: 2, policy: s.UNDECIDED_SUPPORT_POLICY, collectorAvailable: true, railAvailable: true, feesKnown: false }).blockers.includes('no_fees'));
});
