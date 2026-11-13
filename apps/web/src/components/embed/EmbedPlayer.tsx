'use client';

/**
 * Embed player frame (docs/embeds/README.md §2): the watch page's player
 * (VideoPlayerWithChapters → CustomVideoPlayer) with minimal chrome.
 *
 * - Facade first: poster + play button. The player (and with it analytics)
 *   loads only when the viewer presses play, or at once with autoplay=1
 *   (muted, as browsers require for third-party autoplay).
 * - autoplay=1&gesture=1: the host started playback from the viewer's own click
 *   (www's video facade). The parent's user activation lets an iframe with
 *   allow="autoplay" play with sound, so it plays unmuted; only if the browser
 *   refuses (NotAllowedError) does it mute and show "Tap to unmute".
 * - start / end / loop parameters, "Watch on Al Ummah Now" at the current time.
 * - Playlists: the same frame with a list drawer, in the playlist's saved order (the playback
 *   queue API); when a video ends the 3 s "Up next" countdown plays the next one (cancellable),
 *   (each item starts like the first: see the autoplay rules above).
 * - postMessage events and commands through useEmbedMessaging.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Player } from 'video.js';
import { ExternalLink, ListVideo, Play, VolumeX, X } from 'lucide-react';
import { VideoPlayerWithChapters } from '@/components/VideoPagePlayer/VideoPlayerWithChapters';
import { useDeliveryPlayback } from '@/components/VideoPagePlayer/useDeliveryPlayback';
import { LocaleOverrideContext } from '@/hooks/useLanguage';
import { removeUnwantedChars } from '@/lib/utility';
import { embedderOrigin, readAncestorOrigins, type EmbedCommandMessage, type EmbedState } from '@/lib/embed/messaging';
import type { EmbedParams } from '@/lib/embed/params';
import { embedStrings, fill } from '@/lib/embed/strings';
import { formatTimestamp } from '@/lib/embed/snippets';
import type { EmbedVideo } from '@/lib/embed/content';
import { videoAspect } from '@/lib/embed/aspect';
import type { ExtendedPlayer } from '@/lib/video/videojs';
import type { AnalyticsContext } from '@al-ummah/shared-types';
import { updatePlayerUi } from '@/lib/video/player-ui';
import { watchHref as listWatchHref } from '@/lib/playlists/playback';
import { shareLink } from '@/lib/share/short-link';
import { useEmbedMessaging } from './useEmbedMessaging';
// Black backdrop and a player that fills the host's frame, in every theme and mode
import './embed-frame.css';
import { channelLabel } from '@/lib/channel-name';

export interface EmbedPlayerProps {
  videos: EmbedVideo[];
  params: EmbedParams;
  playlist?: { id: string; title: string };
}

function titleOf(video: EmbedVideo, lang: string): string {
  return removeUnwantedChars(video.titleLocalized?.[lang] || video.title || '');
}

/**
 * The player box is the whole frame, and the video is fitted inside it at its own ratio (the video
 * element and the poster are object-fit: contain, on the night colour; embed-frame.css). A Short in
 * X's wide card is pillarboxed, as before, but the control bar, the progress bar and the "Watch on"
 * link are laid out across the frame, like YouTube's vertical videos in a landscape player: on a
 * box the video's own width (~175-250px in X's card) the bar wrapped onto two rows, lifting the
 * progress bar to the middle of the video, and the link covered the video's title (2026-11-12).
 */
/**
 * Whether the "Watch on" link shows its icon alone: in frames under 480px wide, and wherever the
 * picture is pillarboxed but the full link does not fit in the bar beside it (it would cover the
 * top of the picture: a Short's title, a logo burned into its corner). A landscape video filling a
 * wide frame keeps the label on the picture, as before. The label's own width is measured
 * (scrollWidth, also while it is visually hidden), so English and Arabic each get their real size.
 */
const LINK_CHROME_PX = 14 + 4 + 20 + 8; // icon, gap, padding, the 8px inset from the frame's edge
function useCompactLink(labelRef: React.RefObject<HTMLSpanElement | null>, aspect: number | null): boolean {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const fit = () => {
      const width = window.innerWidth;
      const picture = aspect ? Math.min(width, window.innerHeight * aspect) : width;
      const side = (width - picture) / 2;
      const full = (labelRef.current?.scrollWidth ?? 0) + LINK_CHROME_PX;
      setCompact(width < 480 || (side > 4 && side < full + 8));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [labelRef, aspect]);
  return compact;
}

const FACADE_STYLE = { width: '100%', height: '100%' } as const;

