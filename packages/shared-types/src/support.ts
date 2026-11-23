/**
 * Supporting creators (wiki AUN-MEMBERS, Linear AUN-612; decisions O41, O42).
 *
 * Viewers give a creator a one-time or monthly gift. PayGood only COLLECTS into the
 * organization's merchant account; creators are paid through a separate payout rail. The
 * platform takes 0%: no cut, no margin, no float. Everything here is off by default behind the
 * `creatorSupport` switch (AUN-FEATURES) and stays off until the organization exists.
 *
 * Money rules (never broken):
 * - amounts are integers in the currency's minor units, with the ISO 4217 code alongside;
 * - no floating-point arithmetic on amounts: fees use integer basis points, rounding is explicit;
 * - every provider call carries an idempotency key; balances are sums over an append-only ledger.
 *
 * Open owner decisions (MEM-D17 to MEM-D24, and the earlier MEM-D3 to MEM-D10) are NOT answered in
 * code. Each one is a field of `SupportPolicy` whose value starts as `null` (undecided). While any
 * field is null, `creatorSupport` can't be switched on (`supportReadiness`).
 */
// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/**
 * Currencies support can hold, with their ISO 4217 minor-unit exponent. A currency outside this
 * list is refused before anything is stored. Add a code here (with its exponent) to allow it.
 */
export const SUPPORT_CURRENCY_EXPONENTS = Object.freeze({
  USD: 2,
  CAD: 2,
  EUR: 2,
  GBP: 2,
  AUD: 2,
  SAR: 2,
  AED: 2,
  QAR: 2,
  EGP: 2,
  MYR: 2,
  IDR: 2,
  PKR: 2,
  TRY: 2,
  JPY: 0,
  KWD: 3,
  BHD: 3,
  OMR: 3,
  JOD: 3,
} as const);

export type SupportCurrency = keyof typeof SUPPORT_CURRENCY_EXPONENTS;

export function isSupportCurrency(value: unknown): value is SupportCurrency {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SUPPORT_CURRENCY_EXPONENTS, value);
}

/** An amount of money: an integer count of the currency's minor units (cents, fils, …). */
export interface Money {
  amount: number;
  currency: SupportCurrency;
}

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

/** Builds a Money, refusing fractions, unsafe integers and unknown currencies. */
export function money(amount: number, currency: string): Money {
  if (!Number.isSafeInteger(amount)) throw new MoneyError(`Amount must be a safe integer of minor units, got ${amount}`);
  if (!isSupportCurrency(currency)) throw new MoneyError(`Unsupported currency: ${currency}`);
  return { amount, currency };
}

function sameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) throw new MoneyError(`Currency mismatch: ${a.currency} and ${b.currency}`);
}

function safe(n: number): number {
  if (!Number.isSafeInteger(n)) throw new MoneyError('Amount overflow');
  return n;
}

export const addMoney = (a: Money, b: Money): Money => (sameCurrency(a, b), { amount: safe(a.amount + b.amount), currency: a.currency });
export const subMoney = (a: Money, b: Money): Money => (sameCurrency(a, b), { amount: safe(a.amount - b.amount), currency: a.currency });
export const negateMoney = (a: Money): Money => ({ amount: a.amount === 0 ? 0 : -a.amount, currency: a.currency });
export const zeroMoney = (currency: SupportCurrency): Money => ({ amount: 0, currency });

/** Sum of amounts that must all share `currency`. */
export function sumMoney(currency: SupportCurrency, items: readonly Money[]): Money {
  return items.reduce((acc, m) => addMoney(acc, m), zeroMoney(currency));
}

/** How a fractional minor unit is settled. Explicit everywhere a fee is computed. */
export type Rounding = 'up' | 'down' | 'halfUp';

/** Integer division with explicit rounding, for non-negative numerators. */
export function divRound(numerator: number, denominator: number, rounding: Rounding): number {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator <= 0) throw new MoneyError('Invalid division');
  if (numerator < 0) return -divRound(-numerator, denominator, rounding === 'up' ? 'down' : rounding === 'down' ? 'up' : 'halfUp');
  const q = Math.floor(numerator / denominator);
  const r = numerator - q * denominator;
  if (r === 0) return q;
  if (rounding === 'down') return q;
  if (rounding === 'up') return q + 1;
  return r * 2 >= denominator ? q + 1 : q;
}

