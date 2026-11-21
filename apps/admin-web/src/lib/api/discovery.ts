'use server';

/**
 * Discovery (admin-api /api/discovery, wiki E07 "Discovery ranking"): pins, exclusions, the home
 * page's rail order, rank now and preview.
 */
import type { DiscoveryAdminState, DiscoveryExclusionView, DiscoveryHomeRailView, DiscoveryPinKind, DiscoveryPinView, DiscoveryPreviewItem } from '@al-ummah/shared-types';
import { AdminApiError, type ActionResult } from './errors';
import { fetchAdmin, navigateForPasskey } from './request';

export type DiscoveryResult<T> = ActionResult<T> & { fields?: Record<string, string> };

async function mutate<T>(endpoint: string, method: string, body?: unknown): Promise<DiscoveryResult<T>> {
  try {
    const data = await fetchAdmin<T>(endpoint, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { ok: true, data };
  } catch (error) {
    await navigateForPasskey(error);
    if (error instanceof AdminApiError) {
      return { ok: false, status: error.status, error: error.message, ...(error.code ? { code: error.code } : {}), ...(error.fields ? { fields: error.fields } : {}) };
    }
    return { ok: false, status: 500, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export interface DiscoveryHistoryEntry {
  id: string;
  action: string;
  kind: string;
  targetId: string;
  title: string | null;
  details: Record<string, unknown> | null;
  previous: Record<string, unknown> | null;
  actorId: string;
  actorName: string | null;
  createdAt: string;
}

export interface DiscoveryPinInput {
  rail: string;
  kind: DiscoveryPinKind;
  target: string;
  position: number;
  startsAt?: string | null;
  endsAt?: string | null;
  note?: string | null;
}

export async function getDiscoveryState(): Promise<DiscoveryAdminState> {
  return fetchAdmin<DiscoveryAdminState>('/api/discovery');
}

export async function discoveryHistory(limit = 20): Promise<DiscoveryHistoryEntry[]> {
  return (await fetchAdmin<{ entries: DiscoveryHistoryEntry[] }>(`/api/discovery/history?limit=${limit}`)).entries;
}

export async function addDiscoveryPin(input: DiscoveryPinInput) {
  return mutate<{ pin: DiscoveryPinView; ranking: boolean }>('/api/discovery/pins', 'POST', input);
}

export async function updateDiscoveryPin(id: string, patch: { position?: number; startsAt?: string | null; endsAt?: string | null; note?: string | null }) {
  return mutate<{ pin: DiscoveryPinView; changed: boolean }>(`/api/discovery/pins/${encodeURIComponent(id)}`, 'PATCH', patch);
}

export async function removeDiscoveryPin(id: string) {
  return mutate<{ pin: DiscoveryPinView }>(`/api/discovery/pins/${encodeURIComponent(id)}`, 'DELETE');
}

export async function addDiscoveryExclusion(input: { kind: DiscoveryPinKind; target: string; reason?: string | null }) {
  return mutate<{ exclusion: DiscoveryExclusionView; ranking: boolean }>('/api/discovery/exclusions', 'POST', input);
}

export async function removeDiscoveryExclusion(kind: DiscoveryPinKind, targetId: string) {
  return mutate<{ kind: DiscoveryPinKind; targetId: string; reason: string | null }>(`/api/discovery/exclusions/${kind}/${encodeURIComponent(targetId)}`, 'DELETE');
}

export async function saveDiscoveryHomeRails(rails: DiscoveryHomeRailView[]) {
  return mutate<{ homeRails: DiscoveryHomeRailView[]; changed: boolean }>('/api/discovery/home-rails', 'PUT', { rails });
}

export async function runDiscoveryRanking() {
  return mutate<{ job: unknown; existing: boolean }>('/api/discovery/run', 'POST', {});
}

export async function previewDiscoveryRail(rail: string, scope: string) {
  return mutate<{ rail: string; scope: string; meta: { label: string; mode: string; items: number; signalItems: number; computedAt: string } | null; items: DiscoveryPreviewItem[] }>(
    `/api/discovery/preview?rail=${encodeURIComponent(rail)}&scope=${encodeURIComponent(scope)}&limit=24`,
    'GET',
  );
}
