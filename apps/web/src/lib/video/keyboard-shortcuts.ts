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

import type { ExtendedPlayer } from './videojs.d';
import { getTranslations, type SupportedLanguage } from './i18n';

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

  // Auto-hide after 1 second
  state.feedbackTimeout = setTimeout(() => {
    if (state.feedbackOverlay) {
      state.feedbackOverlay.classList.remove('vjs-keyboard-feedback-show');
      state.feedbackOverlay.classList.add('vjs-keyboard-feedback-hide');
    }
  }, 1000);
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
 * Setup keyboard shortcuts for video player
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
  const bindings = { ...DEFAULT_KEY_BINDINGS, ...customBindings };

  /**
   * Handle keyboard events
   */
  function handleKeyDown(event: KeyboardEvent): void {
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

    // Rewind (Arrow Left, J) - 5 seconds for arrow, 10 for J
    else if (bindings.rewind.includes(key)) {
      event.preventDefault();
      const rewindAmount = key === 'ArrowLeft' ? 5 : 10;
      const currentTime = player.currentTime() || 0;
      const newTime = Math.max(0, currentTime - rewindAmount);
      player.currentTime(newTime);
      feedbackMessage = `-${rewindAmount}s (${formatTime(newTime)})`;
      handled = true;
    }

    // Forward (Arrow Right, L) - 5 seconds for arrow, 10 for L
    else if (bindings.forward.includes(key)) {
      event.preventDefault();
      const forwardAmount = key === 'ArrowRight' ? 5 : 10;
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
      const newVolume = Math.min(1, currentVolume + 0.1);
      player.volume(newVolume);
      feedbackMessage = `${translations.controls.volume}: ${Math.round(newVolume * 100)}%`;
      handled = true;
    }

    // Volume Down (Arrow Down)
    else if (bindings.volumeDown.includes(key)) {
      event.preventDefault();
      const currentVolume = player.volume();
      const newVolume = Math.max(0, currentVolume - 0.1);
      player.volume(newVolume);
      feedbackMessage = `${translations.controls.volume}: ${Math.round(newVolume * 100)}%`;
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
      const videoElement = player.el().querySelector('video');
      if (videoElement && 'requestPictureInPicture' in videoElement) {
        if (document.pictureInPictureElement) {
          document.exitPictureInPicture();
          feedbackMessage = translations.controls.exitPictureInPicture;
        } else {
          (videoElement as HTMLVideoElement)
            .requestPictureInPicture()
            .catch(() => {
              feedbackMessage = translations.controls.pipNotAvailable;
            });
          feedbackMessage = translations.controls.pictureInPicture;
        }
      } else {
        feedbackMessage = translations.controls.pipNotSupported;
      }
      handled = true;
    }

    // Speed Decrease (<, ,)
    else if (bindings.speedDecrease.includes(key)) {
      event.preventDefault();
      const currentRate = player.playbackRate();
      const newRate = Math.max(0.25, currentRate - 0.25);
      player.playbackRate(newRate);
      feedbackMessage = `${translations.controls.speed}: ${newRate}x`;
      handled = true;
    }

    // Speed Increase (>, .)
    else if (bindings.speedIncrease.includes(key)) {
      event.preventDefault();
      const currentRate = player.playbackRate();
      const newRate = Math.min(2, currentRate + 0.25);
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
      const newTime = (duration * percentage) / 100;
      player.currentTime(newTime);
      feedbackMessage = `${percentage}% (${formatTime(newTime)})`;
      handled = true;
    }

    // Show visual feedback if enabled and action was handled
    if (handled && enableFeedback && feedbackMessage) {
      showFeedback(feedbackMessage, player);
    }
  }

  // Add event listener
  document.addEventListener('keydown', handleKeyDown);

  // Return cleanup function
  return () => {
    document.removeEventListener('keydown', handleKeyDown);

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