/** `bp` basis points (1/100 of a percent) of `amount`, in the same currency. */
export function basisPoints(m: Money, bp: number, rounding: Rounding): Money {
  if (!Number.isSafeInteger(bp) || bp < 0 || bp > 10_000) throw new MoneyError(`Basis points out of range: ${bp}`);
  return { amount: divRound(safe(m.amount * bp), 10_000, rounding), currency: m.currency };
}

/** "5.00" → 500 (USD). Parses a major-unit decimal string without floats; refuses extra decimals. */
export function parseMajor(text: string, currency: string): Money {
  if (!isSupportCurrency(currency)) throw new MoneyError(`Unsupported currency: ${currency}`);
  const exp = SUPPORT_CURRENCY_EXPONENTS[currency];
  const m = /^(-)?(\d{1,13})(?:\.(\d+))?$/.exec(text.trim());
  if (!m) throw new MoneyError(`Not an amount: ${text}`);
  const frac = m[3] ?? '';
  if (frac.length > exp) throw new MoneyError(`Too many decimals for ${currency}: ${text}`);
  const minor = Number(m[2] + frac.padEnd(exp, '0'));
  return money(m[1] ? -minor : minor, currency);
}

/** 500 USD → "5.00". The decimal string of a Money in major units (no floats involved). */
export function toMajorString(m: Money): string {
  const exp = SUPPORT_CURRENCY_EXPONENTS[m.currency];
  const neg = m.amount < 0;
  const digits = String(Math.abs(m.amount)).padStart(exp + 1, '0');
  const whole = exp === 0 ? digits : digits.slice(0, digits.length - exp);
  const frac = exp === 0 ? '' : `.${digits.slice(digits.length - exp)}`;
  return `${neg ? '-' : ''}${whole}${frac}`;
}

// ---------------------------------------------------------------------------
// Owner decisions → policy (never hard-coded)
// ---------------------------------------------------------------------------

/** Payout rails an adapter exists for. 'test' moves no money and exists only on QA and the local stack. */
export const PAYOUT_RAIL_IDS = ['wise', 'paypal-payouts', 'trolley', 'test'] as const;
export type PayoutRailId = (typeof PAYOUT_RAIL_IDS)[number];

/** Collectors (who takes the supporter's payment). PayGood only (O42); 'test' for QA and local. */
export const SUPPORT_COLLECTOR_IDS = ['paygood', 'test'] as const;
export type SupportCollectorId = (typeof SUPPORT_COLLECTOR_IDS)[number];

export const SUPPORT_MODES = ['test', 'live'] as const;
export type SupportMode = (typeof SUPPORT_MODES)[number];

/** MEM-D3: who pays the collector's (card) fee. */
export const COLLECTOR_FEE_PAYERS = ['creatorSupporterMayCover', 'supporterAlways', 'creatorAlways'] as const;
export type CollectorFeePayer = (typeof COLLECTOR_FEE_PAYERS)[number];

/** MEM-D20: who bears the payout rail's fee and currency exchange. */
export const PAYOUT_FEE_BEARERS = ['creatorFromPayout', 'organization', 'supporterCoverEstimate'] as const;
export type PayoutFeeBearer = (typeof PAYOUT_FEE_BEARERS)[number];

/** MEM-D21: what happens when a refund or lost dispute arrives after the money was paid out. */
export const NEGATIVE_BALANCE_POLICIES = ['netAgainstFutureGifts', 'reserveFromPayouts', 'organizationAbsorbs'] as const;
export type NegativeBalancePolicy = (typeof NEGATIVE_BALANCE_POLICIES)[number];

/** MEM-D22: balances whose creator never completes payout setup, or disappears. */
export const DORMANT_POLICIES = ['unclaimedPropertyRule', 'refundSupporters'] as const;
export type DormantPolicy = (typeof DORMANT_POLICIES)[number];

