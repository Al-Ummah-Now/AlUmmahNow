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

/**
 * Mobile Touch Handler State
 */
interface TouchState {
  lastTapTime: number;
  lastTapX: number;
  touchStartY: number;
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
    lastTapTime: 0,
    lastTapX: 0,
    touchStartY: 0,
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
    console.warn('[MobileTouchControls] Player element not found');
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
    const touch = event.touches[0];

    // Store initial touch position for swipe detection
    state.touchStartY = touch.clientY;
    state.touchStartVolume = player.volume();

    // Start long press timer if enabled
    if (config.enableLongPress) {
      state.isLongPress = false;
      state.longPressTimer = setTimeout(() => {
        handleLongPress();
      }, config.longPressDuration);
    }
  }

  /**
   * Touch move handler
   */
  function onTouchMove(event: TouchEvent): void {
    // Cancel long press if finger moves
    if (state.longPressTimer) {
      clearTimeout(state.longPressTimer);
      state.longPressTimer = null;
    }

    // Handle volume swipe if enabled
    if (config.enableSwipeVolume) {
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
    // Clear long press timer
    if (state.longPressTimer) {
      clearTimeout(state.longPressTimer);
      state.longPressTimer = null;
    }

    // Skip if this was a long press
    if (state.isLongPress) {
      state.isLongPress = false;
      return;
    }

    // Handle double-tap if enabled
    if (config.enableDoubleTap) {
      const touch = event.changedTouches[0];
      const now = Date.now();
      const timeSinceLast = now - state.lastTapTime;
      const x = touch.clientX;

      // Check if this is a double-tap (same location within threshold)
      const isSameLocation = Math.abs(x - state.lastTapX) < 50;
      const isWithinThreshold = timeSinceLast > 0 && timeSinceLast < config.doubleTapThreshold;

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

  /**
   * Prevent context menu on long press
   */
  function onContextMenu(event: Event): void {
    event.preventDefault();
  }

  // Add event listeners
  playerElement.addEventListener('touchstart', onTouchStart, { passive: true });
  playerElement.addEventListener('touchmove', onTouchMove, { passive: false });
  playerElement.addEventListener('touchend', onTouchEnd, { passive: false });
  playerElement.addEventListener('contextmenu', onContextMenu);

  // Return cleanup function
  return () => {
    // Remove event listeners
    playerElement.removeEventListener('touchstart', onTouchStart);
    playerElement.removeEventListener('touchmove', onTouchMove);
    playerElement.removeEventListener('touchend', onTouchEnd);
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
