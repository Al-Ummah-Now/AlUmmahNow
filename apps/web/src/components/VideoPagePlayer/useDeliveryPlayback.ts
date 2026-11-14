"use client";
/**
 * Playback for every web player (LTR and RTL watch pages, embeds; docs/media-delivery/PROVIDERS.md).
 * Players are dumb: the API orders the providers and this hook walks its list.
 *
 *   sources[0] ─(fatal error, or a stall of STALL_TIMEOUT_MS)─► sources[1] ─► … at the same time
 *       │ every failure is reported: GET /playback?exclude=<failed so far>&reason=<class> (health)
 *       └─ list used up (or an older response with only playUrl): that answer's sources come next
 *
 * One QoE session per video load: requested source, the source it ended on, the first reason.
 *
 * The player (CustomVideoPlayer) asks handlePlaybackError before it shows its error screen: while
 * this hook moves to another source, or waits for the API's, the screen stays away. Without that the
 * error screen replaced the player on the first error and the next source never played (a fast 503).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Player } from "video.js";
import type { MediaProviderId, PlaybackFallbackReason, PlaybackSourceView } from "@al-ummah/shared-types";
import type { PlayerOptions } from "./interface";
import { deviceClass, fallbackReasonFor, playbackList, playbackSourcesOf } from "@/lib/video/delivery";
import { QoeTracker, sendQoeBeacon } from "@/lib/video/qoe";
import { fetchFallbackPlayback } from "@/lib/api/videos";

export const HLS = 'application/x-mpegURL';
/** A stall this long counts as a failure and moves to the next source */
export const STALL_TIMEOUT_MS = 15_000;
/** How often a playing session reports to the live view (admin Delivery page "now"; the server forgets a session after 75 s). */
const QOE_HEARTBEAT_MS = 30_000;

/** One id per play session (statistics only, but never Math.random) */
function qoeSessionId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}

type VhsTech = { vhs?: { playlists?: { media?: () => { attributes?: { BANDWIDTH?: number } }; error?: { status?: number } } } };

function vhsOf(player: Player): VhsTech['vhs'] {
  try {
    return (player as unknown as { tech?: (o: unknown) => VhsTech }).tech?.({ IWillNotUseThisInPlugins: true })?.vhs;
  } catch {
    return undefined;
  }
}

/** VHS's selected rendition bandwidth (bits/s), when the tech exposes it */
function vhsBandwidth(player: Player): number | undefined {
  try {
    return vhsOf(player)?.playlists?.media?.()?.attributes?.BANDWIDTH;
  } catch {
    return undefined;
  }
}

/** The fallback reason for the player's current error */
export function playerErrorReason(player: Player): PlaybackFallbackReason {
  const error = ((player as unknown as { error?: () => unknown }).error?.() ?? null) as { code?: number; status?: number; metadata?: { status?: number } } | null;
  const status = vhsOf(player)?.playlists?.error?.status ?? error?.metadata?.status ?? error?.status;
  return fallbackReasonFor({ code: error?.code, status: typeof status === 'number' ? status : undefined });
}

/** The poster: the API's thumbnail (the chosen source's), else Bunny's next to its playlist. Always absolute. */
export function posterFor(options: Pick<PlayerOptions, 'poster' | 'playUrl'>): string {
  const derived = options.playUrl?.endsWith('/playlist.m3u8') ? options.playUrl.replace(/playlist\.m3u8$/, 'thumbnail.jpg') : '';
  const poster = options.poster || derived;
  if (poster && !poster.startsWith('http://') && !poster.startsWith('https://')) return `https://${poster}`;
  return poster || '';
}

export interface DeliveryPlaybackOptions {
  /** Embeds never act as the viewer: the fallback request goes without the session */
  anonymous?: boolean;
  /** Tests: the fallback request */
  fetchFallback?: typeof fetchFallbackPlayback;
}

