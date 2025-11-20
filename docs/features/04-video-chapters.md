# Video Chapters (Timestamps) Implementation Plan

**Document Version**: 1.0
**Created**: 2025-01-20
**Author**: System Architect Agent
**Priority**: CRITICAL
**Estimated Effort**: 2 weeks

## Executive Summary

This document provides a comprehensive implementation plan for adding Video Chapters support to Al Ummah Now platform. Video chapters allow users to navigate long-form content (lectures, sermons, Quran recitations) by jumping to specific sections marked by timestamps in the video description.

Based on the YouTube comparison analysis, this feature is marked as **CRITICAL** for discovery and UX on long-form content, which comprises a significant portion of Islamic educational videos.

## Requirements

### Functional Requirements

From `docs/YOUTUBE_FEATURE_COMPARISON.md`:

1. **Automatic Chapter Detection**
   - Parse description for timestamps in `MM:SS` or `HH:MM:SS` format
   - Extract chapter titles from text following timestamps
   - First chapter must start at `0:00` or `00:00`
   - Minimum 10 seconds duration per chapter
   - Maximum 100 chapters per video

2. **Player UI Integration**
   - Display chapter markers on video progress bar
   - Show chapter title on hover over markers
   - Current chapter indicator in player controls
   - Chapter list panel (collapsible)
   - Jump to chapter on marker/list click

3. **API Support**
   - Endpoint to retrieve parsed chapters
   - Store chapters in video metadata
   - Support for manual chapter editing (future)
   - Chapter data in video fetch response

4. **Search & Discovery**
   - Chapters appear in search results
   - Chapter titles indexed for search
   - Direct links to specific chapters
   - Chapter preview in video cards (optional)

### Non-Functional Requirements

1. **Performance**
   - Chapter parsing < 100ms for typical description
   - No impact on video loading time
   - Lazy load chapter UI components
   - Efficient marker rendering (virtualization for 50+ chapters)

2. **Accessibility**
   - Keyboard navigation through chapters
   - Screen reader announcements
   - ARIA labels for chapter controls
   - High contrast markers

3. **Internationalization**
   - Support Arabic chapter titles
   - RTL layout for chapter list
   - Localized timestamp formats
   - Bilingual UI labels

## Technical Architecture

### Data Model Changes

#### 1. Video Chapter Type (`packages/shared-types/src/video.ts`)

```typescript
export interface VideoChapter {
  id: string;           // UUID for chapter
  startTime: number;    // Start time in seconds
  endTime: number;      // End time in seconds
  title: string;        // Chapter title
  titleLocalized?: {    // Localized titles (optional)
    en?: string;
    ar?: string;
  };
}

export interface VideoChapterData {
  chapters: VideoChapter[];
  source: 'automatic' | 'manual' | 'imported';
  parsedAt: string;     // ISO timestamp
  version: number;      // For future migration
}

// Update VideoObject interface
export interface VideoObject extends Timestamps {
  // ... existing fields ...

  // Chapter support
  chapters?: VideoChapterData;
  hasChapters?: boolean;  // Quick check flag
}
```

#### 2. Chapter Validation Schema (`packages/shared-types/src/schemas/chapter.ts`)

```typescript
import { z } from 'zod';

export const VideoChapterSchema = z.object({
  id: z.string().uuid(),
  startTime: z.number().min(0),
  endTime: z.number().min(10), // Minimum 10 seconds
  title: z.string().min(1).max(100),
  titleLocalized: z.object({
    en: z.string().optional(),
    ar: z.string().optional(),
  }).optional(),
});

export const VideoChapterDataSchema = z.object({
  chapters: z.array(VideoChapterSchema).max(100),
  source: z.enum(['automatic', 'manual', 'imported']),
  parsedAt: z.string().datetime(),
  version: z.number().default(1),
});
```

### Chapter Parser Implementation

#### Core Parser Library (`apps/api-videos/src/lib/chapters/parser.ts`)

