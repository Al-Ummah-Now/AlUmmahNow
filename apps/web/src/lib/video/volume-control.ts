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
import type { ExtendedPlayer } from './videojs';
import { logger } from '@/lib/logger-client';
import { getTranslations } from '@/lib/video/i18n/utils/getTranslations';
import type { SupportedLanguage, VideoPlayerTranslations } from '@/lib/video/i18n/types';


const STORAGE_KEY = 'videoPlayerVolume';
const VOLUME_STEP = 0.1; // 10% steps
const INDICATOR_DURATION = 800;

/** Pending hide per indicator, so a rapid series of changes keeps it visible once. */
const indicatorHideTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

function volumeText(translations: VideoPlayerTranslations, percentage: number, muted: boolean): string {
  const { muted: mutedText, volume } = translations.accessibility.announcements;
  return muted ? mutedText : volume.replace('{volume}', String(percentage));
}

export interface VolumeState {
  volume: number;
  muted: boolean;
}

/**
 * Save volume and mute state to localStorage
 *
 * Note: Volume preferences are stored unencrypted as they are not sensitive data.
 * User privacy is not compromised by knowing someone prefers 70% volume.
 */
export function saveVolumeState(volume: number, muted: boolean): void {
  try {
    const state: VolumeState = {
      volume: Math.max(0, Math.min(1, volume)),
      muted,
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    logger.error('[VolumeControl] Failed to save volume state:', error);
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

    // Invalid data format
    logger.warn('[VolumeControl] Invalid volume state format, clearing');
    localStorage.removeItem(STORAGE_KEY);
    return null;
  } catch (error) {
    logger.error('[VolumeControl] Failed to load volume state:', error);
    // Clear corrupted data
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (_clearError) {
      // Ignore errors when clearing
    }
    return null;
  }
}

/**
 * Apply saved volume state to player with fallback
 */
export function applySavedVolume(player: Player | ExtendedPlayer): void {
  const extPlayer = player as ExtendedPlayer;

  try {
    const savedState = loadVolumeState();
    if (savedState) {
      extPlayer.volume(savedState.volume);
      extPlayer.muted(savedState.muted);
      logger.debug('[VolumeControl] Restored volume:', savedState);
    } else {
      // Fallback: Set reasonable defaults if no saved state
      const fallbackVolume = 0.7; // 70% volume as reasonable default
      const fallbackMuted = false;

      extPlayer.volume(fallbackVolume);
      extPlayer.muted(fallbackMuted);

      logger.debug('[VolumeControl] Applied fallback volume:', { volume: fallbackVolume, muted: fallbackMuted });

      // Save the fallback state for future use
      saveVolumeState(fallbackVolume, fallbackMuted);
    }
  } catch (error) {
    logger.error('[VolumeControl] Failed to apply saved volume, using fallback:', error);

    // Emergency fallback: Set safe defaults even if everything fails
    try {
      extPlayer.volume(0.5); // 50% volume as safe default
      extPlayer.muted(false);
    } catch (fallbackError) {
      logger.error('[VolumeControl] Even fallback failed:', fallbackError);
    }
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
export function showVolumeIndicator(
  player: Player | ExtendedPlayer,
  volume: number,
  muted: boolean,
  lang: SupportedLanguage = 'en'
): void {
  const playerElement = (player as ExtendedPlayer).el();
  if (!playerElement) return;

  const indicator = createVolumeIndicator(playerElement);

  // Update content
  const percentage = Math.round(volume * 100);
  const iconHtml = muted
    ? '<svg class="vjs-volume-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4V5zM23 9l-6 6M17 9l6 6"/></svg>'
    : '<svg class="vjs-volume-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4V5zM19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07"/></svg>';

  const text = muted ? getTranslations(lang).accessibility.announcements.muted : `${percentage}%`;
  indicator.innerHTML = `${iconHtml}<span class="vjs-volume-text">${text}</span>`;

  // Trigger animation
  indicator.classList.remove('vjs-volume-indicator-show');
  void indicator.offsetWidth; // Force reflow
  indicator.classList.add('vjs-volume-indicator-show');

  // Auto-hide after duration, restarted by each change so rapid changes don't flicker
  const pendingHide = indicatorHideTimers.get(indicator);
  if (pendingHide !== undefined) clearTimeout(pendingHide);
  indicatorHideTimers.set(
    indicator,
    setTimeout(() => {
      indicator.classList.remove('vjs-volume-indicator-show');
      indicatorHideTimers.delete(indicator);
    }, INDICATOR_DURATION)
  );
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
    } else if ('wheelDelta' in event) {
      const wheelEvent = event as WheelEvent & { wheelDelta?: number };
      if (typeof wheelEvent.wheelDelta === 'number') {
        delta = -wheelEvent.wheelDelta; // wheelDelta has inverted sign
      } else {
        delta = 0;
      }
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

    logger.debug('[VolumeControl] Scroll wheel:', { currentVolume, newVolume, muted: extPlayer.muted() });
  };

  // Add event listener with passive: false to allow preventDefault
  playerElement.addEventListener('wheel', handleWheel, { passive: false });

  // Return cleanup function
  return () => {
    playerElement.removeEventListener('wheel', handleWheel);
  };
}

/**
 * Setup keyboard accessibility for volume control
 */
export function setupKeyboardAccessibility(
  player: Player | ExtendedPlayer,
  lang: SupportedLanguage = 'en'
): () => void {
  const extPlayer = player as ExtendedPlayer;
  const playerElement = extPlayer.el();
  if (!playerElement) return () => {};

  // Find volume panel and mute button
  const volumePanel = playerElement.querySelector('.vjs-volume-panel') as HTMLElement;
  const muteButton = playerElement.querySelector('.vjs-mute-control') as HTMLElement;
  const volumeBar = playerElement.querySelector('.vjs-volume-bar') as HTMLElement;

  if (!volumePanel || !muteButton || !volumeBar) {
    logger.warn('[VolumeControl] Volume control elements not found');
    return () => {};
  }

  // Ensure volume bar is keyboard accessible
  volumeBar.setAttribute('tabindex', '0');
  volumeBar.setAttribute('role', 'slider');
  const translations = getTranslations(lang);
  volumeBar.setAttribute('aria-label', translations.accessibility.volumeSlider);
  volumeBar.setAttribute('aria-valuemin', '0');
  volumeBar.setAttribute('aria-valuemax', '100');
  // The inline slider is horizontal; a value change is already announced through
  // aria-valuetext, so an aria-live on the slider would announce it twice.
  volumeBar.setAttribute('aria-orientation', 'horizontal');
  volumeBar.removeAttribute('aria-live');

  // Update ARIA values when volume changes
  const updateAriaValues = (): void => {
    const volume = extPlayer.volume();
    const muted = extPlayer.muted();
    const percentage = Math.round(volume * 100);
    
    volumeBar.setAttribute('aria-valuenow', muted ? '0' : percentage.toString());
    volumeBar.setAttribute('aria-valuetext', volumeText(translations, percentage, muted));
  };

  // Initial ARIA setup
  updateAriaValues();

  // Handle keyboard events on volume bar
  const handleKeyDown = (event: KeyboardEvent): void => {
    // Only handle arrow keys, space, and enter
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Enter'].includes(event.key)) {
      return;
    }

    event.preventDefault();
    // Video.js's own slider handler is on this same element; without
    // stopImmediatePropagation one key press would move the volume twice.
    event.stopImmediatePropagation();

    const currentVolume = extPlayer.volume();
    const currentMuted = extPlayer.muted();
    let newVolume = currentVolume;
    let newMuted = currentMuted;

    switch (event.key) {
      case 'ArrowUp':
      case 'ArrowRight':
        // Increase volume by 10%
        newVolume = Math.min(1, currentVolume + VOLUME_STEP);
        if (newVolume > 0 && currentMuted) {
          newMuted = false;
        }
        break;

      case 'ArrowDown':
      case 'ArrowLeft':
        // Decrease volume by 10%
        newVolume = Math.max(0, currentVolume - VOLUME_STEP);
        if (newVolume === 0 && !currentMuted) {
          newMuted = true;
        }
        break;

      case ' ':
      case 'Enter':
        // Toggle mute
        newMuted = !currentMuted;
        break;
    }

    // Apply changes
    if (newVolume !== currentVolume) {
      extPlayer.volume(newVolume);
    }
    if (newMuted !== currentMuted) {
      extPlayer.muted(newMuted);
    }

    // Update ARIA values
    updateAriaValues();

    logger.debug('[VolumeControl] Keyboard control:', { 
      key: event.key, 
      newVolume, 
      newMuted 
    });
  };

  // Update ARIA values on volume changes
  const handleVolumeChange = (): void => {
    updateAriaValues();
  };

  // Add event listeners
  // Capture phase: runs before the Video.js handler registered earlier on this element
  volumeBar.addEventListener('keydown', handleKeyDown, true);
  player.on('volumechange', handleVolumeChange);

  // Ensure volume panel shows slider when focused
  const handleFocus = (): void => {
    volumePanel.classList.add('vjs-volume-panel-hover');
  };

  const handleBlur = (event: FocusEvent): void => {
    // Check if focus is still within volume panel
    const relatedTarget = event.relatedTarget as HTMLElement;
    if (!volumePanel.contains(relatedTarget)) {
      volumePanel.classList.remove('vjs-volume-panel-hover');
    }
  };

  volumeBar.addEventListener('focus', handleFocus);
  volumeBar.addEventListener('blur', handleBlur);

  // Return cleanup function
  return () => {
    volumeBar.removeEventListener('keydown', handleKeyDown, true);
    volumeBar.removeEventListener('focus', handleFocus);
    volumeBar.removeEventListener('blur', handleBlur);
    player.off('volumechange', handleVolumeChange);
  };
}

/**
 * Setup volume change listener for persistence and feedback
 */
export function setupVolumeChangeListener(
  player: Player | ExtendedPlayer,
  lang: SupportedLanguage = 'en'
): () => void {
  const extPlayer = player as ExtendedPlayer;
  // The indicator answers the viewer, so the remembered volume applied on load stays silent:
  // it shows once playback has started or the viewer has pressed a key or the pointer in the player
  let interacted = false;
  const markInteracted = (): void => { interacted = true; };
  const root = (player as { el?: () => Element | null }).el?.() ?? null;
  root?.addEventListener('keydown', markInteracted, true);
  root?.addEventListener('pointerdown', markInteracted, true);

  const handleVolumeChange = (): void => {
    const volume = extPlayer.volume();
    const muted = extPlayer.muted();

    // Save to localStorage (synchronous now)
    try {
      saveVolumeState(volume, muted);
    } catch (error) {
      logger.error('[VolumeControl] Failed to save volume state:', error);
    }

    // Show visual feedback
    const started = typeof (player as { hasStarted?: () => boolean }).hasStarted === 'function' ? (player as { hasStarted: () => boolean }).hasStarted() : true;
    if (interacted || started) showVolumeIndicator(player, volume, muted, lang);

    logger.debug('[VolumeControl] Volume changed:', { volume, muted });
  };

  player.on('volumechange', handleVolumeChange);

  // Return cleanup function
  return () => {
    player.off('volumechange', handleVolumeChange);
    root?.removeEventListener('keydown', markInteracted, true);
    root?.removeEventListener('pointerdown', markInteracted, true);
  };
}

/**
 * Initialize all volume controls for a player
 */
export function initializeVolumeControls(
  player: Player | ExtendedPlayer,
  lang: SupportedLanguage = 'en'
): () => void {
  const cleanupFunctions: Array<() => void> = [];

  // Apply saved volume state (synchronous now)
  try {
    applySavedVolume(player);
  } catch (error) {
    logger.error('[VolumeControl] Failed to apply saved volume:', error);
  }

  // Setup scroll wheel control
  const cleanupScrollWheel = setupScrollWheelControl(player);
  cleanupFunctions.push(cleanupScrollWheel);

  // Setup volume change listener
  const cleanupVolumeChange = setupVolumeChangeListener(player, lang);
  cleanupFunctions.push(cleanupVolumeChange);

  // Setup keyboard accessibility
  const cleanupKeyboard = setupKeyboardAccessibility(player, lang);
  cleanupFunctions.push(cleanupKeyboard);

  // Return combined cleanup function
  return () => {
    cleanupFunctions.forEach(cleanup => cleanup());
  };
}
