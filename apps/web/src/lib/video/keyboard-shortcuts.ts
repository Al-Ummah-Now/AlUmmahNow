/**
 * Video Player Keyboard Shortcuts
 *
 * Implements YouTube-style keyboard shortcuts for the video player.
 * Provides comprehensive control over playback, volume, seeking, and more.
 *
 * Features:
 * - Play/Pause (Space, K)
 * - Seeking (Arrow keys, J, L, 0-9)
 * - Volume control (Arrow Up/Down, M)
 * - Fullscreen (F)
 * - Picture-in-Picture (P)
 * - Playback speed (<, >)
 * - Help modal (?)
 * - Visual feedback for actions
 * - Form input detection to prevent conflicts
 * - Works in fullscreen mode
 * - RTL support (arrow keys swap for Arabic)
 *
 * RTL Behavior:
 * - In RTL mode (Arabic), horizontal arrow keys are swapped:
 *   - ArrowLeft → seeks forward (10s)
 *   - ArrowRight → seeks backward (10s)
 * - This matches natural RTL reading direction
 * - J/L keys remain unchanged (letter keys don't swap)
 * - Vertical arrows (volume) and other keys unaffected
 *
 * @example
 * ```typescript
 * const cleanup = setupKeyboardShortcuts(player, {
 *   onShowHelp: () => setShowHelp(true),
 *   lang: 'en'
 * });
 * // Later, cleanup when component unmounts
 * cleanup();
 * ```
 */

import type { ExtendedPlayer } from './videojs';
import { getTranslations, isRTL, type SupportedLanguage } from './i18n';
import { logger } from '@/lib/logger-server';


/**
 * Constants for keyboard shortcuts behavior
 */
const FEEDBACK_DURATION_MS = 1000;
const ARROW_REWIND_SECONDS = 5;
const J_REWIND_SECONDS = 10;
const ARROW_FORWARD_SECONDS = 5;
const L_FORWARD_SECONDS = 10;
const VOLUME_STEP = 0.1;
const MIN_PLAYBACK_RATE = 0.25;
const MAX_PLAYBACK_RATE = 2;
const PLAYBACK_RATE_STEP = 0.25;
const PERCENT_MULTIPLIER = 100;

/**
 * Security constants for event validation
 * 
 * EVENT_RATE_LIMIT_MS: 50ms (20 events/second maximum)
 * - Prevents keyboard event flooding attacks that could:
 *   - Overwhelm the event loop causing UI freezing
 *   - Exhaust memory through rapid event queue accumulation
 *   - Trigger performance degradation in video playback
 * - 50ms balance: Responsive for legitimate rapid typing while blocking abuse
 * - Human typing typically 100-200ms between keystrokes
 * - Bot/script attacks often attempt <10ms intervals
 * 
 * MAX_EVENT_QUEUE_SIZE: 100 events
 * - Prevents memory exhaustion from accumulated event timestamps
 * - Allows tracking of recent key patterns for anomaly detection
 * - Auto-clears when limit reached, maintaining performance
 */
const EVENT_RATE_LIMIT_MS = 50; // Maximum 20 events per second
const MAX_EVENT_QUEUE_SIZE = 100;

/**
 * Configuration options for keyboard shortcuts
 */
export interface KeyboardShortcutsOptions {
  /**
   * Callback when help modal should be shown
   */
  onShowHelp?: () => void;

  /**
   * Language for feedback messages
   */
  lang?: SupportedLanguage;

  /**
   * Enable/disable visual feedback
   */
  showFeedback?: boolean;

  /**
   * Custom key bindings (optional override)
   */
  customBindings?: Partial<KeyBindings>;
}

/**
 * Key binding definitions
 */
export interface KeyBindings {
  playPause: string[];
  rewind: string[];
  forward: string[];
  volumeUp: string[];
  volumeDown: string[];
  mute: string[];
  fullscreen: string[];
  pip: string[];
  speedDecrease: string[];
  speedIncrease: string[];
  help: string[];
  seek: Record<string, number>; // 0-9 keys map to percentage
}

