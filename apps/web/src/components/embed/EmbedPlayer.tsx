'use client';

/**
 * Embed player frame (docs/embeds/README.md §2): the watch page's player
 * (VideoPlayerWithChapters → CustomVideoPlayer) with minimal chrome.
 *
 * - Facade first: poster + play button. The player (and with it analytics)
 *   loads only when the viewer presses play, or at once with autoplay=1
 *   (muted, as browsers require).
 * - start / end / loop parameters, "Watch on Al Ummah Now" at the current time.
 * - Playlists: the same frame with a list drawer; moves on when a video ends.
 * - postMessage events and commands through useEmbedMessaging.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Player } from 'video.js';
import { ExternalLink, ListVideo, Play, X } from 'lucide-react';
import { VideoPlayerWithChapters } from '@/components/VideoPagePlayer/VideoPlayerWithChapters';
import { LocaleOverrideContext } from '@/hooks/useLanguage';
import { removeUnwantedChars } from '@/lib/utility';
import { embedderOrigin, readAncestorOrigins, type EmbedCommandMessage, type EmbedState } from '@/lib/embed/messaging';
import type { EmbedParams } from '@/lib/embed/params';
import { embedStrings, fill } from '@/lib/embed/strings';
import { formatTimestamp } from '@/lib/embed/snippets';
import type { EmbedVideo } from '@/lib/embed/content';
import type { ExtendedPlayer } from '@/lib/video/videojs';
import type { AnalyticsContext } from '@al-ummah/shared-types';
import { useEmbedMessaging } from './useEmbedMessaging';

export interface EmbedPlayerProps {
  videos: EmbedVideo[];
  params: EmbedParams;
  playlist?: { id: string; title: string };
}

function titleOf(video: EmbedVideo, lang: string): string {
  return removeUnwantedChars(video.titleLocalized?.[lang] || video.title || '');
}

/** Largest 16:9 box that fits the frame */
const PLAYER_BOX_STYLE = { width: 'min(100vw, calc(100vh * 16 / 9))' } as const;
/** Inline: the @tailwindcss/aspect-ratio plugin replaces the core aspect-video utility */
const FACADE_STYLE = { aspectRatio: '16 / 9' } as const;