/**
 * Every open owner decision, as a setting. `null` = not decided yet. Admins with
 * `support:providers` record the decision on the Support settings page once the owner and the
 * organization have made it; the value is audited.
 */
export interface SupportPolicy {
  /** MEM-D17: the payout rail (primary), and the fallback for countries it can't reach */
  primaryRail: PayoutRailId | null;
  fallbackRail: PayoutRailId | 'none' | null;
  /** MEM-D18 (decided 2026-11-23: an admin setting, 30 days unless changed): days a gift is held before it becomes available */
  holdDays: number | null;
  /** MEM-D19: smallest available balance paid out, in USD minor units (converted per payee currency by the rail quote) */
  payoutThresholdUsdMinor: number | null;
  /** MEM-D19: day of the month the payout batch is planned (1–28) */
  payoutDayOfMonth: number | null;
  /** MEM-D19: a creator may raise (never lower) their own threshold */
  creatorMayRaiseThreshold: boolean | null;
  /** MEM-D20 */
  payoutFeeBearer: PayoutFeeBearer | null;
  /** MEM-D21 */
  negativeBalancePolicy: NegativeBalancePolicy | null;
  /** MEM-D21 option "reserve": share of each payout held back (basis points) and for how many days */
  reserveBasisPoints: number | null;
  reserveDays: number | null;
  /** MEM-D22 */
  dormantPolicy: DormantPolicy | null;
  /** MEM-D22: months without an active payee at which the creator is reminded */
  dormantReminderMonths: number[] | null;
  /** MEM-D23: gifts may be collected before the creator's payee is active (money waits in the balance) */
  collectBeforePayeeActive: boolean | null;
  /** MEM-D24: people needed for a payout batch: one prepares, the others approve (1 or 2) */
  batchApprovers: 1 | 2 | null;
  /** MEM-D24: people needed for a ledger adjustment (1 or 2) */
  adjustmentApprovers: 1 | 2 | null;
  /** MEM-D3 */
  collectorFeePayer: CollectorFeePayer | null;
  /**
   * MEM-D4 (decided 2026-11-23, O43: an admin setting per currency, no fixed default): per currency, the
   * smallest gift and the preset buttons, in that currency's minor units. A currency without an entry
   * can't be given in.
   */
  amounts: SupportAmounts | null;
  /** MEM-D9: youngest age that may support / receive */
  minSupporterAge: number | null;
  minCreatorAge: number | null;
  /**
   * MEM-D5: who may receive. 'tierCapability': owners whose creator tier has "Can receive support"
   * (CreatorTier.supportReceive); 'everyAdultOwner': every channel owner (the rail's onboarding checks age).
   */
  receiversRule: ReceiversRule | null;
}

export const RECEIVERS_RULES = ['tierCapability', 'everyAdultOwner'] as const;
export type ReceiversRule = (typeof RECEIVERS_RULES)[number];

export const UNDECIDED_SUPPORT_POLICY: SupportPolicy = Object.freeze({
  primaryRail: null,
  fallbackRail: null,
  // Owner 2026-11-23, admin-editable defaults: MEM-D18/D21 a 120-day hold (the card networks' standard
  // dispute window); MEM-D19 $25 (or the rail's minimum, if higher) on the 15th, creators may raise
  // their own; MEM-D20 the creator bears payout and exchange fees; MEM-D21 a later loss is netted
  // against future gifts (the organization writes off only what can never be recovered)
  holdDays: 120,
  payoutThresholdUsdMinor: 2500,
  payoutDayOfMonth: 15,
  creatorMayRaiseThreshold: true,
  payoutFeeBearer: 'creatorFromPayout',
  negativeBalancePolicy: 'netAgainstFutureGifts',
  reserveBasisPoints: null,
  reserveDays: null,
  dormantPolicy: null,
  dormantReminderMonths: null,
  collectBeforePayeeActive: null,
  batchApprovers: null,
  adjustmentApprovers: null,
  collectorFeePayer: null,
  amounts: null,
  minSupporterAge: null,
  minCreatorAge: null,
  receiversRule: null,
}) as SupportPolicy;

