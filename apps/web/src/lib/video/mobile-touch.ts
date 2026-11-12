/**
 * Mobile Touch Controls Handler
 *
 * Implements mobile-optimized touch gestures for video playback:
 * - Double-tap left/right for seek (±10s)
 * - Swipe up/down for volume control
 * - Single tap to toggle controls visibility
 * - Long press for playback speed menu
 * - Visual feedback animations
 *
 * Gestures belong to the video surface only. A touch that starts on a control (the bar, the big
 * play button, a menu, an overlay button) is that control's alone: before, two quick taps on the
 * bar's play button also counted as a double tap and seeked 10s back, a slow tap on it changed the
 * speed and still paused, and a finger on the half-scrolled player could not scroll the page
 * because every vertical move was taken for the volume swipe. The volume swipe now runs only in
 * fullscreen, where there is no page to scroll; inline, a vertical drag scrolls the page.
 *
 * Features:
 * - Touch zones: left (rewind), center (play/pause), right (forward)
 * - Smooth volume control via vertical swipe
 * - Debounced touch handling to prevent conflicts
 * - Accessibility-friendly with screen reader announcements
 * - Works on iOS Safari and Android Chrome
 *
 * @example
 * ```typescript
 * const cleanup = setupMobileTouchControls(player);
 * // Later, cleanup when component unmounts
 * cleanup();
 * ```
 */

import type { ExtendedPlayer } from './videojs';
import { logger } from '@/lib/logger-client';


/**
 * Configuration options for mobile touch controls
 */
export interface MobileTouchOptions {
  /**
   * Enable/disable double-tap seek gesture
   */
  enableDoubleTap?: boolean;

  /**
   * Enable/disable swipe volume control
   */
  enableSwipeVolume?: boolean;

  /**
   * Enable/disable long press for speed control
   */
  enableLongPress?: boolean;

  /**
   * Double-tap timeout in milliseconds
   */
  doubleTapThreshold?: number;

  /**
   * Long press duration in milliseconds
   */
  longPressDuration?: number;

  /**
   * Swipe sensitivity (pixels per volume unit)
   */
  swipeSensitivity?: number;
}

/**
 * Default configuration
 */
const DEFAULT_OPTIONS: Required<MobileTouchOptions> = {
  enableDoubleTap: true,
  enableSwipeVolume: true,
  enableLongPress: true,
  doubleTapThreshold: 300,
  longPressDuration: 500,
  swipeSensitivity: 200,
};

/** How far (px) a finger may shake and still be tapping */
const MOVE_SLOP = 10;

/**
 * Mobile Touch Handler State
 */
interface TouchState {
  /** The current touch started on the video surface (not on a control) */
  tracking: boolean;
  lastTapTime: number;
  lastTapX: number;
  touchStartX: number;
  touchStartY: number;
  /** The finger moved past MOVE_SLOP: a drag, not a tap or a long press */
  moved: boolean;
  touchStartVolume: number;
  longPressTimer: ReturnType<typeof setTimeout> | null;
  isLongPress: boolean;
}

/**
 * Touch feedback position
 */
type FeedbackPosition = 'left' | 'right' | 'center';

/**
 * Setup mobile touch controls for video player
 *
 * @param player - Video.js player instance
 * @param options - Configuration options
 * @returns Cleanup function to remove event listeners
 */
