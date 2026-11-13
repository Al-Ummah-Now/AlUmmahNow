/**
 * Pure status logic (unit-tested in test/state.test.ts): the debounce that
 * turns raw check results into the public state, the effective state once
 * incidents and maintenance are applied, and the uptime math.
 */
import type { ComponentState, IncidentImpact } from '@al-ummah/shared-types';
import type { RawState } from './checks';

export type CheckedState = 'operational' | 'degraded' | 'partial' | 'major';

export const SEVERITY: Record<ComponentState, number> = { operational: 0, maintenance: 1, degraded: 2, partial: 3, major: 4 };

export function worst<T extends ComponentState>(a: T, b: T): T {
  return SEVERITY[b] > SEVERITY[a] ? b : a;
}
function mildest(a: CheckedState, b: CheckedState): CheckedState {
  return SEVERITY[b] < SEVERITY[a] ? b : a;
}

export interface StoredState {
  state: CheckedState;
  raw: RawState;
  streak: number;
  since: string;
}

export interface Transition {
  next: StoredState;
  changed: boolean;
  from: CheckedState | null;
}

/**
 * Debounce: the public state changes only when two runs in a row agree it
 * should, in either direction (worse or better). With two different bad
 * results in a row (partial then major) it takes the milder one. A run that
 * could not check anything (`unknown`) changes nothing.
 */
export function advance(prev: StoredState | null, raw: RawState, at: string): Transition {
  if (!prev) {
    const state: CheckedState = raw === 'unknown' ? 'operational' : raw;
    return { next: { state, raw, streak: 1, since: at }, changed: false, from: null };
  }
  const streak = raw === prev.raw ? prev.streak + 1 : 1;
  if (raw === 'unknown' || prev.raw === 'unknown') {
    return { next: { ...prev, raw, streak }, changed: false, from: prev.state };
  }
  const cur = SEVERITY[prev.state];
  let state = prev.state;
  if (SEVERITY[raw] > cur && SEVERITY[prev.raw] > cur) state = mildest(raw, prev.raw);
  else if (SEVERITY[raw] < cur && SEVERITY[prev.raw] < cur) state = worstChecked(raw, prev.raw);
  const changed = state !== prev.state;
  return { next: { state, raw, streak, since: changed ? at : prev.since }, changed, from: prev.state };
}

function worstChecked(a: CheckedState, b: CheckedState): CheckedState {
  return SEVERITY[b] > SEVERITY[a] ? b : a;
}

/** States that open an admin alert. */
export function isOutage(state: ComponentState): boolean {
  return state === 'partial' || state === 'major';
}

/** What the page shows: the checked state, made worse by open incidents; an active maintenance window shows as maintenance unless the checks see worse than degraded. */
export function effectiveState(checked: CheckedState, impacts: IncidentImpact[], inMaintenance: boolean): ComponentState {
  let s: ComponentState = checked;
  for (const i of impacts) if (i !== 'none' && i !== 'maintenance') s = worst(s, i);
  if (inMaintenance && SEVERITY[s] <= SEVERITY.degraded) return 'maintenance';
  return s;
}

/** Headline for the whole page from the components' states. */
export function overallState(states: ComponentState[]): ComponentState {
  return states.reduce<ComponentState>((acc, s) => worst(acc, s), 'operational');
}

export interface DayCounts {
  day: string;
  operational: number;
  degraded: number;
  partial: number;
  major: number;
  maintenance: number;
  unknown: number;
}

/** A partial outage counts as this share of downtime (Statuspage's convention). */
export const PARTIAL_WEIGHT = 0.3;

/** Uptime of some days (0..1), or null with no checked runs. Maintenance and unknown runs are left out. */
export function uptime(days: Omit<DayCounts, 'day'>[]): number | null {
  let counted = 0;
  let down = 0;
  for (const d of days) {
    counted += d.operational + d.degraded + d.partial + d.major;
    down += d.major + PARTIAL_WEIGHT * d.partial;
  }
  return counted ? 1 - down / counted : null;
}

export type BarLevel = 'operational' | 'degraded' | 'partial' | 'major' | 'maintenance' | 'none';

/** One day's bar: the worst state the component was in that day. */
export function dayLevel(d: Omit<DayCounts, 'day'> | undefined): BarLevel {
  if (!d) return 'none';
  if (d.major) return 'major';
  if (d.partial) return 'partial';
  if (d.degraded) return 'degraded';
  if (d.operational) return 'operational';
  if (d.maintenance) return 'maintenance';
  return 'none';
}

/** The last `n` UTC days ending today, oldest first (YYYY-MM-DD). */
export function lastDays(now: Date, n: number): string[] {
  const out: string[] = [];
  const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (let i = n - 1; i >= 0; i--) out.push(new Date(base - i * 86_400_000).toISOString().slice(0, 10));
  return out;
}

/** Rounds down so 99.996% never shows as 100% (two decimals). */
export function formatUptime(u: number | null): string | null {
  if (u === null) return null;
  return (Math.floor(u * 10_000) / 100).toFixed(2);
}
