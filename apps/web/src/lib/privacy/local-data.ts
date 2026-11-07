/**
 * On-device personal data inventory, retention and erasure (Story 1.3, AC 1, 2, 5).
 *
 * Every localStorage / IndexedDB key the web app writes is listed here with its
 * purpose, classification and retention. `enforceLocalRetention()` runs on
 * every page load (SecurityBootstrap) and `clearLocalPersonalData()` backs the
 * "clear data on this device" action and account deletion.
 */

import { EncryptedStorage } from '@/lib/storage/EncryptedStorage';
import { ConsentManager } from '@/lib/consent/ConsentManager';
import { logger } from '@/lib/logger-client';

export type LocalDataClass = 'preference' | 'personal' | 'tracking' | 'session';

export interface LocalDataEntry {
  key: string;
  /** Matches keys by prefix instead of exact name. */
  prefix?: boolean;
  classification: LocalDataClass;
  purpose: string;
  retention: string;
  encrypted: boolean;
}

export const LOCAL_DATA_INVENTORY: ReadonlyArray<LocalDataEntry> = [
  { key: 'aun.enc.watchProgress', classification: 'personal', purpose: 'Resume playback for signed-out viewers', retention: '90 days, max 50 videos', encrypted: true },
  { key: 'video_views_tracked', classification: 'personal', purpose: 'Avoid counting the same view twice', retention: '30 minutes', encrypted: false },
  { key: 'al-ummah-active-channel', prefix: true, classification: 'session', purpose: 'Remember which of your channels is active', retention: 'Until sign-out', encrypted: false },
  { key: 'al-ummah-ab-assignments', classification: 'tracking', purpose: 'Keep A/B experiment variants stable (experiments consent only)', retention: '30 days unused', encrypted: false },
  { key: 'darkmode', classification: 'preference', purpose: 'Theme preference', retention: 'Until cleared', encrypted: false },
  { key: 'preferred-language', classification: 'preference', purpose: 'Language preference', retention: 'Until cleared', encrypted: false },
  { key: 'videoPlayerVolume', classification: 'preference', purpose: 'Player volume', retention: 'Until cleared', encrypted: false },
  { key: 'video-player-playback-rate', classification: 'preference', purpose: 'Player speed', retention: 'Until cleared', encrypted: false },
  { key: 'subtitle-settings', classification: 'preference', purpose: 'Subtitle appearance', retention: 'Until cleared', encrypted: false },
  { key: 'last-subtitle-track', classification: 'preference', purpose: 'Last subtitle language', retention: 'Until cleared', encrypted: false },
];

/** Keys from earlier releases that held personal or tracking data and are no longer written. */
export const LEGACY_KEYS: ReadonlyArray<string> = ['pendingVideoAnalytics'];

const VIEW_DEDUPE_WINDOW_MS = 30 * 60 * 1000;

function store(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Remove expired / unconsented data from this device. Returns the number of entries removed. */
export function enforceLocalRetention(now = Date.now()): number {
  const ls = store();
  let removed = EncryptedStorage.purgeExpired(now);
  if (!ls) return removed;

  for (const key of LEGACY_KEYS) {
    if (ls.getItem(key) !== null) {
      ls.removeItem(key);
      removed++;
    }
  }

  if (!ConsentManager.hasConsent('experiments') && ls.getItem('al-ummah-ab-assignments') !== null) {
    ls.removeItem('al-ummah-ab-assignments');
    removed++;
  }

  try {
    const raw = ls.getItem('video_views_tracked');
    if (raw) {
      const views = JSON.parse(raw) as Record<string, number>;
      const fresh = Object.fromEntries(
        Object.entries(views).filter(([, ts]) => typeof ts === 'number' && now - ts < VIEW_DEDUPE_WINDOW_MS),
      );
      const dropped = Object.keys(views).length - Object.keys(fresh).length;
      if (dropped > 0) {
        removed += dropped;
        if (Object.keys(fresh).length === 0) ls.removeItem('video_views_tracked');
        else ls.setItem('video_views_tracked', JSON.stringify(fresh));
      }
    }
  } catch {
    ls.removeItem('video_views_tracked');
    removed++;
  }

  if (removed > 0) logger.debug('[Privacy] Local retention removed expired entries', { removed });
  return removed;
}

/**
 * Erase personal and tracking data stored by this app on this device.
 * Preferences (theme, language, player settings) are kept unless
 * `includePreferences` is set. The consent cookie is left in place so the
 * user's choice is still respected.
 */
export async function clearLocalPersonalData(options: { includePreferences?: boolean } = {}): Promise<void> {
  const ls = store();
  if (ls) {
    const doomed: string[] = [];
    for (let i = 0; i < ls.length; i++) {
      const key = ls.key(i);
      if (!key) continue;
      const entry = LOCAL_DATA_INVENTORY.find(item => (item.prefix ? key.startsWith(item.key) : item.key === key));
      const isLegacy = LEGACY_KEYS.includes(key) || key === 'watchProgress';
      if (isLegacy || (entry && (entry.classification !== 'preference' || options.includePreferences))) {
        doomed.push(key);
      }
    }
    doomed.forEach(key => ls.removeItem(key));
  }
  await EncryptedStorage.clearAll();
  logger.info('[Privacy] Cleared personal data from this device');
}