/**
 * Default key bindings (YouTube-style)
 */
const DEFAULT_KEY_BINDINGS: KeyBindings = {
  playPause: [' ', 'k', 'K'],
  rewind: ['ArrowLeft', 'j', 'J'],
  forward: ['ArrowRight', 'l', 'L'],
  volumeUp: ['ArrowUp'],
  volumeDown: ['ArrowDown'],
  mute: ['m', 'M'],
  fullscreen: ['f', 'F'],
  pip: ['p', 'P'],
  speedDecrease: [',', '<'],
  speedIncrease: ['.', '>'],
  help: ['?', '/'],
  seek: {
    '0': 0,
    '1': 10,
    '2': 20,
    '3': 30,
    '4': 40,
    '5': 50,
    '6': 60,
    '7': 70,
    '8': 80,
    '9': 90,
  },
};

/**
 * Per-player state management to avoid race conditions with multiple players
 */
interface PlayerState {
  feedbackOverlay: HTMLDivElement | null;
  feedbackTimeout: NodeJS.Timeout | null;
  lastEventTime: number;
  eventQueue: Map<string, number>;
}

const playerStates = new WeakMap<ExtendedPlayer, PlayerState>();

/**
 * Get or create player state
 */
function getPlayerState(player: ExtendedPlayer): PlayerState {
  let state = playerStates.get(player);
  if (!state) {
    state = {
      feedbackOverlay: null,
      feedbackTimeout: null,
      lastEventTime: 0,
      eventQueue: new Map(),
    };
    playerStates.set(player, state);
  }
  return state;
}

/**
 * Check if the current focused element is an input field
 * Prevents keyboard shortcuts from interfering with form inputs
 */
function isInputElement(element: Element | null): boolean {
  if (!element) return false;

  const tagName = element.tagName.toLowerCase();
  const isEditable = element.getAttribute('contenteditable') === 'true';

  return (
    tagName === 'input' ||
    tagName === 'textarea' ||
    tagName === 'select' ||
    isEditable
  );
}

/**
 * Show visual feedback overlay with message
 */
function showFeedback(message: string, player: ExtendedPlayer): void {
  const state = getPlayerState(player);

  // Get or create feedback overlay for this player
  if (!state.feedbackOverlay) {
    state.feedbackOverlay = document.createElement('div');
    state.feedbackOverlay.className = 'vjs-keyboard-feedback';
    state.feedbackOverlay.setAttribute('role', 'status');
    state.feedbackOverlay.setAttribute('aria-live', 'polite');
  }

  // Find player container
  const playerContainer = player.el();
  if (!playerContainer) return;

  // Clear existing timeout for this player
  if (state.feedbackTimeout) {
    clearTimeout(state.feedbackTimeout);
  }

  // Update message and show
  state.feedbackOverlay.textContent = message;
  state.feedbackOverlay.classList.remove('vjs-keyboard-feedback-hide');
  state.feedbackOverlay.classList.add('vjs-keyboard-feedback-show');

  // Append to player if not already there
  if (!playerContainer.contains(state.feedbackOverlay)) {
    playerContainer.appendChild(state.feedbackOverlay);
  }

  // Auto-hide after configured duration
  state.feedbackTimeout = setTimeout(() => {
    if (state.feedbackOverlay) {
      state.feedbackOverlay.classList.remove('vjs-keyboard-feedback-show');
      state.feedbackOverlay.classList.add('vjs-keyboard-feedback-hide');
    }
  }, FEEDBACK_DURATION_MS);
}

/**
 * Format time in MM:SS or HH:MM:SS
 */
function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Result of handling Picture-in-Picture toggle
 */
interface PiPToggleResult {
  handled: boolean;
  feedbackMessage: string;
  shouldReturn: boolean;
}

/**
 * Handle Picture-in-Picture toggle
 * Extracted from keyboard shortcut handler for improved readability and testability
 */