```typescript
import { v4 as uuidv4 } from 'uuid';
import type { VideoChapter } from '@al-ummah/shared-types';

export interface ParseOptions {
  minDuration?: number;      // Minimum chapter duration (default: 10)
  maxChapters?: number;       // Maximum chapters allowed (default: 100)
  requireFirstAtZero?: boolean; // First chapter must start at 0:00 (default: true)
}

export interface ParseResult {
  success: boolean;
  chapters: VideoChapter[];
  errors?: string[];
}

/**
 * Parse video chapters from description text
 * Supports formats: 0:00, 00:00, 1:23:45
 */
export function parseChapters(
  description: string,
  videoDuration: number,
  options: ParseOptions = {}
): ParseResult {
  const {
    minDuration = 10,
    maxChapters = 100,
    requireFirstAtZero = true
  } = options;

  const errors: string[] = [];
  const chapters: VideoChapter[] = [];

  // Regex patterns for different timestamp formats
  const timestampPatterns = [
    /^(\d{1,2}):(\d{2}):(\d{2})\s+(.+)$/,  // HH:MM:SS Title
    /^(\d{1,2}):(\d{2})\s+(.+)$/,           // MM:SS Title
    /^(\d{2}):(\d{2}):(\d{2})\s+(.+)$/,     // HH:MM:SS Title (strict)
  ];

  // Split description into lines
  const lines = description.split('\n');
  const timestampLines: Array<{time: number, title: string, line: number}> = [];

  // Extract all timestamp lines
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Try each pattern
    for (const pattern of timestampPatterns) {
      const match = line.match(pattern);
      if (match) {
        let seconds = 0;
        let title = '';

        if (match.length === 5) {
          // HH:MM:SS format
          const hours = parseInt(match[1], 10);
          const minutes = parseInt(match[2], 10);
          const secs = parseInt(match[3], 10);
          title = match[4].trim();
          seconds = hours * 3600 + minutes * 60 + secs;
        } else if (match.length === 4) {
          // MM:SS format
          const minutes = parseInt(match[1], 10);
          const secs = parseInt(match[2], 10);
          title = match[3].trim();
          seconds = minutes * 60 + secs;
        }

        if (seconds <= videoDuration) {
          timestampLines.push({ time: seconds, title, line: i + 1 });
        }
        break;
      }
    }
  }

  // Validation
  if (timestampLines.length === 0) {
    return { success: false, chapters: [], errors: ['No timestamps found'] };
  }

  if (timestampLines.length > maxChapters) {
    errors.push(`Too many chapters (${timestampLines.length} > ${maxChapters})`);
    timestampLines.splice(maxChapters);
  }

  // Sort by time
  timestampLines.sort((a, b) => a.time - b.time);

  // Check first chapter starts at 0
  if (requireFirstAtZero && timestampLines[0].time !== 0) {
    errors.push('First chapter must start at 0:00');
    return { success: false, chapters: [], errors };
  }

  // Create chapters with duration validation
  for (let i = 0; i < timestampLines.length; i++) {
    const current = timestampLines[i];
    const next = timestampLines[i + 1];
    const endTime = next ? next.time : videoDuration;
    const duration = endTime - current.time;

    if (duration < minDuration) {
      errors.push(`Chapter "${current.title}" is too short (${duration}s < ${minDuration}s)`);
      continue;
    }

    chapters.push({
      id: uuidv4(),
      startTime: current.time,
      endTime,
      title: current.title,
    });
  }

  return {
    success: chapters.length > 0,
    chapters,
    errors: errors.length > 0 ? errors : undefined
  };
}

/**
 * Validate existing chapters
 */
export function validateChapters(
  chapters: VideoChapter[],
  videoDuration: number
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (chapters.length === 0) {
    errors.push('No chapters provided');
    return { valid: false, errors };
  }

  // Check first chapter starts at 0
  if (chapters[0].startTime !== 0) {
    errors.push('First chapter must start at 0:00');
  }

  // Check sequential and non-overlapping
  for (let i = 0; i < chapters.length; i++) {
    const current = chapters[i];
    const next = chapters[i + 1];

    // Validate duration
    const duration = current.endTime - current.startTime;
    if (duration < 10) {
      errors.push(`Chapter "${current.title}" is too short`);
    }

    // Check bounds
    if (current.startTime < 0 || current.endTime > videoDuration) {
      errors.push(`Chapter "${current.title}" exceeds video duration`);
    }

    // Check sequence
    if (next && current.endTime !== next.startTime) {
      errors.push(`Gap or overlap between chapters at ${current.endTime}s`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
```

### API Endpoints

#### 1. Chapter Retrieval Endpoint (`apps/api-videos/src/endpoints/video/chapters.ts`)

