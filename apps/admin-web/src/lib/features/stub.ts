/**
 * The Features page without admin-api (FEATURES_STUB=1): local renders, screenshots and the page's
 * own tests. Never set on a deployed worker. It follows admin-api's contract (wiki AUN-FEATURES
 * §3–§5): registry order, versions, 409 feature_changed and feature_precondition, history pages of 50.
 *
 * The cookie `features_stub` picks a scenario and keeps one state per value, so each browser
 * context starts fresh: `<scenario>[:<run id>]`, scenario one of
 *   default       every switch at a lived-in value (needs setup, an environment override, history)
 *   uploadsOff    Uploads off, so Move from YouTube and Extra audio tracks wait for it
 *   conflict      the next write finds that someone else changed the feature first
 *   loadError     the list can't be read
 *   slow          the list takes 20 s (the loading skeleton)
 */
import { cookies } from 'next/headers';
import { FEATURE_REGISTRY, blockedBy, withDefaults, type FeatureKey } from '@al-ummah/shared-types';
import type { FeatureHistoryEntry, FeatureHistoryPage, FeatureItem, FeatureWriteResult } from '@/lib/api/features';
import { getAdminSession } from '@/lib/auth';
import { isSuperAdmin, normalizeRole } from '@/lib/roles';

type Scenario = 'default' | 'uploadsOff' | 'conflict' | 'loadError' | 'slow';
const SCENARIOS: readonly Scenario[] = ['default', 'uploadsOff', 'conflict', 'loadError', 'slow'];

interface StoredRow {
  enabled: boolean;
  version: number;
  updatedAt: string | null;
  updatedBy: { id: string; name: string } | null;
  parked: number;
}

interface StubState {
  rows: Map<FeatureKey, StoredRow>;
  history: Map<FeatureKey, FeatureHistoryEntry[]>;
  conflictPending: boolean;
}

const FATIMA = { id: 'u-fatima', name: 'Fatima Rahman' };
const YUSUF = { id: 'u-yusuf', name: 'Yusuf Ali' };
const AMINA = { id: 'u-amina', name: 'Amina Yusuf' };
const PEOPLE = [FATIMA, YUSUF, AMINA];

/** A fixed clock, so frames and tests never move: 2026-11-22 15:40 UTC. */
const NOW = Date.UTC(2026, 10, 22, 15, 40);
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

const states = new Map<string, StubState>();

function seed(scenario: Scenario): StubState {
  const rows = new Map<FeatureKey, StoredRow>();
  const history = new Map<FeatureKey, FeatureHistoryEntry[]>();
  for (const def of FEATURE_REGISTRY) rows.set(def.key, { enabled: def.default, version: 0, updatedAt: null, updatedBy: null, parked: 0 });

  const change = (key: FeatureKey, values: boolean[], by: (typeof PEOPLE)[number][], minutesAgo: number[]) => {
    const entries: FeatureHistoryEntry[] = [];
    let old: boolean | null = null;
    values.forEach((v, i) => {
      entries.unshift({ id: `${key}-${i}`, oldEnabled: old, newEnabled: v, actor: by[i % by.length], source: i > 0 && values[i - 1] !== v && i % 7 === 3 ? 'undo' : 'features_page', createdAt: ago(minutesAgo[i]) });
      old = v;
    });
    const row = rows.get(key)!;
    row.enabled = values[values.length - 1];
    row.version = values.length;
    row.updatedAt = ago(minutesAgo[minutesAgo.length - 1]);
    row.updatedBy = by[(values.length - 1) % by.length];
    history.set(key, entries);
  };

  // A long history on one row, so the sheet shows a second page
  const flips = Array.from({ length: 63 }, (_, i) => i % 2 === 0);
  change('youtubeImport', flips, PEOPLE, Array.from({ length: 63 }, (_, i) => (63 - i) * 1440 + 95));
  change('newsletter', [false, true], [YUSUF, FATIMA], [4320, 2905]);
  change('captionsTranslate', [false, true], [AMINA, AMINA], [180, 178]);
  change('tierRequests', [true], [FATIMA], [26]);
  change('socialAutopost', [false, true], [YUSUF, YUSUF], [10080, 9990]);

  if (scenario === 'uploadsOff') {
    change('upload', [false], [FATIMA], [12]);
    rows.get('youtubeImport')!.parked = 3;
    rows.get('audioTracks')!.parked = 0;
  }
  return { rows, history, conflictPending: scenario === 'conflict' };
}

