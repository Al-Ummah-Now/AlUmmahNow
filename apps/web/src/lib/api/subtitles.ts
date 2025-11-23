'use server';

import { getApiUrl } from "@/lib/runtime-config";
import { ApiResponse, ApiHeaders } from "./types";
import { logger } from '@/lib/logger-server';


const baseUrl = getApiUrl();

/**
 * Subtitle Track Type
 */
export interface SubtitleTrack {
  videoId: string;
  language: string;
  label: string;
  url: string;
  isDefault: boolean;
  fileSize: number;
  uploadDate: string;
  status: 'active' | 'processing' | 'failed';
}

/**
 * Supported Languages (10 languages)
 */
export const SUPPORTED_LANGUAGES = [
  { code: 'ar', name: 'Arabic', nameAr: 'العربية', rtl: true, flag: '🇸🇦' },
  { code: 'en', name: 'English', nameAr: 'الإنجليزية', rtl: false, flag: '🇬🇧' },
  { code: 'ur', name: 'Urdu', nameAr: 'الأردية', rtl: true, flag: '🇵🇰' },
  { code: 'fr', name: 'French', nameAr: 'الفرنسية', rtl: false, flag: '🇫🇷' },
  { code: 'id', name: 'Indonesian', nameAr: 'الإندونيسية', rtl: false, flag: '🇮🇩' },
  { code: 'tr', name: 'Turkish', nameAr: 'التركية', rtl: false, flag: '🇹🇷' },
  { code: 'ms', name: 'Malay', nameAr: 'الملايو', rtl: false, flag: '🇲🇾' },
  { code: 'bn', name: 'Bengali', nameAr: 'البنغالية', rtl: false, flag: '🇧🇩' },
  { code: 'de', name: 'German', nameAr: 'الألمانية', rtl: false, flag: '🇩🇪' },
  { code: 'es', name: 'Spanish', nameAr: 'الإسبانية', rtl: false, flag: '🇪🇸' },
] as const;

export type SupportedLanguageCode = typeof SUPPORTED_LANGUAGES[number]['code'];

/**
 * Upload subtitle file for a video
 * POST /api/videos/:videoId/subtitles
 */
