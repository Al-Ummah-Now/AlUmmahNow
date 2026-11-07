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
