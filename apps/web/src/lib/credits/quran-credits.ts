/**
 * Reads GET /api/quran/credits for the Credits page (server side): QF's attribution and every
 * translation edition in use (api-videos endpoints/quran/quranCredits.ts).
 */
import { QURAN_ATTRIBUTION, QURAN_CREDIT, QURAN_FOUNDATION_URL } from '@al-ummah/shared-types';
import { buildApiUrl } from '@/lib/api/api-client';
import { logger } from '@/lib/logger-server';

export interface QuranCreditEdition {
  id: number;
  name: string;
  author?: string;
  language: string;
}

export interface QuranCredits {
  attribution: { en: string; ar: string };
  credit: { en: string; ar: string; url: string };
  quranText: boolean;
  editions: QuranCreditEdition[];
}

/**
 * `ok`: the API's answer. `off`: no Quran text from QF on this site (the page is a 404 and its link
 * hidden). `error`: the API could not be read; the page still shows QF's line (it is fixed text) and
 * says the list of translations is unavailable.
 */
export type QuranCreditsResult = { status: 'ok'; credits: QuranCredits } | { status: 'off' } | { status: 'error'; credits: QuranCredits };

const FALLBACK: QuranCredits = {
  attribution: { ...QURAN_ATTRIBUTION },
  credit: { ...QURAN_CREDIT, url: QURAN_FOUNDATION_URL },
  quranText: true,
  editions: [],
};

export async function loadQuranCredits(fetchImpl: typeof fetch = fetch): Promise<QuranCreditsResult> {
  try {
    const res = await fetchImpl(buildApiUrl('/api/quran/credits'), { headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (res.status === 404) return { status: 'off' };
    const body = (await res.json().catch(() => null)) as { success?: boolean; data?: QuranCredits } | null;
    if (!res.ok || !body?.success || !body.data) {
      logger.warn('[Credits] Quran credits unreadable', { status: res.status });
      return { status: 'error', credits: FALLBACK };
    }
    return { status: 'ok', credits: body.data };
  } catch (error) {
    logger.warn('[Credits] Quran credits request failed', { error: error instanceof Error ? error.message : String(error) });
    return { status: 'error', credits: FALLBACK };
  }
}
