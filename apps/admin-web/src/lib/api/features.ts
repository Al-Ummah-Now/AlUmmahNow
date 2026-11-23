'use server';

/**
 * The Features page (wiki AUN-FEATURES §3–§4, decision O39) through admin-api /api/features.
 * Every admin role reads (features:read); a change needs features:manage, and super-admin-only
 * switches need a super admin (admin-api checks it on every write and audits it).
 *
 * Writes return an ActionResult instead of throwing, because production builds redact server-action
 * error messages. The message shown for a refused write is the server's own, in the admin's
 * language (O40): this asks for it with Accept-Language.
 *
 * With FEATURES_STUB=1 (local renders and screenshots only, never set on a deployed worker) the
 * answers come from an in-memory fixture (lib/features/stub.ts) instead of admin-api.
 */
import type { FeatureKey, FeatureText } from '@al-ummah/shared-types';
import { getI18n } from '@/i18n/server';
import { AdminApiError } from './errors';
import { navigateForPasskey, requestAdmin } from './request';

export interface FeatureActor {
  id: string;
  name: string;
}

/** One row of GET /api/features, in registry order. */
export interface FeatureItem {
  key: FeatureKey;
  /** The stored switch */
  enabled: boolean;
  /** On for people: stored, and every feature it requires is on, and no environment override */
  effective: boolean;
  /** The required features that are off (wiki §2.2) */
  blockedBy: FeatureKey[];
  /** Set up enough to work (keys, clients); false shows "needs setup" while on */
  ready: boolean;
  /** What is missing, in both languages, when not ready */
  setupNote: FeatureText | null;
  /** Off in this environment by an operations override (AI_CATEGORIZE_ENABLED=false): locked */
  envOverride: boolean;
  /** Background jobs waiting for it to come back on */
  parked: number;
  /** Bumped by every write; a write sends the version it saw */
  version: number;
  updatedAt: string | null;
  updatedBy: FeatureActor | null;
  /** This admin may change it (features:manage, and a super admin for super-admin-only rows) */
  canToggle: boolean;
}

export interface FeatureHistoryEntry {
  id: string;
  /** null: the first change from the default */
  oldEnabled: boolean | null;
  newEnabled: boolean;
  actor: FeatureActor;
  source: 'features_page' | 'undo';
  createdAt: string;
}

export interface FeatureHistoryPage {
  entries: FeatureHistoryEntry[];
  nextCursor: string | null;
}

export interface FeatureWrite {
  previous: boolean;
  enabled: boolean;
  version: number;
}

/**
 * A refused write. `changed`: someone else changed it first (409 feature_changed), with the row as
 * it is now. `precondition`: admin-api refuses to switch it on yet (409 feature_precondition), with
 * a localized reason. `error`: anything else, with the server's message.
 */
export type FeatureWriteResult =
  | { ok: true; data: FeatureWrite }
  | { ok: false; kind: 'changed'; feature: FeatureItem; message: string }
  | { ok: false; kind: 'precondition'; message: string }
  | { ok: false; kind: 'error'; status: number; message: string; code?: string };

async function stubModule(): Promise<typeof import('@/lib/features/stub') | null> {
  if (process.env.FEATURES_STUB !== '1') return null;
  return import('@/lib/features/stub');
}

async function languageHeaders(): Promise<Record<string, string>> {
  try {
    const { locale } = await getI18n();
    return { 'Accept-Language': locale };
  } catch {
    return {};
  }
}

export async function listFeatures(): Promise<FeatureItem[]> {
  const stub = await stubModule();
  if (stub) return stub.stubList();
  const body = await requestAdmin('/api/features', { headers: await languageHeaders() });
  return Array.isArray(body.features) ? (body.features as FeatureItem[]) : [];
}

export async function setFeature(key: FeatureKey, enabled: boolean, expectedVersion: number, opts: { undo?: boolean } = {}): Promise<FeatureWriteResult> {
  const stub = await stubModule();
  if (stub) return stub.stubSet(key, enabled, expectedVersion, opts);
  try {
    const body = await requestAdmin(`/api/features/${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: await languageHeaders(),
      body: JSON.stringify({ enabled, expectedVersion, ...(opts.undo ? { undo: true } : {}) }),
    });
    return { ok: true, data: { previous: Boolean(body.previous), enabled: Boolean(body.enabled), version: Number(body.version) } };
  } catch (error) {
    await navigateForPasskey(error);
    if (error instanceof AdminApiError) {
      const message = typeof error.body?.message === 'string' && error.body.message ? error.body.message : error.message;
      const current = error.body?.feature as FeatureItem | undefined;
      if (error.status === 409 && error.code === 'feature_changed' && current) return { ok: false, kind: 'changed', feature: current, message };
      if (error.status === 409 && error.code === 'feature_precondition') return { ok: false, kind: 'precondition', message };
      return { ok: false, kind: 'error', status: error.status, message, ...(error.code ? { code: error.code } : {}) };
    }
    return { ok: false, kind: 'error', status: 500, message: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function featureHistory(key: FeatureKey, cursor?: string | null): Promise<FeatureHistoryPage> {
  const stub = await stubModule();
  if (stub) return stub.stubHistory(key, cursor ?? null);
  const q = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  const body = await requestAdmin(`/api/features/${encodeURIComponent(key)}/history${q}`, { headers: await languageHeaders() });
  return { entries: Array.isArray(body.entries) ? (body.entries as FeatureHistoryEntry[]) : [], nextCursor: typeof body.nextCursor === 'string' ? body.nextCursor : null };
}