export default function EmbedPlayer({ videos, params, playlist }: EmbedPlayerProps) {
  const { lang } = params;
  const s = embedStrings(lang);
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const [index, setIndex] = useState(() => Math.min(params.index, Math.max(0, videos.length - 1)));
  const [activated, setActivated] = useState(params.autoplay);
  const [listOpen, setListOpen] = useState(false);
  /** Playing muted because of an autoplay rule: the "Tap to unmute" control shows */
  const [needsUnmute, setNeedsUnmute] = useState(false);
  /** The video has ended: the end screen (replay, up next) is up, and "Tap to unmute" would cover its buttons */
  const [ended, setEnded] = useState(false);
  /** The first video of a gesture start is started here, with sound (see handlePlayerReady) */
  const startWithSoundRef = useRef(params.autoplay && params.gesture);
  /** "Watch on" shows its icon alone where its label would cover the picture (see useCompactLink) */
  const watchLabelRef = useRef<HTMLSpanElement>(null);
  const playerRef = useRef<ExtendedPlayer | null>(null);
  const pendingStartRef = useRef<number>(params.start);
  const lastTimeUpdateRef = useRef(0);
  const video = videos[index];
  const compactLink = useCompactLink(watchLabelRef, videoAspect(video));

  const analyticsContext = useMemo<AnalyticsContext>(() => ({
    source: 'embed',
    embedOrigin: typeof window === 'undefined' ? null : embedderOrigin(readAncestorOrigins(), document.referrer),
  }), []);

  const getState = useCallback((): EmbedState => {
    const player = playerRef.current;
    const base = { videoId: video.id, ...(playlist ? { playlistId: playlist.id } : {}) };
    if (!player || player.isDisposed?.()) {
      return { ...base, currentTime: pendingStartRef.current, duration: video.duration ?? null, muted: params.autoplay && !params.gesture };
    }
    return { ...base, currentTime: player.currentTime() || 0, duration: player.duration() || null, muted: player.muted() };
  }, [video, playlist, params.autoplay, params.gesture]);

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

  // The end screen's "Up next" (and its countdown) plays the next item in the list; the list stops
  // after its last item (docs/specs/PLAYLIST-PLAYBACK.md D9)
  const nextVideo = playlist ? videos[index + 1] : undefined;
  useEffect(() => {
    updatePlayerUi({
      upNext: nextVideo
        ? {
            title: titleOf(nextVideo, lang),
            channel: removeUnwantedChars(channelLabel(nextVideo, lang)),
            thumbnail: nextVideo.poster,
            badge: `${(index + 2).toLocaleString(lang)} / ${videos.length.toLocaleString(lang)}`,
            go: goToNext,
          }
        : null,
    });
  }, [nextVideo, index, videos.length, lang, goToNext]);
  useEffect(() => () => updatePlayerUi({ upNext: null }), []);

  const handlePlayerReady = useCallback((readyPlayer: Player) => {
    const player = readyPlayer as unknown as ExtendedPlayer;
    playerRef.current = player;
    const end = index === params.index || !playlist ? params.end : null;
    if (params.loop && !playlist) player.loop(true);

    player.on('play', () => emit('play'));
    player.on('pause', () => emit('pause'));
    // The next item follows through the end screen's countdown (upNext above)
    player.on('ended', () => {
      setEnded(true);
      emit('ended');
    });
    // Replay, a seek back or the next item: the end screen is gone
    player.on('play', () => setEnded(false));
    player.on('seeking', () => setEnded(false));
    player.on('error', () => emit('error', { code: 'media', message: player.error()?.message }));
    // Unmuted by any means (the control bar, a host command): the unmute control goes
    player.on('volumechange', () => {
      if (!player.muted() && (player.volume() ?? 1) > 0) setNeedsUnmute(false);
    });

    if (startWithSoundRef.current) {
      // A gesture start (once per frame): play with sound; muted only if the browser refuses
      startWithSoundRef.current = false;
      player.muted(false);
      const tryPlay = (retry: boolean): Promise<void> =>
        Promise.resolve(player.play()).then(
          () => undefined,
          (err: unknown) => {
            if ((err as { name?: string } | null)?.name === 'NotAllowedError') {
              player.muted(true);
              setNeedsUnmute(true);
              return Promise.resolve(player.play()).then(() => undefined, () => undefined);
            }
            // e.g. AbortError while the source is still loading: once more when it can play
            if (retry) player.one('canplay', () => void tryPlay(false));
            return undefined;
          },
        );
      void tryPlay(true);
    } else {
      // Plain autoplay (muted, as third-party autoplay must be): offer sound
      player.one('playing', () => {
        if (player.muted()) setNeedsUnmute(true);
      });
    }
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
  }, [emit, index, params.end, params.index, params.loop, playlist]);

  // Inside a playlist the watch page continues the list from this item
  // "Watch on": the short link (alummahnow.link/v/<id>, wiki AUN-SHORT-LINKS) where this environment
  // has one, so clicks from embeds are counted; the watch page's own URL otherwise
  const watchHref = useCallback((seconds: number) => {
    const listIndex = playlist ? (video.listIndex ?? index) : null;
    return shareLink(
      { kind: 'video', id: video.id },
      listWatchHref(lang, video.id, { list: playlist?.id ?? null, index: listIndex, t: seconds }),
      { t: seconds, list: playlist?.id ? { id: playlist.id, index: listIndex } : null, locale: lang },
    );
  }, [lang, video.id, video.listIndex, playlist, index]);

  const onWatchClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    const seconds = playerRef.current ? playerRef.current.currentTime() || 0 : pendingStartRef.current;
    event.currentTarget.href = watchHref(seconds);
  };

  // The one URL the API chose; on an R2 failure the API gives Bunny's (anonymously, like every embed call)
  const delivery = useDeliveryPlayback(video, handlePlayerReady, { anonymous: true });

  const title = titleOf(video, lang);
  const isFirst = index === Math.min(params.index, videos.length - 1);
  const muted = params.autoplay && isFirst && !params.gesture;
  const gestureStart = params.autoplay && params.gesture && isFirst;

  const unmute = () => {
    const player = playerRef.current;
    if (!player) return;
    player.muted(false);
    if (!player.volume()) player.volume(1);
    setNeedsUnmute(false);
  };

  return (
    <LocaleOverrideContext.Provider value={lang}>
      <main
        dir={dir}
        lang={lang}
        data-testid="embed-player"
        data-video-id={video.id}
        className="relative w-screen h-screen bg-black text-white overflow-hidden flex items-center justify-center"
      >
        <div className="embed-box relative" data-aspect={videoAspect(video)?.toFixed(4) ?? undefined}>
          {activated ? (
            <VideoPlayerWithChapters
              key={video.id}
              videoId={video.id}
              sources={delivery.videoSources}
              poster={video.poster}
              controls
              autoplay={!gestureStart}
              muted={muted}
              startTime={pendingStartRef.current}
              enableAnalytics
              enableWebSocket={false}
              analyticsContext={analyticsContext}
              showChapterOverlay={false}
              lang={lang}
              className="w-full"
              ariaLabel={fill(s.playVideo, { title })}
              onPlayerReady={delivery.handlePlayerReady}
            />
          ) : (
            <button
              type="button"
              onClick={() => setActivated(true)}
              className="group relative block w-full bg-transparent focus:outline-none focus-visible:ring-4 focus-visible:ring-emerald-400"
              style={FACADE_STYLE}
              aria-label={fill(s.playVideo, { title })}
              data-testid="embed-facade"
            >
              {video.poster && (
                // contain, not cover: a vertical or square poster is letterboxed like the player shows it
                // eslint-disable-next-line @next/next/no-img-element
                <img src={video.poster} alt="" className="absolute inset-0 w-full h-full object-contain" />
              )}
              <span className="absolute inset-0 bg-gradient-to-b from-black/70 via-transparent to-black/40" aria-hidden="true" />
              <span className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
                <span className="flex items-center justify-center w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-emerald-600 group-hover:bg-emerald-500 shadow-lg transition-colors">
                  <Play className="w-8 h-8 sm:w-10 sm:h-10 fill-white text-white ms-1" />
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
                {channelLabel(video, lang) && (
                  <p className="truncate text-xs text-gray-300">{removeUnwantedChars(channelLabel(video, lang))}</p>
                )}
              </div>
            </div>
          )}

          {needsUnmute && !ended && (
            <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
              <button
                type="button"
                onClick={unmute}
                className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-[var(--fanous-c-nav-bg)] text-[var(--fanous-c-nav-text)] px-4 py-2 text-sm font-semibold shadow-lg ring-1 ring-[color-mix(in_srgb,var(--fanous-c-nav-text)_45%,transparent)] hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[var(--fanous-color-focus-ring)]"
                data-testid="embed-unmute"
              >
                <VolumeX className="w-5 h-5" aria-hidden="true" />
                <span>{s.tapToUnmute}</span>
              </button>
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
              title={s.watchOn}
              data-compact={compactLink || undefined}
              className="embed-watch-link inline-flex items-center gap-1 rounded-full bg-black/70 px-2.5 py-1 text-xs leading-5 hover:bg-black/90 focus-visible:ring-2 focus-visible:ring-white"
              data-testid="embed-watch-link"
            >
              {/* Compact: the icon alone; the label stays the link's name (embed-frame.css) */}
              <span ref={watchLabelRef} className="embed-watch-label">{s.watchOn}</span>
              <ExternalLink className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
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
                        <img src={item.poster} alt="" className="h-9 w-16 shrink-0 rounded object-contain" loading="lazy" />
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