export function useDeliveryPlayback(
  options: Pick<PlayerOptions, 'id' | 'playUrl' | 'poster' | 'delivery' | 'sources'>,
  onPlayerReady?: (player: Player) => void,
  opts: DeliveryPlaybackOptions = {},
) {
  // Keyed by content: a new array with the same sources must not reload the video
  const sourcesKey = (options.sources ?? []).map((x) => `${x.provider} ${x.src}`).join('\n');
  const list = useMemo(() => playbackList(options), [options.playUrl, sourcesKey, options.delivery?.source]); // eslint-disable-line react-hooks/exhaustive-deps
  const requested: MediaProviderId = list[0]?.provider ?? 'bunny';
  // A stable array: a new one would make the player reload the video
  const firstSrc = list[0]?.src || '';
  const videoSources = useMemo(() => [{ src: firstSrc, type: HLS }], [firstSrc]);
  const posterUrl = useMemo(() => posterFor(options), [options.poster, options.playUrl]); // eslint-disable-line react-hooks/exhaustive-deps
  const trackerRef = useRef<QoeTracker | null>(null);
  /** This load's error handler (the effect below); true while a fallback is under way */
  const walkerRef = useRef<{ player: Player; onError: () => boolean } | null>(null);
  /** An error the player saw before the effect was attached, held because another source exists */
  const pendingErrorRef = useRef(false);
  const listRef = useRef(list);
  listRef.current = list;
  const [player, setPlayer] = useState<Player | null>(null);
  const fetchFallback = opts.fetchFallback ?? fetchFallbackPlayback;
  const anonymous = opts.anonymous === true;

  const handlePlayerReady = useCallback((ready: Player) => {
    setPlayer(ready);
    onPlayerReady?.(ready);
  }, [onPlayerReady]);

  // One QoE session per video load on this player, and the walk down the source list
  useEffect(() => {
    // A playlist's next video re-keys the player: the old one is disposed until the new one is ready
    if (!player || (player as unknown as { isDisposed?: () => boolean }).isDisposed?.()) return;
    const videoId = options.id;
    const tracker = new QoeTracker(
      { on: (e, fn) => player.on(e, fn), off: (e, fn) => player.off(e, fn), paused: () => player.paused(), bandwidth: () => vhsBandwidth(player) },
      { sessionId: qoeSessionId(), source: requested, device: deviceClass(), send: (r) => sendQoeBeacon(videoId, r), beat: (r) => sendQoeBeacon(videoId, r) },
    );
    trackerRef.current = tracker;
    // Live view of the admin Delivery page: a heartbeat every 30 s while the page is visible
    const beat = window.setInterval(() => {
      if (document.visibilityState === 'visible') tracker.heartbeat();
    }, QOE_HEARTBEAT_MS);
    const onDispose = () => tracker.flush();
    player.on('dispose', onDispose);

    let sources: PlaybackSourceView[] = [...list];
    let index = 0;
    const failed: MediaProviderId[] = [];
    /** The API was asked for more after the list ran out (once per load) */
    let askedForMore = false;
    let waitingForApi = false;
    let stallTimer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const clearStall = () => {
      if (stallTimer !== undefined) clearTimeout(stallTimer);
      stallTimer = undefined;
    };
    /** The player shows its error screen for the error that is still set (nothing left to try) */
    const surfaceError = () => (player as unknown as { trigger?: (e: string) => void }).trigger?.('error');
    const switchTo = (next: PlaybackSourceView, reason: PlaybackFallbackReason, at: number) => {
      tracker.markFallback(reason, next.provider);
      // Video.js accepts error(null) and a single source object; the local typings are narrower
      const vjs = player as unknown as { error(e: null): void; src(s: { src: string; type: string }): void };
      vjs.error(null);
      vjs.src({ src: next.src, type: HLS });
      player.one('loadedmetadata', () => {
        if (at > 0) player.currentTime(at);
        void player.play()?.catch(() => undefined);
      });
    };
    /** Moves on from the current source; true while that is under way (switched, or asking the API) */
    const fallBack = (reason: PlaybackFallbackReason): boolean => {
      if (disposed) return false;
      if (waitingForApi) return true;
      const current = sources[index];
      if (!current || failed.includes(current.provider)) return false;
      failed.push(current.provider);
      clearStall();
      const at = player.currentTime() || 0;
      // Every failure is reported (provider health); the answer is only needed when the list ran out
      const answer = fetchFallback(videoId, reason, anonymous, [...failed]).catch(() => null);
      const next = sources[index + 1];
      if (next) {
        index += 1;
        switchTo(next, reason, at);
        return true;
      }
      if (askedForMore) return false;
      askedForMore = true;
      waitingForApi = true;
      void answer.then((reply) => {
        waitingForApi = false;
        if (disposed) return;
        if (!reply) return surfaceError();
        const more = playbackSourcesOf(reply.sources).filter((x) => !failed.includes(x.provider));
        const single = reply.playUrl && reply.delivery?.source && !failed.includes(reply.delivery.source as MediaProviderId)
          ? playbackList({ playUrl: reply.playUrl, delivery: reply.delivery })
          : [];
        const extra = more.length ? more : single;
        if (!extra.length) return surfaceError();
        sources = [...sources.slice(0, index + 1), ...extra];
        index += 1;
        switchTo(sources[index]!, reason, at);
      });
      return true;
    };
    // The player asks first (handlePlaybackError); this listener covers players that do not. An error
    // already moved past (error(null) on the switch) is not counted again.
    const handleError = () => fallBack(playerErrorReason(player));
    const onError = () => {
      if ((player as unknown as { error?: () => unknown }).error?.()) handleError();
    };
    walkerRef.current = { player, onError: handleError };
    if (pendingErrorRef.current) {
      pendingErrorRef.current = false;
      onError();
    }
    const onWaiting = () => {
      if (stallTimer !== undefined || waitingForApi) return;
      stallTimer = setTimeout(() => {
        stallTimer = undefined;
        fallBack('stall_timeout');
      }, STALL_TIMEOUT_MS);
    };
    const stallEvents = ['playing', 'pause', 'seeking', 'ended'] as const;
    player.on('error', onError);
    player.on('waiting', onWaiting);
    for (const e of stallEvents) player.on(e, clearStall);
    return () => {
      disposed = true;
      window.clearInterval(beat);
      clearStall();
      tracker.flush();
      tracker.detach();
      player.off('dispose', onDispose);
      player.off('error', onError);
      player.off('waiting', onWaiting);
      for (const e of stallEvents) player.off(e, clearStall);
      if (trackerRef.current === tracker) trackerRef.current = null;
      if (walkerRef.current?.player === player) walkerRef.current = null;
    };
  }, [player, options.id, list, requested, anonymous, fetchFallback]);

  // Report the session when the page is hidden or left
  useEffect(() => {
    const flush = () => trackerRef.current?.flush();
    const onHidden = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, []);

  /**
   * For the player, before it shows its error screen: true when this hook is moving to another
   * source (or asking the API for one), so the screen must stay away. An error before this load's
   * handler is attached is held when another source exists, and handled as soon as it is.
   */
  const handlePlaybackError = useCallback((errored: Player): boolean => {
    const walker = walkerRef.current;
    if (walker && walker.player === errored) return walker.onError();
    if (listRef.current.length < 2) return false;
    pendingErrorRef.current = true;
    return true;
  }, []);

  return { source: requested, videoSources, posterUrl, handlePlayerReady, handlePlaybackError };
}
