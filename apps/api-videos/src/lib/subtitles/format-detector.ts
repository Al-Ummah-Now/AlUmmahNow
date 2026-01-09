/**
 * Subtitle format detection utility
 */

import { SubtitleFormat } from '@al-ummah/shared-types';

/**
 * Detect subtitle format from content
 * @param content - Raw subtitle file content
 * @returns Detected format or 'unknown'
 */
export function detectFormat(content: string): SubtitleFormat | 'unknown' {
  const trimmedContent = content.trim();

  // WebVTT detection - must start with "WEBVTT"
  if (trimmedContent.startsWith('WEBVTT')) {
    return 'vtt';
  }

  // SRT detection - starts with number, followed by timestamp with commas
  // Example: "1\n00:00:00,000 --> 00:00:05,000"
  const srtPattern = /^\d+\s*\n\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}/;
  if (srtPattern.test(trimmedContent)) {
    return 'srt';
  }

  // SBV detection - timestamp with comma separator (no sequence number)
  // Example: "0:00:00.000,0:00:05.000"
  const sbvPattern = /^\d{1,2}:\d{2}:\d{2}\.\d{3},\d{1,2}:\d{2}:\d{2}\.\d{3}/;
  if (sbvPattern.test(trimmedContent)) {
    return 'sbv';
  }

  // If content has SRT-style timestamps anywhere, likely SRT
  if (content.includes('-->') && content.includes(',')) {
    return 'srt';
  }

  // If content has VTT-style timestamps, likely VTT
  if (content.includes('-->') && content.includes('.')) {
    return 'vtt';
  }

  return 'unknown';
}

/**
 * Validate that the detected format is supported
 * @param format - Detected format
 * @returns True if format is supported
 */
export function isSupportedFormat(format: string): format is SubtitleFormat {
  return format === 'vtt' || format === 'srt' || format === 'sbv';
}

/**
 * Get file extension for format
 * @param format - Subtitle format
 * @returns File extension (e.g., '.vtt')
 */
export function getFileExtension(format: SubtitleFormat): string {
  return `.${format}`;
}

/**
 * Get MIME type for format
 * @param format - Subtitle format
 * @returns MIME type
 */
export function getMimeType(format: SubtitleFormat): string {
  switch (format) {
    case 'vtt':
      return 'text/vtt';
    case 'srt':
      return 'text/plain';
    case 'sbv':
      return 'text/plain';
    default:
      return 'text/plain';
  }
}