export type SupportDecisionId = 'MEM-D3' | 'MEM-D4' | 'MEM-D5' | 'MEM-D9' | 'MEM-D17' | 'MEM-D18' | 'MEM-D19' | 'MEM-D20' | 'MEM-D21' | 'MEM-D22' | 'MEM-D23' | 'MEM-D24';

/** Which policy fields answer which owner decision (wiki AUN-MEMBERS §15). */
export const SUPPORT_DECISION_FIELDS: Readonly<Record<SupportDecisionId, readonly (keyof SupportPolicy)[]>> = Object.freeze({
  'MEM-D3': ['collectorFeePayer'],
  'MEM-D4': ['amounts'],
  'MEM-D5': ['receiversRule'],
  'MEM-D9': ['minSupporterAge', 'minCreatorAge'],
  'MEM-D17': ['primaryRail', 'fallbackRail'],
  'MEM-D18': ['holdDays'],
  'MEM-D19': ['payoutThresholdUsdMinor', 'payoutDayOfMonth', 'creatorMayRaiseThreshold'],
  'MEM-D20': ['payoutFeeBearer'],
  'MEM-D21': ['negativeBalancePolicy'],
  'MEM-D22': ['dormantPolicy', 'dormantReminderMonths'],
  'MEM-D23': ['collectBeforePayeeActive'],
  'MEM-D24': ['batchApprovers', 'adjustmentApprovers'],
});

/** Decisions still unanswered in `policy`, in id order. The reserve fields count only under the reserve option. */
export function undecidedSupportDecisions(policy: SupportPolicy): SupportDecisionId[] {
  const out: SupportDecisionId[] = [];
  for (const [id, fields] of Object.entries(SUPPORT_DECISION_FIELDS) as [SupportDecisionId, (keyof SupportPolicy)[]][]) {
    const missing = fields.some((f) => policy[f] === null);
    const reserveMissing = id === 'MEM-D21' && policy.negativeBalancePolicy === 'reserveFromPayouts' && (policy.reserveBasisPoints === null || policy.reserveDays === null);
    if (missing || reserveMissing) out.push(id);
  }
  return out;
}

export interface PolicyProblem {
  field: keyof SupportPolicy;
  code: 'invalid';
}

const intIn = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isSafeInteger(v) && v >= lo && v <= hi;
const oneOf = <T extends string>(list: readonly T[]) => (v: unknown) => typeof v === 'string' && (list as readonly string[]).includes(v);
const bool = (v: unknown) => typeof v === 'boolean';
const intList = (lo: number, hi: number, max: number) => (v: unknown) => Array.isArray(v) && v.length > 0 && v.length <= max && v.every((x) => intIn(x, lo, hi));

/** MEM-D4 per currency: the smallest gift and up to 6 preset buttons, minor units of that currency. */
export type SupportAmounts = Partial<Record<SupportCurrency, { minimum: number; presets: number[] }>>;

function validAmounts(v: unknown): boolean {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const entries = Object.entries(v as Record<string, unknown>);
  if (!entries.length) return false;
  return entries.every(([currency, a]) => {
    if (!isSupportCurrency(currency) || !a || typeof a !== 'object') return false;
    const { minimum, presets } = a as { minimum?: unknown; presets?: unknown };
    return intIn(minimum, 1, 100_000_000) && Array.isArray(presets) && presets.length >= 1 && presets.length <= 6 && presets.every((x) => intIn(x, minimum as number, 1_000_000_000));
  });
}

