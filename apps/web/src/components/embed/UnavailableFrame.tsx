'use client';

/**
 * "This video is unavailable" frame. Shown alike for private, scheduled,
 * deleted, hidden, processing and unknown content so it reveals nothing.
 * Tells the parent page through postMessage (ready, then error 'unavailable').
 */

import { useEffect } from 'react';
import { VideoOff } from 'lucide-react';
import type { EmbedLang } from '@/lib/embed/params';
import { embedStrings } from '@/lib/embed/strings';
import { useEmbedMessaging } from './useEmbedMessaging';

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
      className="flex w-screen h-screen flex-col items-center justify-center gap-3 bg-neutral-900 p-6 text-center text-white"
    >
      <VideoOff className="h-12 w-12 text-gray-400" aria-hidden="true" />
      <h1 className="text-lg font-semibold">{s.unavailableTitle}</h1>
      <p className="text-sm text-gray-300">{s.unavailableBody}</p>
      <a
        href={`/${lang}`}
        target="_blank"
        rel="noopener"
        className="mt-1 rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium hover:bg-emerald-500 focus-visible:ring-2 focus-visible:ring-white"
      >
        {s.goToSite}
      </a>
    </main>
  );
}
