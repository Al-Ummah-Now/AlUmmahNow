'use server';

/**
 * Machine translation of titles and descriptions (AUN-CAPTIONS §5.8, §5.9): POST /api/translate
 * for the Translate button, GET /api/videos/:id/translated-metadata for viewers, and the channel's
 * viewer-title opt-out.
 */
import type { InlineTranslateField } from '@al-ummah/shared-types';
import { buildApiUrl } from './api-client';
import { getServerAuthContext } from './server-auth';
import { logger } from '@/lib/logger-server';

export type TranslateResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string; resetsAt?: string };

async function call<T>(path: string, init: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<TranslateResult<T>> {
  const auth = init.auth === false ? null : await getServerAuthContext();
  if (init.auth !== false && !auth?.accessToken) return { ok: false, status: 401, error: 'unauthorized' };
  try {
    const res = await fetch(buildApiUrl(path), {
      method: init.method ?? 'GET',
      headers: { 'Content-Type': 'application/json', ...(auth?.accessToken ? { Authorization: `Bearer ${auth.accessToken}` } : {}) },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      cache: 'no-store',
    });
    const json = (await res.json().catch(() => ({}))) as { success?: boolean; data?: T; error?: string; code?: string; resetsAt?: string };
    if (!res.ok || json.success === false) {
      if (res.status >= 500 && res.status !== 503) logger.error('[Translate] Request failed', { path, status: res.status, error: json.error });
      return { ok: false, status: res.status, error: typeof json.error === 'string' ? json.error : typeof json.code === 'string' ? json.code : 'request_failed', ...(typeof json.resetsAt === 'string' ? { resetsAt: json.resetsAt } : {}) };
    }
    return { ok: true, data: json.data as T };
  } catch (error) {
    logger.error('[Translate] Request error', { path, error: error instanceof Error ? error.message : String(error) });
    return { ok: false, status: 0, error: 'network' };
  }
}

export interface InlineTranslation {
  items: Array<{ id: string; text: string; quran?: Array<{ range: string; label: string }>; cached: boolean }>;
  provider: string;
  machineTranslation: true;
  fairUse: { used: number; limit: number; resetsAt: string };
}

/** Translate one or more texts (the Translate button). Text inside {…} is a Quran quotation and stays as written. */
export async function translateTexts(input: { items: Array<{ id: string; text: string }>; from: string; to: string; field?: InlineTranslateField; videoId?: string }): Promise<TranslateResult<InlineTranslation>> {
  return call<InlineTranslation>('/api/translate', { method: 'POST', body: { ...input, field: input.field ?? 'title' } });
}

export interface ViewerTranslation {
  translation: { lang: string; from: string; title: string; description: string | null; provider: string } | null;
  pending: boolean;
}

/** A public video's title and description translated for a viewer (O6: on unless the channel opted out or an admin paused it). */
export async function getTranslatedMetadata(videoId: string, lang: string): Promise<TranslateResult<ViewerTranslation>> {
  return call<ViewerTranslation>(`/api/videos/${encodeURIComponent(videoId)}/translated-metadata?lang=${encodeURIComponent(lang)}`, { auth: false });
}

export interface ChannelTranslationSettings {
  viewerTitles: boolean;
  platformEnabled: boolean;
}

export async function getChannelTranslationSettings(channelId: string): Promise<TranslateResult<ChannelTranslationSettings>> {
  return call<ChannelTranslationSettings>(`/api/channels/${encodeURIComponent(channelId)}/translation-settings`);
}

export async function setChannelTranslationSettings(channelId: string, viewerTitles: boolean): Promise<TranslateResult<ChannelTranslationSettings>> {
  return call<ChannelTranslationSettings>(`/api/channels/${encodeURIComponent(channelId)}/translation-settings`, { method: 'PUT', body: { viewerTitles } });
}

export interface QuranEdition {
  id: number;
  name: string;
  author?: string;
  language: string;
}

export interface ChannelQuranEdition {
  language: string;
  id: number;
  name: string;
  source: 'channel' | 'platform' | 'default';
}

/** Quran Foundation translation editions for a language (the picker). */
export async function listQuranEditions(language: string): Promise<TranslateResult<{ editions: QuranEdition[] }>> {
  return call<{ editions: QuranEdition[] }>(`/api/quran/translations?language=${encodeURIComponent(language)}`, { auth: false });
}

/** The channel's Quran translation per language and where each comes from (its own, the site's, the default). */
export async function getChannelQuranEditions(channelId: string): Promise<TranslateResult<{ editions: ChannelQuranEdition[] }>> {
  return call<{ editions: ChannelQuranEdition[] }>(`/api/channels/${encodeURIComponent(channelId)}/quran-translations`);
}

export async function setChannelQuranEdition(channelId: string, language: string, id: number): Promise<TranslateResult<{ editions: ChannelQuranEdition[] }>> {
  return call<{ editions: ChannelQuranEdition[] }>(`/api/channels/${encodeURIComponent(channelId)}/quran-translations/${encodeURIComponent(language)}`, { method: 'PUT', body: { id } });
}

export async function resetChannelQuranEdition(channelId: string, language: string): Promise<TranslateResult<{ editions: ChannelQuranEdition[] }>> {
  return call<{ editions: ChannelQuranEdition[] }>(`/api/channels/${encodeURIComponent(channelId)}/quran-translations/${encodeURIComponent(language)}`, { method: 'DELETE' });
}
