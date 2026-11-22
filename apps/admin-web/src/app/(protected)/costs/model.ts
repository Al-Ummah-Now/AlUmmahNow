/**
 * Costs page model (COST-1): how old the data is, whether the collector has a token, the open
 * alerts as readable lines, the connection states and test results, week-on-week deltas and the
 * alert settings form with the same limits as admin-api (shared-types mergeCostAlertSettings).
 * Pure: server and client safe.
 */
import { COST_ALERT_KINDS, COST_ALERT_RANGES, dateTimeFormat, parseDigits, RESEND_PLANS, type CostAlertKind, type CostAlertSettings, type CostCredentialView, type CostProvider, type ResendPlan } from '@al-ummah/shared-types';
import type { MessageKey, TranslateParams } from '@/i18n/translate';
import type { CapacityRule, CostCollectorState } from '@/lib/api/costs-types';

/** Data older than this reads as stale (the collector runs hourly). */
export const STALE_AFTER_MS = 2 * 3_600_000;

export function dataAge(dataAsOf: string | null, now: Date): { never: boolean; stale: boolean } {
  if (!dataAsOf) return { never: true, stale: true };
  const at = Date.parse(dataAsOf);
  if (!Number.isFinite(at)) return { never: true, stale: true };
  return { never: false, stale: now.getTime() - at > STALE_AFTER_MS };
}

export type TokenNotice = 'missing' | 'refused' | 'release' | null;

/**
 * The header's token notice: 'missing' when the collector has no token (or never reported one) and
 * no Cloudflare connection is set; 'refused' when Cloudflare refuses the token it has (no Account
 * Analytics Read), so the Cloudflare figures are missing, not zero; 'release' while it borrows
 * the release token.
 */
export function tokenNotice(collector: Pick<CostCollectorState, 'tokenSource' | 'analytics'>, connections: Pick<CostCredentialView, 'provider' | 'set'>[]): TokenNotice {
  const cloudflareSet = connections.some((c) => c.provider === 'cloudflare' && c.set);
  if ((collector.tokenSource === 'none' || collector.tokenSource === 'unknown') && !cloudflareSet) return 'missing';
  if (collector.analytics?.state === 'refused') return 'refused';
  if (collector.tokenSource === 'release' && !cloudflareSet) return 'release';
  return null;
}

export type AlertLine =
  | { type: 'budget'; month: string; percent: number }
  | { type: 'projected'; month: string }
  | { type: 'spike'; env: string; total: boolean; resource: string }
  | { type: 'other'; key: string };

/** ops-cost:budget:2026-11:80, ops-cost:projected:2026-11, ops-cost:spike:<env>:<resource|total>. */
export function parseAlertKey(key: string): AlertLine {
  const parts = key.split(':');
  if (parts[0] !== 'ops-cost') return { type: 'other', key };
  if (parts[1] === 'budget' && parts.length === 4 && /^\d{4}-\d{2}$/.test(parts[2]) && /^\d+$/.test(parts[3])) {
    return { type: 'budget', month: parts[2], percent: Number(parts[3]) };
  }
  if (parts[1] === 'projected' && parts.length === 3 && /^\d{4}-\d{2}$/.test(parts[2])) return { type: 'projected', month: parts[2] };
  if (parts[1] === 'spike' && parts.length >= 4) {
    // A resource id may itself hold colons
    const resource = parts.slice(3).join(':');
    return { type: 'spike', env: parts[2], total: resource === 'total', resource };
  }
  return { type: 'other', key };
}

export type CredentialState = 'unset' | 'set' | 'unreadable';

export function credentialState(view: Pick<CostCredentialView, 'set' | 'unreadable'> | undefined): CredentialState {
  if (!view?.set) return 'unset';
  return view.unreadable ? 'unreadable' : 'set';
}

/**
 * What a connection card says about its key: no key here but the collector reading Cloudflare
 * with the shared release token says so (a bare "Not set" beside live figures reads as broken).
 */
export function connectionStatus(provider: CostProvider, state: CredentialState, last4: string | null, releaseInUse: boolean): 'release' | 'unset' | 'unreadable' | 'set' | 'setPlain' {
  if (state === 'unset') return provider === 'cloudflare' && releaseInUse ? 'release' : 'unset';
  if (state === 'unreadable') return 'unreadable';
  return last4 ? 'set' : 'setPlain';
}

/** Test and Remove only once there is a key: a greyed-out button reads as clickable. */
export const connectionActions = (state: CredentialState): boolean => state !== 'unset';

/** Connection test codes admin-api stores (lib/costs.ts); each has a translated line. */
export const TEST_CODES = [
  'cf_ok',
  'cf_partial',
  'cf_no_analytics',
  'cf_invalid',
  'cf_inactive',
  'bunny_ok',
  'bunny_invalid',
  'bunny_unavailable',
  'bunny_not_account',
  'resend_ok',
  'resend_sending_only',
  'resend_invalid',
  'resend_unavailable',
  'unreachable',
  'unreadable',
] as const;
export type TestCode = (typeof TEST_CODES)[number];