const POLICY_CHECKS: Readonly<Record<keyof SupportPolicy, (v: unknown) => boolean>> = {
  primaryRail: oneOf(PAYOUT_RAIL_IDS),
  fallbackRail: (v) => v === 'none' || oneOf(PAYOUT_RAIL_IDS)(v),
  holdDays: (v) => intIn(v, 0, 180),
  payoutThresholdUsdMinor: (v) => intIn(v, 0, 1_000_000),
  payoutDayOfMonth: (v) => intIn(v, 1, 28),
  creatorMayRaiseThreshold: bool,
  payoutFeeBearer: oneOf(PAYOUT_FEE_BEARERS),
  negativeBalancePolicy: oneOf(NEGATIVE_BALANCE_POLICIES),
  reserveBasisPoints: (v) => intIn(v, 0, 5_000),
  reserveDays: (v) => intIn(v, 0, 365),
  dormantPolicy: oneOf(DORMANT_POLICIES),
  dormantReminderMonths: intList(1, 60, 6),
  collectBeforePayeeActive: bool,
  batchApprovers: (v) => v === 1 || v === 2,
  adjustmentApprovers: (v) => v === 1 || v === 2,
  collectorFeePayer: oneOf(COLLECTOR_FEE_PAYERS),
  amounts: (v) => validAmounts(v),
  // MEM-D9 (decided 2026-11-23, O43): 18+ to send and to receive; a setting that can only be 18 or more
  minSupporterAge: (v) => intIn(v, 18, 99),
  minCreatorAge: (v) => intIn(v, 18, 99),
  receiversRule: oneOf(RECEIVERS_RULES),
};

/**
 * Checks a stored or submitted policy. `null` is always allowed (undecided). Unknown keys are
 * dropped; a wrong value is a problem, never silently replaced.
 */
export function parseSupportPolicy(input: unknown): { policy: SupportPolicy; problems: PolicyProblem[] } {
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const policy = { ...UNDECIDED_SUPPORT_POLICY } as Record<keyof SupportPolicy, unknown>;
  const problems: PolicyProblem[] = [];
  for (const key of Object.keys(POLICY_CHECKS) as (keyof SupportPolicy)[]) {
    const v = src[key];
    if (v === undefined || v === null) continue;
    if (POLICY_CHECKS[key](v)) policy[key] = Array.isArray(v) ? [...v] : v;
    else problems.push({ field: key, code: 'invalid' });
  }
  const p = policy as unknown as SupportPolicy;
  if (p.primaryRail && p.fallbackRail && p.fallbackRail === p.primaryRail) problems.push({ field: 'fallbackRail', code: 'invalid' });
  return { policy: p, problems };
}

// ---------------------------------------------------------------------------
// The breakdown before paying (§5.4)
// ---------------------------------------------------------------------------

/** A collector's (card) fee: a percentage in basis points plus a fixed amount per charge. Admin-set, per currency. */
export interface CollectorFeeSchedule {
  basisPoints: number;
  fixed: Money;
}

export interface GiftBreakdown {
  /** What the supporter is charged */
  charged: Money;
  /** The amount the supporter chose */
  gift: Money;
  /** Added because the supporter ticked "cover the fees" (0 otherwise) */
  coverFees: Money;
  /** The collector's fee (estimate before paying; the real fee comes on the webhook) */
  collectorFee: Money;
  /** Tax on the gift; 0 while support is a gift outside the scope of VAT (§6.1) */
  tax: Money;
  /** Always zero (O41). Shown so the supporter sees it */
  platformFee: Money;
  /** What the creator's balance receives (before any payout fee) */
  creatorReceives: Money;
}

/**
 * The supporter's breakdown. `supporterCovers` is what the supporter ticked; whether that box is
 * offered, forced or hidden is MEM-D3 (`effectiveCoverFees`).
 */
