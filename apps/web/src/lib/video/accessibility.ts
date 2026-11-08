/**
 * Video Player Accessibility Enhancements
 *
 * Ensures WCAG 2.1 AA compliance with comprehensive accessibility features:
 * - ARIA labels for all controls
 * - Screen reader announcements
 * - Focus management
 * - High contrast mode detection
 * - Keyboard navigation support (already in keyboard-shortcuts.ts)
 * - RTL support
 *
 * Features:
 * - Automatic ARIA attribute updates
 * - Throttled screen reader announcements
 * - Live region for status updates
 * - Focus indicators (styled in CSS)
 * - Accessible control labeling
 *
 * @example
 * ```typescript
 * const cleanup = setupAccessibility(player, {
 *   lang: 'en',
 *   announcements: true
 * });
 * // Later, cleanup when component unmounts
 * cleanup();
 * ```
 */

import type { ExtendedPlayer } from './videojs';
import { plural } from './i18n/utils/plural';
import { logger } from '@/lib/logger-client';
import { getTranslations } from './i18n';


/**
 * Configuration options for accessibility
 */
export interface AccessibilityOptions {
  /**
   * Language for screen reader announcements
   */
  lang?: 'en' | 'ar';

  /**
   * Enable/disable screen reader announcements
   */
  announcements?: boolean;

  /**
   * Custom ARIA labels (optional override)
   */
  customLabels?: Partial<AriaLabels>;
}

/**
 * ARIA label definitions
 */
export interface AriaLabels {
  player: string;
  playButton: string;
  pauseButton: string;
  muteButton: string;
  unmuteButton: string;
  fullscreenButton: string;
  exitFullscreenButton: string;
  volumeControl: string;
  progressBar: string;
  currentTime: string;
  duration: string;
}

/**
 * ARIA labels for a language, from the video player i18n system
 */
export function getAriaLabels(lang: 'en' | 'ar' = 'en'): AriaLabels {
  const a = getTranslations(lang).accessibility;
  return {
    player: a.videoPlayer,
    playButton: a.playButton,
    pauseButton: a.pauseButton,
    muteButton: a.muteButton,
    unmuteButton: a.unmuteButton,
    fullscreenButton: a.fullscreenButton,
    exitFullscreenButton: a.exitFullscreenButton,
    volumeControl: a.volumeSlider,
    progressBar: a.progressBar,
    currentTime: a.currentTime,
    duration: a.duration,
  };
}

/**
 * Name the quality menu button (videojs-hls-quality-selector renders it with
 * only an aria-hidden "Auto"/"720p" label). The accessible name includes the
 * visible quality so it satisfies WCAG 2.5.3 Label in Name.
 */
export function labelQualityButton(button: HTMLElement, baseLabel: string): void {
  const visible = button.querySelector('.vjs-icon-placeholder')?.textContent?.trim() ?? '';
  const label = visible ? `${baseLabel}: ${visible}` : baseLabel;
  if (button.getAttribute('aria-label') !== label) {
    button.setAttribute('aria-label', label);
  }
  if (button.getAttribute('title') !== baseLabel) {
    button.setAttribute('title', baseLabel);
  }
}

/**
 * A Video.js menu's title <li> sits inside role="menu" without a menu-item
 * role (axe aria-required-children). Use it as the menu's accessible name and
 * hide the title row itself from assistive technology.
 */
export function fixMenuTitle(menu: HTMLElement): void {
  const title = menu.querySelector<HTMLElement>(':scope > li.vjs-menu-title');
  if (!title) return;
  const text = title.textContent?.trim();
  if (text && menu.getAttribute('aria-label') !== text) {
    menu.setAttribute('aria-label', text);
  }
  if (title.getAttribute('aria-hidden') !== 'true') title.setAttribute('aria-hidden', 'true');
  if (title.hasAttribute('tabindex')) title.removeAttribute('tabindex');
}

/**
 * Screen reader announcement manager
 * Uses throttling to prevent announcement spam
 * Singleton pattern with reference counting to prevent memory leaks
 */
class AnnouncementManager {
  private static globalAnnouncer: HTMLElement | null = null;
  private static instanceCount = 0;
  private lastAnnouncement = '';
  private lastAnnouncementTime = 0;
  private readonly throttleDelay = 1000; // 1 second

  /**
   * Get or create singleton announcer element
   */
  private getAnnouncer(): HTMLElement {
    if (!AnnouncementManager.globalAnnouncer) {
      AnnouncementManager.globalAnnouncer = document.getElementById('vjs-sr-announcer');
      if (!AnnouncementManager.globalAnnouncer) {
        AnnouncementManager.globalAnnouncer = this.createAnnouncer();
      }
    }
    AnnouncementManager.instanceCount++;
    return AnnouncementManager.globalAnnouncer;
  }

