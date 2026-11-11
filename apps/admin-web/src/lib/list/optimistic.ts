/**
 * Optimistic row updates for the admin lists.
 *
 * A change shows in the list at once as an override (a patch, or "removed")
 * on top of the rows the API returned. A failed change drops its own override
 * (rollback), leaving any later change in place. A change that worked keeps
 * its override until the API's rows agree or it expires: admin-api reads the
 * lists from an index the processor updates a moment later, so refetching right
 * away would briefly show the old value again.
 *
 * Pure: the hooks keep the overrides in the query cache; the unit tests use it directly.
 */

export type RowPatch<T> = Partial<T>;

export interface RowOverride<T> {
  /** One change (a mutation); its rollback removes only this override. */
  token: string;
  ids: string[];
  /** The fields to show, or 'remove' to hide the rows (a delete). */
  patch: RowPatch<T> | 'remove';
  /** After this (ms since epoch) the API's rows are trusted again. */
  expiresAt: number;
  /** Set once the change succeeded; until then the API's rows never clear it. */
  confirmed: boolean;
}

/** How long a confirmed change outranks the API's rows (the index normally catches up in seconds). */
export const OVERRIDE_TTL_MS = 60_000;

export function addOverride<T>(overrides: readonly RowOverride<T>[], override: Omit<RowOverride<T>, 'expiresAt' | 'confirmed'>, now: number, ttl = OVERRIDE_TTL_MS): RowOverride<T>[] {
  return [...overrides.filter((o) => o.token !== override.token), { ...override, ids: [...override.ids], expiresAt: now + ttl, confirmed: false }];
}

/** Rollback: the change failed, so its override goes; earlier and later changes stay. */
export function rollbackOverride<T>(overrides: readonly RowOverride<T>[], token: string): RowOverride<T>[] {
  return overrides.filter((o) => o.token !== token);
}

/** The change worked: keep showing it until the API agrees or the TTL runs out. */
export function confirmOverride<T>(overrides: readonly RowOverride<T>[], token: string, now: number, ttl = OVERRIDE_TTL_MS): RowOverride<T>[] {
  return overrides.map((o) => (o.token === token ? { ...o, confirmed: true, expiresAt: now + ttl } : o));
}

/** Limits a change to the ids that went through (a bulk change that partly failed). */
export function narrowOverride<T>(overrides: readonly RowOverride<T>[], token: string, ids: readonly string[]): RowOverride<T>[] {
  const keep = new Set(ids);
  return overrides.flatMap((o) => {
    if (o.token !== token) return [o];
    const left = o.ids.filter((id) => keep.has(id));
    return left.length ? [{ ...o, ids: left }] : [];
  });
}

function matches<T extends object>(row: T, patch: RowPatch<T>): boolean {
  return Object.entries(patch).every(([key, value]) => (row as Record<string, unknown>)[key] === value);
}

/**
 * Drops the overrides the API no longer needs: expired ones, and confirmed ones
 * whose rows now read the same (or, for a removal, are gone from the page).
 * Pending changes always stay.
 */
export function pruneOverrides<T extends { id: string }>(overrides: readonly RowOverride<T>[], rows: readonly T[], now: number): RowOverride<T>[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return overrides.filter((o) => {
    if (o.expiresAt <= now) return false;
    if (!o.confirmed) return true;
    if (o.patch === 'remove') return o.ids.some((id) => byId.has(id));
    const patch = o.patch;
    return o.ids.some((id) => {
      const row = byId.get(id);
      return row !== undefined && !matches(row, patch);
    });
  });
}

/** The rows as the admin should see them: every live override applied in order. */
export function applyOverrides<T extends { id: string }>(rows: readonly T[], overrides: readonly RowOverride<T>[], now: number): T[] {
  const live = overrides.filter((o) => o.expiresAt > now);
  if (live.length === 0) return rows as T[];
  const out: T[] = [];
  for (const row of rows) {
    let next: T | null = row;
    for (const o of live) {
      if (!next || !o.ids.includes(row.id)) continue;
      next = o.patch === 'remove' ? null : { ...next, ...o.patch };
    }
    if (next) out.push(next);
  }
  return out;
}

/** How many rows an override set hides, so the total can follow a delete. */
export function removedCount<T extends { id: string }>(rows: readonly T[], overrides: readonly RowOverride<T>[], now: number): number {
  return rows.length - applyOverrides(rows, overrides.filter((o) => o.patch === 'remove'), now).length;
}
