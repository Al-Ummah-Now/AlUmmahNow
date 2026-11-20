'use client';

/**
 * "This video is unavailable" frame. Shown alike for private, scheduled,
 * deleted, hidden, processing and unknown content so it reveals nothing.
 * Tells the parent page through postMessage (ready, then error 'unavailable').
 * Colours are the theme's night tokens, like the player's backdrop (embed-frame.css, #1660).
 */

import { useEffect } from 'react';
import { VideoOff } from 'lucide-react';
import type { EmbedLang } from '@/lib/embed/params';
import { embedStrings } from '@/lib/embed/strings';
import { useEmbedMessaging } from './useEmbedMessaging';
import './embed-frame.css';

export default function UnavailableFrame({ lang, origin, contentId }: { lang: EmbedLang; origin: string | null; contentId: string }) {
  const s = embedStrings(lang);
  const { emit } = useEmbedMessaging(origin, () => ({ videoId: contentId, currentTime: 0, duration: null, muted: false }));

  useEffect(() => {
    emit('ready');
    emit('error', { code: 'unavailable' });
  }, [emit]);

  return (
    <main
      dir={lang === 'ar' ? 'rtl' : 'ltr'}
      lang={lang}
      data-testid="embed-unavailable"
      className="embed-unavailable flex w-screen h-screen flex-col items-center justify-center gap-3 p-6 text-center"
    >
      <VideoOff className="embed-unavailable-icon h-12 w-12 shrink-0" aria-hidden="true" />
      <h1 className="text-lg font-semibold">{s.unavailableTitle}</h1>
      <p className="embed-unavailable-body text-sm">{s.unavailableBody}</p>
      <a
        href={`/${lang}`}
        target="_blank"
        rel="noopener"
        className="embed-unavailable-link mt-1 rounded-full px-4 py-2 text-sm font-medium"
      >
        {s.goToSite}
      </a>
    </main>
  );
}