```typescript
import { OpenAPIRoute } from 'chanfana';
import { z } from 'zod';
import { VideoChapterDataSchema } from '@al-ummah/shared-types';
import { parseChapters } from '@/lib/chapters/parser';
import { R2Repository } from '@/lib/repository';
import { addAuthToSchema } from '@/lib/auth';

export class VideoChaptersGet extends OpenAPIRoute {
  static schema = addAuthToSchema({
    tags: ['Video'],
    summary: 'Get video chapters',
    parameters: z.object({
      videoId: z.string().min(1).describe('Video ID'),
      regenerate: z.boolean().optional().describe('Force regenerate chapters'),
    }),
    responses: {
      '200': {
        description: 'Video chapters retrieved',
        schema: z.object({
          success: z.boolean(),
          chapters: VideoChapterDataSchema.optional(),
          message: z.string().optional(),
        }),
      },
      '404': {
        description: 'Video not found',
      },
    },
  });

  async handle(c: Context) {
    const { videoId } = c.req.param();
    const { regenerate } = c.req.query();
    const env = c.env as Env;

    const videoRepo = new R2Repository(env.R2_BUCKET, 'videos');

    // Fetch video
    const video = await videoRepo.get(videoId);
    if (!video) {
      return c.json({ success: false, message: 'Video not found' }, 404);
    }

    // Check if chapters exist and not regenerating
    if (video.chapters && !regenerate) {
      return c.json({
        success: true,
        chapters: video.chapters,
      });
    }

    // Parse chapters from description
    if (!video.description) {
      return c.json({
        success: false,
        message: 'No description to parse chapters from',
      });
    }

    const parseResult = parseChapters(
      video.description,
      video.duration || 0
    );

    if (!parseResult.success) {
      return c.json({
        success: false,
        message: 'No valid chapters found',
        errors: parseResult.errors,
      });
    }

    // Save chapters to video
    const chapterData = {
      chapters: parseResult.chapters,
      source: 'automatic' as const,
      parsedAt: new Date().toISOString(),
      version: 1,
    };

    await videoRepo.update(videoId, {
      chapters: chapterData,
      hasChapters: true,
    });

    return c.json({
      success: true,
      chapters: chapterData,
    });
  }
}
```

#### 2. Chapter Update Endpoint (`apps/api-videos/src/endpoints/video/chaptersUpdate.ts`)

```typescript
import { OpenAPIRoute } from 'chanfana';
import { z } from 'zod';
import { VideoChapterSchema } from '@al-ummah/shared-types';
import { validateChapters } from '@/lib/chapters/parser';
import { R2Repository } from '@/lib/repository';
import { requireAuth } from '@/middleware/auth';

export class VideoChaptersUpdate extends OpenAPIRoute {
  static schema = {
    tags: ['Video'],
    summary: 'Update video chapters (manual edit)',
    security: [{ bearerAuth: [] }],
    parameters: z.object({
      videoId: z.string().min(1),
    }),
    requestBody: z.object({
      chapters: z.array(VideoChapterSchema),
    }),
    responses: {
      '200': {
        description: 'Chapters updated',
      },
      '400': {
        description: 'Invalid chapters',
      },
      '403': {
        description: 'Not authorized',
      },
    },
  };

  async handle(c: Context) {
    const { videoId } = c.req.param();
    const { chapters } = await c.req.json();
    const { user } = await requireAuth(c);
    const env = c.env as Env;

    const videoRepo = new R2Repository(env.R2_BUCKET, 'videos');

    // Fetch video and check ownership
    const video = await videoRepo.get(videoId);
    if (!video) {
      return c.json({ success: false, message: 'Video not found' }, 404);
    }

    if (video.userId !== user.id) {
      return c.json({ success: false, message: 'Not authorized' }, 403);
    }

    // Validate chapters
    const validation = validateChapters(chapters, video.duration || 0);
    if (!validation.valid) {
      return c.json({
        success: false,
        message: 'Invalid chapters',
        errors: validation.errors,
      }, 400);
    }

    // Update chapters
    const chapterData = {
      chapters,
      source: 'manual' as const,
      parsedAt: new Date().toISOString(),
      version: 1,
    };

    await videoRepo.update(videoId, {
      chapters: chapterData,
      hasChapters: true,
    });

    return c.json({
      success: true,
      chapters: chapterData,
    });
  }
}
```

### Video Player UI Components

#### 1. Chapter Markers Component (`apps/web/src/components/VideoPlayer/ChapterMarkers.tsx`)

