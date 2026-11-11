'use client';

/**
 * Plays a live HLS stream or its recording with the app's video.js setup
 * (lib/video/videojs-setup.ts: VHS, the live badge, the Fanous skin). Both live
 * providers deliver HLS, so the same player serves Bunny and self-hosted.
 *
 * The <video> element is made here, not by React: video.js wraps and later
 * removes it, which React must not see.
 */
import { useEffect, useRef } from 'react';
import type { Player } from 'video.js';
import { createVideoPlayer, disposeVideoPlayer } from '@/lib/video/videojs-setup';
import { logger } from '@/lib/logger-client';
import '@/theme/player-themes.css';
import '@/styles/video-player.css';
import '@/styles/player-skin.css';

export interface LivePlayerProps {
  src: string;
  lang: 'en' | 'ar';
  label: string;
  poster?: string | null;
  autoplay?: boolean;
  muted?: boolean;
  /** Called once the player is ready, and with null when it is disposed. */
  onPlayer?: (player: Player | null, attachedAt: number) => void;
  testId?: string;
}

export function LivePlayer({ src, lang, label, poster, autoplay = false, muted = false, onPlayer, testId = 'live-player' }: LivePlayerProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<Player | null>(null);
  const onPlayerRef = useRef(onPlayer);
  onPlayerRef.current = onPlayer;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const video = document.createElement('video');
    video.className = 'video-js vjs-big-play-centered';
    video.setAttribute('playsinline', '');
    video.setAttribute('aria-label', label);
    if (muted) video.muted = true;
    host.appendChild(video);
    const attachedAt = Date.now();
    let player: Player | null = null;
    try {
      player = createVideoPlayer(video, {
        controls: true,
        autoplay: autoplay ? (muted ? 'muted' : 'any') : false,
        muted,
        poster: poster ?? undefined,
        language: lang,
        sources: [{ src, type: 'application/x-mpegURL' }],
      });
      playerRef.current = player;
      player.ready(() => onPlayerRef.current?.(player, attachedAt));
    } catch (error) {
      logger.error('[LivePlayer] Could not start the player', { error: error instanceof Error ? error.message : String(error) });
    }
    return () => {
      onPlayerRef.current?.(null, attachedAt);
      disposeVideoPlayer(player);
      playerRef.current = null;
      host.replaceChildren();
    };
    // The player is rebuilt only when the stream URL or language changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, lang]);

  return <div ref={hostRef} className="w-full overflow-hidden rounded-lg" data-testid={testId} data-src={src} />;
}