export function setupMobileTouchControls(
  player: ExtendedPlayer,
  options: MobileTouchOptions = {}
): () => void {
  const config = { ...DEFAULT_OPTIONS, ...options };

  // Touch state management
  const state: TouchState = {
    tracking: false,
    lastTapTime: 0,
    lastTapX: 0,
    touchStartX: 0,
    touchStartY: 0,
    moved: false,
    touchStartVolume: 0,
    longPressTimer: null,
    isLongPress: false,
  };

  // Track active feedback elements and timers for cleanup
  const activeFeedbackElements: HTMLElement[] = [];
  const activeTimers: ReturnType<typeof setTimeout>[] = [];

  // Get player element
  const playerElement = player.el();
  if (!playerElement) {
    logger.warn('[MobileTouchControls] Player element not found');
    return () => {};
  }

  /**
   * Show visual feedback overlay
   */
  function showFeedback(text: string, position: FeedbackPosition): void {
    // Create feedback element
    const feedback = document.createElement('div');
    feedback.className = `vjs-mobile-touch-feedback vjs-mobile-touch-feedback-${position}`;
    feedback.textContent = text;
    feedback.setAttribute('role', 'status');
    feedback.setAttribute('aria-live', 'polite');

    // Append to player
    playerElement.appendChild(feedback);
    activeFeedbackElements.push(feedback);

    // Trigger animation
    requestAnimationFrame(() => {
      feedback.classList.add('vjs-mobile-touch-feedback-show');
    });

    // Remove after animation
    const timer1 = setTimeout(() => {
      feedback.classList.remove('vjs-mobile-touch-feedback-show');
      feedback.classList.add('vjs-mobile-touch-feedback-hide');

      const timer2 = setTimeout(() => {
        feedback.remove();
        const index = activeFeedbackElements.indexOf(feedback);
        if (index > -1) {
          activeFeedbackElements.splice(index, 1);
        }
      }, 300);
      activeTimers.push(timer2);
    }, 1000);
    activeTimers.push(timer1);
  }

  /**
   * Handle double-tap seek
   */
  function handleDoubleTap(x: number): void {
    const rect = playerElement.getBoundingClientRect();
    const width = rect.width;
    const relativeX = x - rect.left;

    // Determine zone (left third, center third, right third)
    if (relativeX < width / 3) {
      // Left zone: rewind 10s
      const currentTime = player.currentTime() || 0;
      const newTime = Math.max(0, currentTime - 10);
      player.currentTime(newTime);
      showFeedback('⏪ -10s', 'left');
    } else if (relativeX > (width * 2) / 3) {
      // Right zone: forward 10s
      const currentTime = player.currentTime() || 0;
      const duration = player.duration() || 0;
      const newTime = Math.min(duration, currentTime + 10);
      player.currentTime(newTime);
      showFeedback('⏩ +10s', 'right');
    } else {
      // Center zone: play/pause
      if (player.paused()) {
        player.play();
        showFeedback('▶', 'center');
      } else {
        player.pause();
        showFeedback('⏸', 'center');
      }
    }
  }

  /**
   * Handle volume swipe
   */
  function handleVolumeSwipe(deltaY: number): void {
    const volumeChange = deltaY / config.swipeSensitivity;
    const newVolume = Math.max(0, Math.min(1, state.touchStartVolume + volumeChange));
    player.volume(newVolume);

    // Show volume percentage
    const volumePercent = Math.round(newVolume * 100);
    showFeedback(`🔊 ${volumePercent}%`, 'center');
  }

  /**
   * Handle long press for playback speed
   */
  function handleLongPress(): void {
    state.isLongPress = true;
    // Cycle through playback speeds: 0.5x, 0.75x, 1x, 1.25x, 1.5x, 2x
    const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
    const currentSpeed = player.playbackRate();
    const currentIndex = speeds.indexOf(currentSpeed);
    const nextIndex = (currentIndex + 1) % speeds.length;
    const nextSpeed = speeds[nextIndex];

    player.playbackRate(nextSpeed);
    showFeedback(`⚡ ${nextSpeed}x`, 'center');
  }

  /**
   * Touch start handler
   */
  function onTouchStart(event: TouchEvent): void {
    clearLongPress();
    state.isLongPress = false;
    // A second finger, or a touch on a control, is not a surface gesture
    state.tracking = event.touches.length === 1 && isVideoSurface(event.target);
    if (!state.tracking) {
      state.lastTapTime = 0;
      return;
    }
    const touch = event.touches[0];

    // Store initial touch position for swipe detection
    state.moved = false;
    state.touchStartX = touch.clientX;
    state.touchStartY = touch.clientY;
    state.touchStartVolume = player.volume();

    // Start long press timer if enabled
    if (config.enableLongPress) {
      state.longPressTimer = setTimeout(() => {
        handleLongPress();
      }, config.longPressDuration);
    }
  }

  /**
   * Touch move handler
   */
  function onTouchMove(event: TouchEvent): void {
    if (!state.tracking) return;
    const moving = event.touches[0];
    // A finger always shakes a little: only a real move is a drag
    if (!state.moved && Math.hypot(moving.clientX - state.touchStartX, moving.clientY - state.touchStartY) < MOVE_SLOP) return;
    state.moved = true;
    // A drag is neither a long press nor a tap
    clearLongPress();
    state.lastTapTime = 0;

    // Volume swipe only in fullscreen: inline, a vertical drag scrolls the page
    if (config.enableSwipeVolume && player.isFullscreen()) {
      const touch = event.touches[0];
      const deltaY = state.touchStartY - touch.clientY;

      // Only handle vertical swipes (prevent horizontal scroll interference)
      if (Math.abs(deltaY) > 10) {
        event.preventDefault();
        handleVolumeSwipe(deltaY);
      }
    }
  }

  /**
   * Touch end handler
   */
  function onTouchEnd(event: TouchEvent): void {
    clearLongPress();
    if (!state.tracking) return;
    state.tracking = false;

    // A long press already acted: its release must not also tap (play/pause, show controls)
    if (state.isLongPress) {
      state.isLongPress = false;
      if (event.cancelable) event.preventDefault();
      return;
    }

    // Handle double-tap if enabled (a drag is no tap)
    if (config.enableDoubleTap && !state.moved) {
      const touch = event.changedTouches[0];
      const now = Date.now();
      const timeSinceLast = now - state.lastTapTime;
      const x = touch.clientX;

      // Check if this is a double-tap (same location within threshold)
      const isSameLocation = Math.abs(x - state.lastTapX) < 50;
      const isWithinThreshold = state.lastTapTime > 0 && timeSinceLast > 0 && timeSinceLast < config.doubleTapThreshold;

      if (isSameLocation && isWithinThreshold) {
        event.preventDefault();
        handleDoubleTap(x);
        // Reset tap timer to prevent triple-tap
        state.lastTapTime = 0;
      } else {
        // Store this tap for next comparison
        state.lastTapTime = now;
        state.lastTapX = x;
      }
    }
  }

  /** The browser took the touch (a scroll, a system gesture): nothing to finish */
  function onTouchCancel(): void {
    clearLongPress();
    state.tracking = false;
    state.isLongPress = false;
    state.lastTapTime = 0;
  }

  function clearLongPress(): void {
    if (state.longPressTimer) {
      clearTimeout(state.longPressTimer);
      state.longPressTimer = null;
    }
  }

  /**
   * Prevent context menu on long press
   */
  function onContextMenu(event: Event): void {
    if (isVideoSurface(event.target)) event.preventDefault();
  }

  // Add event listeners
  playerElement.addEventListener('touchstart', onTouchStart, { passive: true });
  playerElement.addEventListener('touchmove', onTouchMove, { passive: false });
  playerElement.addEventListener('touchend', onTouchEnd, { passive: false });
  playerElement.addEventListener('touchcancel', onTouchCancel, { passive: true });
  playerElement.addEventListener('contextmenu', onContextMenu);

  // Return cleanup function
  return () => {
    // Remove event listeners
    playerElement.removeEventListener('touchstart', onTouchStart);
    playerElement.removeEventListener('touchmove', onTouchMove);
    playerElement.removeEventListener('touchend', onTouchEnd);
    playerElement.removeEventListener('touchcancel', onTouchCancel);
    playerElement.removeEventListener('contextmenu', onContextMenu);

    // Clear long press timer
    if (state.longPressTimer) {
      clearTimeout(state.longPressTimer);
    }

    // Clear all active feedback timers
    activeTimers.forEach(timer => clearTimeout(timer));

    // Remove all active feedback elements
    activeFeedbackElements.forEach(element => {
      if (element.parentNode) {
        element.remove();
      }
    });
  };
}

