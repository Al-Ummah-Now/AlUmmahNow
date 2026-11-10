/**
 * Private search history (Story 29.8).
 *
 * Kept only on this device, encrypted with the per-device key (EncryptedStorage,
 * Story 1.3) and listed in the on-device data inventory (lib/privacy/local-data.ts),
 * so "clear data on this device" and account deletion remove it. Never sent to the API.
 */

import { EncryptedStorage } from '@/lib/storage/EncryptedStorage';
import { normalizeSearchText } from '@al-ummah/shared-types';
import { logger } from '@/lib/logger-client';

export const SEARCH_HISTORY_KEY = 'searchHistory';
export const SEARCH_HISTORY_MAX = 20;
export const SEARCH_HISTORY_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export interface SearchHistoryEntry {
  query: string;
  at: number;
}

type Listener = (entries: SearchHistoryEntry[]) => void;
const listeners = new Set<Listener>();

function notify(entries: SearchHistoryEntry[]) {
  listeners.forEach(listener => listener(entries));
}

export function subscribeSearchHistory(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function sanitize(entries: unknown, now: number): SearchHistoryEntry[] {
  if (!Array.isArray(entries)) return [];
  return entries
    .filter((e): e is SearchHistoryEntry => !!e && typeof e.query === 'string' && typeof e.at === 'number')
    .filter(e => now - e.at < SEARCH_HISTORY_RETENTION_MS)
    .slice(0, SEARCH_HISTORY_MAX);
}

export async function getSearchHistory(now = Date.now()): Promise<SearchHistoryEntry[]> {
  try {
    return sanitize(await EncryptedStorage.getItem<SearchHistoryEntry[]>(SEARCH_HISTORY_KEY), now);
  } catch (error) {
    logger.warn('[SearchHistory] Could not read search history', { error });
    return [];
  }
}

async function write(entries: SearchHistoryEntry[]): Promise<void> {
  if (entries.length === 0) {
    EncryptedStorage.removeItem(SEARCH_HISTORY_KEY);
  } else {
    await EncryptedStorage.setItem(SEARCH_HISTORY_KEY, entries, { ttlMs: SEARCH_HISTORY_RETENTION_MS });
  }
  notify(entries);
}

/** Add a query to the top of the history (case/diacritics-insensitive de-duplication). */
export async function addSearchHistory(query: string, now = Date.now()): Promise<SearchHistoryEntry[]> {
  const trimmed = query.trim().slice(0, 200);
  if (!trimmed) return getSearchHistory(now);
  const key = normalizeSearchText(trimmed);
  const existing = await getSearchHistory(now);
  const next = [{ query: trimmed, at: now }, ...existing.filter(e => normalizeSearchText(e.query) !== key)]
    .slice(0, SEARCH_HISTORY_MAX);
  await write(next);
  return next;
}

export async function removeSearchHistoryEntry(query: string): Promise<SearchHistoryEntry[]> {
  const key = normalizeSearchText(query);
  const next = (await getSearchHistory()).filter(e => normalizeSearchText(e.query) !== key);
  await write(next);
  return next;
}

export async function clearSearchHistory(): Promise<void> {
  await write([]);
  logger.debug('[SearchHistory] Search history cleared');
}
