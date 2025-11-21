/**
 * Subtitle Helpers for Video.js Integration
 *
 * Provides utilities for loading and managing subtitle tracks in Video.js player.
 */

import type { Player } from 'video.js';
import { SubtitleTrack } from '@/lib/api/subtitles';

export interface SubtitleSettings {
  fontSize: 'small' | 'medium' | 'large';
  backgroundOpacity: number; // 0-100
  textColor: string;
  edgeStyle: 'none' | 'drop-shadow' | 'outline';
}

export const DEFAULT_SUBTITLE_SETTINGS: SubtitleSettings = {
  fontSize: 'medium',
  backgroundOpacity: 75,
  textColor: '#ffffff',
  edgeStyle: 'drop-shadow',
};

/**
 * Load subtitle tracks into Video.js player
 */
export function loadSubtitleTracks(
  player: Player,
  subtitles: SubtitleTrack[]
): void {
  if (!player || subtitles.length === 0) return;

  // Remove existing text tracks (except native ones)
  const textTracks = player.textTracks();
  for (let i = textTracks.length - 1; i >= 0; i--) {
    const track = textTracks[i];
    if (track.kind === 'subtitles' && track.label) {
      player.removeRemoteTextTrack(track);
    }
  }

  // Add new subtitle tracks
  subtitles.forEach((subtitle) => {
    if (subtitle.status === 'active') {
      player.addRemoteTextTrack(
        {
          kind: 'subtitles',
          src: subtitle.url,
          srclang: subtitle.language,
          label: subtitle.label,
          default: subtitle.isDefault,
        },
        false // Don't add to DOM manually
      );
    }
  });
}

/**
 * Apply subtitle appearance settings
 */
export function applySubtitleSettings(
  player: Player,
  settings: SubtitleSettings
): void {
  const textTrackDisplay = player.el().querySelector('.vjs-text-track-display');
  if (!textTrackDisplay) return;

  // Font size
  const fontSizeMap = {
    small: '0.8em',
    medium: '1em',
    large: '1.2em',
  };

  // Apply styles
  const style = (textTrackDisplay as HTMLElement).style;
  style.fontSize = fontSizeMap[settings.fontSize];

  // Apply to all cue elements
  const cues = textTrackDisplay.querySelectorAll('.vjs-text-track-cue');
  cues.forEach((cue) => {
    const cueEl = cue as HTMLElement;
    cueEl.style.backgroundColor = `rgba(0, 0, 0, ${settings.backgroundOpacity / 100})`;
    cueEl.style.color = settings.textColor;

    // Edge style
    switch (settings.edgeStyle) {
      case 'drop-shadow':
        cueEl.style.textShadow = '2px 2px 4px rgba(0,0,0,0.8)';
        break;
      case 'outline':
        cueEl.style.textShadow =
          '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000';
        break;
      case 'none':
      default:
        cueEl.style.textShadow = 'none';
        break;
    }
  });
}

/**
 * Get current active subtitle track
 */
export function getActiveSubtitleTrack(player: Player): string | null {
  const textTracks = player.textTracks();

  for (let i = 0; i < textTracks.length; i++) {
    const track = textTracks[i];
    if (track.kind === 'subtitles' && track.mode === 'showing') {
      return track.language || null;
    }
  }

  return null;
}

/**
 * Set active subtitle track by language
 */
export function setActiveSubtitleTrack(
  player: Player,
  language: string | null
): void {
  const textTracks = player.textTracks();

  for (let i = 0; i < textTracks.length; i++) {
    const track = textTracks[i];
    if (track.kind === 'subtitles') {
      if (language === null) {
        // Turn off all subtitles
        track.mode = 'disabled';
      } else if (track.language === language) {
        // Enable this track
        track.mode = 'showing';
      } else {
        // Disable other tracks
        track.mode = 'disabled';
      }
    }
  }
}

/**
 * Cycle to next subtitle track
 */
export function cycleSubtitleTrack(player: Player): void {
  const textTracks = player.textTracks();
  const subtitleTracks: any[] = [];

  // Collect all subtitle tracks
  for (let i = 0; i < textTracks.length; i++) {
    const track = textTracks[i];
    if (track.kind === 'subtitles') {
      subtitleTracks.push(track);
    }
  }

  if (subtitleTracks.length === 0) return;

  // Find current active track
  let currentIndex = -1;
  for (let i = 0; i < subtitleTracks.length; i++) {
    if (subtitleTracks[i].mode === 'showing') {
      currentIndex = i;
      break;
    }
  }

  // Cycle to next track (or off if at end)
  const nextIndex = (currentIndex + 1) % (subtitleTracks.length + 1);

  if (nextIndex === subtitleTracks.length) {
    // Turn off all subtitles
    setActiveSubtitleTrack(player, null);
  } else {
    // Enable next track
    setActiveSubtitleTrack(player, subtitleTracks[nextIndex].language);
  }
}

/**
 * Auto-select subtitle track based on user's locale
 */
export function autoSelectSubtitle(
  player: Player,
  userLocale: string
): boolean {
  const textTracks = player.textTracks();
  const locale = userLocale.substring(0, 2); // Get language code (e.g., 'en' from 'en-US')

  for (let i = 0; i < textTracks.length; i++) {
    const track = textTracks[i];
    if (track.kind === 'subtitles' && track.language === locale) {
      setActiveSubtitleTrack(player, locale);
      return true;
    }
  }

  return false;
}

/**
 * Save subtitle settings to localStorage
 */
export function saveSubtitleSettings(settings: SubtitleSettings): void {
  try {
    localStorage.setItem('subtitle-settings', JSON.stringify(settings));
  } catch (error) {
    console.error('Failed to save subtitle settings:', error);
  }
}

/**
 * Load subtitle settings from localStorage
 */
export function loadSubtitleSettings(): SubtitleSettings {
  try {
    const stored = localStorage.getItem('subtitle-settings');
    if (stored) {
      return { ...DEFAULT_SUBTITLE_SETTINGS, ...JSON.parse(stored) };
    }
  } catch (error) {
    console.error('Failed to load subtitle settings:', error);
  }
  return DEFAULT_SUBTITLE_SETTINGS;
}

/**
 * Save last used subtitle track to localStorage
 */
export function saveLastSubtitleTrack(language: string | null): void {
  try {
    if (language) {
      localStorage.setItem('last-subtitle-track', language);
    } else {
      localStorage.removeItem('last-subtitle-track');
    }
  } catch (error) {
    console.error('Failed to save last subtitle track:', error);
  }
}

/**
 * Load last used subtitle track from localStorage
 */
export function loadLastSubtitleTrack(): string | null {
  try {
    return localStorage.getItem('last-subtitle-track');
  } catch (error) {
    console.error('Failed to load last subtitle track:', error);
    return null;
  }
}
