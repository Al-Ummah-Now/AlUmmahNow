/**
 * ConsentManager (Story 1.3, AC 3, 4)
 *
 * Browser-side source of truth for tracking consent. Default deny: until the
 * user makes a choice, `hasConsent()` is false for every optional category, so
 * analytics, A/B experiment events and performance beacons are not sent and
 * nothing tracking-related is persisted.
 *
 * Choices are stored in the first-party `aun_consent` cookie (so server routes
 * can enforce them too) and, for signed-in users, recorded server-side as an
 * audit trail (api-videos PUT /api/privacy/consent). Withdrawing consent purges
 * the data collected under that category from the device.
 */

import { logger } from '@/lib/logger-client';
import {
  CONSENT_CATEGORIES,
  CONSENT_COOKIE,
  CONSENT_MAX_AGE_SECONDS,
  CONSENT_VERSION,
  ConsentCategory,
  ConsentChoices,
  ConsentState,
  isCategoryAllowed,
  parseConsent,
  serializeConsent,
} from './consent-cookie';

export type { ConsentCategory, ConsentChoices, ConsentState } from './consent-cookie';

/** localStorage keys holding data collected under each category; removed on withdrawal. */
export const CATEGORY_STORAGE_KEYS: Readonly<Record<ConsentCategory, ReadonlyArray<string>>> = {
  analytics: ['pendingVideoAnalytics'],
  experiments: ['al-ummah-ab-assignments'],
  performance: [],
};

type Listener = (state: ConsentState | null) => void;

const listeners = new Set<Listener>();
const preferenceListeners = new Set<() => void>();
let cached: ConsentState | null | undefined;

function readCookie(): string | null {
  if (typeof document === 'undefined') return null;
  for (const part of document.cookie.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === CONSENT_COOKIE) return rest.join('=');
  }
  return null;
}

function writeCookie(state: ConsentState): void {
  if (typeof document === 'undefined') return;
  const secure = typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${CONSENT_COOKIE}=${serializeConsent(state)}; Path=/; Max-Age=${CONSENT_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
}

function purgeCategoryData(category: ConsentCategory): void {
  try {
    CATEGORY_STORAGE_KEYS[category].forEach(key => localStorage.removeItem(key));
  } catch {
    // storage unavailable: nothing to purge
  }
}

async function recordServerSide(state: ConsentState, source: string): Promise<void> {
  try {
    const [{ getApiUrl }, { getClientAuthHeaders }] = await Promise.all([
      import('@/lib/runtime-config'),
      import('@/lib/auth/client-token'),
    ]);
    const headers = await getClientAuthHeaders();
    const apiUrl = getApiUrl();
    if (!apiUrl || !headers.Authorization) return; // anonymous: the cookie is the record
    const response = await fetch(`${apiUrl}/api/privacy/consent`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        version: state.version,
        analytics: state.analytics,
        experiments: state.experiments,
        performance: state.performance,
        decidedAt: new Date(state.decidedAt).toISOString(),
        source,
      }),
    });
    if (!response.ok) {
      logger.warn('[Consent] Server-side consent record rejected', { status: response.status });
    }
  } catch (error) {
    logger.warn('[Consent] Failed to record consent server-side', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export const ConsentManager = {
  /** Current decision, or null if the user has not decided (or it expired). */
  getConsent(): ConsentState | null {
    if (cached === undefined) cached = parseConsent(readCookie());
    return cached;
  },

  hasDecided(): boolean {
    return this.getConsent() !== null;
  },

  hasConsent(category: ConsentCategory): boolean {
    return isCategoryAllowed(this.getConsent(), category);
  },

  setConsent(choices: ConsentChoices, source = 'banner'): ConsentState {
    const previous = this.getConsent();
    const state: ConsentState = {
      version: CONSENT_VERSION,
      analytics: choices.analytics === true,
      experiments: choices.experiments === true,
      performance: choices.performance === true,
      decidedAt: Date.now(),
    };
    writeCookie(state);
    cached = state;

    for (const category of CONSENT_CATEGORIES) {
      if (!state[category] && (previous === null || previous[category])) purgeCategoryData(category);
    }

    logger.info('[Consent] Consent updated', {
      analytics: state.analytics,
      experiments: state.experiments,
      performance: state.performance,
      source,
    });
    listeners.forEach(listener => listener(state));
    void recordServerSide(state, source);
    return state;
  },

  acceptAll(source = 'banner'): ConsentState {
    return this.setConsent({ analytics: true, experiments: true, performance: true }, source);
  },

  rejectAll(source = 'banner'): ConsentState {
    return this.setConsent({ analytics: false, experiments: false, performance: false }, source);
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /** Ask the banner to reopen its preferences panel (e.g. from a footer or settings link). */
  openPreferences(): void {
    preferenceListeners.forEach(listener => listener());
  },

  onOpenPreferences(listener: () => void): () => void {
    preferenceListeners.add(listener);
    return () => preferenceListeners.delete(listener);
  },

  /** Test helper: forget the cached decision so the cookie is re-read. */
  resetCache(): void {
    cached = undefined;
  },
};

/** Convenience for non-React services (analytics, experiments, monitoring). */
export function hasConsent(category: ConsentCategory): boolean {
  return ConsentManager.hasConsent(category);
}