/**
 * Controls and overlays inside the player: a touch on any of them is the control's, never a gesture
 */
const CONTROL_SELECTOR = [
  '.vjs-control-bar',
  '.vjs-control',
  '.vjs-big-play-button',
  '.vjs-menu',
  '.vjs-modal-dialog',
  'button',
  'a',
  'input',
  'select',
  'textarea',
  '[role="button"]',
  '[role="slider"]',
  '[role="menu"]',
  '[role="menuitem"]',
  '[role="menuitemradio"]',
  '[role="dialog"]',
].join(',');

/** True when a touch on this target is a gesture on the video itself */
export function isVideoSurface(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== 'function') return false;
  return (target as Element).closest(CONTROL_SELECTOR) === null;
}

/**
 * Detect if device is mobile
 * Used to conditionally enable mobile touch controls
 *
 * @returns True if device is likely mobile
 */
export function isMobileDevice(): boolean {
  // Check user agent for mobile indicators
  const userAgent = navigator.userAgent || navigator.vendor || (window as { opera?: string }).opera || '';
  const mobileRegex = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i;

  // Check touch support
  const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

  // Check screen width (mobile typically < 768px)
  const isSmallScreen = window.innerWidth < 768;

  return mobileRegex.test(userAgent) || (hasTouch && isSmallScreen);
}
