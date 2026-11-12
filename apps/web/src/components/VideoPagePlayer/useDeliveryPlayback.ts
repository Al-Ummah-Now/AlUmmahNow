"use client";
/**
 * Source choice for the watch page player, shared by the LTR and RTL players (epic #687):
 * Bunny or R2 per the admin delivery switch (lib/video/delivery.ts), a one-time fallback to Bunny
 * on a fatal R2 error, the poster, and one QoE session per video load tagged by source.
 *
 * 2026-11-12: only the LTR player had this; Arabic pages (VideoPagePlayer/rtl) played Bunny's
 * playUrl whatever the switch said and sent no QoE. Both players use this hook now.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Player } from "video.js";
import type { PlayerOptions } from "./interface";
import { chooseDelivery, deviceClass, type DeliveryChoice } from "@/lib/video/delivery";
import { QoeTracker, sendQoeBeacon } from "@/lib/video/qoe";

export const HLS = 'application/x-mpegURL';

/** One id per play session (statistics only, but never Math.random) */
/** How often a playing session reports to the live view (admin Delivery page "now"; the server forgets a session after 75 s). */
const QOE_HEARTBEAT_MS = 30_000;

function qoeSessionId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** VHS's selected rendition bandwidth (bits/s), when the tech exposes it */
function vhsBandwidth(player: Player): number | undefined {
  try {
    const tech = (player as unknown as { tech?: (o: unknown) => { vhs?: { playlists?: { media?: () => { attributes?: { BANDWIDTH?: number } } } } } }).tech?.({ IWillNotUseThisInPlugins: true });
    return tech?.vhs?.playlists?.media?.()?.attributes?.BANDWIDTH;
  } catch {
    return undefined;
  }
}

/** The poster: R2's when playing R2, else the API's, else Bunny's next to its playlist. Always absolute. */
export function posterFor(options: Pick<PlayerOptions, 'poster' | 'playUrl'>, delivery: DeliveryChoice): string {
  const derived = options.playUrl?.endsWith('/playlist.m3u8') ? options.playUrl.replace(/playlist\.m3u8$/, 'thumbnail.jpg') : '';
  const poster = (delivery.provider === 'r2' ? delivery.poster : undefined) || options.poster || derived;
  if (poster && !poster.startsWith('http://') && !poster.startsWith('https://')) return `https://${poster}`;
  return poster || '';
}

export function useDeliveryPlayback(options: PlayerOptions, onPlayerReady?: (player: Player) => void) {
  // Drawn once per video load
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const delivery = useMemo(() => chooseDelivery(options.playUrl, options.delivery), [options.id, options.playUrl, options.delivery?.source, options.delivery?.r2?.playUrl]);
  // A stable array: a new one would make the player reload the video
  const videoSources = useMemo(() => [{ src: delivery.src, type: HLS }], [delivery.src]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const posterUrl = useMemo(() => posterFor(options, delivery), [options.poster, options.id, delivery.provider, delivery.poster]);
  const trackerRef = useRef<QoeTracker | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);

  const handlePlayerReady = useCallback((ready: Player) => {
    setPlayer(ready);
    onPlayerReady?.(ready);
  }, [onPlayerReady]);

  // One QoE session per video load on this player, plus the one-time R2 → Bunny fallback
  useEffect(() => {
    if (!player) return;
    const videoId = options.id;
    const tracker = new QoeTracker(
      { on: (e, fn) => player.on(e, fn), off: (e, fn) => player.off(e, fn), paused: () => player.paused(), bandwidth: () => vhsBandwidth(player) },
      { sessionId: qoeSessionId(), source: delivery.provider, device: deviceClass(), send: (r) => sendQoeBeacon(videoId, r), beat: (r) => sendQoeBeacon(videoId, r) },
    );
    trackerRef.current = tracker;
    // Live view of the admin Delivery page: a heartbeat every 30 s while the page is visible
    const beat = window.setInterval(() => {
      if (document.visibilityState === 'visible') tracker.heartbeat();
    }, QOE_HEARTBEAT_MS);
    const onDispose = () => tracker.flush();
    player.on('dispose', onDispose);
    const fallbackSrc = delivery.provider === 'r2' ? delivery.fallbackSrc : undefined;
    let fellBack = false;
    const onError = () => {
      if (!fallbackSrc || fellBack) return;
      fellBack = true;
      const at = player.currentTime() || 0;
      tracker.markFallback();
      // Video.js accepts error(null) and a single source object; the local typings are narrower
      const vjs = player as unknown as { error(e: null): void; src(s: { src: string; type: string }): void };
      vjs.error(null);
      vjs.src({ src: fallbackSrc, type: HLS });
      player.one('loadedmetadata', () => {
        if (at > 0) player.currentTime(at);
        void player.play()?.catch(() => undefined);
      });
    };
    if (fallbackSrc) player.on('error', onError);
    return () => {
      window.clearInterval(beat);
      tracker.flush();
      tracker.detach();
      player.off('dispose', onDispose);
      player.off('error', onError);
      if (trackerRef.current === tracker) trackerRef.current = null;
    };
  }, [player, options.id, delivery.provider, delivery.fallbackSrc]);

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

  return { delivery, videoSources, posterUrl, handlePlayerReady };
}
