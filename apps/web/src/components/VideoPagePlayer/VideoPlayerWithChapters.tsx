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
import { ChapterNav } from './ChapterNav';
import { useVideoChapters } from '@/hooks/useVideoChapters';
import { useVideoSubtitles } from '@/hooks/useVideoSubtitles';
import { useLanguage } from '@/hooks/useLanguage';
import type { Player } from 'video.js';
import { PLAYER_SEEK_EVENT, type PlayerSeekDetail } from '@/lib/video/comment-timestamps';
import { chapterShortcut, getChapterTitle } from '@/lib/video/chapters';
import { updatePlayerUi } from '@/lib/video/player-ui';
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
  const { lang, isRTL } = useLanguage();
  const [player, setPlayer] = useState<Player | null>(null);
  const [progressHolder, setProgressHolder] = useState<HTMLElement | null>(null);
  const [isChapterListOpen, setIsChapterListOpen] = useState(false);

  const {
    chapters,
    currentChapter,
    currentChapterIndex,
    duration,
    seekToChapter,
    nextChapter,
    previousChapter,
    hasChapters,
  } = useVideoChapters({
    videoId,
    player,
    enabled: enableChapters,
  });

  const textTracks = useVideoSubtitles(videoId, lang, enableSubtitles);

  // The progress bar's hover tooltip names the chapter under the pointer
  useEffect(() => {
    if (!enableChapters) return undefined;
    updatePlayerUi({ chapters: chapters.map((c) => ({ startTime: c.startTime, title: getChapterTitle(c, lang) })).sort((a, b) => a.startTime - b.startTime) });
    return () => updatePlayerUi({ chapters: [] });
  }, [chapters, lang, enableChapters]);

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

  // Ctrl/Alt + arrow: previous/next chapter while the player has focus
  useEffect(() => {
    if (!player || !hasChapters) return undefined;
    const root = player.el() as HTMLElement | null;
    if (!root) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      const action = chapterShortcut(event, isRTL);
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      logger.debug('[VideoPlayerWithChapters] Chapter shortcut', { videoId, action });
      if (action === 'next') nextChapter();
      else previousChapter();
    };
    root.addEventListener('keydown', onKeyDown);
    return () => root.removeEventListener('keydown', onKeyDown);
  }, [player, hasChapters, isRTL, nextChapter, previousChapter, videoId]);

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
            />,
            progressHolder
          )}

          {showChapterOverlay && (
            <CurrentChapter
              chapter={currentChapter}
              enabled={showChapterOverlay}
            />
          )}

          <ChapterNav
            chapters={chapters}
            currentChapter={currentChapter}
            currentChapterIndex={currentChapterIndex}
            onPrevious={previousChapter}
            onNext={nextChapter}
          />

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
