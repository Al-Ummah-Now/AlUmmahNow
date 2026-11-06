'use server';

import { ApiResponse, ApiHeaders } from "./types";
import { buildApiUrl } from "./api-client";
import { getServerAuthContext } from "./server-auth";
import { logger } from '@/lib/logger-server';
import type { SubtitleTrack, SubtitleCue, SubtitleValidationResult } from "./subtitles-types";
import { normalizeSubtitleTrack, type ApiSubtitleTrack } from "./subtitle-utils";

// Re-export types for convenience
export type { SubtitleTrack, SubtitleCue, SubtitleValidationResult };
export type { SupportedLanguageCode } from "./subtitles-types";

/**
 * Upload subtitle file for a video
 * POST /api/videos/:videoId/subtitles
 */
export async function uploadSubtitle(
  videoId: string,
  file: File,
  language: string,
  isDefault: boolean,
  headers: Required<Pick<ApiHeaders, 'channelId'>>
): Promise<ApiResponse<{ subtitle: SubtitleTrack }> | null> {
  const formData = new FormData();
  formData.append('subtitle', file);
  formData.append('language', language);
  formData.append('isDefault', isDefault.toString());

  const authContext = await getServerAuthContext();

  const response = await fetch(
    buildApiUrl(`/api/videos/${videoId}/subtitles`),
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authContext?.accessToken || ''}`,
        'channelId': headers.channelId,
      },
      body: formData,
    }
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    logger.error('uploadSubtitle error:', errorData);
    return {
      success: false,
      error: {
        code: 'UPLOAD_ERROR',
        message: errorData.error || `Error uploading subtitle: ${response.statusText}`
      }
    };
  }

  // API responds with { success, data: { track, video } }
  const data = await response.json();
  return {
    success: !!data?.success,
    data: data?.data?.track ? { subtitle: normalizeSubtitleTrack(data.data.track as ApiSubtitleTrack, videoId) } : undefined,
  };
}

/**
 * List all subtitle tracks for a video
 * GET /api/videos/:videoId/subtitles
 */
export async function listSubtitles(
  videoId: string,
  headers?: ApiHeaders
): Promise<SubtitleTrack[]> {
  const authContext = await getServerAuthContext();

  const response = await fetch(
    buildApiUrl(`/api/videos/${videoId}/subtitles`),
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(authContext?.accessToken && { 'Authorization': `Bearer ${authContext.accessToken}` }),
        ...(headers?.channelId && { 'channelId': headers.channelId }),
      },
    }
  );

  if (!response.ok) {
    logger.error('listSubtitles error:', response.statusText);
    return [];
  }

  // API responds with { success, data: { tracks, defaultLanguage } }
  const data = await response.json();
  const tracks = (data?.data?.tracks || []) as ApiSubtitleTrack[];
  return tracks.map((track) => normalizeSubtitleTrack(track, videoId));
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
  const authContext = await getServerAuthContext();

  const response = await fetch(
    buildApiUrl(`/api/videos/${videoId}/subtitles/${language}`),
    {
      method: 'GET',
      headers: {
        'Content-Type': 'text/plain',
        ...(authContext?.accessToken && { 'Authorization': `Bearer ${authContext.accessToken}` }),
        ...(headers?.channelId && { 'channelId': headers.channelId }),
      },
    }
  );

  if (!response.ok) {
    logger.error('getSubtitle error:', response.statusText);
    return null;
  }

  return response.text();
}

/**
 * Delete a subtitle track
 * DELETE /api/videos/:videoId/subtitles/:language
 */
export async function deleteSubtitle(
  videoId: string,
  language: string,
  headers: Required<Pick<ApiHeaders, 'channelId'>>
): Promise<ApiResponse<{ success: boolean }> | null> {
  const authContext = await getServerAuthContext();

  const response = await fetch(
    buildApiUrl(`/api/videos/${videoId}/subtitles/${language}`),
    {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authContext?.accessToken || ''}`,
        'channelId': headers.channelId,
      },
    }
  );

  if (!response.ok) {
    logger.error('deleteSubtitle error:', response.statusText);
    return {
      success: false,
      error: {
        code: 'DELETE_ERROR',
        message: `Error deleting subtitle: ${response.statusText}`
      }
    };
  }

  return response.json();
}

/**
 * Set a subtitle track as default
 * PUT /api/videos/:videoId/subtitles/:language/default
 */
export async function setDefaultSubtitle(
  videoId: string,
  language: string,
  headers: Required<Pick<ApiHeaders, 'channelId'>>
): Promise<ApiResponse<{ success: boolean }> | null> {
  const authContext = await getServerAuthContext();

  const response = await fetch(
    buildApiUrl(`/api/videos/${videoId}/subtitles/${language}/default`),
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authContext?.accessToken || ''}`,
        'channelId': headers.channelId,
      },
    }
  );

  if (!response.ok) {
    logger.error('setDefaultSubtitle error:', response.statusText);
    return {
      success: false,
      error: {
        code: 'SET_DEFAULT_ERROR',
        message: `Error setting default subtitle: ${response.statusText}`
      }
    };
  }

  return response.json();
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
}

// Internal helper functions (not exported)

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

function validateTiming(cues: SubtitleCue[]): string[] {
  const issues: string[] = [];

  for (let i = 0; i < cues.length; i++) {
    const current = cues[i];

    const startSeconds = timeToSeconds(current.startTime);
    const endSeconds = timeToSeconds(current.endTime);

    if (startSeconds >= endSeconds) {
      issues.push(`Cue ${i + 1}: Start time must be before end time`);
    }

    if (i < cues.length - 1) {
      const next = cues[i + 1];
      const nextStartSeconds = timeToSeconds(next.startTime);

      if (endSeconds > nextStartSeconds) {
        issues.push(`Cue ${i + 1}: Overlaps with next cue`);
      }

      const gap = nextStartSeconds - endSeconds;
      if (gap > 5) {
        issues.push(`Large gap (${gap.toFixed(1)}s) between cue ${i + 1} and ${i + 2}`);
      }
    }
  }

  return issues;
}

function timeToSeconds(timeStr: string): number {
  const parts = timeStr.split(':');
  const hours = parseInt(parts[0]);
  const minutes = parseInt(parts[1]);
  const seconds = parseFloat(parts[2].replace(',', '.'));
  return hours * 3600 + minutes * 60 + seconds;
}