async function current(): Promise<{ scenario: Scenario; state: StubState }> {
  let value = 'default';
  try {
    value = (await cookies()).get('features_stub')?.value || 'default';
  } catch {
    // outside a request (unit tests): the default scenario
  }
  const name = value.split(':')[0] as Scenario;
  const scenario = SCENARIOS.includes(name) ? name : 'default';
  let state = states.get(value);
  if (!state) {
    state = seed(scenario);
    states.set(value, state);
  }
  return { scenario, state };
}

async function viewerRole(): Promise<{ manage: boolean; superAdmin: boolean }> {
  const role = normalizeRole((await getAdminSession())?.user.role);
  return { manage: role === 'admin' || role === 'super_admin', superAdmin: isSuperAdmin(role) };
}

function toItem(state: StubState, key: FeatureKey, who: { manage: boolean; superAdmin: boolean }): FeatureItem {
  const def = FEATURE_REGISTRY.find((d) => d.key === key)!;
  const stored = withDefaults(Object.fromEntries([...state.rows].map(([k, r]) => [k, r.enabled])));
  const row = state.rows.get(key)!;
  const envOverride = key === 'aiCategorySuggest';
  const ready = key !== 'youtubeImport';
  const blocked = blockedBy(key, stored);
  return {
    key,
    enabled: row.enabled,
    effective: row.enabled && blocked.length === 0 && !envOverride,
    blockedBy: blocked,
    ready,
    setupNote: ready ? null : { en: 'no Google client yet', ar: 'لم يُضف عميل Google بعد' },
    envOverride,
    parked: row.parked,
    version: row.version,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
    canToggle: who.manage && !envOverride && (def.toggle === 'admin' || who.superAdmin),
  };
}

export async function stubList(): Promise<FeatureItem[]> {
  const { scenario, state } = await current();
  if (scenario === 'loadError') throw new Error('Admin API unreachable');
  if (scenario === 'slow') await new Promise((r) => setTimeout(r, 20_000));
  const who = await viewerRole();
  return FEATURE_REGISTRY.map((d) => toItem(state, d.key, who));
}

export async function stubSet(key: FeatureKey, enabled: boolean, expectedVersion: number, opts: { undo?: boolean }): Promise<FeatureWriteResult> {
  const { state } = await current();
  const who = await viewerRole();
  const item = toItem(state, key, who);
  if (!item.canToggle) return { ok: false, kind: 'error', status: 403, message: 'You can’t change this feature.', code: 'forbidden' };
  const row = state.rows.get(key)!;
  if (state.conflictPending) {
    // Someone else got there first: they made the change this admin was about to make
    state.conflictPending = false;
    row.enabled = enabled;
    row.version += 1;
    row.updatedAt = new Date(NOW - 20_000).toISOString();
    row.updatedBy = YUSUF;
    return { ok: false, kind: 'changed', feature: toItem(state, key, who), message: 'Someone else changed this feature.' };
  }
  if (row.version !== expectedVersion) return { ok: false, kind: 'changed', feature: item, message: 'Someone else changed this feature.' };
  if (key === 'creatorSupport' && enabled) {
    return { ok: false, kind: 'precondition', message: 'Creator support can’t be switched on yet: the organisation isn’t formed and there is no finance approver.' };
  }
  const previous = row.enabled;
  row.enabled = enabled;
  row.version += 1;
  row.updatedAt = new Date(NOW).toISOString();
  row.updatedBy = { id: 'u-shot', name: 'Maryam Hassan' };
  const entries = state.history.get(key) ?? [];
  entries.unshift({ id: `${key}-w${row.version}`, oldEnabled: previous, newEnabled: enabled, actor: row.updatedBy, source: opts.undo ? 'undo' : 'features_page', createdAt: row.updatedAt });
  state.history.set(key, entries);
  return { ok: true, data: { previous, enabled, version: row.version } };
}

export async function stubHistory(key: FeatureKey, cursor: string | null): Promise<FeatureHistoryPage> {
  const { state } = await current();
  const all = state.history.get(key) ?? [];
  const start = cursor ? Number(cursor) || 0 : 0;
  const entries = all.slice(start, start + 50);
  return { entries, nextCursor: start + 50 < all.length ? String(start + 50) : null };
}
