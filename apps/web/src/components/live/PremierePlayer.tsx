'use client';

/**
 * A premiere's video (wiki E17 §5.4): the normal player, so signing, provider fallback, captions and
 * statistics are those of any video. While the premiere is on it stays at everyone's moment; after it,
 * the same player plays on as usual.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Player } from 'video.js';
import { useAuth } from '@/components/AuthProvider/authContext';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { VideoPlayerWithChapters } from '@/components/VideoPagePlayer/VideoPlayerWithChapters';
import { startsPortrait, type PlayerOptions } from '@/components/VideoPagePlayer/interface';
import { useDeliveryPlayback } from '@/components/VideoPagePlayer/useDeliveryPlayback';
import { useLanguage } from '@/hooks/useLanguage';
import { fetchVideoById } from '@/lib/api/videos';
import { logger } from '@/lib/logger-client';
import { premierePosition, usePremiereSync, type PremiereClock, type SyncedPlayer } from './premiere-clock';

/** The video is released a moment after the premiere starts. */
export const VIDEO_RETRY_MS = 5_000;

export interface PremierePlayerProps {
  videoId: string;
  /** While the premiere is on; null after it */
  clock: PremiereClock | null;
  onPlayer: (player: Player | null) => void;
  /** It is over and its video cannot be watched */
  onGone: () => void;
}

export function PremierePlayer({ videoId, clock, onPlayer, onGone }: PremierePlayerProps) {
  const [options, setOptions] = useState<PlayerOptions | null>(null);
  const on = !!clock;
  const onGoneRef = useRef(onGone);
  onGoneRef.current = onGone;

  useEffect(() => {
    if (options?.id === videoId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      const video = await fetchVideoById(videoId).catch((error) => {
        logger.debug('[Premiere] The video was not read', { videoId, error });
        return undefined;
      });
      if (stopped) return;
      if (video) setOptions(video);
      else if (on) timer = setTimeout(() => void load(), VIDEO_RETRY_MS);
      else onGoneRef.current();
    };
    void load();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [videoId, on, options?.id]);

  if (options?.id !== videoId) return <Skeleton className="aspect-video w-full rounded-lg" aria-busy="true" data-testid="premiere-loading" />;
  return <Playing key={videoId} options={options} clock={clock} onPlayer={onPlayer} />;
}

function Playing({ options, clock, onPlayer }: { options: PlayerOptions; clock: PremiereClock | null; onPlayer: (player: Player | null) => void }) {
  const { t, lang } = useLanguage();
  const { user } = useAuth();
  const [player, setPlayer] = useState<Player | null>(null);
  const onPlayerRef = useRef(onPlayer);
  onPlayerRef.current = onPlayer;
  const ready = useCallback((p: Player) => {
    setPlayer(p);
    onPlayerRef.current(p);
  }, []);
  useEffect(() => () => onPlayerRef.current(null), []);
  const { videoSources, posterUrl, handlePlayerReady, handlePlaybackError } = useDeliveryPlayback(options, ready);
  const { behind, returnToLive } = usePremiereSync(player as unknown as SyncedPlayer | null, clock);
  // As it was when the page opened: the saved position is not resumed, and the end does not restart it
  const [start] = useState(() => (clock ? premierePosition(clock.startedAt, clock.offset, clock.duration) : undefined));
  const [autoplay] = useState(() => !!clock);
  return (
    <div data-testid="premiere-player" data-on={clock ? 'true' : 'false'}>
      <VideoPlayerWithChapters
        videoId={options.id}
        enableChapters={!clock}
        userId={user?.id}
        sources={videoSources}
        poster={posterUrl}
        initialPortrait={startsPortrait(options)}
        controls
        autoplay={false}
        autoplayIntent={autoplay}
        enableAnalytics
        enableWebSocket={false}
        isLive={autoplay}
        startTime={start}
        lang={lang}
        audioTracks={options.audioTracks}
        className="w-full"
        ariaLabel={t.liveWatch.playerLabel}
        onPlayerReady={handlePlayerReady}
        onPlaybackError={handlePlaybackError}
      />
      {behind && (
        <div className="mt-2 flex justify-end">
          <Button variant="outline" size="sm" onClick={returnToLive} data-testid="premiere-return">
            <span aria-hidden="true" className="size-2 rounded-full bg-[var(--fanous-color-error-text)]" />
            {t.liveWatch.returnToLive}
          </Button>
        </div>
      )}
    </div>
  );
}