function handlePictureInPictureToggle(
  player: ExtendedPlayer,
  translations: ReturnType<typeof getTranslations>,
  enableFeedback: boolean
): PiPToggleResult {
  const videoElement = player.el().querySelector('video');

  if (videoElement && 'requestPictureInPicture' in videoElement) {
    if (document.pictureInPictureElement) {
      // Exit PiP mode
      document.exitPictureInPicture();
      return {
        handled: true,
        feedbackMessage: translations.controls.exitPictureInPicture,
        shouldReturn: false
      };
    } else {
      // Enter PiP mode (async operation)
      (videoElement as HTMLVideoElement)
        .requestPictureInPicture()
        .then(() => {
          if (enableFeedback) {
            showFeedback(translations.controls.pictureInPicture, player);
          }
        })
        .catch(() => {
          if (enableFeedback) {
            showFeedback(translations.controls.pipNotAvailable, player);
          }
        });
      // Feedback handled in promise callbacks - early return
      return {
        handled: true,
        feedbackMessage: '',
        shouldReturn: true
      };
    }
  } else {
    // PiP not supported
    return {
      handled: true,
      feedbackMessage: translations.controls.pipNotSupported,
      shouldReturn: false
    };
  }
}

/**
 * Add help button to video player control bar
 */
export function addHelpButton(
  player: ExtendedPlayer,
  onShowHelp: () => void,
  lang: SupportedLanguage = 'en'
): () => void {
  const playerElement = player.el();
  if (!playerElement) return () => {};

  // Find control bar
  const controlBar = playerElement.querySelector('.vjs-control-bar') as HTMLElement;
  if (!controlBar) {
    logger.warn('[KeyboardShortcuts] Control bar not found, cannot add help button');
    return () => {};
  }

  // Create help button
  const helpButton = document.createElement('button');
  helpButton.className = 'vjs-keyboard-help-button vjs-control vjs-button';
  helpButton.setAttribute('type', 'button');
  helpButton.setAttribute('aria-label', lang === 'ar' ? 'عرض اختصارات لوحة المفاتيح' : 'Show keyboard shortcuts');
  helpButton.setAttribute('title', lang === 'ar' ? 'اختصارات لوحة المفاتيح (?)' : 'Keyboard shortcuts (?)');

  // Add click handler
  helpButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    onShowHelp();
  });

  // Insert button before fullscreen button (if exists) or at the end
  const fullscreenButton = controlBar.querySelector('.vjs-fullscreen-control');
  if (fullscreenButton) {
    controlBar.insertBefore(helpButton, fullscreenButton);
  } else {
    controlBar.appendChild(helpButton);
  }

  logger.info('[KeyboardShortcuts] Help button added to control bar');

  // Return cleanup function
  return () => {
    if (helpButton.parentNode) {
      helpButton.parentNode.removeChild(helpButton);
    }
  };
}

/**
 * Setup keyboard shortcuts for a video player
 *
 * @param player - Video.js player instance
 * @param options - Configuration options
 * @returns Cleanup function to remove event listeners
 */