/** A test's code (or a stored "<code>: <english>" line); null for an unknown one. */
export function testCodeOf(message: string | null | undefined): TestCode | null {
  const code = (message ?? '').split(':')[0]?.trim();
  return (TEST_CODES as readonly string[]).includes(code) ? (code as TestCode) : null;
}

/** Cloudflare listings the collector reads besides Account Analytics. */
export const CF_LISTINGS = ['workers', 'd1', 'kv', 'r2', 'queues', 'containers'] as const;
export type CfListing = (typeof CF_LISTINGS)[number];

/** The listings a partial Cloudflare token cannot read, from the test's checks (just run or stored). */
export function missingListings(checks: readonly { name: string; ok: boolean }[] | undefined): CfListing[] {
  const known = (n: string): n is CfListing => (CF_LISTINGS as readonly string[]).includes(n);
  return (checks ?? []).filter((c) => !c.ok && known(c.name)).map((c) => c.name as CfListing);
}

export type KeyProblem = 'short' | 'spaces' | 'resendPrefix';

/** The same shape check admin-api runs (shared-types validateCostCredential), as a translatable code. */
export function keyProblem(provider: CostProvider, value: string): KeyProblem | null {
  const v = value.trim();
  if (v.length < 20 || v.length > 400) return 'short';
  if (/\s/.test(v)) return 'spaces';
  if (provider === 'resend' && !v.startsWith('re_')) return 'resendPrefix';
  return null;
}

export type Direction = 'up' | 'down' | 'flat';

/** Last 7 days against the 7 before: the change, its share (null from nothing) and its direction. */
export function weekDelta(last7: number, prev7: number): { change: number; share: number | null; direction: Direction } {
  const change = Math.round((last7 - prev7) * 100) / 100;
  const direction: Direction = Math.abs(change) < 0.005 ? 'flat' : change > 0 ? 'up' : 'down';
  return { change, share: prev7 > 0 ? change / prev7 : null, direction };
}

/** Each product's share of the month so far (0..1), for the ranked bars. */
export function shareOf(value: number, total: number): number {
  return total > 0 ? Math.max(0, Math.min(1, value / total)) : 0;
}

// ---------------------------------------------------------------------------------------------
// My alert emails
// ---------------------------------------------------------------------------------------------

/** Kinds in the canonical order, unknown ones dropped. */
export function normalizeKinds(kinds: readonly string[]): CostAlertKind[] {
  return COST_ALERT_KINDS.filter((k) => kinds.includes(k));
}

export function toggleKind(kinds: readonly CostAlertKind[], kind: CostAlertKind, on: boolean): CostAlertKind[] {
  return normalizeKinds(on ? [...kinds, kind] : kinds.filter((k) => k !== kind));
}

// ---------------------------------------------------------------------------------------------
// Alert settings form (super admins)
// ---------------------------------------------------------------------------------------------

export interface SettingsForm {
  budgetUsd: string;
  /** Percentages, comma separated: "50, 80, 100". */
  budgetLevels: string;
  projectedAlert: boolean;
  spikeFactor: string;
  spikeMinUsd: string;
  spikeTotalMinUsd: string;
  digestEnabled: boolean;
  digestWeekday: number;
  digestHour: number;
  resendPlan: ResendPlan;
}

export type SettingsField = 'budgetUsd' | 'budgetLevels' | 'spikeFactor' | 'spikeMinUsd' | 'spikeTotalMinUsd';

/** The limits mergeCostAlertSettings applies (budget levels in percent here). */
export const SETTINGS_LIMITS = {
  budgetUsd: COST_ALERT_RANGES.budgetUsd,
  spikeFactor: COST_ALERT_RANGES.spikeFactor,
  spikeMinUsd: COST_ALERT_RANGES.spikeMinUsd,
  spikeTotalMinUsd: COST_ALERT_RANGES.spikeTotalMinUsd,
  levelPercent: { min: COST_ALERT_RANGES.budgetLevel.min * 100, max: COST_ALERT_RANGES.budgetLevel.max * 100 },
  levelCount: COST_ALERT_RANGES.levelCount,
} as const;

const trimNumber = (v: number) => String(Math.round(v * 100) / 100);

export function settingsToForm(s: CostAlertSettings): SettingsForm {
  return {
    budgetUsd: s.budgetUsd === null ? '' : trimNumber(s.budgetUsd),
    budgetLevels: s.budgetLevels.map((l) => trimNumber(l * 100)).join(', '),
    projectedAlert: s.projectedAlert,
    spikeFactor: trimNumber(s.spikeFactor),
    spikeMinUsd: trimNumber(s.spikeMinUsd),
    spikeTotalMinUsd: trimNumber(s.spikeTotalMinUsd),
    digestEnabled: s.digestEnabled,
    digestWeekday: s.digestWeekday,
    digestHour: s.digestHour,
    resendPlan: s.resendPlan in RESEND_PLANS ? s.resendPlan : 'free',
  };
}

