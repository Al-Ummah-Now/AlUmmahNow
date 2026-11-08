/**
 * Video Player with Chapters and Subtitles
 *
 * Wraps CustomVideoPlayer for the watch page:
 * - Loads chapters (GET /api/videos/:id/chapters) and renders markers inside
 *   the Video.js progress bar, a current-chapter overlay and a chapter list
 * - Loads subtitle tracks (GET /api/videos/:id/subtitles) into the player
 */

'use client';

import { useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import CustomVideoPlayer, { CustomVideoPlayerProps } from '../VideoPlayer/CustomVideoPlayer';
import { ChapterMarkers } from './ChapterMarkers';
import { ChapterList } from './ChapterList';
import { CurrentChapter } from './CurrentChapter';
import { useVideoChapters } from '@/hooks/useVideoChapters';
import { useVideoSubtitles } from '@/hooks/useVideoSubtitles';
import { useLanguage } from '@/hooks/useLanguage';
import type { Player } from 'video.js';
import { PLAYER_SEEK_EVENT, type PlayerSeekDetail } from '@/lib/video/comment-timestamps';
import { logger } from '@/lib/logger-client';

interface VideoPlayerWithChaptersProps extends CustomVideoPlayerProps {
  videoId: string;
  enableChapters?: boolean;
  enableSubtitles?: boolean;
  showChapterOverlay?: boolean;
}

export function VideoPlayerWithChapters({
  videoId,
  enableChapters = true,
  enableSubtitles = true,
  showChapterOverlay = true,
  onPlayerReady,
  ...playerProps
}: VideoPlayerWithChaptersProps) {
  const { lang } = useLanguage();
  const [player, setPlayer] = useState<Player | null>(null);
  const [progressHolder, setProgressHolder] = useState<HTMLElement | null>(null);
  const [isChapterListOpen, setIsChapterListOpen] = useState(false);

  const {
    chapters,
    currentChapter,
    currentChapterIndex,
    duration,
    seekToChapter,
    hasChapters,
  } = useVideoChapters({
    videoId,
    player,
    enabled: enableChapters,
  });

  const textTracks = useVideoSubtitles(videoId, lang, enableSubtitles);

  const handlePlayerReady = useCallback((readyPlayer: Player) => {
    setPlayer(readyPlayer);
    onPlayerReady?.(readyPlayer);
  }, [onPlayerReady]);

  // Locate the Video.js progress holder so markers sit on the real seek bar
  useEffect(() => {
    if (!player) {
      setProgressHolder(null);
      return;
    }
    const root = player.el();
    const holder = root?.querySelector('.vjs-progress-holder') as HTMLElement | null;
    setProgressHolder(holder || null);
  }, [player]);

  // Comment timestamps ("12:34") seek this player
  useEffect(() => {
    if (!player) return undefined;
    const onSeek = (event: Event) => {
      const detail = (event as CustomEvent<PlayerSeekDetail>).detail;
      if (!detail || detail.videoId !== videoId || !Number.isFinite(detail.seconds)) return;
      try {
        player.currentTime(detail.seconds);
        const played = player.play();
        if (played && typeof (played as Promise<void>).catch === 'function') {
          (played as Promise<void>).catch(() => undefined);
        }
        player.el()?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        (player.el() as HTMLElement | null)?.focus?.();
      } catch (error) {
        logger.warn('[VideoPlayerWithChapters] Seek from comment failed', { videoId, error });
      }
    };
    window.addEventListener(PLAYER_SEEK_EVENT, onSeek);
    return () => window.removeEventListener(PLAYER_SEEK_EVENT, onSeek);
  }, [player, videoId]);

  const toggleChapterList = useCallback(() => {
    setIsChapterListOpen(prev => !prev);
  }, []);

  const showChapters = enableChapters && hasChapters && !!player;

  return (
    <div className="relative">
      <CustomVideoPlayer
        {...playerProps}
        videoId={videoId}
        textTracks={textTracks}
        onPlayerReady={handlePlayerReady}
      />

      {showChapters && (
        <>
          {/* Markers rendered into the Video.js progress bar (always LTR) */}
          {progressHolder && duration > 0 && createPortal(
            <ChapterMarkers
              chapters={chapters}
              currentChapter={currentChapter}
              duration={duration}
              onSeek={seekToChapter}
              direction="ltr"
            />,
            progressHolder
          )}

          {showChapterOverlay && (
            <CurrentChapter
              chapter={currentChapter}
              enabled={showChapterOverlay}
            />
          )}

          <ChapterList
            chapters={chapters}
            currentChapter={currentChapter}
            currentChapterIndex={currentChapterIndex}
            onSeek={seekToChapter}
            isOpen={isChapterListOpen}
            onToggle={toggleChapterList}
          />
        </>
      )}
    </div>
  );
}

export default VideoPlayerWithChapters;
