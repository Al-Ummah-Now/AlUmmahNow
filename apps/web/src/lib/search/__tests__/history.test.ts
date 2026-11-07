/**
 * Private search history (Story 29.8): stored through EncryptedStorage with a
 * TTL, de-duplicated, capped, clearable, and listed in the device data inventory.
 */

const store = new Map<string, { value: unknown; ttlMs: number }>();

jest.mock('@/lib/storage/EncryptedStorage', () => ({
  EncryptedStorage: {
    setItem: jest.fn(async (key: string, value: unknown, options: { ttlMs: number }) => {
      store.set(key, { value: JSON.parse(JSON.stringify(value)), ttlMs: options.ttlMs });
      return true;
    }),
    getItem: jest.fn(async (key: string) => store.get(key)?.value ?? null),
    removeItem: jest.fn((key: string) => store.delete(key)),
    purgeExpired: jest.fn(() => 0),
    clearAll: jest.fn(async () => store.clear()),
  },
}));

jest.mock('@/lib/logger-client', () => ({ logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() } }));

import {
  SEARCH_HISTORY_KEY,
  SEARCH_HISTORY_MAX,
  SEARCH_HISTORY_RETENTION_MS,
  addSearchHistory,
  clearSearchHistory,
  getSearchHistory,
  removeSearchHistoryEntry,
  subscribeSearchHistory,
} from '../history';
import { LOCAL_DATA_INVENTORY } from '@/lib/privacy/local-data';

describe('search history', () => {
  beforeEach(() => store.clear());

  it('adds newest first with a retention TTL', async () => {
    await addSearchHistory('tafsir', 1000);
    await addSearchHistory('seerah', 2000);
    expect((await getSearchHistory(3000)).map(e => e.query)).toEqual(['seerah', 'tafsir']);
    expect(store.get(SEARCH_HISTORY_KEY)?.ttlMs).toBe(SEARCH_HISTORY_RETENTION_MS);
  });

  it('de-duplicates spelling variants and moves them to the top', async () => {
    await addSearchHistory('الصلاة', 1000);
    await addSearchHistory('fiqh', 2000);
    await addSearchHistory('الصَّلاه', 3000);
    const entries = await getSearchHistory(4000);
    expect(entries.map(e => e.query)).toEqual(['الصَّلاه', 'fiqh']);
  });

  it('caps the number of entries and ignores blank queries', async () => {
    for (let i = 0; i < SEARCH_HISTORY_MAX + 5; i++) await addSearchHistory(`q${i}`, 1000 + i);
    await addSearchHistory('   ', 5000);
    expect(await getSearchHistory(6000)).toHaveLength(SEARCH_HISTORY_MAX);
  });

  it('drops expired entries', async () => {
    await addSearchHistory('old', 0);
    expect(await getSearchHistory(SEARCH_HISTORY_RETENTION_MS + 1)).toEqual([]);
  });

  it('removes one entry, clears all and notifies subscribers', async () => {
    const listener = jest.fn();
    const unsubscribe = subscribeSearchHistory(listener);
    await addSearchHistory('a');
    await addSearchHistory('b');
    await removeSearchHistoryEntry('a');
    expect((await getSearchHistory()).map(e => e.query)).toEqual(['b']);
    await clearSearchHistory();
    expect(store.has(SEARCH_HISTORY_KEY)).toBe(false);
    expect(listener).toHaveBeenLastCalledWith([]);
    unsubscribe();
  });

  it('is listed in the on-device data inventory as encrypted personal data', () => {
    const entry = LOCAL_DATA_INVENTORY.find(e => e.key === `aun.enc.${SEARCH_HISTORY_KEY}`);
    expect(entry).toMatchObject({ classification: 'personal', encrypted: true });
  });
});
