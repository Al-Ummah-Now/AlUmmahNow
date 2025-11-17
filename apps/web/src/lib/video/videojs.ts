/**
 * Video.js Type Extensions
 *
 * Extends the Video.js Player type to include methods that exist at runtime
 * but are not fully exposed in the official type definitions.
 */

import type { Player as VideoJsPlayer } from 'video.js';

// Component type from video.js - using unknown for now as Component is not exported properly
type Component = unknown;

/**
 * Quality Level interface for Video.js quality selector plugin
 */
export interface QualityLevel {
  id: string;
  height: number;
  width: number;
  bitrate: number;
  enabled: boolean;
}

/**
 * Quality Levels interface for Video.js quality selector plugin
 */
export interface QualityLevelList {
  length: number;
  selectedIndex: number;
  [index: number]: QualityLevel;
  on(event: string, callback: () => void): void;
  off(event: string, callback: () => void): void;
}

/**
 * Extended Player interface with additional methods
 *
 * Video.js Player has methods that exist at runtime but are not fully
 * exposed in the TypeScript definitions.
 */
export interface ExtendedPlayer extends VideoJsPlayer {
  /**
   * Get the current media error
   * @returns The current MediaError or null if no error
   */
  error(): MediaError | null;

  /**
   * Get or set the playback rate
   * @param rate - Optional playback rate to set (0.25 to 2.0)
   * @returns Current playback rate if no parameter, or the player instance if setting
   */
  playbackRate(): number;
  playbackRate(rate: number): this;

  /**
   * Get the player's root DOM element
   * @returns The player's root HTMLElement
   */
  el(): HTMLElement;

  /**
   * Check if player is in fullscreen mode
   * @returns True if player is fullscreen
   */
  isFullscreen(): boolean;

  /**
   * Request fullscreen mode
   * @returns Promise that resolves when fullscreen is entered
   */
  requestFullscreen(): Promise<void>;

  /**
   * Exit fullscreen mode
   * @returns Promise that resolves when fullscreen is exited
   */
  exitFullscreen(): Promise<void>;

  /**
   * Trigger a custom event on the player
   * @param event - Event name or event object
   */
  trigger(event: string | Event): void;

  /**
   * Get the control bar component
   * @returns Control bar component
   */
  controlBar: Component;

  /**
   * Get or set the player volume
   * @param volume - Optional volume level (0 to 1)
   * @returns Current volume if no parameter, or the player instance if setting
   */
  volume(): number;
  volume(volume: number): this;

  /**
   * Get or set the muted state
   * @param muted - Optional muted state
   * @returns Current muted state if no parameter, or the player instance if setting
   */
  muted(): boolean;
  muted(muted: boolean): this;

  /**
   * Get the ready state of the media element
   * @returns Current ready state (0-4)
   */
  readyState(): number;

  /**
   * Get the quality levels for HLS streams (if quality selector plugin is available)
   * @returns Quality levels list or undefined if plugin not available
   */
  qualityLevels?(): QualityLevelList;

  /**
   * Get the TimeRanges object representing buffered portions of the media
   * @returns TimeRanges object with buffered time ranges
   */
  buffered(): TimeRanges;

  /**
   * Get the current source URL
   * @returns Current source URL or empty string if no source
   */
  currentSrc(): string;

  /**
   * Reset and reload the media element
   * Useful when changing sources programmatically
   */
  load(): void;
}

/**
 * Type guard to check if a player has the error method
 *
 * @param player - Video.js player instance
 * @returns True if player has error method
 */
export function hasErrorMethod(player: VideoJsPlayer): player is ExtendedPlayer {
  return typeof (player as ExtendedPlayer).error === 'function';
}
