/**
 * Chapter Parser Library
 * Parses video chapters from description text
 * Supports formats: 0:00, 00:00, 1:23:45
 */

import { v4 as uuidv4 } from 'uuid';
import type { VideoChapter } from '@al-ummah/shared-types';
import { logger } from '../logger';

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

interface TimestampLine {
  time: number;
  title: string;
  line: number;
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
  ];

  // Split description into lines
  const lines = description.split('\n');
  const timestampLines: TimestampLine[] = [];

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

        if (seconds <= videoDuration && title) {
          timestampLines.push({ time: seconds, title, line: i + 1 });
        } else if (seconds > videoDuration) {
          logger.warn('Chapter timestamp exceeds video duration', {
            timestamp: seconds,
            videoDuration,
            line: i + 1
          });
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

  logger.debug('Chapters parsed', {
    totalLines: lines.length,
    foundTimestamps: timestampLines.length,
    validChapters: chapters.length,
    errors: errors.length
  });

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

/**
 * Format time in seconds to timestamp string (MM:SS or HH:MM:SS)
 */
export function formatChapterTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}