```typescript
import React from 'react';
import { VideoChapter } from '@al-ummah/shared-types';
import { Tooltip } from '@/components/ui/tooltip';

interface ChapterMarkersProps {
  chapters: VideoChapter[];
  duration: number;
  currentTime: number;
  onSeek: (time: number) => void;
  className?: string;
}

export function ChapterMarkers({
  chapters,
  duration,
  currentTime,
  onSeek,
  className = '',
}: ChapterMarkersProps) {
  return (
    <div className={`chapter-markers absolute inset-0 pointer-events-none ${className}`}>
      {chapters.map((chapter) => {
        const position = (chapter.startTime / duration) * 100;
        const isActive = currentTime >= chapter.startTime && currentTime < chapter.endTime;

        return (
          <Tooltip key={chapter.id} content={chapter.title}>
            <button
              className={`
                chapter-marker absolute top-0 bottom-0 w-0.5
                pointer-events-auto cursor-pointer
                ${isActive ? 'bg-primary' : 'bg-white/50'}
                hover:bg-primary hover:w-1
                transition-all duration-200
              `}
              style={{ left: `${position}%` }}
              onClick={() => onSeek(chapter.startTime)}
              aria-label={`Jump to chapter: ${chapter.title}`}
            />
          </Tooltip>
        );
      })}
    </div>
  );
}
```

#### 2. Chapter List Panel (`apps/web/src/components/VideoPlayer/ChapterList.tsx`)

```typescript
import React, { useState } from 'react';
import { VideoChapter } from '@al-ummah/shared-types';
import { ChevronDown, ChevronUp, Clock } from 'lucide-react';
import { formatTime } from '@/lib/utils/time';
import { useLanguage } from '@/hooks/useLanguage';

interface ChapterListProps {
  chapters: VideoChapter[];
  currentChapter?: VideoChapter;
  onChapterClick: (chapter: VideoChapter) => void;
  isCollapsed?: boolean;
  className?: string;
}

export function ChapterList({
  chapters,
  currentChapter,
  onChapterClick,
  isCollapsed = false,
  className = '',
}: ChapterListProps) {
  const { t, isRTL } = useLanguage();
  const [collapsed, setCollapsed] = useState(isCollapsed);

  return (
    <div className={`chapter-list ${className}`} dir={isRTL ? 'rtl' : 'ltr'}>
      <button
        className="chapter-list-header flex items-center justify-between w-full p-3 hover:bg-gray-100 dark:hover:bg-gray-800"
        onClick={() => setCollapsed(!collapsed)}
        aria-expanded={!collapsed}
      >
        <h3 className="font-semibold flex items-center gap-2">
          <Clock className="w-4 h-4" />
          {t('video.chapters')} ({chapters.length})
        </h3>
        {collapsed ? <ChevronDown /> : <ChevronUp />}
      </button>

      {!collapsed && (
        <div className="chapter-list-items max-h-80 overflow-y-auto">
          {chapters.map((chapter, index) => {
            const isActive = currentChapter?.id === chapter.id;
            const duration = chapter.endTime - chapter.startTime;

            return (
              <button
                key={chapter.id}
                className={`
                  chapter-item w-full text-left p-3 hover:bg-gray-100 dark:hover:bg-gray-800
                  ${isActive ? 'bg-primary/10 border-l-4 border-primary' : ''}
                  ${isRTL ? 'pr-6' : 'pl-6'}
                `}
                onClick={() => onChapterClick(chapter)}
                aria-label={`${t('video.chapter')} ${index + 1}: ${chapter.title}`}
              >
                <div className="flex items-start gap-3">
                  <span className="text-sm text-gray-500 whitespace-nowrap">
                    {formatTime(chapter.startTime)}
                  </span>
                  <div className="flex-1">
                    <p className={`font-medium ${isActive ? 'text-primary' : ''}`}>
                      {index + 1}. {chapter.titleLocalized?.[isRTL ? 'ar' : 'en'] || chapter.title}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      {formatTime(duration)}
                    </p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

#### 3. Current Chapter Display (`apps/web/src/components/VideoPlayer/CurrentChapter.tsx`)

```typescript
import React from 'react';
import { VideoChapter } from '@al-ummah/shared-types';
import { useLanguage } from '@/hooks/useLanguage';

interface CurrentChapterProps {
  chapter?: VideoChapter;
  chapterIndex?: number;
  totalChapters?: number;
  className?: string;
}

