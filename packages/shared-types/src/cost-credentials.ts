/**
 * Cost monitoring credentials set by the super admin in the videos admin (Costs → Connections):
 * a read-only Cloudflare API token and optional Bunny and Resend keys (COST-1).
 *
 * admin-api encrypts a key when it is saved and the cost-monitor collector decrypts it when it
 * runs; both bind COSTS_DB and the per-environment INTERNAL_API_KEY. Nothing else can read it:
 *
 * - AES-256-GCM with a random 12-byte IV per value. The additional data is the provider name, so a
 *   ciphertext cannot be moved to another provider's row.
 * - The AES key is HKDF-SHA256 of the master secret (COST_CREDENTIALS_KEY when a deployment binds
 *   one, else INTERNAL_API_KEY) with a fixed salt and info, so it is never stored and differs from
 *   the master itself. `key_id` on the row records which master sealed it ('ck1' or 'ik1'); a row
 *   that no longer opens (the master was rotated) reads as "set again", never as a crash.
 * - The admin only ever sees `last4`, who set it and when, and the last connection test.
 */

export const COST_PROVIDERS = ['cloudflare', 'bunny', 'resend'] as const;
export type CostProvider = (typeof COST_PROVIDERS)[number];

export const isCostProvider = (v: unknown): v is CostProvider => typeof v === 'string' && (COST_PROVIDERS as readonly string[]).includes(v);

/** What the admin sees about one credential (never the value). */
export interface CostCredentialView {
  provider: CostProvider;
  set: boolean;
  last4: string | null;
  updatedBy: string | null;
  updatedByName: string | null;
  updatedAt: string | null;
  /**
   * Last connection test: ok, its result code (the page translates it), what each probe could read
   * (Cloudflare), an English line for the audit, and when.
   */
  test: { ok: boolean; code: string | null; checks: { name: string; ok: boolean }[]; message: string; at: string } | null;
  /** The stored value no longer decrypts (the master secret changed): it has to be set again. */
  unreadable?: boolean;
}

/** One row of cost_credentials (COSTS_DB). */
export interface CostCredentialRow {
  provider: CostProvider;
  ciphertext: string;
  iv: string;
  key_id: string;
  last4: string;
  updated_by: string;
  updated_by_name: string | null;
  updated_at: string;
  test_ok: number | null;
  test_message: string | null;
  test_at: string | null;
  /** JSON { code, checks } of the last test. */
  test_detail: string | null;
}

const SALT = new TextEncoder().encode('al-ummah-cost-credentials');
const INFO = new TextEncoder().encode('cost-credentials:aes-gcm:v1');

export interface CostKeySource {
  COST_CREDENTIALS_KEY?: string | null;
  INTERNAL_API_KEY?: string | null;
}

/** The master secret and its id, or null when neither secret is available. */
export function costMasterSecret(src: CostKeySource): { id: 'ck1' | 'ik1'; secret: string } | null {
  if (src.COST_CREDENTIALS_KEY && src.COST_CREDENTIALS_KEY.length >= 16) return { id: 'ck1', secret: src.COST_CREDENTIALS_KEY };
  if (src.INTERNAL_API_KEY && src.INTERNAL_API_KEY.length >= 16) return { id: 'ik1', secret: src.INTERNAL_API_KEY };
  return null;
}

async function deriveKey(secret: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: SALT, info: INFO }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

const toB64 = (bytes: Uint8Array) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};
const fromB64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

/** The last four characters shown back to the admin (shorter values show nothing). */
export function credentialLast4(value: string): string {
  const v = value.trim();
  return v.length >= 12 ? v.slice(-4) : '';
}

export class CostCredentialError extends Error {}

export async function sealCostCredential(
  provider: CostProvider,
  value: string,
  src: CostKeySource,
): Promise<{ ciphertext: string; iv: string; key_id: string; last4: string }> {
  const master = costMasterSecret(src);
  if (!master) throw new CostCredentialError('No key to encrypt credentials with (INTERNAL_API_KEY is not bound)');
  const key = await deriveKey(master.secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(provider) }, key, new TextEncoder().encode(value.trim()));
  return { ciphertext: toB64(new Uint8Array(sealed)), iv: toB64(iv), key_id: master.id, last4: credentialLast4(value) };
}

