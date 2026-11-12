'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getMediaLive } from '@/lib/api/admin';
import { useAdminLive } from '@/lib/live/useAdminLive';
import type { MediaLive } from '@/lib/api/types';
import { useLanguage } from '@/i18n/I18nProvider';
import { logger } from '@/lib/logger-client';
import { LiveFigures } from './live';
import { mediaLiveFromEvent } from './live-event';

export const LIVE_REFRESH_MS = 30_000;

/**
 * Keeps the live figures fresh from the admin:media live channel: a `live`
 * event replaces the figures, a job event re-renders the page (jobs table,
 * R2 badges). While the socket is down it falls back to reading every 30 s
 * while the page is visible, and at once when it becomes visible again after
 * a longer gap. A failed refresh keeps the last figures and says so.
 */
export function LiveTranscodes({ initial }: { initial: MediaLive | null }) {
  const { t, locale } = useLanguage();
  const router = useRouter();
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

  const { live: socketLive } = useAdminLive(
    ['media'],
    (update) => {
      const figures = update.events.map(mediaLiveFromEvent).filter((f): f is MediaLive => f !== null).at(-1);
      if (figures) {
        last.current = Date.now();
        setLive(figures);
        setStale(false);
      } else if (update.resync) {
        void refresh();
      }
      if (update.resync || update.events.some((e) => e.kind === 'job')) router.refresh();
    },
    {
      poll: () => {
        if (document.visibilityState === 'visible') void refresh();
      },
      pollMs: LIVE_REFRESH_MS,
    },
  );

  useEffect(() => {
    if (socketLive) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - last.current >= LIVE_REFRESH_MS) void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh, socketLive]);

  return <LiveFigures live={live} t={t} locale={locale} stale={stale} />;
}