export function setupKeyboardShortcuts(
  player: ExtendedPlayer,
  options: KeyboardShortcutsOptions = {}
): () => void {
  const {
    onShowHelp,
    lang = 'en',
    showFeedback: enableFeedback = true,
    customBindings,
  } = options;

  const translations = getTranslations(lang);
  const rtl = isRTL(lang);

  // Swap arrow keys for RTL mode
  // In RTL, left arrow should go forward and right arrow should go backward
  const bindings: KeyBindings = rtl
    ? {
        ...DEFAULT_KEY_BINDINGS,
        rewind: ['ArrowRight', 'j', 'J'], // Swap: right arrow rewinds in RTL
        forward: ['ArrowLeft', 'l', 'L'], // Swap: left arrow forwards in RTL
        ...customBindings,
      }
    : { ...DEFAULT_KEY_BINDINGS, ...customBindings };

  /**
   * Handle keyboard events with security validation
   * Wrapped in try-catch to prevent errors from propagating to global scope
   */
  function handleKeyDown(event: KeyboardEvent): void {
    try {
      const state = getPlayerState(player);
      const now = Date.now();

      // Security: Validate event is trusted (prevents event injection)
      if (!event.isTrusted) {
        logger.warn('[KeyboardShortcuts] Ignoring untrusted event');
        return;
      }

      // Security: Rate limiting to prevent event flooding attacks
      if (now - state.lastEventTime < EVENT_RATE_LIMIT_MS) {
        return; // Rate limited
      }
      state.lastEventTime = now;

      // Security: Prevent event queue overflow
      if (state.eventQueue.size >= MAX_EVENT_QUEUE_SIZE) {
        state.eventQueue.clear();
      }
      state.eventQueue.set(event.key, now);

      // Don't handle if focus is on an input element
      if (isInputElement(document.activeElement)) {
        return;
      }

      const key = event.key;
      let handled = false;
      let feedbackMessage = '';

      // Play/Pause (Space, K)
    if (bindings.playPause.includes(key)) {
      event.preventDefault();
      if (player.paused()) {
        player.play();
        feedbackMessage = translations.controls.play;
      } else {
        player.pause();
        feedbackMessage = translations.controls.pause;
      }
      handled = true;
    }

    // Rewind (Arrow Left, J)
    else if (bindings.rewind.includes(key)) {
      event.preventDefault();
      const rewindAmount = key === 'ArrowLeft' ? ARROW_REWIND_SECONDS : J_REWIND_SECONDS;
      const currentTime = player.currentTime() || 0;
      const newTime = Math.max(0, currentTime - rewindAmount);
      player.currentTime(newTime);
      feedbackMessage = `-${rewindAmount}s (${formatTime(newTime)})`;
      handled = true;
    }

    // Forward (Arrow Right, L)
    else if (bindings.forward.includes(key)) {
      event.preventDefault();
      const forwardAmount = key === 'ArrowRight' ? ARROW_FORWARD_SECONDS : L_FORWARD_SECONDS;
      const currentTime = player.currentTime() || 0;
      const duration = player.duration() || 0;
      const newTime = Math.min(duration, currentTime + forwardAmount);
      player.currentTime(newTime);
      feedbackMessage = `+${forwardAmount}s (${formatTime(newTime)})`;
      handled = true;
    }

    // Volume Up (Arrow Up)
    else if (bindings.volumeUp.includes(key)) {
      event.preventDefault();
      const currentVolume = player.volume();
      const newVolume = Math.min(1, currentVolume + VOLUME_STEP);
      player.volume(newVolume);
      feedbackMessage = `${translations.controls.volume}: ${Math.round(newVolume * PERCENT_MULTIPLIER)}%`;
      handled = true;
    }

    // Volume Down (Arrow Down)
    else if (bindings.volumeDown.includes(key)) {
      event.preventDefault();
      const currentVolume = player.volume();
      const newVolume = Math.max(0, currentVolume - VOLUME_STEP);
      player.volume(newVolume);
      feedbackMessage = `${translations.controls.volume}: ${Math.round(newVolume * PERCENT_MULTIPLIER)}%`;
      handled = true;
    }

    // Mute/Unmute (M)
    else if (bindings.mute.includes(key)) {
      event.preventDefault();
      if (player.muted()) {
        player.muted(false);
        feedbackMessage = translations.controls.unmute;
      } else {
        player.muted(true);
        feedbackMessage = translations.controls.mute;
      }
      handled = true;
    }

    // Fullscreen (F)
    else if (bindings.fullscreen.includes(key)) {
      event.preventDefault();
      if (player.isFullscreen()) {
        player.exitFullscreen();
        feedbackMessage = translations.controls.exitFullscreen;
      } else {
        player.requestFullscreen();
        feedbackMessage = translations.controls.fullscreen;
      }
      handled = true;
    }

    // Picture-in-Picture (P)
    else if (bindings.pip.includes(key)) {
      event.preventDefault();
      const pipResult = handlePictureInPictureToggle(player, translations, enableFeedback);
      handled = pipResult.handled;
      feedbackMessage = pipResult.feedbackMessage;
      if (pipResult.shouldReturn) {
        return; // Early return for async PiP entry
      }
    }

    // Speed Decrease (<, ,)
    else if (bindings.speedDecrease.includes(key)) {
      event.preventDefault();
      const currentRate = player.playbackRate();
      const newRate = Math.max(MIN_PLAYBACK_RATE, currentRate - PLAYBACK_RATE_STEP);
      player.playbackRate(newRate);
      feedbackMessage = `${translations.controls.speed}: ${newRate}x`;
      handled = true;
    }

    // Speed Increase (>, .)
    else if (bindings.speedIncrease.includes(key)) {
      event.preventDefault();
      const currentRate = player.playbackRate();
      const newRate = Math.min(MAX_PLAYBACK_RATE, currentRate + PLAYBACK_RATE_STEP);
      player.playbackRate(newRate);
      feedbackMessage = `${translations.controls.speed}: ${newRate}x`;
      handled = true;
    }

    // Help (?)
    else if (bindings.help.includes(key)) {
      event.preventDefault();
      if (onShowHelp) {
        onShowHelp();
      }
      handled = true;
    }

    // Seek to percentage (0-9)
    else if (key in bindings.seek) {
      event.preventDefault();
      const percentage = bindings.seek[key];
      const duration = player.duration() || 0;
      const newTime = (duration * percentage) / PERCENT_MULTIPLIER;
      player.currentTime(newTime);
      feedbackMessage = `${percentage}% (${formatTime(newTime)})`;
      handled = true;
    }

      // Show visual feedback if enabled and action was handled
      if (handled && enableFeedback && feedbackMessage) {
        showFeedback(feedbackMessage, player);
      }
    } catch (error) {
      // Log error but prevent propagation to global scope
      logger.error('[KeyboardShortcuts] Error handling keyboard event:', error);
      // Optionally notify user of error (silent failure for better UX)
      // Could show error feedback here if desired
    }
  }

  // Get player element for scoped event listening
  const playerElement = player.el();
  if (!playerElement) {
    logger.error('[KeyboardShortcuts] Player element not found');
    return () => {}; // Return no-op cleanup
  }

  // Add help button if callback provided
  let helpButtonCleanup: (() => void) | undefined;
  if (onShowHelp) {
    helpButtonCleanup = addHelpButton(player, onShowHelp, lang);
  }

  // Add scoped event listener to player element (not global document)
  playerElement.addEventListener('keydown', handleKeyDown);

  // Also add to document for when player is in fullscreen but maintain security validation
  document.addEventListener('keydown', handleKeyDown);

  // Return cleanup function
  return () => {
    // Remove scoped event listeners
    playerElement.removeEventListener('keydown', handleKeyDown);
    document.removeEventListener('keydown', handleKeyDown);

    // Cleanup help button
    if (helpButtonCleanup) {
      helpButtonCleanup();
    }

    // Cleanup feedback overlay for this player
    const state = getPlayerState(player);
    if (state.feedbackTimeout) {
      clearTimeout(state.feedbackTimeout);
      state.feedbackTimeout = null;
    }
    if (state.feedbackOverlay && state.feedbackOverlay.parentNode) {
      state.feedbackOverlay.parentNode.removeChild(state.feedbackOverlay);
      state.feedbackOverlay = null;
    }
    
    // Cleanup event queue
    state.eventQueue.clear();
    
    // Note: WeakMap automatically cleans up when player is garbage collected
  };
}

/**
 * Get default key bindings
 * Useful for displaying in help modal
 */
export function getDefaultKeyBindings(): KeyBindings {
  return { ...DEFAULT_KEY_BINDINGS };
}

/**
 * Format key for display (e.g., "ArrowLeft" -> "←")
 */
export function formatKeyForDisplay(key: string): string {
  const keyMap: Record<string, string> = {
    ' ': 'Space',
    'ArrowLeft': '←',
    'ArrowRight': '→',
    'ArrowUp': '↑',
    'ArrowDown': '↓',
  };

  return keyMap[key] || key.toUpperCase();
}