export async function uploadSubtitle(
  videoId: string,
  file: File,
  language: string,
  isDefault: boolean,
  headers: Required<Pick<ApiHeaders, 'channelId' | 'userId'>>
): Promise<ApiResponse<{ subtitle: SubtitleTrack }> | null> {
  try {
    const formData = new FormData();
    formData.append('subtitle', file);
    formData.append('language', language);
    formData.append('isDefault', isDefault.toString());

    const response = await fetch(
      `${baseUrl}/api/videos/${videoId}/subtitles`,
      {
        method: 'POST',
        headers: {
          'channelId': headers.channelId,
          'userId': headers.userId,
        },
        body: formData,
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Error uploading subtitle: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    logger.error('uploadSubtitle error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to upload subtitle'
    };
  }
}

/**
 * List all subtitle tracks for a video
 * GET /api/videos/:videoId/subtitles
 */
export async function listSubtitles(
  videoId: string,
  headers?: ApiHeaders
): Promise<SubtitleTrack[]> {
  try {
    const response = await fetch(
      `${baseUrl}/api/videos/${videoId}/subtitles`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(headers?.channelId && { 'channelId': headers.channelId }),
          ...(headers?.userId && { 'userId': headers.userId }),
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Error fetching subtitles: ${response.statusText}`);
    }

    const data = await response.json();
    return data.subtitles || [];
  } catch (error) {
    logger.error('listSubtitles error:', error);
    return [];
  }
}

/**
 * Get WebVTT content for a specific subtitle track
 * GET /api/videos/:videoId/subtitles/:language
 */
export async function getSubtitle(
  videoId: string,
  language: string,
  headers?: ApiHeaders
): Promise<string | null> {
  try {
    const response = await fetch(
      `${baseUrl}/api/videos/${videoId}/subtitles/${language}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'text/plain',
          ...(headers?.channelId && { 'channelId': headers.channelId }),
          ...(headers?.userId && { 'userId': headers.userId }),
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Error fetching subtitle: ${response.statusText}`);
    }

    return await response.text();
  } catch (error) {
    logger.error('getSubtitle error:', error);
    return null;
  }
}

/**
 * Delete a subtitle track
 * DELETE /api/videos/:videoId/subtitles/:language
 */
export async function deleteSubtitle(
  videoId: string,
  language: string,
  headers: Required<Pick<ApiHeaders, 'channelId' | 'userId'>>
): Promise<ApiResponse<{ success: boolean }> | null> {
  try {
    const response = await fetch(
      `${baseUrl}/api/videos/${videoId}/subtitles/${language}`,
      {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'channelId': headers.channelId,
          'userId': headers.userId,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Error deleting subtitle: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    logger.error('deleteSubtitle error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete subtitle'
    };
  }
}

/**
 * Set a subtitle track as default
 * PUT /api/videos/:videoId/subtitles/:language/default
 */
export async function setDefaultSubtitle(
  videoId: string,
  language: string,
  headers: Required<Pick<ApiHeaders, 'channelId' | 'userId'>>
): Promise<ApiResponse<{ success: boolean }> | null> {
  try {
    const response = await fetch(
      `${baseUrl}/api/videos/${videoId}/subtitles/${language}/default`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'channelId': headers.channelId,
          'userId': headers.userId,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Error setting default subtitle: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    logger.error('setDefaultSubtitle error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to set default subtitle'
    };
  }
}

/**
 * Client-side subtitle validation (before upload)
 */
export interface SubtitleValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  preview?: SubtitleCue[];
}

export interface SubtitleCue {
  startTime: string;
  endTime: string;
  text: string;
}

/**
 * Validate subtitle file before upload
 */
export async function validateSubtitleFile(
  file: File
): Promise<SubtitleValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const preview: SubtitleCue[] = [];

  // Validate file size (max 2MB)
  const MAX_SIZE = 2 * 1024 * 1024;
  if (file.size > MAX_SIZE) {
    errors.push('File size exceeds 2MB limit');
    return { valid: false, errors, warnings };
  }

  // Validate file extension
  const validExtensions = ['.srt', '.vtt', '.sbv'];
  const fileName = file.name.toLowerCase();
  const hasValidExtension = validExtensions.some(ext => fileName.endsWith(ext));

  if (!hasValidExtension) {
    errors.push('Invalid file format. Supported formats: SRT, VTT, SBV');
    return { valid: false, errors, warnings };
  }

  try {
    const content = await file.text();

    // Basic content validation
    if (!content || content.trim().length === 0) {
      errors.push('File is empty');
      return { valid: false, errors, warnings };
    }

    // Parse and validate subtitle format
    const cues = parseSubtitleContent(content, fileName);

    if (cues.length === 0) {
      errors.push('No valid subtitle cues found');
      return { valid: false, errors, warnings };
    }

    // Validate max cues (10,000 limit)
    if (cues.length > 10000) {
      errors.push('File contains too many cues (max 10,000)');
      return { valid: false, errors, warnings };
    }

    // Check for timing issues
    const timingIssues = validateTiming(cues);
    if (timingIssues.length > 0) {
      warnings.push(...timingIssues);
    }

    // Get first 5 cues for preview
    preview.push(...cues.slice(0, 5));

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      preview
    };
  } catch (_error) {
    errors.push('Failed to parse subtitle file');
    return { valid: false, errors, warnings };
  }
}

/**
 * Parse subtitle content from different formats
 */
function parseSubtitleContent(content: string, fileName: string): SubtitleCue[] {
  if (fileName.endsWith('.srt')) {
    return parseSRT(content);
  } else if (fileName.endsWith('.vtt')) {
    return parseVTT(content);
  } else if (fileName.endsWith('.sbv')) {
    return parseSBV(content);
  }
  return [];
}

/**
 * Parse SRT format
 */
function parseSRT(content: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  const blocks = content.split(/\n\s*\n/).filter(block => block.trim());

  for (const block of blocks) {
    const lines = block.split('\n').map(line => line.trim());
    if (lines.length < 3) continue;

    const timingLine = lines[1];
    const match = timingLine.match(/(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/);

    if (match) {
      cues.push({
        startTime: match[1].replace(',', '.'),
        endTime: match[2].replace(',', '.'),
        text: lines.slice(2).join(' ')
      });
    }
  }

  return cues;
}

/**
 * Parse WebVTT format
 */
function parseVTT(content: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  const lines = content.split('\n');
  let i = 0;

  // Skip WEBVTT header
  while (i < lines.length && !lines[i].includes('-->')) {
    i++;
  }

  while (i < lines.length) {
    const line = lines[i].trim();

    if (line.includes('-->')) {
      const match = line.match(/(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})/);
      if (match) {
        i++;
        const textLines: string[] = [];
        while (i < lines.length && lines[i].trim() !== '') {
          textLines.push(lines[i].trim());
          i++;
        }
        cues.push({
          startTime: match[1],
          endTime: match[2],
          text: textLines.join(' ')
        });
      }
    }
    i++;
  }

  return cues;
}

/**
 * Parse SBV format (YouTube)
 */
function parseSBV(content: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  const blocks = content.split(/\n\s*\n/).filter(block => block.trim());

  for (const block of blocks) {
    const lines = block.split('\n').map(line => line.trim());
    if (lines.length < 2) continue;

    const timingLine = lines[0];
    const match = timingLine.match(/(\d{1,2}:\d{2}:\d{2}\.\d{3}),(\d{1,2}:\d{2}:\d{2}\.\d{3})/);

    if (match) {
      cues.push({
        startTime: match[1].padStart(12, '0'),
        endTime: match[2].padStart(12, '0'),
        text: lines.slice(1).join(' ')
      });
    }
  }

  return cues;
}

/**
 * Validate timing of subtitle cues
 */
function validateTiming(cues: SubtitleCue[]): string[] {
  const issues: string[] = [];

  for (let i = 0; i < cues.length; i++) {
    const current = cues[i];

    // Check if start time is before end time
    const startSeconds = timeToSeconds(current.startTime);
    const endSeconds = timeToSeconds(current.endTime);

    if (startSeconds >= endSeconds) {
      issues.push(`Cue ${i + 1}: Start time must be before end time`);
    }

    // Check for overlaps with next cue
    if (i < cues.length - 1) {
      const next = cues[i + 1];
      const nextStartSeconds = timeToSeconds(next.startTime);

      if (endSeconds > nextStartSeconds) {
        issues.push(`Cue ${i + 1}: Overlaps with next cue`);
      }

      // Check for large gaps (> 5 seconds)
      const gap = nextStartSeconds - endSeconds;
      if (gap > 5) {
        issues.push(`Large gap (${gap.toFixed(1)}s) between cue ${i + 1} and ${i + 2}`);
      }
    }
  }

  return issues;
}

/**
 * Convert time string to seconds
 */
function timeToSeconds(timeStr: string): number {
  const parts = timeStr.split(':');
  const hours = parseInt(parts[0]);
  const minutes = parseInt(parts[1]);
  const seconds = parseFloat(parts[2].replace(',', '.'));
  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * Format time for display
 */
export function formatSubtitleTime(timeStr: string): string {
  return timeStr.substring(0, 8); // HH:MM:SS
}
