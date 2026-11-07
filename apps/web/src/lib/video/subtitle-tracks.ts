/**
 * Subtitle tracks for the video player.
 *
 * Tracks are listed by GET /api/videos/:videoId/subtitles and each track's
 * WebVTT is served by GET /api/videos/:videoId/subtitles/:language.
 */

import { SUPPORTED_LANGUAGES } from '@/lib/api/subtitles-types';
import type { ApiSubtitleTrack } from '@/lib/api/subtitle-utils';

export interface PlayerTextTrack {
  src: string;
  srclang: string;
  label: string;
  kind: 'subtitles' | 'captions';
  default: boolean;
}

/**
 * Human-readable label for a subtitle language in the viewer's UI locale.
 */
export function getSubtitleLabel(language: string, uiLocale: string, fallback?: string): string {
  const info = SUPPORTED_LANGUAGES.find((l) => l.code === language);
  if (!info) return fallback || language;
  return uiLocale === 'ar' ? info.nameAr : info.name;
}

/**
 * Convert API tracks to Video.js remote text track options.
 *
 * - Only ready tracks with a URL are used.
 * - Relative URLs are resolved against the API base URL.
 * - At most one track is default: the API's default track, if any.
 */
export function toPlayerTextTracks(
  tracks: ApiSubtitleTrack[],
  options: { apiUrl: string; videoId: string; uiLocale: string }
): PlayerTextTrack[] {
  const apiBase = options.apiUrl.replace(/\/+$/, '');
  let defaultAssigned = false;

  return tracks
    .filter((track) => track && track.language && (track.status === undefined || track.status === 'ready'))
    .map((track) => {
      const src = track.url
        ? (/^https?:\/\//i.test(track.url) ? track.url : `${apiBase}${track.url.startsWith('/') ? '' : '/'}${track.url}`)
        : `${apiBase}/api/videos/${encodeURIComponent(options.videoId)}/subtitles/${encodeURIComponent(track.language)}`;

      const isDefault = !!track.isDefault && !defaultAssigned;
      if (isDefault) defaultAssigned = true;

      return {
        src,
        srclang: track.language,
        label: getSubtitleLabel(track.language, options.uiLocale, track.label),
        kind: track.kind === 'captions' ? 'captions' : 'subtitles',
        default: isDefault,
      } satisfies PlayerTextTrack;
    });
}
