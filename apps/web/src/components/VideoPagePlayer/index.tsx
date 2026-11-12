"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Player } from "video.js";
import { removeUnwantedChars } from "@/lib/utility";
import { PlayerOptions } from "./interface";
import { VideoPlayerWithChapters } from "@/components/VideoPagePlayer/VideoPlayerWithChapters";
import { useAuth } from "@/components/AuthProvider/authContext";
import { getLocalizedValue } from "@al-ummah/shared-types";
import { useLanguage } from "@/hooks/useLanguage";
import { VideoDetails } from "@/components/VideoPagePlayer/VideoDetails";
import { playerChannelHref, playerChannelName } from "@/lib/video/player-channel";
import { chooseDelivery, deviceClass } from "@/lib/video/delivery";
import { QoeTracker, sendQoeBeacon } from "@/lib/video/qoe";

const HLS = 'application/x-mpegURL';

/** One id per play session (statistics only, but never Math.random) */
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

interface WatchPlayerProps {
  options: PlayerOptions;
  /** Start position in seconds (?t= on the watch page) */
  startTime?: number;
  /** Gives the watch page the Video.js player (share "start at current time") */
  onPlayerReady?: (player: Player) => void;
}

const VideoPlayer: React.FC<WatchPlayerProps> = ({ options, startTime, onPlayerReady }) => {
  const { user } = useAuth();
  const { lang, t } = useLanguage();
  const locale = lang;

  const title = getLocalizedValue(options.titleLocalized, options.title, locale);
  const channelHref = playerChannelHref(locale, options);
  const channelName = playerChannelName(options);

  // Bunny or R2 (epic #687): drawn once per video load; R2 falls back to Bunny once on a fatal error
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const delivery = useMemo(() => chooseDelivery(options.playUrl, options.delivery), [options.id, options.playUrl, options.delivery?.source, options.delivery?.r2?.playUrl]);
  // Memoize to prevent new array reference on every render
  const videoSources = useMemo(() => [{ src: delivery.src, type: HLS }], [delivery.src]);
  const trackerRef = useRef<QoeTracker | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);

  const handlePlayerReady = useCallback((ready: Player) => {
    setPlayer(ready);
    onPlayerReady?.(ready);
  }, [onPlayerReady]);

  // One QoE session per video load on this player, plus the one-time R2 → Bunny fallback
  useEffect(() => {
    if (!player) return;
    const sessionId = qoeSessionId();
    const videoId = options.id;
    const tracker = new QoeTracker(
      { on: (e, fn) => player.on(e, fn), off: (e, fn) => player.off(e, fn), paused: () => player.paused(), bandwidth: () => vhsBandwidth(player) },
      { sessionId, source: delivery.provider, device: deviceClass(), send: (r) => sendQoeBeacon(videoId, r) },
    );
    trackerRef.current = tracker;
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

  // Use poster from options (API-provided thumbnail URL) or fallback to default pattern
  // Ensure the poster URL has the protocol (https://) - some API responses return relative URLs
  const posterUrl = useMemo(() => {
    // Bunny keeps the thumbnail next to the playlist, so derive it from this
    // video's own library (QA/prod differ) rather than a hard-coded host.
    const derived = options.playUrl?.endsWith('/playlist.m3u8')
      ? options.playUrl.replace(/playlist\.m3u8$/, 'thumbnail.jpg')
      : '';
    const poster = (delivery.provider === 'r2' ? delivery.poster : undefined) || options.poster || derived;
    // If the poster URL doesn't start with http:// or https://, prepend https://
    if (poster && !poster.startsWith('http://') && !poster.startsWith('https://')) {
      return `https://${poster}`;
    }
    return poster;
  }, [options.poster, options.id, delivery.provider, delivery.poster]);

  return (
    <>
      <div className="flex w-full mt-0 relative">
        <div className="w-full rounded-lg overflow-visible 2xl:max-w-[1920px] 2xl:max-h-[1080px]">
          {/* Video.js player with chapters and subtitles */}
          <VideoPlayerWithChapters
            videoId={options.id}
            expectChapters={options.hasChapters === true}
            userId={user?.id}
            sources={videoSources}
            poster={posterUrl}
            initialPortrait={(options.height ?? 0) > (options.width ?? 0)}
            controls={true}
            autoplay={false}
            enableAnalytics={true}
            enableWebSocket={false}
            isLive={false}
            isShort={options.isShort === true}
            lang="en"
            className="w-full"
            ariaLabel={t.a11y.videoPlayerFor.replace('{title}', removeUnwantedChars(title))}
            title={removeUnwantedChars(title)}
            startTime={startTime}
            onPlayerReady={handlePlayerReady}
          />
        </div>
      </div>
      <VideoDetails title={title} channelName={channelName} channelHref={channelHref} options={options} />
    </>
  );
};

export default VideoPlayer;