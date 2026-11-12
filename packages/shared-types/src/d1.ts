// D1 Database Types - Shared across services using Cloudflare D1

export interface D1Database {
  prepare: (sql: string) => D1PreparedStatement;
  batch: <T = unknown>(statements: D1PreparedStatement[]) => Promise<D1Result<T>[]>;
  exec: (sql: string) => Promise<D1ExecResult>;
}

export interface D1PreparedStatement {
  bind: (...values: unknown[]) => D1PreparedStatement;
  first: <T = unknown>(colName?: string) => Promise<T | null>;
  run: () => Promise<D1Result>;
  all: <T = unknown>() => Promise<D1Result<T>>;
}

export interface D1Result<T = unknown> {
  results?: T[];
  success: boolean;
  error?: string;
  meta?: object;
}

export interface D1ExecResult {
  count: number;
  duration: number;
}

/**
 * D1 refuses a LIKE or GLOB pattern longer than 50 bytes ("LIKE or GLOB pattern too complex"),
 * so a search box that wraps the whole input in `%...%` fails on a long email or title.
 */
export const D1_LIKE_PATTERN_MAX_BYTES = 50;

const utf8Length = (s: string): number => new TextEncoder().encode(s).length;

/**
 * `%term%` for `LIKE ? ESCAPE '\\'`: the term's `\`, `%` and `_` escaped, cut to D1's 50-byte
 * limit. A longer term keeps its start (whole characters and escape pairs), so the search still
 * finds what the full term would have, plus anything sharing that start; callers that need an
 * exact hit on a long value add an `=` comparison next to the LIKE.
 */
export function containsPattern(term: string): string {
  const parts = Array.from(term).map((ch) => (ch === '\\' || ch === '%' || ch === '_' ? `\\${ch}` : ch));
  let budget = D1_LIKE_PATTERN_MAX_BYTES - 2;
  let out = '';
  for (const part of parts) {
    const size = utf8Length(part);
    if (size > budget) break;
    out += part;
    budget -= size;
  }
  return `%${out}%`;
}
