import { useCallback, useEffect, useRef } from 'react';
import type { Player } from 'video.js';
import { useListenAudio } from '@/components/listen/listen-context';

export function useWatchPlayer(onPlayerReady?: (player: Player) => void) {
  const { pause } = useListenAudio();
  const pauseRef = useRef(pause);
  pauseRef.current = pause;
  const playerRef = useRef<Player | null>(null);
  const detachRef = useRef<(() => void) | null>(null);

  const handleWatchPlayerReady = useCallback((player: Player) => {
    detachRef.current?.();
    playerRef.current = player;
    const onPlay = () => pauseRef.current();
    const detach = () => {
      if (!player.isDisposed()) {
        player.off('play', onPlay);
        player.off('dispose', detach);
      }
      detachRef.current = null;
      playerRef.current = null;
    };
    detachRef.current = detach;
    player.on('play', onPlay);
    player.on('dispose', detach);
    onPlayerReady?.(player);
  }, [onPlayerReady]);

  useEffect(() => () => detachRef.current?.(), []);

  return { playerRef, handleWatchPlayerReady };
}