export function quoteGift(input: { gift: Money; fee: CollectorFeeSchedule; supporterCovers: boolean; taxBasisPoints?: number }): GiftBreakdown {
  const { gift, fee } = input;
  if (gift.amount <= 0) throw new MoneyError('A gift must be more than zero');
  sameCurrency(gift, fee.fixed);
  const tax = basisPoints(gift, input.taxBasisPoints ?? 0, 'halfUp');
  // The card fee is charged on everything the card pays, tax included
  const feeOf = (m: Money) => addMoney(basisPoints(m, fee.basisPoints, 'up'), fee.fixed);
  let charged: Money;
  if (input.supporterCovers) {
    // Gross up so that charged − fee(charged) ≥ gift + tax: charged = ceil((gift + tax + fixed) / (1 − bp))
    const numer = safe((gift.amount + tax.amount + fee.fixed.amount) * 10_000);
    charged = { amount: divRound(numer, 10_000 - fee.basisPoints, 'up'), currency: gift.currency };
  } else {
    charged = addMoney(gift, tax);
  }
  const collectorFee = feeOf(charged);
  const creatorReceives = subMoney(subMoney(charged, tax), collectorFee);
  // A gift the card fee would swallow is refused, never booked as a negative balance for the creator
  if (creatorReceives.amount <= 0) throw new MoneyError('A gift must be more than the card fee');
  return {
    charged,
    gift,
    coverFees: subMoney(subMoney(charged, tax), gift),
    collectorFee,
    tax,
    platformFee: zeroMoney(gift.currency),
    creatorReceives,
  };
}

/** MEM-D3 applied to the supporter's tick: null while the decision is open (checkout refuses). */
export function effectiveCoverFees(payer: CollectorFeePayer | null, supporterTicked: boolean): boolean | null {
  if (payer === null) return null;
  if (payer === 'supporterAlways') return true;
  if (payer === 'creatorAlways') return false;
  return supporterTicked;
}

// ---------------------------------------------------------------------------
// Statuses (mirrored by the CHECK constraints in search migration 0076)
// ---------------------------------------------------------------------------

export const PAYEE_STATUSES = ['not_started', 'pending', 'action_needed', 'active', 'restricted', 'disabled', 'closed'] as const;
export type PayeeStatus = (typeof PAYEE_STATUSES)[number];

export const TAX_FORMS = ['none', 'w9', 'w8ben', 'w8bene'] as const;
export type TaxForm = (typeof TAX_FORMS)[number];

export const SANCTIONS_STATUSES = ['clear', 'pending', 'hold'] as const;
export type SanctionsStatus = (typeof SANCTIONS_STATUSES)[number];

export const PLEDGE_STATUSES = ['active', 'past_due', 'canceled', 'ended'] as const;
export type PledgeStatus = (typeof PLEDGE_STATUSES)[number];

export const SUPPORT_PAYMENT_STATUSES = ['succeeded', 'failed', 'refunded', 'partially_refunded', 'disputed', 'dispute_lost', 'dispute_won'] as const;
export type SupportPaymentStatus = (typeof SUPPORT_PAYMENT_STATUSES)[number];

export const PAYOUT_STATUSES = ['queued', 'sent', 'unknown', 'paid', 'failed', 'returned', 'canceled'] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

export const PAYOUT_BATCH_STATUSES = ['draft', 'awaiting_approval', 'approved', 'funding', 'sending', 'done', 'stopped'] as const;
export type PayoutBatchStatus = (typeof PAYOUT_BATCH_STATUSES)[number];

// ---------------------------------------------------------------------------
// Ledger chart of accounts (§9.3). The accountant sets the final chart; the shape is fixed here.
// ---------------------------------------------------------------------------

export const CREATOR_BUCKETS = ['pending', 'available', 'in_payout', 'reserve'] as const;
export type CreatorBucket = (typeof CREATOR_BUCKETS)[number];

export const SYSTEM_ACCOUNTS = ['clearing:collector', 'bank:creator_funds', 'rail:funding', 'fees:collector', 'fees:rail', 'fees:fx', 'loss:org_reserve', 'org:fee_contributions'] as const;
export type SystemAccount = (typeof SYSTEM_ACCOUNTS)[number];

export type LedgerAccount = SystemAccount | `creator:${string}:${CreatorBucket}`;

export const creatorAccount = (channelId: string, bucket: CreatorBucket): LedgerAccount => {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(channelId)) throw new MoneyError(`Invalid channel id for a ledger account: ${channelId}`);
  return `creator:${channelId}:${bucket}`;
};

export function isLedgerAccount(value: string): value is LedgerAccount {
  if ((SYSTEM_ACCOUNTS as readonly string[]).includes(value)) return true;
  const m = /^creator:([A-Za-z0-9_-]{1,64}):([a-z_]+)$/.exec(value);
  return !!m && (CREATOR_BUCKETS as readonly string[]).includes(m[2]);
}