  /**
   * Create announcer element (hidden, for screen readers only)
   */
  private createAnnouncer(): HTMLElement {
    const div = document.createElement('div');
    div.id = 'vjs-sr-announcer';
    div.setAttribute('role', 'status');
    div.setAttribute('aria-live', 'polite');
    div.setAttribute('aria-atomic', 'true');
    div.className = 'sr-only';
    document.body.appendChild(div);
    return div;
  }

  /**
   * Announce message to screen readers
   * Throttled to prevent spam
   */
  announce(message: string, force = false): void {
    const now = Date.now();
    const timeSinceLast = now - this.lastAnnouncementTime;

    // Skip if same message or too soon (unless forced)
    if (!force && (message === this.lastAnnouncement || timeSinceLast < this.throttleDelay)) {
      return;
    }

    const announcer = this.getAnnouncer();
    announcer.textContent = message;

    this.lastAnnouncement = message;
    this.lastAnnouncementTime = now;
  }

  /**
   * Cleanup announcer element with reference counting
   * Only removes DOM element when all instances are cleaned up
   */
  cleanup(): void {
    AnnouncementManager.instanceCount--;
    if (AnnouncementManager.instanceCount === 0 && AnnouncementManager.globalAnnouncer) {
      AnnouncementManager.globalAnnouncer.remove();
      AnnouncementManager.globalAnnouncer = null;
    }
  }
}

/**
 * Setup accessibility enhancements for video player
 *
 * @param player - Video.js player instance
 * @param options - Configuration options
 * @returns Cleanup function to remove event listeners
 */
