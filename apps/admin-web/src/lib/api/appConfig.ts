'use server';

/**
 * Remote config and feature flags for the native apps (issue #413): admin-api /api/app-config,
 * which reads and writes api-videos' APP_CONFIG documents with the service key (it never reaches
 * the browser), checks settings:manage and audits every change.
 */
import type { AppConfigContext, AppConfigDocumentKey, AppConfigResult } from '@al-ummah/shared-types';
import { AdminApiError, type ActionResult } from './errors';
import { fetchAdmin, navigateForPasskey } from './request';

export interface AppConfigHistoryEntry {
  id: string;
  actorId: string;
  actorName: string | null;
  createdAt: string;
}

async function action<T>(run: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await run() };
  } catch (error) {
    await navigateForPasskey(error);
    if (error instanceof AdminApiError) {
      return { ok: false, status: error.status, error: error.message, ...(error.code ? { code: error.code } : {}), ...(error.problems ? { problems: error.problems } : {}) };
    }
    return { ok: false, status: 500, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/** The stored document (null when it has never been set). */
export async function getAppConfigDocument(key: AppConfigDocumentKey): Promise<unknown> {
  const { value } = await fetchAdmin<{ key: string; value: unknown }>(`/api/app-config/${key}`);
  return value;
}

export async function getAppConfigHistory(key: AppConfigDocumentKey): Promise<AppConfigHistoryEntry[]> {
  const { entries } = await fetchAdmin<{ entries: AppConfigHistoryEntry[] }>(`/api/app-config/${key}/history?limit=5`);
  return entries;
}

/** Replaces a document. `expected` is what the editor started from: a newer stored one answers 409 (code conflict). */
export async function saveAppConfigDocument(key: AppConfigDocumentKey, value: unknown, expected: unknown): Promise<ActionResult<{ key: string; value: unknown }>> {
  return action(() => fetchAdmin(`/api/app-config/${key}`, { method: 'PUT', body: JSON.stringify({ value, expected }) }));
}

/** Dry run: what a build would get from the drafts (documents left out are the stored ones). Nothing is written. */
export async function evaluateAppConfig(context: AppConfigContext, documents: Partial<Record<AppConfigDocumentKey, unknown>>): Promise<ActionResult<AppConfigResult>> {
  return action(() => fetchAdmin<AppConfigResult>('/api/app-config/evaluate', { method: 'POST', body: JSON.stringify({ context, documents }) }));
}