export interface FieldError {
  key: MessageKey;
  params?: TranslateParams;
}

/** Reads a number typed with Arabic numerals 0–9 or Eastern Arabic (Hindi) numerals ٠–٩ (and «٫»). */
export function readNumber(text: string): number | null {
  const plain = parseDigits(text.trim());
  if (!/^-?\d+(\.\d+)?$/.test(plain)) return null;
  const n = Number(plain);
  return Number.isFinite(n) ? n : null;
}

/** Percentages "50, 80, 100" (also "٥٠، ٨٠") → shares, or null when one is not a number. */
export function readLevels(text: string): number[] | null {
  const parts = text.split(/[,،\s]+/).filter(Boolean);
  const out: number[] = [];
  for (const p of parts) {
    const n = readNumber(p.replace(/%$/, ''));
    if (n === null) return null;
    out.push(n);
  }
  return out;
}

/** Validates the form; the settings to send when every field is in range. */
export function validateSettingsForm(form: SettingsForm): { errors: Partial<Record<SettingsField, FieldError>>; value: CostAlertSettings | null } {
  const errors: Partial<Record<SettingsField, FieldError>> = {};
  const num = (field: Exclude<SettingsField, 'budgetLevels'>): number => {
    const { min, max } = SETTINGS_LIMITS[field];
    const n = readNumber(form[field]);
    if (n === null || n < min || n > max) errors[field] = { key: 'costs.thresholds.errors.range', params: { min, max } };
    return n ?? 0;
  };
  const budgetUsd = form.budgetUsd.trim() === '' ? null : num('budgetUsd');
  const spikeFactor = num('spikeFactor');
  const spikeMinUsd = num('spikeMinUsd');
  const spikeTotalMinUsd = num('spikeTotalMinUsd');
  const levels = readLevels(form.budgetLevels);
  const { levelPercent, levelCount } = SETTINGS_LIMITS;
  if (levels === null) errors.budgetLevels = { key: 'costs.thresholds.errors.levelsNumbers' };
  else if (levels.length < levelCount.min || levels.length > levelCount.max) errors.budgetLevels = { key: 'costs.thresholds.errors.levelsCount', params: { max: levelCount.max } };
  else if (levels.some((l) => l < levelPercent.min || l > levelPercent.max)) errors.budgetLevels = { key: 'costs.thresholds.errors.levelsRange', params: { min: String(levelPercent.min), max: String(levelPercent.max) } };
  if (Object.keys(errors).length) return { errors, value: null };
  const shares = [...new Set(levels!.map((l) => Math.round(l) / 100))].sort((a, b) => a - b);
  return {
    errors,
    value: {
      budgetUsd,
      budgetLevels: shares,
      projectedAlert: form.projectedAlert,
      spikeFactor,
      spikeMinUsd,
      spikeTotalMinUsd,
      digestEnabled: form.digestEnabled,
      digestWeekday: Math.min(6, Math.max(0, Math.trunc(form.digestWeekday))),
      digestHour: Math.min(23, Math.max(0, Math.trunc(form.digestHour))),
      resendPlan: form.resendPlan,
    },
  };
}

/** Weekday names (0 = Sunday) in the locale. */
export function weekdayNames(locale: string): string[] {
  const f = dateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' });
  // 2026-11-01 is a Sunday
  return Array.from({ length: 7 }, (_, i) => f.format(new Date(Date.UTC(2026, 10, 1 + i, 12))));
}

/** An hour of the day (0..23) as the locale writes it ("9 AM", "٩ ص"). */
export function hourName(hour: number, locale: string): string {
  return dateTimeFormat(locale, { hour: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 10, 1, hour)));
}

// D1 capacity rules (wiki AUN-D1-SCALING D1-1)
/** Percent metrics are stored as fractions (0.7) and typed as percentages (70). */
export const isPercentMetric = (m: CapacityRule['metric']) => m !== 'storage_days_to_70';
/** The range each rule accepts in the form (percent or days). */
export const RULE_RANGE: Record<CapacityRule['metric'], { min: number; max: number }> = {
  storage_pct: { min: 1, max: 100 },
  busy_pct: { min: 1, max: 100 },
  account_storage_pct: { min: 1, max: 100 },
  storage_days_to_70: { min: 1, max: 365 },
};

/** The stored value for the typed one, or null when it is out of range or not a number. */
export function ruleValueFromInput(metric: CapacityRule['metric'], input: string): number | null {
  const n = Number(parseDigits(input.trim()));
  const { min, max } = RULE_RANGE[metric];
  if (!input.trim() || !Number.isFinite(n) || n < min || n > max) return null;
  return isPercentMetric(metric) ? Math.round(n * 10) / 1000 : Math.round(n);
}
export const ruleInputOf = (r: CapacityRule) => String(isPercentMetric(r.metric) ? Math.round(r.value * 1000) / 10 : r.value);

/** The viewer's own date (YYYY-MM-DD): at 7 pm in New York it is still the 21st, though UTC is on the 22nd. */
export function localDate(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
