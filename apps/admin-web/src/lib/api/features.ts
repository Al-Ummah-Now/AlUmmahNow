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

import {
  readFeatureHistory,
  readFeatureList,
  readFeatureRefusal,
  readFeatureWrite,
  type FeatureHistoryPage,
  type FeatureItem,
  type FeatureKey,
  type FeatureWriteOutcome,
} from '@al-ummah/shared-types';
import { getI18n } from '@/i18n/server';
import { AdminApiError } from './errors';
import { navigateForPasskey, requestAdmin } from './request';

export type { FeatureActor, FeatureHistoryEntry, FeatureHistoryPage, FeatureItem, FeatureWrite } from '@al-ummah/shared-types';

/**
 * A write's outcome (shared-types features-api.ts, read from admin-api's real answers), plus `error`:
 * any other refusal, with the server's message in the admin's language.
 */
export type FeatureWriteResult = FeatureWriteOutcome | { ok: false; kind: 'error'; status: number; message: string; code?: string };

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

/** One admin-api call; the stub answers the same envelopes and throws the same errors. */
async function call(endpoint: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const stub = await stubModule();
  if (stub) return stub.stubRequest(endpoint, init);
  return requestAdmin(endpoint, { ...init, headers: { ...(await languageHeaders()), ...(init.headers as Record<string, string> | undefined) } });
}

export async function listFeatures(): Promise<FeatureItem[]> {
  return readFeatureList(await call('/api/features'));
}

export async function setFeature(key: FeatureKey, enabled: boolean, expectedVersion: number, opts: { undo?: boolean } = {}): Promise<FeatureWriteResult> {
  try {
    const body = await call(`/api/features/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify({ enabled, expectedVersion, ...(opts.undo ? { undo: true } : {}) }),
    });
    return readFeatureWrite(body, { enabled, expectedVersion });
  } catch (error) {
    await navigateForPasskey(error);
    if (error instanceof AdminApiError) {
      const refusal = readFeatureRefusal(error.status, error.body);
      if (refusal) return refusal;
      const message = typeof error.body?.message === 'string' && error.body.message ? error.body.message : error.message;
      return { ok: false, kind: 'error', status: error.status, message, ...(error.code ? { code: error.code } : {}) };
    }
    return { ok: false, kind: 'error', status: 500, message: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function featureHistory(key: FeatureKey, cursor?: string | null): Promise<FeatureHistoryPage> {
  const q = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return readFeatureHistory(await call(`/api/features/${encodeURIComponent(key)}/history${q}`));
}
