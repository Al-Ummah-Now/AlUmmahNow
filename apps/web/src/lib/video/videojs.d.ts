/**
 * Video.js Type Extensions
 *
 * Extends the Video.js Player type to include methods that exist at runtime
 * but are not fully exposed in the official type definitions.
 */

import type { Player as VideoJsPlayer } from 'video.js';

/**
 * Extended Player interface with additional methods
 *
 * Video.js Player has an error() method that returns MediaError | null,
 * but it's not fully exposed in the TypeScript definitions.
 */
export interface ExtendedPlayer extends VideoJsPlayer {
  /**
   * Get the current media error
   * @returns The current MediaError or null if no error
   */
  error(): MediaError | null;
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