export default function EmbedPlayer({ videos, params, playlist }: EmbedPlayerProps) {
  const { lang } = params;
  const s = embedStrings(lang);
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const [index, setIndex] = useState(() => Math.min(params.index, Math.max(0, videos.length - 1)));
  const [activated, setActivated] = useState(params.autoplay);
  const [listOpen, setListOpen] = useState(false);
  const playerRef = useRef<ExtendedPlayer | null>(null);
  const pendingStartRef = useRef<number>(params.start);
  const lastTimeUpdateRef = useRef(0);
  const video = videos[index];

  const analyticsContext = useMemo<AnalyticsContext>(() => ({
    source: 'embed',
    embedOrigin: typeof window === 'undefined' ? null : embedderOrigin(readAncestorOrigins(), document.referrer),
  }), []);

  const getState = useCallback((): EmbedState => {
    const player = playerRef.current;
    const base = { videoId: video.id, ...(playlist ? { playlistId: playlist.id } : {}) };
    if (!player || player.isDisposed?.()) {
      return { ...base, currentTime: pendingStartRef.current, duration: video.duration ?? null, muted: params.autoplay };
    }
    return { ...base, currentTime: player.currentTime() || 0, duration: player.duration() || null, muted: player.muted() };
  }, [video, playlist, params.autoplay]);

  const handleCommand = useCallback((command: EmbedCommandMessage) => {
    const player = playerRef.current;
    switch (command.command) {
      case 'play':
        if (!player) setActivated(true);
        else void Promise.resolve(player.play()).catch(() => undefined);
        break;
      case 'pause':
        player?.pause();
        break;
      case 'seek':
        if (player) player.currentTime(command.seconds ?? 0);
        else pendingStartRef.current = command.seconds ?? 0;
        break;
      case 'mute':
        player?.muted(true);
        break;
      case 'unmute':
        player?.muted(false);
        break;
      default:
        break;
    }
  }, []);

  const { emit } = useEmbedMessaging(params.origin, getState, handleCommand);

  useEffect(() => {
    emit('ready');
    // once per frame load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const goToNext = useCallback(() => {
    if (index + 1 < videos.length) {
      pendingStartRef.current = 0;
      playerRef.current = null;
      setIndex(index + 1);
    }
  }, [index, videos.length]);

  const handlePlayerReady = useCallback((readyPlayer: Player) => {
    const player = readyPlayer as unknown as ExtendedPlayer;
    playerRef.current = player;
    const end = index === params.index || !playlist ? params.end : null;
    if (params.loop && !playlist) player.loop(true);

    player.on('play', () => emit('play'));
    player.on('pause', () => emit('pause'));
    player.on('ended', () => {
      emit('ended');
      goToNext();
    });
    player.on('error', () => emit('error', { code: 'media', message: player.error()?.message }));
    player.on('timeupdate', () => {
      const now = player.currentTime() || 0;
      if (end !== null && now >= end && !player.paused()) {
        player.pause();
        if (params.loop && !playlist) {
          player.currentTime(pendingStartRef.current || 0);
          void Promise.resolve(player.play()).catch(() => undefined);
        }
      }
      const t = Date.now();
      if (t - lastTimeUpdateRef.current >= 1000) {
        lastTimeUpdateRef.current = t;
        emit('timeupdate');
      }
    });
  }, [emit, goToNext, index, params.end, params.index, params.loop, playlist]);

  const watchHref = useCallback((seconds: number) => {
    const path = `/${lang}/video/${encodeURIComponent(video.id)}`;
    return seconds >= 1 ? `${path}?t=${Math.floor(seconds)}` : path;
  }, [lang, video.id]);

  const onWatchClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    const seconds = playerRef.current ? playerRef.current.currentTime() || 0 : pendingStartRef.current;
    event.currentTarget.href = watchHref(seconds);
  };

  const title = titleOf(video, lang);
  const isFirst = index === Math.min(params.index, videos.length - 1);
  const muted = params.autoplay && isFirst;

  return (
    <LocaleOverrideContext.Provider value={lang}>
      <main
        dir={dir}
        lang={lang}
        data-testid="embed-player"
        data-video-id={video.id}
        className="relative w-screen h-screen bg-black text-white overflow-hidden flex items-center justify-center"
      >
        <div className="relative" style={PLAYER_BOX_STYLE}>
          {activated ? (
            <VideoPlayerWithChapters
              key={video.id}
              videoId={video.id}
              sources={[{ src: video.playUrl, type: 'application/x-mpegURL' }]}
              poster={video.poster}
              controls
              autoplay
              muted={muted}
              startTime={pendingStartRef.current}
              enableAnalytics
              enableWebSocket={false}
              analyticsContext={analyticsContext}
              showChapterOverlay={false}
              lang={lang}
              className="w-full"
              ariaLabel={fill(s.playVideo, { title })}
              onPlayerReady={handlePlayerReady}
            />
          ) : (
            <button
              type="button"
              onClick={() => setActivated(true)}
              className="group relative block w-full bg-black focus:outline-none focus-visible:ring-4 focus-visible:ring-emerald-400"
              style={FACADE_STYLE}
              aria-label={fill(s.playVideo, { title })}
              data-testid="embed-facade"
            >
              {video.poster && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={video.poster} alt="" className="absolute inset-0 w-full h-full object-cover" />
              )}
              <span className="absolute inset-0 bg-gradient-to-b from-black/70 via-transparent to-black/40" aria-hidden="true" />
              <span className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
                <span className="flex items-center justify-center w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-emerald-600 group-hover:bg-emerald-500 shadow-lg transition-colors">
                  <Play className="w-8 h-8 sm:w-10 sm:h-10 fill-white text-white translate-x-[5.55%]" />
                </span>
              </span>
              {params.start > 0 && (
                <span className="absolute bottom-3 end-3 rounded bg-black/70 px-2 py-0.5 text-xs" aria-hidden="true">
                  {formatTimestamp(params.start)}
                </span>
              )}
            </button>
          )}

          {params.showTitle && !activated && (
            <div className="pointer-events-none absolute top-0 inset-x-0 p-3 pe-48 flex items-start gap-2 bg-gradient-to-b from-black/60 to-transparent">
              <div className="min-w-0 flex-1">
                <a
                  href={watchHref(0)}
                  target="_blank"
                  rel="noopener"
                  className="pointer-events-auto block truncate text-base font-semibold hover:underline"
                  data-testid="embed-title"
                >
                  {title}
                </a>
                {video.channelName && (
                  <p className="truncate text-xs text-gray-300">{removeUnwantedChars(video.channelName)}</p>
                )}
              </div>
            </div>
          )}

          <div className="absolute top-2 end-2 z-20 flex items-center gap-2">
            {playlist && videos.length > 1 && (
              <button
                type="button"
                onClick={() => setListOpen((open) => !open)}
                aria-expanded={listOpen}
                aria-controls="embed-playlist"
                className="inline-flex items-center gap-1 rounded-full bg-black/70 px-3 py-1.5 text-xs hover:bg-black/90 focus-visible:ring-2 focus-visible:ring-white"
                data-testid="embed-playlist-toggle"
              >
                <ListVideo className="w-4 h-4" aria-hidden="true" />
                <span>{index + 1}/{videos.length}</span>
                <span className="sr-only">{s.playlist}</span>
              </button>
            )}
            <a
              href={watchHref(params.start)}
              onClick={onWatchClick}
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-1 rounded-full bg-black/70 px-3 py-1.5 text-xs hover:bg-black/90 focus-visible:ring-2 focus-visible:ring-white"
              data-testid="embed-watch-link"
            >
              <span>{s.watchOn}</span>
              <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
            </a>
          </div>

          {playlist && listOpen && (
            <nav
              id="embed-playlist"
              aria-label={s.playlist}
              className="absolute top-0 bottom-0 end-0 z-30 w-72 max-w-[85%] overflow-y-auto bg-black/90 p-2"
              data-testid="embed-playlist"
            >
              <div className="flex items-center justify-between gap-2 px-1 pb-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{removeUnwantedChars(playlist.title) || s.playlist}</p>
                  <p className="text-xs text-gray-400">{fill(s.playlistCount, { count: videos.length })}</p>
                </div>
                <button type="button" onClick={() => setListOpen(false)} className="rounded p-1 hover:bg-white/10" aria-label={s.close}>
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
              <ol className="space-y-1">
                {videos.map((item, i) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => {
                        pendingStartRef.current = 0;
                        playerRef.current = null;
                        setIndex(i);
                        setActivated(true);
                        setListOpen(false);
                      }}
                      aria-current={i === index ? 'true' : undefined}
                      className={`flex w-full items-center gap-2 rounded p-1 text-start hover:bg-white/10 ${i === index ? 'bg-white/15' : ''}`}
                    >
                      <span className="w-5 shrink-0 text-center text-xs text-gray-400">{i === index ? '▶' : i + 1}</span>
                      {item.poster && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.poster} alt="" className="h-9 w-16 shrink-0 rounded object-cover" loading="lazy" />
                      )}
                      <span className="line-clamp-2 text-xs">{titleOf(item, lang)}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </nav>
          )}
        </div>
      </main>
    </LocaleOverrideContext.Provider>
  );
}
