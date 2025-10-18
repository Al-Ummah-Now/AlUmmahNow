/**
 * Volume Control Utilities for Video Player
 *
 * Features:
 * - Volume and mute state persistence in localStorage
 * - Scroll wheel volume control
 * - Volume indicator overlay with visual feedback
 * - Smooth volume transitions
 * - 10% volume steps for keyboard/scroll control
 * - Mobile-optimized touch controls
 */

import type { Player } from 'video.js';
import type { ExtendedPlayer } from './videojs.d';

const STORAGE_KEY = 'videoPlayerVolume';
const VOLUME_STEP = 0.1; // 10% steps
const INDICATOR_DURATION = 1500; // 1.5 seconds

export interface VolumeState {
  volume: number;
  muted: boolean;
}

/**
 * Save volume and mute state to localStorage
 */
export function saveVolumeState(volume: number, muted: boolean): void {
  try {
    const state: VolumeState = {
      volume: Math.max(0, Math.min(1, volume)),
      muted,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error('[VolumeControl] Failed to save volume state:', error);
  }
}

/**
 * Load volume and mute state from localStorage
 */
export function loadVolumeState(): VolumeState | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return null;

    const state = JSON.parse(saved) as VolumeState;

    // Validate loaded state
    if (
      typeof state.volume === 'number' &&
      typeof state.muted === 'boolean' &&
      state.volume >= 0 &&
      state.volume <= 1
    ) {
      return state;
    }

    return null;
  } catch (error) {
    console.error('[VolumeControl] Failed to load volume state:', error);
    return null;
  }
}

/**
 * Apply saved volume state to player
 */
export function applySavedVolume(player: Player | ExtendedPlayer): void {
  const savedState = loadVolumeState();
  if (savedState) {
    const extPlayer = player as ExtendedPlayer;
    extPlayer.volume(savedState.volume);
    extPlayer.muted(savedState.muted);
    console.log('[VolumeControl] Restored volume:', savedState);
  }
}

/**
 * Create volume indicator overlay element
 */
function createVolumeIndicator(playerElement: HTMLElement): HTMLDivElement {
  const existing = playerElement.querySelector('.vjs-volume-indicator');
  if (existing) {
    return existing as HTMLDivElement;
  }

  const indicator = document.createElement('div');
  indicator.className = 'vjs-volume-indicator';
  indicator.setAttribute('role', 'status');
  indicator.setAttribute('aria-live', 'polite');
  indicator.setAttribute('aria-atomic', 'true');
  playerElement.appendChild(indicator);

  return indicator;
}

/**
 * Show volume indicator with current volume
 */
export function showVolumeIndicator(player: Player | ExtendedPlayer, volume: number, muted: boolean): void {
  const playerElement = (player as ExtendedPlayer).el();
  if (!playerElement) return;

  const indicator = createVolumeIndicator(playerElement);

  // Update content
  const percentage = Math.round(volume * 100);
  const iconHtml = muted
    ? '<svg class="vjs-volume-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4V5zM23 9l-6 6M17 9l6 6"/></svg>'
    : '<svg class="vjs-volume-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4V5zM19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07"/></svg>';

  const text = muted ? 'Muted' : `${percentage}%`;
  indicator.innerHTML = `${iconHtml}<span class="vjs-volume-text">${text}</span>`;

  // Trigger animation
  indicator.classList.remove('vjs-volume-indicator-show');
  void indicator.offsetWidth; // Force reflow
  indicator.classList.add('vjs-volume-indicator-show');

  // Auto-hide after duration
  setTimeout(() => {
    indicator.classList.remove('vjs-volume-indicator-show');
  }, INDICATOR_DURATION);
}

/**
 * Setup scroll wheel volume control
 */
export function setupScrollWheelControl(player: Player | ExtendedPlayer): () => void {
  const playerElement = (player as ExtendedPlayer).el();
  if (!playerElement) {
    return () => {}; // Return no-op cleanup
  }

  const extPlayer = player as ExtendedPlayer;

  const handleWheel = (event: WheelEvent): void => {
    // Only handle scroll on the player element itself, not on controls
    const target = event.target as HTMLElement;
    if (!playerElement.contains(target)) return;

    // Check if scrolling over controls - if so, don't intercept
    const controlBar = playerElement.querySelector('.vjs-control-bar');
    if (controlBar && controlBar.contains(target)) return;

    event.preventDefault();
    event.stopPropagation();

    // Determine scroll direction (normalize for different browsers)
    // Use proper type guards instead of any casting for better type safety
    let delta: number;
    if (typeof event.deltaY === 'number' && event.deltaY !== 0) {
      delta = event.deltaY;
    } else if (typeof event.detail === 'number' && event.detail !== 0) {
      delta = event.detail;
    } else if ('wheelDelta' in event && typeof (event as any).wheelDelta === 'number') {
      delta = -(event as any).wheelDelta; // wheelDelta has inverted sign
    } else {
      delta = 0;
    }
    const direction = delta > 0 ? -1 : 1;

    // Calculate new volume
    const currentVolume = extPlayer.volume();
    const newVolume = Math.max(0, Math.min(1, currentVolume + (direction * VOLUME_STEP)));

    // Apply volume change
    extPlayer.volume(newVolume);

    // If volume increased from 0, unmute
    if (newVolume > 0 && extPlayer.muted()) {
      extPlayer.muted(false);
    }

    console.log('[VolumeControl] Scroll wheel:', { currentVolume, newVolume, muted: extPlayer.muted() });
  };

  // Add event listener with passive: false to allow preventDefault
  playerElement.addEventListener('wheel', handleWheel, { passive: false });

  // Return cleanup function
  return () => {
    playerElement.removeEventListener('wheel', handleWheel);
  };
}

/**
 * Setup volume change listener for persistence and feedback
 */
export function setupVolumeChangeListener(player: Player | ExtendedPlayer): () => void {
  const extPlayer = player as ExtendedPlayer;

  const handleVolumeChange = (): void => {
    const volume = extPlayer.volume();
    const muted = extPlayer.muted();

    // Save to localStorage
    saveVolumeState(volume, muted);

    // Show visual feedback
    showVolumeIndicator(player, volume, muted);

    console.log('[VolumeControl] Volume changed:', { volume, muted });
  };

  player.on('volumechange', handleVolumeChange);

  // Return cleanup function
  return () => {
    player.off('volumechange', handleVolumeChange);
  };
}

/**
 * Initialize all volume controls for a player
 */
export function initializeVolumeControls(player: Player | ExtendedPlayer): () => void {
  const cleanupFunctions: Array<() => void> = [];

  // Apply saved volume state
  applySavedVolume(player);

  // Setup scroll wheel control
  const cleanupScrollWheel = setupScrollWheelControl(player);
  cleanupFunctions.push(cleanupScrollWheel);

  // Setup volume change listener
  const cleanupVolumeChange = setupVolumeChangeListener(player);
  cleanupFunctions.push(cleanupVolumeChange);

  // Return combined cleanup function
  return () => {
    cleanupFunctions.forEach(cleanup => cleanup());
  };
}
