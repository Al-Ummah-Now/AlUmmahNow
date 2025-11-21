/**
 * Video Player with Chapters Integration Example
 *
 * This component demonstrates how to integrate chapter components
 * with the CustomVideoPlayer.
 *
 * Features:
 * - Chapter markers on progress bar
 * - Collapsible chapter list
 * - Current chapter overlay
 * - Keyboard shortcuts (N/P for next/previous chapter, C to toggle list)
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import CustomVideoPlayer, { CustomVideoPlayerProps } from './CustomVideoPlayer';
import { ChapterMarkers } from './ChapterMarkers';
import { ChapterList } from './ChapterList';
import { CurrentChapter } from './CurrentChapter';
import { useVideoChapters } from '@/hooks/useVideoChapters';
import type { Player } from 'video.js';

interface VideoPlayerWithChaptersProps extends CustomVideoPlayerProps {
  enableChapters?: boolean;
  showChapterOverlay?: boolean;
}

export function VideoPlayerWithChapters({
  videoId,
  enableChapters = true,
  showChapterOverlay = true,
  ...playerProps
}: VideoPlayerWithChaptersProps) {
  const [player, setPlayer] = useState<Player | null>(null);
  const [isChapterListOpen, setIsChapterListOpen] = useState(false);
  const [duration, setDuration] = useState(0);

  // Use the existing useVideoChapters hook
  const {
    chapters,
    currentChapter,
    currentChapterIndex,
    seekToChapter,
    nextChapter,
    previousChapter,
    hasChapters,
  } = useVideoChapters({
    videoId,
    player,
    enabled: enableChapters,
  });

  // Track player duration
  useEffect(() => {
    if (!player) return;

    const updateDuration = () => {
      const d = player.duration();
      if (d && !isNaN(d)) {
        setDuration(d);
      }
    };

    player.on('loadedmetadata', updateDuration);
    player.on('durationchange', updateDuration);

    return () => {
      player.off('loadedmetadata', updateDuration);
      player.off('durationchange', updateDuration);
    };
  }, [player]);

  // Keyboard shortcuts for chapters
  useEffect(() => {
    if (!enableChapters || !hasChapters) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle if not typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      switch (e.key.toLowerCase()) {
        case 'n':
          e.preventDefault();
          nextChapter();
          break;
        case 'p':
          e.preventDefault();
          previousChapter();
          break;
        case 'c':
          e.preventDefault();
          setIsChapterListOpen(prev => !prev);
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [enableChapters, hasChapters, nextChapter, previousChapter]);

  const toggleChapterList = useCallback(() => {
    setIsChapterListOpen(prev => !prev);
  }, []);

  return (
    <div className="relative">
      {/* Video Player */}
      <CustomVideoPlayer
        {...playerProps}
        videoId={videoId}
        onPlayerReady={(playerInstance) => {
          setPlayer(playerInstance);
        }}
      />

      {/* Chapter Components (only if chapters exist) */}
      {enableChapters && hasChapters && player && (
        <>
          {/* Chapter Markers on Progress Bar */}
          <ChapterMarkers
            chapters={chapters}
            currentChapter={currentChapter}
            duration={duration}
            onSeek={seekToChapter}
            className="vjs-progress-control"
          />

          {/* Current Chapter Overlay */}
          {showChapterOverlay && (
            <CurrentChapter
              chapter={currentChapter}
              enabled={showChapterOverlay}
            />
          )}

          {/* Chapter List Panel */}
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