/** The stored value, or null when it cannot be opened (missing master, rotated master, tampered row). */
export async function openCostCredential(row: Pick<CostCredentialRow, 'provider' | 'ciphertext' | 'iv' | 'key_id'>, src: CostKeySource): Promise<string | null> {
  const ck = src.COST_CREDENTIALS_KEY && src.COST_CREDENTIALS_KEY.length >= 16 ? src.COST_CREDENTIALS_KEY : null;
  const ik = src.INTERNAL_API_KEY && src.INTERNAL_API_KEY.length >= 16 ? src.INTERNAL_API_KEY : null;
  const secret = row.key_id === 'ck1' ? ck : row.key_id === 'ik1' ? ik : null;
  if (!secret) return null;
  try {
    const key = await deriveKey(secret);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(row.iv), additionalData: new TextEncoder().encode(row.provider) }, key, fromB64(row.ciphertext));
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

/** Basic shape check before saving; returns an error message or null. Values are never echoed. */
export function validateCostCredential(provider: CostProvider, value: unknown): string | null {
  if (typeof value !== 'string') return 'The key must be text';
  const v = value.trim();
  if (v.length < 20 || v.length > 400) return 'That does not look like a key (20–400 characters)';
  if (/\s/.test(v)) return 'A key has no spaces or line breaks';
  if (provider === 'resend' && !v.startsWith('re_')) return 'Resend keys start with re_';
  return null;
}

// ---------------------------------------------------------------------------------------------
// Alert settings (editable by super admins on the Costs page; read by admin-api's alert tick)
// ---------------------------------------------------------------------------------------------

export interface CostAlertSettings {
  /** Admin-configured monthly spend alert threshold for the platform; null until a super admin sets it. */
  budgetUsd: number | null;
  /** Shares of the budget that open an alert, ascending, e.g. [0.5, 0.8, 1]. */
  budgetLevels: number[];
  /** Alert when the month-end projection goes over the budget. */
  projectedAlert: boolean;
  /** A day is a spike at this many times the 7-day baseline... */
  spikeFactor: number;
  /** ...and at least this many dollars above it for one resource... */
  spikeMinUsd: number;
  /** ...or this many for an environment's total. */
  spikeTotalMinUsd: number;
  /** Weekly digest: weekday (0 = Sunday) and hour, in the owner's time zone. */
  digestWeekday: number;
  digestHour: number;
  digestEnabled: boolean;
  /** The Resend plan the account is on (prices the email line). */
  resendPlan: ResendPlan;
}

/** Allowed ranges for the alert settings (#1427); budget levels are shares (0.1 = 10%). */
export const COST_ALERT_RANGES = {
  budgetUsd: { min: 50, max: 5000 },
  budgetLevel: { min: 0.1, max: 1.5 },
  levelCount: { min: 1, max: 5 },
  spikeFactor: { min: 1.2, max: 10 },
  spikeMinUsd: { min: 0, max: 100 },
  spikeTotalMinUsd: { min: 0, max: 100 },
} as const;

export const COST_ALERT_DEFAULTS: CostAlertSettings = {
  budgetUsd: null,
  budgetLevels: [0.5, 0.8, 1],
  projectedAlert: true,
  spikeFactor: 2,
  spikeMinUsd: 0.5,
  spikeTotalMinUsd: 2,
  digestWeekday: 1,
  digestHour: 9,
  digestEnabled: true,
  resendPlan: 'free',
};

/** The time zone digests are scheduled in (the owner's). */
export const COST_DIGEST_TIME_ZONE = 'America/New_York';

