/**
 * Video Chapters Hook
 * Manages chapter data and player integration
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import type { VideoChapter, VideoChapterData } from '@al-ummah/shared-types';
import type { Player } from 'video.js';

interface UseVideoChaptersOptions {
  videoId: string;
  player: Player | null;
  enabled?: boolean;
}

interface UseVideoChaptersReturn {
  chapters: VideoChapter[];
  currentChapter: VideoChapter | null;
  currentChapterIndex: number;
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch chapters from API
  useEffect(() => {
    if (!enabled || !videoId) return;

    const fetchChapters = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/videos/${videoId}/chapters`);
        if (!response.ok) {
          if (response.status === 404 || response.status === 400) {
            // No chapters available - not an error
            setChapterData(null);
            return;
          }
          throw new Error('Failed to fetch chapters');
        }

        const data = await response.json();
        if (data.success && data.chapters) {
          setChapterData(data.chapters);
        } else {
          setChapterData(null);
        }
      } catch (err) {
        console.error('Failed to fetch chapters:', err);
        setError(err instanceof Error ? err.message : 'Unknown error');
        setChapterData(null);
      } finally {
        setLoading(false);
      }
    };

    fetchChapters();
  }, [videoId, enabled]);

  // Get chapters array
  const chapters = useMemo(() => {
    return chapterData?.chapters || [];
  }, [chapterData]);

  // Track current chapter based on player time
  useEffect(() => {
    if (!player || chapters.length === 0) {
      setCurrentChapter(null);
      return;
    }

    const updateCurrentChapter = () => {
      const currentTime = player.currentTime();
      if (currentTime === undefined || isNaN(currentTime)) return;

      const chapter = chapters.find(
        ch => currentTime >= ch.startTime && currentTime < ch.endTime
      );

      setCurrentChapter(chapter || null);
    };

    // Update immediately
    updateCurrentChapter();

    // Update on time change
    player.on('timeupdate', updateCurrentChapter);

    return () => {
      player.off('timeupdate', updateCurrentChapter);
    };
  }, [player, chapters]);

  // Get current chapter index
  const currentChapterIndex = useMemo(() => {
    if (!currentChapter) return -1;
    return chapters.findIndex(ch => ch.id === currentChapter.id);
  }, [currentChapter, chapters]);

  // Seek to specific chapter
  const seekToChapter = useCallback((chapter: VideoChapter) => {
    if (!player) return;
    player.currentTime(chapter.startTime);
    if (player.paused()) {
      player.play().catch(err => {
        console.error('Failed to play after chapter seek:', err);
      });
    }
  }, [player]);

  // Navigate to next chapter
  const nextChapter = useCallback(() => {
    if (currentChapterIndex === -1 || currentChapterIndex >= chapters.length - 1) {
      return;
    }
    seekToChapter(chapters[currentChapterIndex + 1]);
  }, [currentChapterIndex, chapters, seekToChapter]);

  // Navigate to previous chapter
  const previousChapter = useCallback(() => {
    if (currentChapterIndex === -1 || currentChapterIndex <= 0) {
      return;
    }
    // If we're more than 3 seconds into the chapter, go to start of current chapter
    // Otherwise go to previous chapter
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
    loading,
    error,
    seekToChapter,
    nextChapter,
    previousChapter,
    hasChapters: chapters.length > 0,
  };
}