export const LEDGER_KINDS = ['gift', 'collector_fee', 'settlement', 'release', 'refund', 'dispute', 'dispute_fee', 'dispute_reversal', 'payout', 'payout_paid', 'payout_fee', 'payout_return', 'rail_funding', 'fx', 'adjustment', 'write_off'] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

// ---------------------------------------------------------------------------
// Permissions (admin-api; §9.6). Money permissions are for the organization's finance list only.
// ---------------------------------------------------------------------------

export const SUPPORT_PERMISSIONS = ['support:read', 'support:manage', 'support:refund', 'support:disputes', 'support:payouts', 'support:ledger', 'support:countries', 'support:providers'] as const;
export type SupportPermission = (typeof SUPPORT_PERMISSIONS)[number];

/** Never granted to an account that isn't on the organization's finance list, nor to tech staff. */
export const FINANCE_ONLY_SUPPORT_PERMISSIONS: readonly SupportPermission[] = Object.freeze(['support:refund', 'support:disputes', 'support:payouts', 'support:ledger', 'support:providers']);

// ---------------------------------------------------------------------------
// Whether `creatorSupport` may be switched on (§9.7). Used by api-videos and by admin-api's
// Features page precondition (AUN-FEATURES FEAT-4).
// ---------------------------------------------------------------------------

export type SupportTurnOnBlocker = 'organization_not_formed' | 'no_finance_approver' | 'decisions_open' | 'no_collector' | 'no_fees' | 'no_rail';

export interface SupportReadiness {
  /** The switch may be turned on */
  ready: boolean;
  /** Why not, in this order */
  blockers: SupportTurnOnBlocker[];
  openDecisions: SupportDecisionId[];
}

/**
 * Ready when the organization is recorded as formed, the finance list has enough people for
 * MEM-D24 (two-person approval needs two), every owner decision is recorded, and a collector and a
 * rail are available in this environment.
 */
export function supportReadiness(input: { organizationFormed: boolean; financeApprovers: number; policy: SupportPolicy; collectorAvailable: boolean; railAvailable: boolean; feesKnown?: boolean }): SupportReadiness {
  const blockers: SupportTurnOnBlocker[] = [];
  if (!input.organizationFormed) blockers.push('organization_not_formed');
  if (input.financeApprovers < Math.max(1, input.policy.batchApprovers ?? 1, input.policy.adjustmentApprovers ?? 1)) blockers.push('no_finance_approver');
  const openDecisions = undecidedSupportDecisions(input.policy);
  if (openDecisions.length) blockers.push('decisions_open');
  if (!input.collectorAvailable) blockers.push('no_collector');
  // O43: every currency people may give in has the collector's fee (a live quote or a fee setting)
  if (input.collectorAvailable && input.feesKnown === false) blockers.push('no_fees');
  if (!input.railAvailable) blockers.push('no_rail');
  return { ready: blockers.length === 0, blockers, openDecisions };
}

/** Why `creatorSupport` can't be switched on yet, for the Features page (en / ar, typographic quotes, ٠–٩). */
export const SUPPORT_TURN_ON_REASONS: Readonly<Record<SupportTurnOnBlocker, { en: string; ar: string }>> = Object.freeze({
  organization_not_formed: { en: 'Supporting creators can’t be switched on until the organization that holds creators’ money is recorded as formed.', ar: 'لا يمكن تشغيل دعم صنّاع المحتوى قبل تسجيل تأسيس المؤسسة التي تحفظ أموال صنّاع المحتوى.' },
  no_finance_approver: { en: 'Add enough people to the organization’s finance list to approve payouts first.', ar: 'أضف أولًا عددًا كافيًا من الأشخاص إلى قائمة المالية في المؤسسة لاعتماد الدفعات.' },
  decisions_open: { en: 'Some decisions about holds, payouts and fees haven’t been recorded yet on the Support settings page.', ar: 'لم تُسجَّل بعد بعض القرارات الخاصة بفترة الحجز والدفعات والرسوم في صفحة إعدادات الدعم.' },
  no_collector: { en: 'No payment provider is set up to collect support here.', ar: 'لا يوجد مزوّد دفع مُعدّ لتحصيل الدعم هنا.' },
  no_fees: { en: 'Enter the payment provider’s fee for every currency people can give in, on the Support settings page.', ar: 'أدخل رسوم مزوّد الدفع لكل عملة يمكن الدعم بها، في صفحة إعدادات الدعم.' },
  no_rail: { en: 'No payout service is set up to pay creators here.', ar: 'لا توجد خدمة دفع مُعدّة لتحويل الأموال إلى صنّاع المحتوى هنا.' },
});


