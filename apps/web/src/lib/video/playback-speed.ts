/**
 * Playback Speed Control Module
 *
 * Phase 2.2: Playback Speed Control
 *
 * Features:
 * - Persist playback rate to localStorage
 * - Keyboard shortcuts (< and >) for speed adjustment
 * - Analytics tracking for speed changes
 * - No audio pitch degradation (browser native handling)
 */

import type { Player } from 'video.js';
import type { ExtendedPlayer } from './videojs';
import { shouldHandleGlobalPlayerShortcut } from '@/lib/security/listener-scope';
import { logger } from '@/lib/logger-client';


/**
 * localStorage key for persisting playback rate
 */
const PLAYBACK_RATE_KEY = 'video-player-playback-rate';

/**
 * Default playback rate if none is stored
 */
const DEFAULT_PLAYBACK_RATE = 1;

/**
 * Available playback rates (must match VIDEO_JS_OPTIONS.playbackRates)
 */
const AVAILABLE_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

/**
 * Load saved playback rate from localStorage
 *
 * @returns Saved playback rate or default (1x)
 */
export function loadPlaybackRate(): number {
  try {
    if (typeof window === 'undefined') {
      return DEFAULT_PLAYBACK_RATE;
    }

    const saved = localStorage.getItem(PLAYBACK_RATE_KEY);
    if (!saved) {
      return DEFAULT_PLAYBACK_RATE;
    }

    const rate = parseFloat(saved);

    // Validate rate is a valid number and within available rates
    if (isNaN(rate) || !AVAILABLE_RATES.includes(rate)) {
      logger.warn('[PlaybackSpeed] Invalid saved rate:', saved);
      return DEFAULT_PLAYBACK_RATE;
    }

    return rate;
  } catch (error) {
    logger.error('[PlaybackSpeed] Failed to load playback rate:', error);
    return DEFAULT_PLAYBACK_RATE;
  }
}

/**
 * Save playback rate to localStorage
 *
 * @param rate - Playback rate to save
 */
export function savePlaybackRate(rate: number): void {
  try {
    if (typeof window === 'undefined') {
      return;
    }

    // Validate rate
    if (isNaN(rate) || !AVAILABLE_RATES.includes(rate)) {
      logger.warn('[PlaybackSpeed] Invalid rate, not saving:', rate);
      return;
    }

    localStorage.setItem(PLAYBACK_RATE_KEY, rate.toString());
  } catch (error) {
    logger.error('[PlaybackSpeed] Failed to save playback rate:', error);
  }
}

/**
 * Get the next playback rate in the sequence
 *
 * @param currentRate - Current playback rate
 * @returns Next rate (wraps to 0.25x after 2x)
 */
function getNextRate(currentRate: number): number {
  const currentIndex = AVAILABLE_RATES.indexOf(currentRate);
  if (currentIndex === -1 || currentIndex === AVAILABLE_RATES.length - 1) {
    return AVAILABLE_RATES[0]; // Wrap to first rate
  }
  return AVAILABLE_RATES[currentIndex + 1];
}

/**
 * Get the previous playback rate in the sequence
 *
 * @param currentRate - Current playback rate
 * @returns Previous rate (wraps to 2x before 0.25x)
 */
function getPreviousRate(currentRate: number): number {
  const currentIndex = AVAILABLE_RATES.indexOf(currentRate);
  if (currentIndex === -1 || currentIndex === 0) {
    return AVAILABLE_RATES[AVAILABLE_RATES.length - 1]; // Wrap to last rate
  }
  return AVAILABLE_RATES[currentIndex - 1];
}

/**
 * Setup keyboard shortcuts for playback speed control
 *
 * Shortcuts:
 * - Shift + > : Increase speed
 * - Shift + < : Decrease speed
 *
 * @param player - Video.js player instance
 */
export function setupPlaybackSpeedKeyboardShortcuts(player: Player | ExtendedPlayer): void {
  if (!player) {
    logger.warn('[PlaybackSpeed] Cannot setup keyboard shortcuts: player is null');
    return;
  }

  const handleKeyDown = (event: KeyboardEvent) => {
    // Only handle when shift is pressed
    if (!event.shiftKey) {
      return;
    }

    // Scope the document listener to this player (Story 1.2, AC 4)
    const scopeElement = (player as ExtendedPlayer).el();
    if (scopeElement && !shouldHandleGlobalPlayerShortcut(event, scopeElement, { handleEventsInsidePlayer: true })) {
      return;
    }

    // Ignore if user is typing in an input field
    const target = event.target as HTMLElement;
    if (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable
    ) {
      return;
    }

    const currentRate = (player as ExtendedPlayer).playbackRate();

    if (event.key === '>' || event.key === '.') {
      // Increase speed (Shift + >)
      event.preventDefault();
      const newRate = getNextRate(currentRate);
      (player as ExtendedPlayer).playbackRate(newRate);
    } else if (event.key === '<' || event.key === ',') {
      // Decrease speed (Shift + <)
      event.preventDefault();
      const newRate = getPreviousRate(currentRate);
      (player as ExtendedPlayer).playbackRate(newRate);
    }
  };

  // Add keyboard listener to document
  document.addEventListener('keydown', handleKeyDown);

  // Store cleanup function on player for later removal
  const playerEl = (player as ExtendedPlayer).el();
  if (playerEl) {
    (playerEl as HTMLElement & { __playbackSpeedKeydownHandler?: typeof handleKeyDown }).__playbackSpeedKeydownHandler = handleKeyDown;
  }
}

/**
 * Cleanup keyboard shortcuts
 *
 * @param player - Video.js player instance
 */
export function cleanupPlaybackSpeedKeyboardShortcuts(player: Player | ExtendedPlayer): void {
  if (!player) {
    return;
  }

  const playerEl = (player as ExtendedPlayer).el();
  if (playerEl) {
    const extPlayerEl = playerEl as HTMLElement & { __playbackSpeedKeydownHandler?: (event: KeyboardEvent) => void };
    const handler = extPlayerEl.__playbackSpeedKeydownHandler;
    if (handler) {
      document.removeEventListener('keydown', handler);
      delete extPlayerEl.__playbackSpeedKeydownHandler;
    }
  }
}

/**
 * Initialize playback speed control for a player
 *
 * Sets up:
 * - Loading and applying saved playback rate
 * - Keyboard shortcuts for speed control
 * - Persistence when speed changes
 *
 * @param player - Video.js player instance
 * @param onSpeedChange - Optional callback when speed changes (for analytics)
 */
export function initializePlaybackSpeed(
  player: Player | ExtendedPlayer,
  onSpeedChange?: (rate: number, previousRate: number) => void
): void {
  if (!player) {
    logger.warn('[PlaybackSpeed] Cannot initialize: player is null');
    return;
  }

  const extPlayer = player as ExtendedPlayer;

  // Load and apply saved playback rate
  const savedRate = loadPlaybackRate();
  if (savedRate !== DEFAULT_PLAYBACK_RATE) {
    extPlayer.playbackRate(savedRate);
  }

  // Setup keyboard shortcuts
  setupPlaybackSpeedKeyboardShortcuts(player);

  // Track rate changes
  let previousRate = extPlayer.playbackRate();

  player.on('ratechange', () => {
    const currentRate = extPlayer.playbackRate();

    // Save to localStorage
    savePlaybackRate(currentRate);

    // Call analytics callback if provided
    if (onSpeedChange) {
      onSpeedChange(currentRate, previousRate);
    }

    previousRate = currentRate;
  });
}