export function CurrentChapter({
  chapter,
  chapterIndex,
  totalChapters,
  className = '',
}: CurrentChapterProps) {
  const { isRTL } = useLanguage();

  if (!chapter) return null;

  return (
    <div
      className={`current-chapter flex items-center gap-2 text-sm ${className}`}
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      {chapterIndex !== undefined && totalChapters && (
        <span className="text-gray-500">
          {chapterIndex + 1}/{totalChapters}
        </span>
      )}
      <span className="font-medium truncate max-w-xs">
        {chapter.titleLocalized?.[isRTL ? 'ar' : 'en'] || chapter.title}
      </span>
    </div>
  );
}
```

#### 4. Integration Hook (`apps/web/src/hooks/useVideoChapters.ts`)

```typescript
import { useState, useEffect, useMemo } from 'react';
import { VideoChapter, VideoChapterData } from '@al-ummah/shared-types';
import { Player } from 'video.js';

interface UseVideoChaptersOptions {
  videoId: string;
  player: Player | null;
  enabled?: boolean;
}

export function useVideoChapters({
  videoId,
  player,
  enabled = true,
}: UseVideoChaptersOptions) {
  const [chapters, setChapters] = useState<VideoChapterData | null>(null);
  const [currentChapter, setCurrentChapter] = useState<VideoChapter | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch chapters
  useEffect(() => {
    if (!enabled || !videoId) return;

    const fetchChapters = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/videos/${videoId}/chapters`);
        if (!response.ok) throw new Error('Failed to fetch chapters');

        const data = await response.json();
        if (data.chapters) {
          setChapters(data.chapters);
        }
      } catch (err) {
        console.error('Failed to fetch chapters:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchChapters();
  }, [videoId, enabled]);

  // Track current chapter
  useEffect(() => {
    if (!player || !chapters?.chapters.length) return;

    const updateCurrentChapter = () => {
      const currentTime = player.currentTime();
      const chapter = chapters.chapters.find(
        ch => currentTime >= ch.startTime && currentTime < ch.endTime
      );
      setCurrentChapter(chapter || null);
    };

    player.on('timeupdate', updateCurrentChapter);

    return () => {
      player.off('timeupdate', updateCurrentChapter);
    };
  }, [player, chapters]);

  // Chapter navigation
  const seekToChapter = (chapter: VideoChapter) => {
    if (player) {
      player.currentTime(chapter.startTime);
      player.play();
    }
  };

  const nextChapter = () => {
    if (!chapters?.chapters.length || !currentChapter) return;

    const currentIndex = chapters.chapters.findIndex(ch => ch.id === currentChapter.id);
    const next = chapters.chapters[currentIndex + 1];
    if (next) seekToChapter(next);
  };

  const previousChapter = () => {
    if (!chapters?.chapters.length || !currentChapter) return;

    const currentIndex = chapters.chapters.findIndex(ch => ch.id === currentChapter.id);
    const prev = chapters.chapters[currentIndex - 1];
    if (prev) seekToChapter(prev);
  };

  return {
    chapters: chapters?.chapters || [],
    currentChapter,
    loading,
    error,
    seekToChapter,
    nextChapter,
    previousChapter,
  };
}
```

### Modified Video Player Integration

Update `apps/web/src/components/VideoPlayer/CustomVideoPlayer.tsx` to include chapters:

```typescript
// Add to imports
import { useVideoChapters } from '@/hooks/useVideoChapters';
import { ChapterMarkers } from './ChapterMarkers';
import { ChapterList } from './ChapterList';
import { CurrentChapter } from './CurrentChapter';

// Add to props interface
export interface CustomVideoPlayerProps {
  // ... existing props ...
  enableChapters?: boolean;
}

// Inside component
const {
  chapters,
  currentChapter,
  seekToChapter,
  nextChapter,
  previousChapter,
} = useVideoChapters({
  videoId,
  player: playerRef.current,
  enabled: enableChapters ?? true,
});

// Add chapter keyboard shortcuts
useEffect(() => {
  if (!player || !chapters.length) return;

  const handleKeyPress = (e: KeyboardEvent) => {
    if (e.shiftKey && e.key === 'N') {
      nextChapter();
    } else if (e.shiftKey && e.key === 'P') {
      previousChapter();
    }
  };

  window.addEventListener('keydown', handleKeyPress);
  return () => window.removeEventListener('keydown', handleKeyPress);
}, [player, chapters, nextChapter, previousChapter]);

// In render, add chapter UI components
// After the video element:
{chapters.length > 0 && (
  <>
    {/* Chapter markers on progress bar */}
    <ChapterMarkers
      chapters={chapters}
      duration={player?.duration() || 0}
      currentTime={player?.currentTime() || 0}
      onSeek={(time) => player?.currentTime(time)}
      className="vjs-progress-holder"
    />

    {/* Current chapter display */}
    <CurrentChapter
      chapter={currentChapter}
      chapterIndex={chapters.findIndex(ch => ch.id === currentChapter?.id)}
      totalChapters={chapters.length}
      className="vjs-current-chapter"
    />

    {/* Chapter list panel */}
    <ChapterList
      chapters={chapters}
      currentChapter={currentChapter}
      onChapterClick={seekToChapter}
      className="vjs-chapter-list"
    />
  </>
)}
```

### Processing Pipeline Integration

#### Update Video Processing (`apps/processor/src/handlers/video.ts`)

Add chapter parsing when video is created or updated:

```typescript
import { parseChapters } from '@api-videos/lib/chapters/parser';

async function processVideoMessage(message: VideoMessage, env: Env) {
  // ... existing processing ...

  // Parse chapters if description exists
  if (message.data.description && message.data.duration) {
    const parseResult = parseChapters(
      message.data.description,
      message.data.duration
    );

    if (parseResult.success && parseResult.chapters.length > 0) {
      // Update video with chapters
      const videoRepo = new R2Repository(env.R2_BUCKET, 'videos');
      await videoRepo.update(message.data.videoId, {
        chapters: {
          chapters: parseResult.chapters,
          source: 'automatic',
          parsedAt: new Date().toISOString(),
          version: 1,
        },
        hasChapters: true,
      });

      // Log chapter parsing
      logger.info('Chapters parsed', {
        videoId: message.data.videoId,
        chapterCount: parseResult.chapters.length,
      });
    }
  }
}
```

## Testing Strategy

### Unit Tests

#### 1. Parser Tests (`apps/api-videos/src/lib/chapters/__tests__/parser.test.ts`)

```typescript
import { parseChapters, validateChapters } from '../parser';

describe('Chapter Parser', () => {
  describe('parseChapters', () => {
    it('parses basic MM:SS format', () => {
      const description = `
        0:00 Introduction
        2:30 Chapter 1
        5:45 Chapter 2
        10:00 Conclusion
      `;

      const result = parseChapters(description, 600); // 10 min video
      expect(result.success).toBe(true);
      expect(result.chapters).toHaveLength(4);
      expect(result.chapters[0].title).toBe('Introduction');
      expect(result.chapters[0].startTime).toBe(0);
      expect(result.chapters[0].endTime).toBe(150);
    });

    it('parses HH:MM:SS format', () => {
      const description = `
        00:00:00 Opening
        01:23:45 Main Content
        02:00:00 Q&A Session
      `;

      const result = parseChapters(description, 7200); // 2 hour video
      expect(result.success).toBe(true);
      expect(result.chapters).toHaveLength(3);
      expect(result.chapters[1].startTime).toBe(5025); // 1:23:45 in seconds
    });

    it('handles Arabic text', () => {
      const description = `
        0:00 مقدمة
        5:00 الفصل الأول
        10:00 الخاتمة
      `;

      const result = parseChapters(description, 600);
      expect(result.success).toBe(true);
      expect(result.chapters[0].title).toBe('مقدمة');
    });

    it('rejects chapters without 0:00 start', () => {
      const description = `
        1:00 Chapter 1
        5:00 Chapter 2
      `;

      const result = parseChapters(description, 600);
      expect(result.success).toBe(false);
      expect(result.errors).toContain('First chapter must start at 0:00');
    });

    it('filters short chapters', () => {
      const description = `
        0:00 Intro
        0:05 Too Short
        0:20 Valid Chapter
      `;

      const result = parseChapters(description, 600);
      expect(result.chapters).toHaveLength(2);
      expect(result.chapters[1].title).toBe('Valid Chapter');
    });
  });

  describe('validateChapters', () => {
    it('validates correct chapters', () => {
      const chapters = [
        { id: '1', startTime: 0, endTime: 100, title: 'Chapter 1' },
        { id: '2', startTime: 100, endTime: 200, title: 'Chapter 2' },
      ];

      const result = validateChapters(chapters, 200);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('detects gaps between chapters', () => {
      const chapters = [
        { id: '1', startTime: 0, endTime: 100, title: 'Chapter 1' },
        { id: '2', startTime: 110, endTime: 200, title: 'Chapter 2' },
      ];

      const result = validateChapters(chapters, 200);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Gap or overlap between chapters at 100s');
    });
  });
});
```

#### 2. Component Tests (`apps/web/src/components/VideoPlayer/__tests__/ChapterList.test.tsx`)

```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { ChapterList } from '../ChapterList';

describe('ChapterList', () => {
  const mockChapters = [
    { id: '1', startTime: 0, endTime: 100, title: 'Introduction' },
    { id: '2', startTime: 100, endTime: 200, title: 'Main Content' },
  ];

  it('renders chapter list', () => {
    render(
      <ChapterList
        chapters={mockChapters}
        onChapterClick={jest.fn()}
      />
    );

    expect(screen.getByText('Introduction')).toBeInTheDocument();
    expect(screen.getByText('Main Content')).toBeInTheDocument();
  });

  it('handles chapter click', () => {
    const handleClick = jest.fn();
    render(
      <ChapterList
        chapters={mockChapters}
        onChapterClick={handleClick}
      />
    );

    fireEvent.click(screen.getByText('Main Content'));
    expect(handleClick).toHaveBeenCalledWith(mockChapters[1]);
  });

  it('highlights current chapter', () => {
    render(
      <ChapterList
        chapters={mockChapters}
        currentChapter={mockChapters[0]}
        onChapterClick={jest.fn()}
      />
    );

    const introButton = screen.getByText('Introduction').closest('button');
    expect(introButton).toHaveClass('bg-primary/10');
  });
});
```

### Integration Tests

#### E2E Test (`apps/web/e2e/video-chapters.spec.ts`)

```typescript
import { test, expect } from '@playwright/test';

test.describe('Video Chapters', () => {
  test('displays chapters from description', async ({ page }) => {
    // Create video with chapters in description
    await page.goto('/upload');
    await page.fill('#title', 'Test Video with Chapters');
    await page.fill('#description', `
      0:00 Introduction
      5:00 Chapter 1
      10:00 Chapter 2
      15:00 Conclusion
    `);
    // ... complete upload ...

    // Navigate to video
    await page.goto('/watch/test-video-id');

    // Check chapter markers appear
    await expect(page.locator('.chapter-marker')).toHaveCount(4);

    // Check chapter list
    await page.click('.chapter-list-header');
    await expect(page.locator('.chapter-item')).toHaveCount(4);

    // Test chapter navigation
    await page.click('text=Chapter 2');
    await expect(page.locator('video')).toHaveAttribute('currentTime', '600');
  });

  test('keyboard navigation', async ({ page }) => {
    await page.goto('/watch/video-with-chapters');

    // Next chapter: Shift+N
    await page.keyboard.press('Shift+N');
    await expect(page.locator('.current-chapter')).toContainText('Chapter 2');

    // Previous chapter: Shift+P
    await page.keyboard.press('Shift+P');
    await expect(page.locator('.current-chapter')).toContainText('Chapter 1');
  });

  test('RTL support for Arabic chapters', async ({ page }) => {
    await page.goto('/ar/watch/arabic-video');

    // Check RTL layout
    await expect(page.locator('.chapter-list')).toHaveAttribute('dir', 'rtl');

    // Check Arabic chapter titles
    await expect(page.locator('.chapter-item').first()).toContainText('مقدمة');
  });
});
```

## Edge Cases & Error Handling

### 1. Invalid Timestamp Formats
- Handle various separators (`:`, `.`, `-`)
- Support single-digit minutes/seconds
- Reject invalid times (e.g., 65:00)

### 2. Chapter Boundaries
- Handle chapters extending beyond video duration
- Manage overlapping chapters
- Deal with gaps between chapters

### 3. Internationalization
- Support RTL chapter titles
- Handle mixed LTR/RTL content
- Preserve Unicode characters

### 4. Performance
- Lazy load chapters for long videos
- Virtualize chapter list for 50+ chapters
- Throttle chapter change events

### 5. Accessibility
- Announce chapter changes to screen readers
- Provide keyboard shortcuts documentation
- Ensure sufficient color contrast for markers

### 6. Mobile Support
- Touch-friendly chapter markers
- Responsive chapter list
- Gesture support for chapter navigation

## Migration Plan

### Phase 1: Backend Implementation (Days 1-3)
1. Add chapter types to shared-types
2. Implement chapter parser library
3. Create API endpoints
4. Add chapter parsing to processor
5. Write unit tests

### Phase 2: Frontend Components (Days 4-6)
1. Build ChapterMarkers component
2. Build ChapterList component
3. Build CurrentChapter display
4. Create useVideoChapters hook
5. Write component tests

### Phase 3: Integration (Days 7-9)
1. Integrate chapters into CustomVideoPlayer
2. Add keyboard shortcuts
3. Implement mobile gestures
4. Add accessibility features
5. Write E2E tests

### Phase 4: Polish & Testing (Days 10-12)
1. Performance optimization
2. Visual polish and animations
3. Cross-browser testing
4. RTL/i18n testing
5. Load testing with many chapters

### Phase 5: Deployment (Days 13-14)
1. Deploy to staging environment
2. User acceptance testing
3. Performance monitoring setup
4. Production deployment
5. Monitor for issues

## Success Metrics

### Technical Metrics
- Chapter parsing success rate > 95%
- Parser performance < 100ms for typical descriptions
- Zero impact on video load time
- Chapter navigation latency < 50ms

### User Metrics
- Chapter adoption rate (% videos with chapters)
- Chapter usage rate (% users clicking chapters)
- Average chapters per video
- Navigation accuracy (correct chapter reached)

### Business Metrics
- Increased watch time for long videos
- Improved video completion rates
- Higher engagement on educational content
- Reduced bounce rate on long-form content

## Future Enhancements

### Phase 2 Features
1. **Manual Chapter Editor**
   - Visual timeline editor
   - Drag-and-drop chapter boundaries
   - Bulk chapter operations
   - Import from SRT/VTT files

2. **AI-Powered Chapter Generation**
   - Automatic chapter detection from audio
   - Scene change detection
   - Topic modeling for chapter titles
   - Multi-language chapter generation

3. **Chapter Thumbnails**
   - Generate thumbnail for each chapter
   - Preview on hover
   - Chapter grid view
   - Visual chapter navigation

4. **Chapter Analytics**
   - Track which chapters are most watched
   - Chapter drop-off rates
   - Popular chapter timestamps
   - Chapter-based recommendations

5. **Social Features**
   - Share specific chapters
   - Comment on chapters
   - Chapter-specific reactions
   - Crowdsourced chapter improvements

## Technical Debt Considerations

1. **Parser Extensibility**
   - Plugin system for custom formats
   - Support for more timestamp formats
   - Configuration for different validation rules

2. **Performance Optimization**
   - Cache parsed chapters
   - Pre-generate chapter data during upload
   - CDN for chapter metadata

3. **Standardization**
   - Align with YouTube's chapter format
   - Support WebVTT chapters standard
   - Export chapters in standard formats

## Security Considerations

1. **Input Sanitization**
   - Sanitize chapter titles (XSS prevention)
   - Validate timestamp formats
   - Rate limit chapter updates

2. **Authorization**
   - Only video owner can edit chapters
   - Moderator override for inappropriate titles
   - Audit log for chapter changes

3. **Data Validation**
   - Maximum chapter title length
   - Maximum number of chapters
   - Prevent malicious timestamp patterns

## Conclusion

The Video Chapters feature is essential for improving navigation and discovery of long-form Islamic educational content. This implementation plan provides a comprehensive approach to adding YouTube-style chapters to Al Ummah Now, with considerations for performance, accessibility, internationalization, and future enhancements.

The two-week timeline is aggressive but achievable with focused development effort. Priority should be given to the core parsing and UI functionality, with advanced features like manual editing and AI generation reserved for future phases.

## References

- YouTube Chapters Documentation: https://support.google.com/youtube/answer/9884579
- WebVTT Chapters Specification: https://www.w3.org/TR/webvtt1/#webvtt-cue-timings
- Video.js Chapters Plugin: https://github.com/videojs/videojs-contrib-ads
- WCAG Guidelines for Time-Based Media: https://www.w3.org/WAI/WCAG21/Understanding/time-based-media

---

**Document Status**: READY FOR REVIEW
**Next Steps**: Review with development team, refine estimates, begin implementation