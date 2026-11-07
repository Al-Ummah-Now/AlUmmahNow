/**
 * Story 1.3 AC 1, 2, 5: on-device watch progress is encrypted, minimised and
 * retained for a bounded time; device data can be erased.
 */
import { installWebCrypto, MemoryKeyStore } from '@/test/webcrypto';
import { setKeyStore } from '@/lib/crypto';
import { ENCRYPTED_KEY_PREFIX } from '@/lib/storage/EncryptedStorage';
import {
  WatchHistoryService,
  applyLocalProgressRetention,
  LOCAL_PROGRESS_MAX_ENTRIES,
  LOCAL_PROGRESS_RETENTION_MS,
  type WatchProgress,
} from '@/services/api/watch-history';
import { clearLocalPersonalData, enforceLocalRetention, LOCAL_DATA_INVENTORY } from '../local-data';
import { ConsentManager } from '@/lib/consent/ConsentManager';

jest.mock('@/lib/auth/client-token', () => ({ getClientAuthHeaders: async () => ({}) }));

const progress = (videoId: string, ageMs = 0): WatchProgress => ({
  videoId,
  userId: 'user-123',
  currentTime: 10,
  duration: 100,
  completed: false,
  timestamp: new Date(Date.now() - ageMs).toISOString(),
});

describe('on-device watch progress', () => {
  beforeAll(() => installWebCrypto());

  beforeEach(() => {
    localStorage.clear();
    setKeyStore(new MemoryKeyStore());
  });

  it('is stored encrypted, without the user id, and read back', async () => {
    await WatchHistoryService.saveLocal(progress('vid-abc'));
    expect(localStorage.getItem('watchProgress')).toBeNull();
    const raw = localStorage.getItem(`${ENCRYPTED_KEY_PREFIX}watchProgress`)!;
    expect(raw).not.toContain('vid-abc');
    const loaded = await WatchHistoryService.getLocal('vid-abc');
    expect(loaded).toMatchObject({ videoId: 'vid-abc', currentTime: 10 });
    expect(loaded).not.toHaveProperty('userId');
  });

  it('migrates legacy plaintext progress into encrypted storage', async () => {
    localStorage.setItem('watchProgress', JSON.stringify({ old: progress('old') }));
    await expect(WatchHistoryService.getLocal('old')).resolves.toMatchObject({ videoId: 'old' });
    expect(localStorage.getItem('watchProgress')).toBeNull();
    expect(localStorage.getItem(`${ENCRYPTED_KEY_PREFIX}watchProgress`)).not.toBeNull();
  });

  it('applies retention: drops expired entries and caps the count', () => {
    const stored: Record<string, WatchProgress> = {
      fresh: progress('fresh'),
      expired: progress('expired', LOCAL_PROGRESS_RETENTION_MS + 1000),
    };
    for (let i = 0; i < LOCAL_PROGRESS_MAX_ENTRIES + 5; i++) stored[`v${i}`] = progress(`v${i}`, i * 1000);
    const pruned = applyLocalProgressRetention(stored);
    expect(pruned.expired).toBeUndefined();
    expect(Object.keys(pruned)).toHaveLength(LOCAL_PROGRESS_MAX_ENTRIES);
    expect(pruned.fresh).toBeDefined();
  });

  it('clearLocal removes it', async () => {
    await WatchHistoryService.saveLocal(progress('a'));
    WatchHistoryService.clearLocal();
    await expect(WatchHistoryService.getLocal('a')).resolves.toBeNull();
  });
});

describe('local data retention and erasure', () => {
  beforeAll(() => installWebCrypto());

  beforeEach(() => {
    localStorage.clear();
    setKeyStore(new MemoryKeyStore());
    document.cookie = 'aun_consent=; Max-Age=0; Path=/';
    ConsentManager.resetCache();
  });

  it('documents every key with purpose, retention and classification', () => {
    for (const entry of LOCAL_DATA_INVENTORY) {
      expect(entry.purpose).toBeTruthy();
      expect(entry.retention).toBeTruthy();
    }
    expect(LOCAL_DATA_INVENTORY.find(e => e.key === 'aun.enc.watchProgress')?.encrypted).toBe(true);
  });

  it('removes legacy tracking data, unconsented experiment data and stale view markers', () => {
    const now = Date.now();
    localStorage.setItem('pendingVideoAnalytics', '[{"videoId":"x"}]');
    localStorage.setItem('al-ummah-ab-assignments', '{}');
    localStorage.setItem('video_views_tracked', JSON.stringify({ old: now - 60 * 60 * 1000, recent: now - 1000 }));
    const removed = enforceLocalRetention(now);
    expect(removed).toBe(3);
    expect(localStorage.getItem('pendingVideoAnalytics')).toBeNull();
    expect(localStorage.getItem('al-ummah-ab-assignments')).toBeNull();
    expect(JSON.parse(localStorage.getItem('video_views_tracked')!)).toEqual({ recent: now - 1000 });
  });

  it('keeps experiment assignments when consent was given', () => {
    ConsentManager.acceptAll();
    localStorage.setItem('al-ummah-ab-assignments', '{}');
    enforceLocalRetention();
    expect(localStorage.getItem('al-ummah-ab-assignments')).toBe('{}');
  });

  it('clearLocalPersonalData erases personal data but keeps preferences', async () => {
    await WatchHistoryService.saveLocal(progress('a'));
    localStorage.setItem('al-ummah-active-channel:user-1', '{}');
    localStorage.setItem('video_views_tracked', '{}');
    localStorage.setItem('darkmode', 'true');
    localStorage.setItem('preferred-language', 'ar');
    await clearLocalPersonalData();
    expect(localStorage.getItem(`${ENCRYPTED_KEY_PREFIX}watchProgress`)).toBeNull();
    expect(localStorage.getItem('al-ummah-active-channel:user-1')).toBeNull();
    expect(localStorage.getItem('video_views_tracked')).toBeNull();
    expect(localStorage.getItem('darkmode')).toBe('true');
    expect(localStorage.getItem('preferred-language')).toBe('ar');
    await clearLocalPersonalData({ includePreferences: true });
    expect(localStorage.getItem('darkmode')).toBeNull();
  });
});
