/**
 * Subtitle Utility Functions
 *
 * Non-server action utilities for subtitle handling.
 * These are pure functions that can be used in client components.
 */

import type { SubtitleTrack } from './subtitles-types';

/**
 * Raw subtitle track as stored/returned by the API (shared-types SubtitleTrack)
 */
export interface ApiSubtitleTrack {
  id?: string;
  language: string;
  label?: string;
  kind?: 'subtitles' | 'captions';
  isDefault?: boolean;
  uploadedAt?: string;
  fileSize?: number;
  url: string;
  status?: 'processing' | 'ready' | 'error';
}

/**
 * Map an API subtitle track to the web SubtitleTrack shape used by the UI.
 */
export function normalizeSubtitleTrack(raw: ApiSubtitleTrack, videoId: string): SubtitleTrack {
  const status: SubtitleTrack['status'] =
    raw.status === 'error' ? 'failed' : raw.status === 'processing' ? 'processing' : 'active';
  return {
    videoId,
    language: raw.language,
    label: raw.label || raw.language,
    url: raw.url,
    isDefault: !!raw.isDefault,
    fileSize: raw.fileSize || 0,
    uploadDate: raw.uploadedAt || '',
    status,
  };
}

/**
 * Replace any existing track for the same language with the new one.
 */
export function upsertSubtitleTrack(tracks: SubtitleTrack[], track: SubtitleTrack): SubtitleTrack[] {
  const others = tracks.filter((t) => t.language !== track.language);
  const next = [...others, track];
  return track.isDefault ? next.map((t) => ({ ...t, isDefault: t.language === track.language })) : next;
}

/**
 * Format time for display
 * Converts "HH:MM:SS,mmm" to "HH:MM:SS"
 */
export function formatSubtitleTime(timeStr: string): string {
  return timeStr.substring(0, 8); // HH:MM:SS
}

/**
 * Parse SRT time format to seconds
 * Converts "HH:MM:SS,mmm" to number of seconds
 */
export function parseSubtitleTime(timeStr: string): number {
  const parts = timeStr.split(':');
  const hours = parseInt(parts[0]);
  const minutes = parseInt(parts[1]);
  const seconds = parseFloat(parts[2].replace(',', '.'));
  return hours * 3600 + minutes * 60 + seconds;
}
