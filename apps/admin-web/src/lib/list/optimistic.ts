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
  /**
   * Set when this change replaced an earlier one on the same rows and fields
   * (an undo): the API agreeing with it may only mean the index has not seen
   * either change yet, so it stays until it expires.
   */
  replaced?: boolean;
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

function keysOf<T>(patch: RowPatch<T> | 'remove'): string[] | null {
  return patch === 'remove' ? null : Object.keys(patch);
}

/** True when `later` sets every field `earlier` sets (or removes the row), so `earlier` no longer shows. */
function covers<T>(later: RowPatch<T> | 'remove', earlier: RowPatch<T> | 'remove'): boolean {
  const l = keysOf(later);
  const e = keysOf(earlier);
  return l === null || (e !== null && e.every((key) => l.includes(key)));
}

/** True when the two changes show something in the same place. */
function overlaps<T>(a: RowPatch<T> | 'remove', b: RowPatch<T> | 'remove'): boolean {
  const ka = keysOf(a);
  const kb = keysOf(b);
  return ka === null || kb === null || ka.some((key) => kb.includes(key));
}

/**
 * Between confirmed changes on the same rows (unpublish, then its undo): an
 * earlier change loses the rows a later one fully replaced, and the later one
 * is marked `replaced`, since the server now holds its value and the API
 * agreeing with it may only mean the index has seen neither change yet.
 */
function dropSuperseded<T>(overrides: readonly RowOverride<T>[]): RowOverride<T>[] {
  const replacing = new Set<number>();
  const left = overrides.map((o, i) => {
    if (!o.confirmed) return o.ids;
    return o.ids.filter((id) => {
      let covered = false;
      overrides.forEach((p, k) => {
        if (k <= i || !p.confirmed || !p.ids.includes(id) || !overlaps(p.patch, o.patch)) return;
        replacing.add(k);
        if (covers(p.patch, o.patch)) covered = true;
      });
      return !covered;
    });
  });
  return overrides.flatMap((o, i) => {
    const ids = left[i];
    if (ids.length === 0 && o.ids.length > 0) return [];
    const replaced = replacing.has(i) && !o.replaced;
    if (ids.length === o.ids.length && !replaced) return [o];
    return [{ ...o, ids, ...(replaced ? { replaced: true } : {}) }];
  });
}

/**
 * Drops the overrides the API no longer needs: confirmed ones a later
 * confirmed change replaced, expired ones, and confirmed ones whose rows now
 * read the same (or, for a removal, are gone from the page). Pending changes,
 * and changes that replaced another, stay until they expire. Unchanged
 * overrides keep their identity.
 */
export function pruneOverrides<T extends { id: string }>(overrides: readonly RowOverride<T>[], rows: readonly T[], now: number): RowOverride<T>[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return dropSuperseded(overrides).filter((o) => {
    if (o.expiresAt <= now) return false;
    if (!o.confirmed || o.replaced) return true;
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
