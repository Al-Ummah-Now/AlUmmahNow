/**
 * Fullscreen and Picture-in-Picture (PiP) Utilities
 *
 * Phase 2.6: Fullscreen and PiP Modes
 *
 * Features:
 * - Double-click to toggle fullscreen
 * - Browser compatibility detection
 * - iOS fullscreen support
 * - PiP availability detection
 * - Orientation lock on mobile (landscape)
 * - Exit fullscreen on video end
 */

import type { ExtendedPlayer } from './videojs';

/**
 * Screen Orientation Lock type
 */
type OrientationLockType = 'portrait' | 'landscape' | 'portrait-primary' | 'portrait-secondary' | 'landscape-primary' | 'landscape-secondary';

/**
 * Extended ScreenOrientation interface with lock method
 */
interface ScreenOrientationWithLock extends ScreenOrientation {
  lock(orientation: OrientationLockType): Promise<void>;
}

/**
 * Check if Picture-in-Picture is supported by the browser
 */
export function isPictureInPictureSupported(): boolean {
  return 'pictureInPictureEnabled' in document;
}

/**
 * Check if the device is iOS
 */
export function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

/**
 * Check if screen orientation API is available
 */
export function isOrientationLockSupported(): boolean {
  return 'orientation' in screen && 'lock' in screen.orientation;
}

/**
 * Setup double-click fullscreen toggle
 *
 * @param player - Video.js player instance
 */
export function setupDoubleClickFullscreen(player: ExtendedPlayer): void {
  player.on('dblclick', () => {
    if (player.isFullscreen()) {
      player.exitFullscreen();
    } else {
      player.requestFullscreen();
    }
  });
}

/**
 * Lock screen orientation to landscape when entering fullscreen
 * Only works on mobile devices with Screen Orientation API support
 *
 * @param isFullscreen - Whether the player is in fullscreen mode
 */
export async function lockOrientationLandscape(isFullscreen: boolean): Promise<void> {
  if (!isFullscreen || !isOrientationLockSupported()) {
    return;
  }

  try {
    // Lock to landscape mode when entering fullscreen
    await (screen.orientation as ScreenOrientationWithLock).lock('landscape');
  } catch (error) {
    // Orientation lock may fail due to:
    // - Browser policy (user gesture required)
    // - Device doesn't support orientation lock
    // - Already locked
    // This is non-critical, so we just log and continue
    console.debug('[FullscreenPiP] Orientation lock failed:', error);
  }
}

/**
 * Setup iOS fullscreen handling
 *
 * iOS Safari has different fullscreen behavior and requires special handling.
 * The native video element has webkit-specific fullscreen methods.
 *
 * @param player - Video.js player instance
 */
export function setupIOSFullscreen(player: ExtendedPlayer): void {
  if (!isIOS()) {
    return;
  }

  const videoElement = player.el().querySelector('video') as HTMLVideoElement & {
    webkitEnterFullscreen?: () => void;
    webkitExitFullscreen?: () => void;
  };

  if (!videoElement) {
    return;
  }

  // Hook into webkit fullscreen events to trigger Video.js fullscreen events
  videoElement.addEventListener('webkitbeginfullscreen', () => {
    player.trigger('fullscreenchange');
  });

  videoElement.addEventListener('webkitendfullscreen', () => {
    player.trigger('fullscreenchange');
  });
}

/**
 * Hide Picture-in-Picture button if not supported
 *
 * @param player - Video.js player instance
 */
export function hidePiPButtonIfUnsupported(player: ExtendedPlayer): void {
  if (!isPictureInPictureSupported()) {
    const pipButton = player.controlBar.pictureInPictureToggle;
    if (pipButton) {
      pipButton.hide();
    }
  }
}

/**
 * Setup exit fullscreen on video end
 *
 * @param player - Video.js player instance
 */
export function setupExitFullscreenOnEnd(player: ExtendedPlayer): void {
  player.on('ended', () => {
    if (player.isFullscreen()) {
      player.exitFullscreen();
    }
  });
}

/**
 * Setup all fullscreen and PiP features
 *
 * This is a convenience function that sets up all fullscreen and PiP features:
 * - Double-click fullscreen toggle
 * - iOS fullscreen handling
 * - Hide PiP button if unsupported
 * - Exit fullscreen on video end
 *
 * Note: Event listeners for analytics tracking should be set up separately
 * in the component to maintain separation of concerns.
 *
 * @param player - Video.js player instance
 */
export function setupFullscreenPiP(player: ExtendedPlayer): void {
  // Setup double-click fullscreen
  setupDoubleClickFullscreen(player);

  // Setup iOS fullscreen handling
  setupIOSFullscreen(player);

  // Hide PiP button if not supported
  hidePiPButtonIfUnsupported(player);

  // Exit fullscreen on video end
  setupExitFullscreenOnEnd(player);
}
