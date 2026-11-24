/**
 * The age rules' numbers (wiki E20 §5.1, §5.2): how old an account must be for each thing. One row in the search
 * D1 (`age_rules`, api-videos migration 0121) next to `feature_switches`: admin-api writes it, api-videos reads it
 * through the same 30-second memo. Videos never knows an age, only the band in the account's token, so a number is
 * one a band can answer: 13, 16 or 18. 13 is Auth's own minimum and no number goes below it.
 */
import { SWITCHES_TTL_MS } from './feature-switch-store';

export const AGE_RULE_KEYS = ['comment', 'post', 'liveChat', 'upload', 'support', 'ageRestricted'] as const;
export type AgeRuleKey = (typeof AGE_RULE_KEYS)[number];

export const AGE_CHOICES = [13, 16, 18] as const;
export type AgeChoice = (typeof AGE_CHOICES)[number];

export type AgeNumbers = Record<AgeRuleKey, AgeChoice>;

/** What the page starts from before the numbers are saved (E20-D3); never used to decide anything. */
export const SUGGESTED_AGE_NUMBERS: Readonly<AgeNumbers> = Object.freeze({ comment: 13, post: 13, liveChat: 16, upload: 13, support: 18, ageRestricted: 18 });

/** Exactly the known keys with allowed numbers, or null. */
export function parseAgeNumbers(raw: unknown): AgeNumbers | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  if (Object.keys(source).length !== AGE_RULE_KEYS.length) return null;
  const out: Partial<AgeNumbers> = {};
  for (const key of AGE_RULE_KEYS) {
    const value = source[key];
    if (!AGE_CHOICES.some((choice) => choice === value)) return null;
    out[key] = value as AgeChoice;
  }
  return out as AgeNumbers;
}

export const sameAgeNumbers = (a: AgeNumbers, b: AgeNumbers): boolean => AGE_RULE_KEYS.every((key) => a[key] === b[key]);

export interface AgeRulesRow {
  numbers: AgeNumbers;
  version: number;
  updatedBy: string;
  updatedAt: string;
}

interface Db {
  prepare(sql: string): {
    bind(...values: unknown[]): { first<T>(): Promise<T | null>; run(): Promise<{ meta?: { changes?: number } }> };
    first<T>(): Promise<T | null>;
  };
}

export interface AgeRulesEnv {
  SEARCH_DB?: unknown;
}

const dbOf = (env: AgeRulesEnv): Db => {
  if (!env.SEARCH_DB) throw new Error('SEARCH_DB is not bound');
  return env.SEARCH_DB as Db;
};

let memo: { db: unknown; at: number; row: AgeRulesRow | null } | null = null;

/** Drops this isolate's memo (after a write here, and in tests). */
export function forgetAgeRules(): void {
  memo = null;
}

/**
 * The saved numbers, at most 30 s old; null: never saved. Throws when they can't be read or are not valid, so a
 * caller refuses (503) instead of guessing an age.
 */
export async function readAgeRules(env: AgeRulesEnv, opts: { fresh?: boolean; now?: number } = {}): Promise<AgeRulesRow | null> {
  const db = dbOf(env);
  const now = opts.now ?? Date.now();
  if (!opts.fresh && memo && memo.db === db && now - memo.at < SWITCHES_TTL_MS) return memo.row;
  const stored = await db
    .prepare('SELECT json, version, updated_by, updated_at FROM age_rules WHERE id = 1')
    .first<{ json: string; version: number; updated_by: string; updated_at: string }>();
  let row: AgeRulesRow | null = null;
  if (stored) {
    const numbers = parseAgeNumbers(JSON.parse(stored.json));
    if (!numbers) throw new Error('The stored age numbers are not valid');
    row = { numbers, version: stored.version, updatedBy: stored.updated_by, updatedAt: stored.updated_at };
  }
  memo = { db, at: now, row };
  return row;
}

/** Saves the numbers if they are still at the version the admin saw (0: never saved). Null: someone else saved meanwhile. */
export async function writeAgeRules(
  env: AgeRulesEnv,
  write: { numbers: AgeNumbers; expectedVersion: number; actorId: string; now?: string },
): Promise<AgeRulesRow | null> {
  const db = dbOf(env);
  const at = write.now ?? new Date().toISOString();
  const json = JSON.stringify(write.numbers);
  const version = write.expectedVersion + 1;
  const statement =
    write.expectedVersion === 0
      ? db.prepare('INSERT INTO age_rules (id, json, version, updated_by, updated_at) VALUES (1, ?, 1, ?, ?) ON CONFLICT (id) DO NOTHING').bind(json, write.actorId, at)
      : db.prepare('UPDATE age_rules SET json = ?, version = ?, updated_by = ?, updated_at = ? WHERE id = 1 AND version = ?').bind(json, version, write.actorId, at, write.expectedVersion);
  const result = await statement.run();
  forgetAgeRules();
  if (result.meta?.changes !== 1) return null;
  return { numbers: write.numbers, version, updatedBy: write.actorId, updatedAt: at };
}

/** A valid account event from Auth this recently means hiding and erasing accounts works (wiki E20 §5.2). */
export const ACCOUNT_EVENTS_MAX_AGE_MS = 48 * 60 * 60 * 1000;

/** When the Videos receiver last recorded a valid account event (E20-B6 writes it), epoch ms; null: never. */
export async function lastAccountEventAt(env: AgeRulesEnv): Promise<number | null> {
  const row = await dbOf(env).prepare('SELECT last_valid_at FROM account_event_status WHERE id = 1').first<{ last_valid_at: number }>();
  return row && Number.isFinite(row.last_valid_at) ? row.last_valid_at : null;
}
