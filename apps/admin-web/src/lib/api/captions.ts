'use server';

/**
 * Captions & translation settings (admin-api /api/content/captions/*, AUN-CAPTIONS §10, O2, O4–O7).
 * Videos-side settings: admin-api checks creators:manage and audits every change.
 */
import type { AdminAuditEntry, DeeplKeyView, DeeplUsageResult } from '@al-ummah/shared-types';
import { AdminApiError, type ActionResult } from './errors';
import { requestAdmin, navigateForPasskey } from './request';

export interface CaptionSettings {
  monthlyBudgetUsd: number;
  model: string;
  translation: { enabled: boolean; model: string; fallbackModel: string; deepl: boolean; deeplLanguages: string[] };
  inline: { enabled: boolean; dailyItems: number; monthlyBudgetUsd: number };
  viewerTitles: { enabled: boolean };
}

export interface QuranEdition {
  language: string;
  id: number;
  name: string;
  source: 'platform' | 'default';
}

export interface CaptionSettingsView {
  settings: CaptionSettings;
  /** A DeepL key is usable now (the admin's or a bound deployment secret) */
  deeplKeyBound: boolean;
  deeplKeySource?: 'admin' | 'binding' | null;
  /** The DeepL key set on this page (never the key itself); null when its state could not be read */
  deeplKey?: DeeplKeyView | null;
  editions: QuranEdition[];
  translations30d: Array<{ kind: 'inline' | 'caption' | 'viewer'; requests: number; items: number; cached: number }>;
  audit: AdminAuditEntry[];
}

async function fetchAdmin<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  return (await requestAdmin(endpoint, options)).result as T;
}

async function mutate<T>(endpoint: string, method: string, body?: unknown): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fetchAdmin<T>(endpoint, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }) };
  } catch (error) {
    await navigateForPasskey(error);
    if (error instanceof AdminApiError) return { ok: false, status: error.status, error: error.message, ...(error.code ? { code: error.code } : {}) };
    return { ok: false, status: 500, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function getCaptionSettings(): Promise<CaptionSettingsView> {
  return fetchAdmin<CaptionSettingsView>('/api/content/captions/settings');
}

export async function saveCaptionSettings(patch: Partial<CaptionSettings>): Promise<ActionResult<{ settings: CaptionSettings }>> {
  return mutate('/api/content/captions/settings', 'PUT', patch);
}

export async function listQuranEditions(language: string): Promise<ActionResult<{ editions: Array<{ id: number; name: string; author?: string }> }>> {
  return mutate(`/api/content/captions/quran-translations/editions?language=${encodeURIComponent(language)}`, 'GET');
}

export async function setQuranEdition(language: string, id: number): Promise<ActionResult<{ editions: QuranEdition[] }>> {
  return mutate(`/api/content/captions/quran-translations/${encodeURIComponent(language)}`, 'PUT', { id });
}

export async function resetQuranEdition(language: string): Promise<ActionResult<{ editions: QuranEdition[] }>> {
  return mutate(`/api/content/captions/quran-translations/${encodeURIComponent(language)}`, 'DELETE');
}

/**
 * The DeepL API key (super admins; AUN-CAPTIONS DEEPL-KEY). The key passes through here once, to
 * admin-api, which seals and tests it: it is never logged, returned or kept.
 */
export interface DeeplKeyResult {
  deeplKey: DeeplKeyView;
  test?: DeeplUsageResult;
}

export async function saveDeeplKey(value: string): Promise<ActionResult<DeeplKeyResult>> {
  return mutate('/api/content/captions/deepl-key', 'PUT', { value });
}

export async function testDeeplKey(): Promise<ActionResult<DeeplKeyResult>> {
  return mutate('/api/content/captions/deepl-key/test', 'POST');
}

export async function removeDeeplKey(): Promise<ActionResult<DeeplKeyResult>> {
  return mutate('/api/content/captions/deepl-key', 'DELETE');
}
