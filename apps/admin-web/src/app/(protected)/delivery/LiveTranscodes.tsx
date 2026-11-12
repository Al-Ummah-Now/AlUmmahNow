'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getMediaLive } from '@/lib/api/admin';
import type { MediaLive } from '@/lib/api/types';
import { useLanguage } from '@/i18n/I18nProvider';
import { logger } from '@/lib/logger-client';
import { LiveFigures } from './live';

export const LIVE_REFRESH_MS = 30_000;

/**
 * Keeps the live figures fresh: every 30 s while the page is visible, and at
 * once when it becomes visible again after a longer gap. A hidden tab asks
 * for nothing. A failed refresh keeps the last figures and says so.
 */
export function LiveTranscodes({ initial }: { initial: MediaLive | null }) {
  const { t, locale } = useLanguage();
  const [live, setLive] = useState<MediaLive | null>(initial);
  const [stale, setStale] = useState(false);
  const last = useRef(Date.now());
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    last.current = Date.now();
    try {
      const result = await getMediaLive();
      if (result.ok && result.data) {
        setLive(result.data);
        setStale(false);
      } else {
        if (!result.ok) logger.warn('[delivery] Live figures refresh failed', { status: result.status });
        setStale(true);
      }
    } catch (e) {
      logger.warn('[delivery] Live figures request failed', { error: e instanceof Error ? e.message : String(e) });
      setStale(true);
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, LIVE_REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - last.current >= LIVE_REFRESH_MS) void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  return <LiveFigures live={live} t={t} locale={locale} stale={stale} />;
}
