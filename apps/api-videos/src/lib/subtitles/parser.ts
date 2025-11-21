/**
 * Subtitle parser interface and base types
 */

import { SubtitleData, SubtitleCue, ValidationResult } from '@al-ummah/shared-types';

/**
 * Base interface for subtitle parsers
 */
export interface SubtitleParser {
  /**
   * Parse subtitle content into structured data
   * @param content - Raw subtitle file content
   * @returns Parsed subtitle data
   */
  parse(content: string): SubtitleData;

  /**
   * Validate parsed subtitle data
   * @param data - Parsed subtitle data
   * @returns Validation result
   */
  validate(data: SubtitleData): ValidationResult;

  /**
   * Convert subtitle data to WebVTT format
   * @param data - Parsed subtitle data
   * @returns WebVTT formatted string
   */
  toWebVTT(data: SubtitleData): string;
}

/**
 * Parse timestamp string to seconds
 * @param timestamp - Timestamp string (e.g., "00:01:23.456")
 * @returns Time in seconds
 */
export function parseTimestamp(timestamp: string): number {
  // Remove any whitespace
  timestamp = timestamp.trim();

  // Match format: HH:MM:SS.mmm or HH:MM:SS,mmm or H:MM:SS.mmm
  const match = timestamp.match(/^(\d{1,2}):(\d{2}):(\d{2})[.,](\d{3})$/);

  if (!match) {
    throw new Error(`Invalid timestamp format: ${timestamp}`);
  }

  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const seconds = parseInt(match[3], 10);
  const milliseconds = parseInt(match[4], 10);

  return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
}

/**
 * Format seconds to WebVTT timestamp
 * @param seconds - Time in seconds
 * @returns WebVTT formatted timestamp (HH:MM:SS.mmm)
 */
export function formatTimestamp(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const milliseconds = Math.round((seconds % 1) * 1000);

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`;
}

/**
 * Sanitize subtitle text to prevent XSS
 * @param text - Raw subtitle text
 * @returns Sanitized text
 */
export function sanitizeText(text: string): string {
  // Remove HTML tags
  text = text.replace(/<script[^>]*>.*?<\/script>/gi, '');
  text = text.replace(/<[^>]+>/g, '');

  // Remove dangerous characters but preserve formatting
  text = text.replace(/[<>]/g, '');

  // Normalize whitespace
  text = text.replace(/\s+/g, ' ').trim();

  return text;
}

/**
 * Validate cue timing
 * @param cue - Subtitle cue
 * @returns True if timing is valid
 */
export function isValidTiming(cue: SubtitleCue): boolean {
  return (
    cue.startTime >= 0 &&
    cue.endTime > cue.startTime &&
    cue.endTime - cue.startTime <= 300 // Max 5 minutes per cue
  );
}

/**
 * Check for timing overlaps
 * @param cues - Array of subtitle cues
 * @returns Array of overlapping cue pairs
 */
export function findTimingOverlaps(
  cues: SubtitleCue[]
): Array<{ cue1: number; cue2: number }> {
  const overlaps: Array<{ cue1: number; cue2: number }> = [];

  for (let i = 0; i < cues.length - 1; i++) {
    for (let j = i + 1; j < cues.length; j++) {
      const cue1 = cues[i];
      const cue2 = cues[j];

      // Check if cues overlap
      if (
        (cue1.startTime <= cue2.startTime && cue1.endTime > cue2.startTime) ||
        (cue2.startTime <= cue1.startTime && cue2.endTime > cue1.startTime)
      ) {
        overlaps.push({ cue1: i, cue2: j });
      }
    }
  }

  return overlaps;
}
