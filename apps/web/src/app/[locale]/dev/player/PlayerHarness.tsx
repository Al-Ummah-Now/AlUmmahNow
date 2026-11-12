'use client';
/**
 * The player in a watch-page layout, driven by the query string so each E2E case is one URL:
 *   ?src=bright|dark|short|live   which fixture plays (served by the E2E route handler)
 *   &watch=0                      an embed-like surface: no theatre, mini player or up next
 *   &width=320                    a fixed player width, for small-player checks
 *   &start=12                     a start position, for the start-over pill
 *   &list=fixtures&index=0        playlist playback: the real pane, up next and autoplay over a
 *                                 queue the spec serves (GET /api/playlists/fixtures/queue)
 *   &account=1                    "Autoplay next" synced with an account (the spec serves
 *                                 /api/auth/token and /api/profile/playback)
 * Fixtures live under e2e/player/fixtures and are never deployed.
 */
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { VIDEO_PLAYER_ID } from '@/components/SkipLinks/SkipLinksBase';
import { VideoPlayerWithChapters } from '@/components/VideoPagePlayer/VideoPlayerWithChapters';
import { enableWatchPageFeatures, getPlayerUi, subscribePlayerUi, updatePlayerUi } from '@/lib/video/player-ui';
import { PlaylistPane } from '@/components/video/PlaylistPane';
import { usePlaylistPlayback } from '@/hooks/usePlaylistPlayback';
import { clearAutoplayIntent, hasAutoplayIntent, requestAutoplay } from '@/lib/video/autoplay-intent';
import { navigateOrLoad } from '@/lib/navigation/navigate-or-load';
import { useAutoplaySetting } from '@/hooks/useAutoplaySetting';

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
  const buildHref = useCallback(
    (id: string, list: string, index: number) => `/${lang}/dev/player?src=${encodeURIComponent(id)}&list=${encodeURIComponent(list)}&index=${index}`,
    [lang],
  );
  const playback = usePlaylistPlayback(src, lang, { buildHref });
  useAutoplaySetting(params.get('account') === '1' ? 'harness-user' : null);
  const autoplayIntent = useMemo(() => !!playback.list || hasAutoplayIntent(src), [src, playback.list]);
  useEffect(() => clearAutoplayIntent(src), [src]);

  useEffect(() => (watch ? enableWatchPageFeatures() : undefined), [watch]);
  useEffect(() => {
    if (!watch) return;
    if (playback.active) {
      updatePlayerUi({ upNext: playback.upNext, replayList: playback.replayList, reportProblem: null });
      return;
    }
    const next = src === 'dark' ? 'bright' : 'dark';
    updatePlayerUi({
      upNext: {
        title: `Next: the ${next} fixture`,
        channel: 'Player harness',
        // As on the watch page: the advance asks the next video to play
        go: (opts) => {
          requestAutoplay(next, { auto: opts?.auto === true });
          navigateOrLoad((href) => router.push(href), `/${lang}/dev/player?src=${next}`);
        },
      },
      replayList: null,
      // As on the watch page: more videos once the countdown is off or cancelled
      suggestions: (['short', 'bright', 'dark'] as const).filter((f) => f !== src && f !== next).map((f) => ({
        id: f,
        title: `Suggestion: the ${f} fixture`,
        channel: 'Player harness',
        go: () => {
          requestAutoplay(f);
          navigateOrLoad((href) => router.push(href), `/${lang}/dev/player?src=${f}`);
        },
      })),
      reportProblem: () => document.getElementById('harness-report')?.focus(),
    });
  }, [watch, src, lang, router, playback.active, playback.upNext, playback.replayList]);

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
            autoplayIntent={autoplayIntent}
            offerResume={playback.active}
            enableChapters={src !== 'live' && src !== 'short'}
            enableSubtitles={src !== 'live'}
          />
          </section>
          <h1 className="mt-4 text-lg font-semibold">Harness: {src}</h1>
          <button id="harness-report" type="button" className="mt-2 text-sm underline">Report</button>
        </div>
        <aside className={`w-full ${theatre ? 'lg:w-full' : 'lg:w-1/4'}`} data-testid="harness-aside">
          {playback.active && playback.list && (
            <PlaylistPane
              queue={playback.queue}
              listId={playback.list}
              loop={playback.loop}
              shuffle={playback.shuffle}
              collapsed={playback.collapsed}
              canPrevious={playback.canPrevious}
              canNext={playback.canNext}
              onToggleLoop={playback.toggleLoop}
              onToggleShuffle={playback.toggleShuffle}
              onToggleCollapsed={playback.toggleCollapsed}
              onPrevious={playback.previous}
              onNext={playback.next}
              onPlay={playback.play}
              hrefFor={playback.hrefFor}
            />
          )}
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