// ---------------------------------------------------------------------------
// Fee schedules (decided 2026-11-23, O43): admin settings with an effective date, changed by the
// finance list and audited. A vendor's live quote wins; the setting is the fallback; with neither,
// nobody can pay (the collector) or no payout is planned (the rail).
// ---------------------------------------------------------------------------

export const FEE_SCHEDULE_KINDS = ['collector', 'rail'] as const;
export type FeeScheduleKind = (typeof FEE_SCHEDULE_KINDS)[number];

export interface FeeScheduleEntry {
  id: string;
  kind: FeeScheduleKind;
  /** 'paygood', 'test', or a payout rail id */
  provider: string;
  currency: SupportCurrency;
  /** A payment method ('card', 'bank', …) or null for any */
  method: string | null;
  basisPoints: number;
  fixedMinor: number;
  /** When it applies from (ISO); the newest entry already in force wins */
  effectiveFrom: string;
  createdBy: string;
  createdAt: string;
  /** The preset it was filled from, if any */
  presetId: string | null;
}

/**
 * Published rates to fill the form from (never applied on their own). Source: the spec's PayGood fee
 * table, 2026-11-22 (wiki AUN-MEMBERS §5.1).
 */
export const FEE_PRESETS: readonly { id: string; kind: FeeScheduleKind; provider: string; currency: SupportCurrency; basisPoints: number; fixedMinor: number; name: { en: string; ar: string } }[] = Object.freeze([
  { id: 'paygood-standard-usd', kind: 'collector', provider: 'paygood', currency: 'USD', basisPoints: 290, fixedMinor: 30, name: { en: 'PayGood standard: 2.9% + 30¢', ar: 'PayGood العادي: ٢٫٩٪ + ٣٠ سنتًا' } },
  { id: 'paygood-nonprofit-usd', kind: 'collector', provider: 'paygood', currency: 'USD', basisPoints: 190, fixedMinor: 30, name: { en: 'PayGood nonprofit: 1.9% + 30¢', ar: 'PayGood للمؤسسات غير الربحية: ١٫٩٪ + ٣٠ سنتًا' } },
]);

/** Checks one fee schedule entry the finance list submits. */
export function feeScheduleProblems(input: { kind?: unknown; provider?: unknown; currency?: unknown; method?: unknown; basisPoints?: unknown; fixedMinor?: unknown; effectiveFrom?: unknown }): string[] {
  const out: string[] = [];
  if (!(FEE_SCHEDULE_KINDS as readonly unknown[]).includes(input.kind)) out.push('kind');
  if (typeof input.provider !== 'string' || !/^[a-z][a-z0-9-]{1,39}$/.test(input.provider)) out.push('provider');
  if (!isSupportCurrency(input.currency)) out.push('currency');
  if (input.method !== null && input.method !== undefined && (typeof input.method !== 'string' || !/^[a-z][a-z0-9_-]{1,29}$/.test(input.method))) out.push('method');
  if (!intIn(input.basisPoints, 0, 2_000)) out.push('basisPoints');
  if (!intIn(input.fixedMinor, 0, 100_000)) out.push('fixedMinor');
  if (typeof input.effectiveFrom !== 'string' || !Number.isFinite(Date.parse(input.effectiveFrom))) out.push('effectiveFrom');
  return out;
}
