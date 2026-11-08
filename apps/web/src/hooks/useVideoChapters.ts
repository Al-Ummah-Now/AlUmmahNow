/**
 * Video Chapters Hook
 * Manages chapter data and player integration
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import type { VideoChapter, VideoChapterData } from '@al-ummah/shared-types';
import type { Player } from 'video.js';
import { logger } from '@/lib/logger-client';
import { getApiUrl } from '@/lib/runtime-config';
import { normalizeChapters, findChapterAt } from '@/lib/video/chapters';


interface UseVideoChaptersOptions {
  videoId: string;
  player: Player | null;
  enabled?: boolean;
}

interface UseVideoChaptersReturn {
  chapters: VideoChapter[];
  currentChapter: VideoChapter | null;
  currentChapterIndex: number;
  duration: number;
  loading: boolean;
  error: string | null;
  seekToChapter: (chapter: VideoChapter) => void;
  nextChapter: () => void;
  previousChapter: () => void;
  hasChapters: boolean;
}

export function useVideoChapters({
  videoId,
  player,
  enabled = true,
}: UseVideoChaptersOptions): UseVideoChaptersReturn {
  const [chapterData, setChapterData] = useState<VideoChapterData | null>(null);
  const [currentChapter, setCurrentChapter] = useState<VideoChapter | null>(null);
  const [duration, setDuration] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch chapters from the API (GET /api/videos/:id/chapters, public)
  useEffect(() => {
    if (!enabled || !videoId) {
      setChapterData(null);
      return;
    }

    const controller = new AbortController();

    const fetchChapters = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`${getApiUrl()}/api/videos/${encodeURIComponent(videoId)}/chapters`, {
          signal: controller.signal,
        });
        if (!response.ok) {
          // 400/404: no chapters or no description to parse - not an error
          setChapterData(null);
          return;
        }

        const data = await response.json();
        setChapterData(data?.success && data.chapters ? data.chapters : null);
      } catch (err) {
        if (controller.signal.aborted) return;
        logger.error('[useVideoChapters] Failed to fetch chapters', { videoId, error: err });
        setError(err instanceof Error ? err.message : 'unknown');
        setChapterData(null);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    fetchChapters();
    return () => controller.abort();
  }, [videoId, enabled]);

  // Track player duration (needed for marker positions and last chapter end)
  useEffect(() => {
    if (!player) {
      setDuration(0);
      return;
    }

    const updateDuration = () => {
      const d = player.duration();
      if (d && Number.isFinite(d)) {
        setDuration(d);
      }
    };

    updateDuration();
    player.on('loadedmetadata', updateDuration);
    player.on('durationchange', updateDuration);

    return () => {
      player.off('loadedmetadata', updateDuration);
      player.off('durationchange', updateDuration);
    };
  }, [player]);

  const chapters = useMemo(
    () => normalizeChapters(chapterData?.chapters, duration),
    [chapterData, duration]
  );

  // Track current chapter based on player time
  useEffect(() => {
    if (!player || chapters.length === 0) {
      setCurrentChapter(null);
      return;
    }

    const updateCurrentChapter = () => {
      const currentTime = player.currentTime();
      if (currentTime === undefined || isNaN(currentTime)) return;
      const chapter = findChapterAt(chapters, currentTime);
      setCurrentChapter((prev) => (prev?.id === chapter?.id ? prev : chapter));
    };

    updateCurrentChapter();
    player.on('timeupdate', updateCurrentChapter);

    return () => {
      player.off('timeupdate', updateCurrentChapter);
    };
  }, [player, chapters]);

  const currentChapterIndex = useMemo(() => {
    if (!currentChapter) return -1;
    return chapters.findIndex(ch => ch.id === currentChapter.id);
  }, [currentChapter, chapters]);

  const seekToChapter = useCallback((chapter: VideoChapter) => {
    if (!player) return;
    player.currentTime(chapter.startTime);
    if (player.paused()) {
      const playPromise = player.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(err => {
          logger.error('[useVideoChapters] Failed to play after chapter seek', { error: err });
        });
      }
    }
  }, [player]);

  const nextChapter = useCallback(() => {
    if (currentChapterIndex === -1 || currentChapterIndex >= chapters.length - 1) {
      return;
    }
    seekToChapter(chapters[currentChapterIndex + 1]);
  }, [currentChapterIndex, chapters, seekToChapter]);

  const previousChapter = useCallback(() => {
    if (currentChapterIndex === -1 || currentChapterIndex <= 0) {
      return;
    }
    // More than 3 seconds into the chapter restarts it; otherwise go back one
    if (player && player.currentTime() - chapters[currentChapterIndex].startTime > 3) {
      seekToChapter(chapters[currentChapterIndex]);
    } else {
      seekToChapter(chapters[currentChapterIndex - 1]);
    }
  }, [currentChapterIndex, chapters, seekToChapter, player]);

  return {
    chapters,
    currentChapter,
    currentChapterIndex,
    duration,
    loading,
    error,
    seekToChapter,
    nextChapter,
    previousChapter,
    hasChapters: chapters.length > 0,
  };
}
