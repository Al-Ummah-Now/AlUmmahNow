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
 * Default ARIA labels (English)
 */
const EN_LABELS: AriaLabels = {
  player: 'Video player',
  playButton: 'Play video',
  pauseButton: 'Pause video',
  muteButton: 'Mute',
  unmuteButton: 'Unmute',
  fullscreenButton: 'Enter fullscreen',
  exitFullscreenButton: 'Exit fullscreen',
  volumeControl: 'Volume control',
  progressBar: 'Video progress',
  currentTime: 'Current time',
  duration: 'Total duration',
};

/**
 * Default ARIA labels (Arabic)
 */
const AR_LABELS: AriaLabels = {
  player: 'مشغل الفيديو',
  playButton: 'تشغيل الفيديو',
  pauseButton: 'إيقاف مؤقت',
  muteButton: 'كتم الصوت',
  unmuteButton: 'إلغاء كتم الصوت',
  fullscreenButton: 'ملء الشاشة',
  exitFullscreenButton: 'الخروج من ملء الشاشة',
  volumeControl: 'التحكم في مستوى الصوت',
  progressBar: 'تقدم الفيديو',
  currentTime: 'الوقت الحالي',
  duration: 'المدة الإجمالية',
};

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
    ...(lang === 'ar' ? AR_LABELS : EN_LABELS),
    ...customLabels,
  };

  // Create announcement manager
  const announcementManager = new AnnouncementManager();

  // Track all event handlers for cleanup
  const eventHandlers: Array<{ event: string; handler: (...args: unknown[]) => void }> = [];

  // Get player element
  const playerEl = player.el();
  if (!playerEl) {
    console.warn('[Accessibility] Player element not found');
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

    // Volume control
    const volumePanel = playerEl.querySelector('.vjs-volume-panel');
    if (volumePanel) {
      volumePanel.setAttribute('aria-label', labels.volumeControl);

      const updateVolumeLabel = () => {
        const volume = Math.round(player.volume() * 100);
        const label = player.muted()
          ? labels.muteButton
          : `${labels.volumeControl} ${volume}%`;
        volumePanel.setAttribute('aria-label', label);
      };
      updateVolumeLabel();

      eventHandlers.push({ event: 'volumechange', handler: updateVolumeLabel });
      player.on('volumechange', updateVolumeLabel);
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

    // Progress bar (seek bar)
    const seekBar = playerEl.querySelector('.vjs-progress-control');
    if (seekBar) {
      seekBar.setAttribute('role', 'slider');
      seekBar.setAttribute('aria-label', labels.progressBar);
      seekBar.setAttribute('aria-valuemin', '0');
      seekBar.setAttribute('aria-valuemax', '100');

      const updateSeekBarValue = () => {
        const duration = player.duration();
        if (duration > 0) {
          const currentTime = player.currentTime() || 0;
          const percent = Math.round((currentTime / duration) * 100);
          seekBar.setAttribute('aria-valuenow', percent.toString());
          seekBar.setAttribute('aria-valuetext', `${percent}%`);
        }
      };
      updateSeekBarValue();

      eventHandlers.push({ event: 'timeupdate', handler: updateSeekBarValue });
      player.on('timeupdate', updateSeekBarValue);
    }

    // Current time display
    const currentTimeDisplay = playerEl.querySelector('.vjs-current-time');
    if (currentTimeDisplay) {
      currentTimeDisplay.setAttribute('aria-label', labels.currentTime);
    }

    // Duration display
    const durationDisplay = playerEl.querySelector('.vjs-duration');
    if (durationDisplay) {
      durationDisplay.setAttribute('aria-label', labels.duration);
    }

    // === Screen Reader Announcements ===
    // Moved inside ready() to avoid race conditions

    if (announcements) {
      // Play/Pause announcements
      const playHandler = () => {
        const message = lang === 'ar' ? 'يتم التشغيل' : 'Playing';
        announcementManager.announce(message);
      };
      eventHandlers.push({ event: 'play', handler: playHandler });
      player.on('play', playHandler);

      const pauseHandler = () => {
        const message = lang === 'ar' ? 'موقف مؤقتاً' : 'Paused';
        announcementManager.announce(message);
      };
      eventHandlers.push({ event: 'pause', handler: pauseHandler });
      player.on('pause', pauseHandler);

      // Volume change announcements
      const volumeHandler = () => {
        const volume = Math.round(player.volume() * 100);
        const message = player.muted()
          ? (lang === 'ar' ? 'الصوت مكتوم' : 'Muted')
          : (lang === 'ar' ? `مستوى الصوت ${volume}%` : `Volume ${volume}%`);
        announcementManager.announce(message);
      };
      eventHandlers.push({ event: 'volumechange', handler: volumeHandler });
      player.on('volumechange', volumeHandler);

      // Fullscreen announcements
      const fullscreenHandler = () => {
        const message = player.isFullscreen()
          ? (lang === 'ar' ? 'وضع ملء الشاشة' : 'Fullscreen mode')
          : (lang === 'ar' ? 'خروج من ملء الشاشة' : 'Exited fullscreen');
        announcementManager.announce(message);
      };
      eventHandlers.push({ event: 'fullscreenchange', handler: fullscreenHandler });
      player.on('fullscreenchange', fullscreenHandler);

      // Error announcements
      const errorHandler = () => {
        const message = lang === 'ar' ? 'حدث خطأ في تشغيل الفيديو' : 'Video playback error';
        announcementManager.announce(message, true); // Force announcement
      };
      eventHandlers.push({ event: 'error', handler: errorHandler });
      player.on('error', errorHandler);

      // Buffering announcements
      const waitingHandler = () => {
        const message = lang === 'ar' ? 'جارٍ التحميل...' : 'Buffering...';
        announcementManager.announce(message);
      };
      eventHandlers.push({ event: 'waiting', handler: waitingHandler });
      player.on('waiting', waitingHandler);

      const canplayHandler = () => {
        const message = lang === 'ar' ? 'جاهز للتشغيل' : 'Ready to play';
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

  if (lang === 'ar') {
    if (hours > 0) parts.push(`${hours} ساعة`);
    if (minutes > 0) parts.push(`${minutes} دقيقة`);
    if (secs > 0 || parts.length === 0) parts.push(`${secs} ثانية`);
  } else {
    if (hours > 0) parts.push(`${hours} hour${hours > 1 ? 's' : ''}`);
    if (minutes > 0) parts.push(`${minutes} minute${minutes > 1 ? 's' : ''}`);
    if (secs > 0 || parts.length === 0) parts.push(`${secs} second${secs !== 1 ? 's' : ''}`);
  }

  return parts.join(lang === 'ar' ? ' و ' : ' ');
}
