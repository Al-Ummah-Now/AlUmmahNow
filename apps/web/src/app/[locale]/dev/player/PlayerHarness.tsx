'use client';
/**
 * The player in a watch-page layout, driven by the query string so each E2E case is one URL:
 *   ?src=bright|dark|short|live   which fixture plays (served by the E2E route handler)
 *   &watch=0                      an embed-like surface: no theatre, mini player or up next
 *   &width=320                    a fixed player width, for small-player checks
 *   &start=12                     a start position, for the start-over pill
 * Fixtures live under e2e/player/fixtures and are never deployed.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { VIDEO_PLAYER_ID } from '@/components/SkipLinks/SkipLinksBase';
import { VideoPlayerWithChapters } from '@/components/VideoPagePlayer/VideoPlayerWithChapters';
import { enableWatchPageFeatures, getPlayerUi, subscribePlayerUi, updatePlayerUi } from '@/lib/video/player-ui';

const SOURCES = ['bright', 'dark', 'short', 'live'] as const;
type Source = (typeof SOURCES)[number];

export function PlayerHarness({ lang }: { lang: 'en' | 'ar' }) {
  const params = useSearchParams();
  const router = useRouter();
  const src: Source = (SOURCES as readonly string[]).includes(params.get('src') ?? '') ? (params.get('src') as Source) : 'bright';
  const watch = params.get('watch') !== '0';
  const width = Number(params.get('width')) || undefined;
  const start = Number(params.get('start')) || undefined;
  const { theatre } = useSyncExternalStore(subscribePlayerUi, getPlayerUi, getPlayerUi);

  useEffect(() => (watch ? enableWatchPageFeatures() : undefined), [watch]);
  useEffect(() => {
    if (!watch) return;
    const next = src === 'dark' ? 'bright' : 'dark';
    updatePlayerUi({
      upNext: { title: `Next: the ${next} fixture`, channel: 'Player harness', go: () => router.push(`/${lang}/dev/player?src=${next}`) },
      reportProblem: () => document.getElementById('harness-report')?.focus(),
    });
  }, [watch, src, lang, router]);

  return (
    <main className="py-6" data-testid="player-harness">
      {/* The watch page's structure (WatchPageContent): the layout's gutter, the primary column, the player section */}
      <div className={`mx-auto flex flex-col gap-6 px-4 ${theatre ? '' : 'lg:flex-row'} max-w-[1600px]`} data-theatre={theatre ? '' : undefined} data-testid="watch-layout">
        <div className={`w-full ${theatre ? '' : 'lg:w-3/4'}`} style={width ? { width, maxWidth: '100%' } : undefined} data-testid="watch-primary">
          <section id={VIDEO_PLAYER_ID} className="w-full" tabIndex={-1}>
          <VideoPlayerWithChapters
            key={src}
            videoId={`harness-${src}`}
            sources={[{ src: `/__player-fixtures/${src}/master.m3u8`, type: 'application/x-mpegURL' }]}
            controls
            autoplay={false}
            enableAnalytics={false}
            enableWebSocket={false}
            isLive={src === 'live'}
            lang={lang}
            className="w-full"
            ariaLabel={lang === 'ar' ? 'مشغل الاختبار' : 'Test player'}
            title={`Harness ${src}`}
            startTime={start}
            enableChapters={src !== 'live' && src !== 'short'}
            enableSubtitles={src !== 'live'}
          />
          </section>
          <h1 className="mt-4 text-lg font-semibold">Harness: {src}</h1>
          <button id="harness-report" type="button" className="mt-2 text-sm underline">Report</button>
        </div>
        <aside className={`w-full ${theatre ? 'lg:w-full' : 'lg:w-1/4'}`} data-testid="harness-aside">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="mb-3 h-20 rounded-lg bg-gray-200 dark:bg-gray-800" />
          ))}
        </aside>
      </div>
      {/* Room to scroll the player off screen for the mini player */}
      <div style={{ height: '150vh' }} aria-hidden="true" />
    </main>
  );
}
