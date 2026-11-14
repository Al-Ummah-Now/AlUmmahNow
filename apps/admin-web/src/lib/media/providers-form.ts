/**
 * The provider settings forms (Delivery page, video page), as pure functions (docs/media-delivery/PROVIDERS.md):
 * list edits, problem labels, and which changes need a confirmation. ProviderSettings.tsx and VideoProvidersPanel.tsx render
 * them; test/media-providers-form.test.ts covers them.
 */
import { MEDIA_PROVIDER_IDS, type MediaOverride, type MediaProviderId, type MediaSettings, type SettingsProblem } from '@al-ummah/shared-types';
import type { MessageKey } from '@/i18n/translate';

export const PROVIDER_LABEL: Record<MediaProviderId, MessageKey> = {
  bunny: 'mediaProviders.bunny',
  r2: 'mediaProviders.r2',
};

export const PROBLEM_LABEL: Record<SettingsProblem, MessageKey> = {
  no_provider_enabled: 'mediaProviders.problem.no_provider_enabled',
  ingest_empty: 'mediaProviders.problem.ingest_empty',
  ingest_disabled: 'mediaProviders.problem.ingest_disabled',
  playback_empty: 'mediaProviders.problem.playback_empty',
  ingest_not_playable: 'mediaProviders.problem.ingest_not_playable',
  weights_zero: 'mediaProviders.problem.weights_zero',
  thumbnail_store_disabled: 'mediaProviders.problem.thumbnail_store_disabled',
  override_ingest_disabled: 'mediaProviders.problem.override_ingest_disabled',
  override_not_playable: 'mediaProviders.problem.override_not_playable',
};

/** Problems the per-video override reports (api-videos lib/media/video-override.ts). */
export const OVERRIDE_PROBLEM_LABEL: Record<string, MessageKey> = {
  not_playable: 'mediaProviders.video.problemNotPlayable',
  weights_zero: 'mediaProviders.video.problemWeightsZero',
  not_found: 'mediaProviders.video.problemNotFound',
  deleted: 'mediaProviders.video.problemNotFound',
};

/** Move a provider one place earlier (-1) or later (+1) in an order; unchanged at the ends. */
export function moveProvider(order: readonly MediaProviderId[], id: MediaProviderId, direction: -1 | 1): MediaProviderId[] {
  const out = [...order];
  const from = out.indexOf(id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= out.length) return out;
  [out[from], out[to]] = [out[to]!, out[from]!];
  return out;
}

/** Add a provider to a list (at the end) or take it out; the order of the others is kept. */
export function toggleProvider(list: readonly MediaProviderId[], id: MediaProviderId, on: boolean): MediaProviderId[] {
  const without = list.filter((p) => p !== id);
  return on ? [...without, id] : without;
}

/** Every provider, the listed ones first in their order (the playback list shows all of them). */
export function withUnlisted(order: readonly MediaProviderId[]): MediaProviderId[] {
  return [...order, ...MEDIA_PROVIDER_IDS.filter((p) => !order.includes(p))];
}

/** A whole number in [min, max], or null. */
export function parseWhole(value: string, min: number, max: number): number | null {
  if (!/^\s*\d{1,6}\s*$/.test(value)) return null;
  const n = Number(value);
  return n >= min && n <= max ? n : null;
}

/** Share of plays each provider gets with these weights, over the providers that play (whole percents). */
export function weightShares(order: readonly MediaProviderId[], weights: Partial<Record<MediaProviderId, number>>): Partial<Record<MediaProviderId, number>> {
  const total = order.reduce((n, p) => n + Math.max(0, weights[p] ?? 0), 0);
  const out: Partial<Record<MediaProviderId, number>> = {};
  for (const p of order) out[p] = total ? Math.round((Math.max(0, weights[p] ?? 0) / total) * 100) : 0;
  return out;
}

export type RiskyChange =
  | { kind: 'provider_off'; provider: MediaProviderId }
  | { kind: 'first_changed'; from: MediaProviderId | null; to: MediaProviderId | null }
  | { kind: 'ingest_dropped'; provider: MediaProviderId };

/**
 * Changes that move live traffic or stop a provider getting new uploads, so the page asks before
 * saving: a provider switched off, a different provider playing first, a provider no longer taking
 * uploads. Weights, health numbers and overrides save without a question.
 */
export function riskyChanges(before: MediaSettings, after: MediaSettings): RiskyChange[] {
  const out: RiskyChange[] = [];
  for (const p of MEDIA_PROVIDER_IDS) if (before.providers[p].enabled && !after.providers[p].enabled) out.push({ kind: 'provider_off', provider: p });
  const first = (s: MediaSettings) => s.playback.order.find((p) => s.providers[p].enabled) ?? null;
  const [from, to] = [first(before), first(after)];
  if (before.playback.strategy === 'priority' && after.playback.strategy === 'priority' && from !== to) out.push({ kind: 'first_changed', from, to });
  for (const p of before.ingest) if (!after.ingest.includes(p) && after.providers[p].enabled) out.push({ kind: 'ingest_dropped', provider: p });
  return out;
}

/** Fields of a channel or video override the editor works with ('' = follow the settings). */
export interface OverrideDraft {
  ingest: MediaProviderId[] | null;
  strategy: '' | 'priority' | 'weighted';
  order: MediaProviderId[] | null;
  weights: Partial<Record<MediaProviderId, string>>;
  note: string;
}

export function draftOf(o: MediaOverride | null | undefined): OverrideDraft {
  return {
    ingest: o?.ingest ? [...o.ingest] : null,
    strategy: o?.strategy ?? '',
    order: o?.order ? [...o.order] : null,
    weights: Object.fromEntries(Object.entries(o?.weights ?? {}).map(([k, v]) => [k, String(v)])) as OverrideDraft['weights'],
    note: o?.note ?? '',
  };
}

/** The override a draft stands for; null when it changes nothing (every field follows the settings). */
export function overrideOf(d: OverrideDraft, opts: { ingest: boolean }): MediaOverride | null {
  const out: MediaOverride = {};
  if (opts.ingest && d.ingest?.length) out.ingest = [...d.ingest];
  if (d.strategy) out.strategy = d.strategy;
  if (d.order?.length) out.order = [...d.order];
  if (d.strategy === 'weighted') {
    const weights: Partial<Record<MediaProviderId, number>> = {};
    for (const p of d.order ?? MEDIA_PROVIDER_IDS) {
      const n = parseWhole(d.weights[p] ?? '', 0, 100);
      if (n !== null) weights[p] = n;
    }
    if (Object.keys(weights).length) out.weights = weights;
  }
  if (!out.ingest && !out.strategy && !out.order && !out.weights) return null;
  if (d.note.trim()) out.note = d.note.trim().slice(0, 200);
  return out;
}

/** Channel ids the settings accept (shared-types normaliseMediaSettings). */
export const CHANNEL_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