/** Validates a partial settings change; returns an error message or the merged settings. */
export function mergeCostAlertSettings(current: CostAlertSettings, input: unknown): CostAlertSettings | string {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'body must be an object';
  const b = input as Record<string, unknown>;
  const out: CostAlertSettings = { ...current, budgetLevels: [...current.budgetLevels] };
  const numIn = (k: keyof CostAlertSettings, min: number, max: number): string | null => {
    if (b[k] === undefined) return null;
    const v = b[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) return `${k} must be a number from ${min} to ${max}`;
    (out as unknown as Record<string, unknown>)[k] = v;
    return null;
  };
  const intIn = (k: keyof CostAlertSettings, min: number, max: number): string | null => {
    if (b[k] === undefined) return null;
    if (!Number.isInteger(b[k])) return `${k} must be a whole number from ${min} to ${max}`;
    return numIn(k, min, max);
  };
  const boolIn = (k: keyof CostAlertSettings): string | null => {
    if (b[k] === undefined) return null;
    if (typeof b[k] !== 'boolean') return `${k} must be true or false`;
    (out as unknown as Record<string, unknown>)[k] = b[k];
    return null;
  };
  const known = new Set(Object.keys(COST_ALERT_DEFAULTS));
  for (const k of Object.keys(b)) if (!known.has(k)) return `Unknown setting ${k}`;
  const R = COST_ALERT_RANGES;
  if (b.budgetUsd === null) {
    out.budgetUsd = null;
  } else if (b.budgetUsd !== undefined) {
    const budgetErr = numIn('budgetUsd', R.budgetUsd.min, R.budgetUsd.max);
    if (budgetErr) return budgetErr;
  }
  const err =
    numIn('spikeFactor', R.spikeFactor.min, R.spikeFactor.max) ??
    numIn('spikeMinUsd', R.spikeMinUsd.min, R.spikeMinUsd.max) ??
    numIn('spikeTotalMinUsd', R.spikeTotalMinUsd.min, R.spikeTotalMinUsd.max) ??
    intIn('digestWeekday', 0, 6) ??
    intIn('digestHour', 0, 23) ??
    boolIn('projectedAlert') ??
    boolIn('digestEnabled');
  if (err) return err;
  if (b.resendPlan !== undefined) {
    if (typeof b.resendPlan !== 'string' || !(b.resendPlan in RESEND_PLANS)) return `resendPlan must be one of ${Object.keys(RESEND_PLANS).join(', ')}`;
    out.resendPlan = b.resendPlan as ResendPlan;
  }
  if (b.budgetLevels !== undefined) {
    const lv = b.budgetLevels;
    if (!Array.isArray(lv) || lv.length < R.levelCount.min || lv.length > R.levelCount.max) return `budgetLevels must list ${R.levelCount.min} to ${R.levelCount.max} levels`;
    for (const x of lv) if (typeof x !== 'number' || !Number.isFinite(x) || x < R.budgetLevel.min || x > R.budgetLevel.max) return `each budget level is a share from ${R.budgetLevel.min} to ${R.budgetLevel.max} (${R.budgetLevel.min * 100}% to ${R.budgetLevel.max * 100}%)`;
    out.budgetLevels = [...new Set(lv.map((x) => Math.round((x as number) * 100) / 100))].sort((x, y) => x - y);
  }
  return out;
}

/** Parses the stored JSON over the defaults (a bad or partial row falls back key by key). */
export function parseCostAlertSettings(json: string | null | undefined): CostAlertSettings {
  if (!json) return { ...COST_ALERT_DEFAULTS, budgetLevels: [...COST_ALERT_DEFAULTS.budgetLevels] };
  try {
    const merged = mergeCostAlertSettings({ ...COST_ALERT_DEFAULTS, budgetLevels: [...COST_ALERT_DEFAULTS.budgetLevels] }, JSON.parse(json));
    return typeof merged === 'string' ? { ...COST_ALERT_DEFAULTS, budgetLevels: [...COST_ALERT_DEFAULTS.budgetLevels] } : merged;
  } catch {
    return { ...COST_ALERT_DEFAULTS, budgetLevels: [...COST_ALERT_DEFAULTS.budgetLevels] };
  }
}

/** Alert kinds an admin can opt into (O24: register-based, nobody gets anything by default). */
export const COST_ALERT_KINDS = ['budget', 'spike', 'digest'] as const;
export type CostAlertKind = (typeof COST_ALERT_KINDS)[number];

// ---------------------------------------------------------------------------------------------
// Products (dashboard breakdown). Cloudflare kinds come from ops_daily; the rest from
// cost_product_daily (collector) or the older per-app sources.
// ---------------------------------------------------------------------------------------------

export const COST_PRODUCTS = ['workers', 'd1', 'kv', 'r2', 'queues', 'durable_objects', 'containers', 'workers_ai', 'bunny', 'resend', 'plan'] as const;
export type CostProduct = (typeof COST_PRODUCTS)[number];

/** Envs a cost can belong to; 'account' is account-wide (Bunny, Resend, Workers AI, the plan). */
export const COST_ENVS = ['production', 'stage', 'qa', 'account'] as const;
export type CostEnv = (typeof COST_ENVS)[number];

/** Resend list prices (2026-11): monthly plans with included emails; overage per 1,000 on paid plans. */
export const RESEND_PLANS = {
  free: { monthlyUsd: 0, included: 3000, overagePer1000: 0 },
  pro: { monthlyUsd: 20, included: 50_000, overagePer1000: 0.9 },
  scale: { monthlyUsd: 90, included: 100_000, overagePer1000: 0.9 },
} as const;
export type ResendPlan = keyof typeof RESEND_PLANS;