export function setupAccessibility(
  player: ExtendedPlayer,
  options: AccessibilityOptions = {}
): () => void {
  const {
    lang = 'en',
    announcements = true,
    customLabels = {},
  } = options;

  // Get labels for current language
  const labels = {
    ...getAriaLabels(lang),
    ...customLabels,
  };
  const translations = getTranslations(lang);
  const said = translations.accessibility.announcements;

  // Create announcement manager
  const announcementManager = new AnnouncementManager();

  // Observes control-bar menus so rebuilt menus keep their accessible names
  let menuObserver: MutationObserver | null = null;

  // Track all event handlers for cleanup
  const eventHandlers: Array<{ event: string; handler: (...args: unknown[]) => void }> = [];

  // Get player element
  const playerEl = player.el();
  if (!playerEl) {
    logger.warn('[Accessibility] Player element not found');
    return () => {};
  }

  // === ARIA Labels Setup ===

  // Player container
  playerEl.setAttribute('role', 'region');
  playerEl.setAttribute('aria-label', labels.player);

  // Update control labels when player is ready
  player.ready(() => {
    // Play/Pause button
    const playButton = playerEl.querySelector('.vjs-play-control');
    if (playButton) {
      const updatePlayButtonLabel = () => {
        const label = player.paused() ? labels.playButton : labels.pauseButton;
        playButton.setAttribute('aria-label', label);
      };
      updatePlayButtonLabel();

      eventHandlers.push({ event: 'play', handler: updatePlayButtonLabel });
      eventHandlers.push({ event: 'pause', handler: updatePlayButtonLabel });
      player.on('play', updatePlayButtonLabel);
      player.on('pause', updatePlayButtonLabel);
    }

    // Mute button
    const muteButton = playerEl.querySelector('.vjs-mute-control');
    if (muteButton) {
      const updateMuteLabel = () => {
        const label = player.muted() ? labels.unmuteButton : labels.muteButton;
        muteButton.setAttribute('aria-label', label);
      };
      updateMuteLabel();

      eventHandlers.push({ event: 'volumechange', handler: updateMuteLabel });
      player.on('volumechange', updateMuteLabel);
    }

    // Fullscreen button
    const fullscreenButton = playerEl.querySelector('.vjs-fullscreen-control');
    if (fullscreenButton) {
      const updateFullscreenLabel = () => {
        const label = player.isFullscreen()
          ? labels.exitFullscreenButton
          : labels.fullscreenButton;
        fullscreenButton.setAttribute('aria-label', label);
      };
      updateFullscreenLabel();

      eventHandlers.push({ event: 'fullscreenchange', handler: updateFullscreenLabel });
      player.on('fullscreenchange', updateFullscreenLabel);
    }

    // Seek slider (Video.js .vjs-progress-holder, role=slider)
    const seekSlider = playerEl.querySelector('.vjs-progress-holder');
    if (seekSlider) {
      seekSlider.setAttribute('aria-label', labels.progressBar);
    }

    // Menus (quality / captions) are rebuilt by Video.js and the quality plugin
    // whenever levels or tracks change, so re-apply the fixes on DOM changes.
    const fixMenus = () => {
      playerEl.querySelectorAll<HTMLElement>('.vjs-quality-selector .vjs-menu-button').forEach((button) => {
        labelQualityButton(button, translations.accessibility.qualityButton);
      });
      playerEl.querySelectorAll<HTMLElement>('.vjs-menu-content[role="menu"]').forEach(fixMenuTitle);
    };
    fixMenus();
    const controlBar = playerEl.querySelector('.vjs-control-bar');
    if (controlBar && typeof MutationObserver !== 'undefined') {
      menuObserver = new MutationObserver(() => fixMenus());
      menuObserver.observe(controlBar, { childList: true, subtree: true, characterData: true });
    }

    // === Screen Reader Announcements ===
    // Moved inside ready() to avoid race conditions

    if (announcements) {
      // Play/Pause announcements
      const playHandler = () => {
        const message = said.playing;
        announcementManager.announce(message);
      };
      eventHandlers.push({ event: 'play', handler: playHandler });
      player.on('play', playHandler);

      const pauseHandler = () => {
        const message = said.paused;
        announcementManager.announce(message);
      };
      eventHandlers.push({ event: 'pause', handler: pauseHandler });
      player.on('pause', pauseHandler);

      // Volume change announcements
      const volumeHandler = () => {
        const volume = Math.round(player.volume() * 100);
        const message = player.muted()
          ? said.muted
          : said.volume.replace('{volume}', String(volume));
        announcementManager.announce(message);
      };
      eventHandlers.push({ event: 'volumechange', handler: volumeHandler });
      player.on('volumechange', volumeHandler);

      // Fullscreen announcements
      const fullscreenHandler = () => {
        const message = player.isFullscreen()
          ? said.fullscreenOn
          : said.fullscreenOff;
        announcementManager.announce(message);
      };
      eventHandlers.push({ event: 'fullscreenchange', handler: fullscreenHandler });
      player.on('fullscreenchange', fullscreenHandler);

      // Error announcements
      const errorHandler = () => {
        const message = said.playbackError;
        announcementManager.announce(message, true); // Force announcement
      };
      eventHandlers.push({ event: 'error', handler: errorHandler });
      player.on('error', errorHandler);

      // Buffering announcements
      const waitingHandler = () => {
        const message = said.buffering;
        announcementManager.announce(message);
      };
      eventHandlers.push({ event: 'waiting', handler: waitingHandler });
      player.on('waiting', waitingHandler);

      const canplayHandler = () => {
        const message = said.readyToPlay;
        announcementManager.announce(message);
      };
      eventHandlers.push({ event: 'canplay', handler: canplayHandler });
      player.on('canplay', canplayHandler);
    }
  });

  // === High Contrast Mode Detection ===

  const highContrastQuery = window.matchMedia('(prefers-contrast: high)');
  const updateHighContrastMode = () => {
    if (highContrastQuery.matches) {
      playerEl.classList.add('vjs-high-contrast');
    } else {
      playerEl.classList.remove('vjs-high-contrast');
    }
  };
  updateHighContrastMode();

  // Listen for changes
  highContrastQuery.addEventListener('change', updateHighContrastMode);

  // === Focus Management ===

  // Ensure player is focusable
  if (!playerEl.hasAttribute('tabindex')) {
    playerEl.setAttribute('tabindex', '0');
  }

  // Return comprehensive cleanup function
  return () => {
    // Remove all player event listeners
    eventHandlers.forEach(({ event, handler }) => {
      player.off(event, handler);
    });

    // Remove high contrast listener
    highContrastQuery.removeEventListener('change', updateHighContrastMode);

    // Stop observing menus
    menuObserver?.disconnect();
    menuObserver = null;

    // Cleanup announcements
    announcementManager.cleanup();
  };
}

/**
 * Format time for screen readers
 * Converts seconds to readable format (e.g., "2 minutes 30 seconds")
 */
export function formatTimeForScreenReader(seconds: number, lang: 'en' | 'ar' = 'en'): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts: string[] = [];
  if (hours > 0) parts.push(plural(lang, 'hours', hours));
  if (minutes > 0) parts.push(plural(lang, 'minutes', minutes));
  if (secs > 0 || parts.length === 0) parts.push(plural(lang, 'seconds', secs));

  return parts.join(lang === 'ar' ? ' و ' : ' ');
}
