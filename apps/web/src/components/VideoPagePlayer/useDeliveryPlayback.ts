"use client";
/**
 * Playback for every web player (LTR and RTL watch pages, embeds; epic #687). Players are dumb:
 *
 *   - play `playUrl`, the one URL the API chose (lib/media/playback.ts in api-videos);
 *   - on a fatal error (or a stall of STALL_TIMEOUT_MS) while playing R2, ask the API once for a URL
 *     without R2 (fetchFallbackPlayback, with the error's class as the reason) and play that;
 *   - one QoE session per video load: requested source, actual source, fallback reason.
 *
 * `delivery.source` is only the label of what the API chose; this hook never picks a source.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Player } from "video.js";
import type { PlaybackFallbackReason } from "@al-ummah/shared-types";
import type { PlayerOptions } from "./interface";
import { deviceClass, fallbackReasonFor } from "@/lib/video/delivery";
import { QoeTracker, sendQoeBeacon } from "@/lib/video/qoe";
import { fetchFallbackPlayback } from "@/lib/api/videos";

export const HLS = 'application/x-mpegURL';
/** A stall this long on R2 counts as a failure and falls back */
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
  options: Pick<PlayerOptions, 'id' | 'playUrl' | 'poster' | 'delivery'>,
  onPlayerReady?: (player: Player) => void,
  opts: DeliveryPlaybackOptions = {},
) {
  const requested = options.delivery?.source === 'r2' ? 'r2' : 'bunny';
  // A stable array: a new one would make the player reload the video
  const videoSources = useMemo(() => [{ src: options.playUrl || '', type: HLS }], [options.playUrl]);
  const posterUrl = useMemo(() => posterFor(options), [options.poster, options.playUrl]); // eslint-disable-line react-hooks/exhaustive-deps
  const trackerRef = useRef<QoeTracker | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const fetchFallback = opts.fetchFallback ?? fetchFallbackPlayback;
  const anonymous = opts.anonymous === true;

  const handlePlayerReady = useCallback((ready: Player) => {
    setPlayer(ready);
    onPlayerReady?.(ready);
  }, [onPlayerReady]);

  // One QoE session per video load on this player, plus the one-time fallback through the API
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

    let fellBack = requested !== 'r2';
    let stallTimer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const clearStall = () => {
      if (stallTimer !== undefined) clearTimeout(stallTimer);
      stallTimer = undefined;
    };
    const fallBack = (reason: PlaybackFallbackReason) => {
      if (fellBack) return;
      fellBack = true;
      clearStall();
      const at = player.currentTime() || 0;
      tracker.markFallback(reason);
      void fetchFallback(videoId, reason, anonymous)
        .catch(() => null)
        .then((answer) => {
          if (disposed || !answer?.playUrl || answer.delivery?.source === 'r2') return;
          // Video.js accepts error(null) and a single source object; the local typings are narrower
          const vjs = player as unknown as { error(e: null): void; src(s: { src: string; type: string }): void };
          vjs.error(null);
          vjs.src({ src: answer.playUrl, type: HLS });
          player.one('loadedmetadata', () => {
            if (at > 0) player.currentTime(at);
            void player.play()?.catch(() => undefined);
          });
        });
    };
    const onError = () => fallBack(playerErrorReason(player));
    const onWaiting = () => {
      if (fellBack || stallTimer !== undefined) return;
      stallTimer = setTimeout(() => {
        stallTimer = undefined;
        fallBack('stall_timeout');
      }, STALL_TIMEOUT_MS);
    };
    const stallEvents = ['playing', 'pause', 'seeking', 'ended'] as const;
    if (!fellBack) {
      player.on('error', onError);
      player.on('waiting', onWaiting);
      for (const e of stallEvents) player.on(e, clearStall);
    }
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
    };
  }, [player, options.id, options.playUrl, requested, anonymous, fetchFallback]);

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

  return { source: requested, videoSources, posterUrl, handlePlayerReady };
}
