# Implementation Plan: 1.4.4 - Implement Comprehensive Keyboard Shortcuts

## Overview

Implement a comprehensive keyboard shortcut system for the video player and main application features, enhancing accessibility and power user experience. This system will provide intuitive keyboard controls for all major functions while maintaining WCAG 2.1 Level AA compliance.

## Objectives

- **Primary**: Implement comprehensive keyboard shortcuts for video player controls
- **Secondary**: Add application-wide keyboard shortcuts for navigation and features
- **Tertiary**: Create customizable shortcut system with user preferences
- **Compliance**: WCAG 2.1.1 (Keyboard), 2.1.2 (No Keyboard Trap), 2.4.1 (Bypass Blocks)

## Success Criteria

### Functional Requirements
- [ ] All video player functions accessible via keyboard shortcuts
- [ ] Application-wide shortcuts for main navigation and features
- [ ] Customizable shortcut system with user preferences
- [ ] Conflict detection and resolution for shortcut combinations
- [ ] Context-aware shortcuts (different shortcuts in different contexts)
- [ ] Help system showing available shortcuts

### Accessibility Requirements
- [ ] All shortcuts avoid conflicts with browser/OS shortcuts
- [ ] Screen reader announcements for shortcut actions
- [ ] Visual indicators when shortcuts are available
- [ ] High contrast mode support for shortcut displays
- [ ] RTL language support for shortcut documentation

### Technical Requirements
- [ ] Cross-browser compatibility (Chrome, Firefox, Safari, Edge)
- [ ] Mobile device support (when external keyboard connected)
- [ ] Performance optimization (minimal impact on video playback)
- [ ] Error handling and graceful degradation
- [ ] Comprehensive test coverage (90%+)

## Implementation Details

### 1. Core Keyboard Shortcut System

#### 1.1 Shortcut Manager Class
```typescript
// apps/web/src/lib/accessibility/shortcut-manager.ts
interface ShortcutDefinition {
  id: string;
  keys: string[];
  description: string;
  category: 'player' | 'navigation' | 'accessibility' | 'global';
  context?: string[];
  action: (event: KeyboardEvent) => void;
  enabled: boolean;
  preventDefault: boolean;
  stopPropagation: boolean;
}

interface ShortcutConflict {
  shortcut: string;
  conflicts: string[];
  resolution: 'disable' | 'remap' | 'warn';
}

class ShortcutManager {
  private shortcuts: Map<string, ShortcutDefinition> = new Map();
  private activeContexts: Set<string> = new Set();
  private helpMode: boolean = false;
  private conflicts: ShortcutConflict[] = [];

  constructor() {
    this.initializeDefaultShortcuts();
    this.bindGlobalEvents();
    this.detectConflicts();
  }

  // Register new shortcut
  registerShortcut(definition: ShortcutDefinition): void {
    this.shortcuts.set(definition.id, definition);
    this.updateConflictDetection();
  }

  // Handle keyboard events
  handleKeyDown(event: KeyboardEvent): void {
    const keyCombo = this.getKeyCombo(event);
    const shortcut = this.findMatchingShortcut(keyCombo, event);
    
    if (shortcut && this.isShortcutActive(shortcut)) {
      if (shortcut.preventDefault) event.preventDefault();
      if (shortcut.stopPropagation) event.stopPropagation();
      
      this.executeShortcut(shortcut, event);
    }
  }

  // Execute shortcut action
  private executeShortcut(shortcut: ShortcutDefinition, event: KeyboardEvent): void {
    try {
      // Announce to screen readers
      this.announceShortcut(shortcut);
      
      // Execute action
      shortcut.action(event);
      
      // Log for analytics
      this.logShortcutUsage(shortcut.id);
      
    } catch (error) {
      console.error(`Shortcut execution failed: ${shortcut.id}`, error);
      this.announceError(shortcut);
    }
  }

  // Context management
  setContext(context: string): void {
    this.activeContexts.clear();
    this.activeContexts.add(context);
  }

  addContext(context: string): void {
    this.activeContexts.add(context);
  }

  removeContext(context: string): void {
    this.activeContexts.delete(context);
  }

  // Help system
  toggleHelpMode(): void {
    this.helpMode = !this.helpMode;
    this.updateHelpDisplay();
  }

  getAvailableShortcuts(): ShortcutDefinition[] {
    return Array.from(this.shortcuts.values())
      .filter(shortcut => this.isShortcutActive(shortcut))
      .sort((a, b) => a.category.localeCompare(b.category));
  }

  // Conflict detection
  private detectConflicts(): void {
    const keyMap = new Map<string, ShortcutDefinition[]>();
    
    this.shortcuts.forEach(shortcut => {
      shortcut.keys.forEach(key => {
        if (!keyMap.has(key)) {
          keyMap.set(key, []);
        }
        keyMap.get(key)!.push(shortcut);
      });
    });

    this.conflicts = Array.from(keyMap.entries())
      .filter(([_, shortcuts]) => shortcuts.length > 1)
      .map(([key, shortcuts]) => ({
        shortcut: key,
        conflicts: shortcuts.map(s => s.id),
        resolution: 'warn' as const
      }));
  }

  // Utility methods
  private getKeyCombo(event: KeyboardEvent): string {
    const parts: string[] = [];
    
    if (event.ctrlKey) parts.push('Ctrl');
    if (event.altKey) parts.push('Alt');
    if (event.shiftKey) parts.push('Shift');
    if (event.metaKey) parts.push('Meta');
    
    parts.push(event.code);
    return parts.join('+');
  }

  private findMatchingShortcut(keyCombo: string, event: KeyboardEvent): ShortcutDefinition | null {
    return Array.from(this.shortcuts.values()).find(shortcut => 
      shortcut.keys.includes(keyCombo) && 
      this.isShortcutActive(shortcut)
    ) || null;
  }

  private isShortcutActive(shortcut: ShortcutDefinition): boolean {
    if (!shortcut.enabled) return false;
    
    if (shortcut.context && shortcut.context.length > 0) {
      return shortcut.context.some(context => this.activeContexts.has(context));
    }
    
    return true;
  }

  private announceShortcut(shortcut: ShortcutDefinition): void {
    const announcement = `Shortcut activated: ${shortcut.description}`;
    this.announceToScreenReader(announcement);
  }

  private announceError(shortcut: ShortcutDefinition): void {
    const announcement = `Shortcut failed: ${shortcut.description}`;
    this.announceToScreenReader(announcement);
  }

  private announceToScreenReader(message: string): void {
    const announcement = document.createElement('div');
    announcement.setAttribute('aria-live', 'polite');
    announcement.setAttribute('aria-atomic', 'true');
    announcement.className = 'sr-only';
    announcement.textContent = message;
    
    document.body.appendChild(announcement);
    
    setTimeout(() => {
      document.body.removeChild(announcement);
    }, 1000);
  }

  private logShortcutUsage(shortcutId: string): void {
    // Analytics tracking
    if (typeof gtag !== 'undefined') {
      gtag('event', 'shortcut_used', {
        shortcut_id: shortcutId,
        context: Array.from(this.activeContexts).join(',')
      });
    }
  }

  private updateHelpDisplay(): void {
    // Update UI to show/hide shortcut hints
    const helpElements = document.querySelectorAll('[data-shortcut-help]');
    helpElements.forEach(element => {
      element.classList.toggle('shortcut-help-visible', this.helpMode);
    });
  }

  private bindGlobalEvents(): void {
    document.addEventListener('keydown', this.handleKeyDown.bind(this));
    
    // Help mode toggle
    document.addEventListener('keydown', (event) => {
      if (event.key === '?' && event.shiftKey) {
        event.preventDefault();
        this.toggleHelpMode();
      }
    });
  }

  private initializeDefaultShortcuts(): void {
    // Video player shortcuts
    this.registerShortcut({
      id: 'play-pause',
      keys: ['Space', 'k'],
      description: 'Play or pause video',
      category: 'player',
      context: ['video-player'],
      action: () => this.togglePlayPause(),
      enabled: true,
      preventDefault: true,
      stopPropagation: true
    });

    this.registerShortcut({
      id: 'seek-forward',
      keys: ['ArrowRight', 'l'],
      description: 'Seek forward 10 seconds',
      category: 'player',
      context: ['video-player'],
      action: () => this.seekForward(10),
      enabled: true,
      preventDefault: true,
      stopPropagation: true
    });

    this.registerShortcut({
      id: 'seek-backward',
      keys: ['ArrowLeft', 'j'],
      description: 'Seek backward 10 seconds',
      category: 'player',
      context: ['video-player'],
      action: () => this.seekBackward(10),
      enabled: true,
      preventDefault: true,
      stopPropagation: true
    });

    // Volume shortcuts
    this.registerShortcut({
      id: 'volume-up',
      keys: ['ArrowUp'],
      description: 'Increase volume',
      category: 'player',
      context: ['video-player'],
      action: () => this.adjustVolume(0.1),
      enabled: true,
      preventDefault: true,
      stopPropagation: true
    });

    this.registerShortcut({
      id: 'volume-down',
      keys: ['ArrowDown'],
      description: 'Decrease volume',
      category: 'player',
      context: ['video-player'],
      action: () => this.adjustVolume(-0.1),
      enabled: true,
      preventDefault: true,
      stopPropagation: true
    });

    this.registerShortcut({
      id: 'mute',
      keys: ['m'],
      description: 'Toggle mute',
      category: 'player',
      context: ['video-player'],
      action: () => this.toggleMute(),
      enabled: true,
      preventDefault: true,
      stopPropagation: true
    });

    // Fullscreen shortcuts
    this.registerShortcut({
      id: 'fullscreen',
      keys: ['f'],
      description: 'Toggle fullscreen',
      category: 'player',
      context: ['video-player'],
      action: () => this.toggleFullscreen(),
      enabled: true,
      preventDefault: true,
      stopPropagation: true
    });

    // Navigation shortcuts
    this.registerShortcut({
      id: 'home',
      keys: ['g', 'h'],
      description: 'Go to home',
      category: 'navigation',
      action: () => this.navigateTo('/'),
      enabled: true,
      preventDefault: true,
      stopPropagation: true
    });

    this.registerShortcut({
      id: 'search',
      keys: ['/', 's'],
      description: 'Focus search',
      category: 'navigation',
      action: () => this.focusSearch(),
      enabled: true,
      preventDefault: true,
      stopPropagation: true
    });

    // Accessibility shortcuts
    this.registerShortcut({
      id: 'skip-to-main',
      keys: ['Alt', 'm'],
      description: 'Skip to main content',
      category: 'accessibility',
      action: () => this.skipToMain(),
      enabled: true,
      preventDefault: true,
      stopPropagation: true
    });
  }

  // Video player actions
  private togglePlayPause(): void {
    const video = document.querySelector('video');
    if (video) {
      if (video.paused) {
        video.play();
      } else {
        video.pause();
      }
    }
  }

  private seekForward(seconds: number): void {
    const video = document.querySelector('video');
    if (video) {
      video.currentTime = Math.min(video.currentTime + seconds, video.duration);
    }
  }

  private seekBackward(seconds: number): void {
    const video = document.querySelector('video');
    if (video) {
      video.currentTime = Math.max(video.currentTime - seconds, 0);
    }
  }

  private adjustVolume(delta: number): void {
    const video = document.querySelector('video');
    if (video) {
      video.volume = Math.max(0, Math.min(1, video.volume + delta));
    }
  }

  private toggleMute(): void {
    const video = document.querySelector('video');
    if (video) {
      video.muted = !video.muted;
    }
  }

  private toggleFullscreen(): void {
    const videoContainer = document.querySelector('.video-container');
    if (videoContainer) {
      if (!document.fullscreenElement) {
        videoContainer.requestFullscreen();
      } else {
        document.exitFullscreen();
      }
    }
  }

  // Navigation actions
  private navigateTo(path: string): void {
    window.location.href = path;
  }

  private focusSearch(): void {
    const searchInput = document.querySelector('input[type="search"]') as HTMLInputElement;
    if (searchInput) {
      searchInput.focus();
    }
  }

  private skipToMain(): void {
    const mainContent = document.querySelector('main') || document.querySelector('[role="main"]');
    if (mainContent) {
      mainContent.focus();
      mainContent.scrollIntoView();
    }
  }
}

// Global instance
export const shortcutManager = new ShortcutManager();
```

#### 1.2 Shortcut Preferences System
```typescript
// apps/web/src/lib/accessibility/shortcut-preferences.ts
interface UserShortcutPreferences {
  customShortcuts: Record<string, string[]>;
  disabledShortcuts: string[];
  helpModeEnabled: boolean;
  showShortcutHints: boolean;
}

class ShortcutPreferences {
  private readonly STORAGE_KEY = 'al-ummah-shortcut-preferences';
  private preferences: UserShortcutPreferences;

  constructor() {
    this.preferences = this.loadPreferences();
  }

  // Load preferences from localStorage
  private loadPreferences(): UserShortcutPreferences {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (error) {
      console.warn('Failed to load shortcut preferences:', error);
    }

    return this.getDefaultPreferences();
  }

  private getDefaultPreferences(): UserShortcutPreferences {
    return {
      customShortcuts: {},
      disabledShortcuts: [],
      helpModeEnabled: false,
      showShortcutHints: true
    };
  }

  // Save preferences to localStorage
  savePreferences(): void {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.preferences));
    } catch (error) {
      console.warn('Failed to save shortcut preferences:', error);
    }
  }

  // Get all preferences
  getPreferences(): UserShortcutPreferences {
    return { ...this.preferences };
  }

  // Update custom shortcut
  updateCustomShortcut(shortcutId: string, keys: string[]): void {
    this.preferences.customShortcuts[shortcutId] = keys;
    this.savePreferences();
  }

  // Enable/disable shortcut
  toggleShortcut(shortcutId: string, enabled: boolean): void {
    if (enabled) {
      this.preferences.disabledShortcuts = this.preferences.disabledShortcuts.filter(
        id => id !== shortcutId
      );
    } else {
      if (!this.preferences.disabledShortcuts.includes(shortcutId)) {
        this.preferences.disabledShortcuts.push(shortcutId);
      }
    }
    this.savePreferences();
  }

  // Toggle help mode
  toggleHelpMode(): void {
    this.preferences.helpModeEnabled = !this.preferences.helpModeEnabled;
    this.savePreferences();
  }

  // Toggle shortcut hints
  toggleShortcutHints(): void {
    this.preferences.showShortcutHints = !this.preferences.showShortcutHints;
    this.savePreferences();
  }

  // Reset to defaults
  resetToDefaults(): void {
    this.preferences = this.getDefaultPreferences();
    this.savePreferences();
  }

  // Export preferences
  exportPreferences(): string {
    return JSON.stringify(this.preferences, null, 2);
  }

  // Import preferences
  importPreferences(preferencesJson: string): boolean {
    try {
      const imported = JSON.parse(preferencesJson);
      this.preferences = { ...this.getDefaultPreferences(), ...imported };
      this.savePreferences();
      return true;
    } catch (error) {
      console.error('Failed to import shortcut preferences:', error);
      return false;
    }
  }
}

export const shortcutPreferences = new ShortcutPreferences();
```

### 2. Video Player Keyboard Shortcuts

#### 2.1 Enhanced Video Player Component
```typescript
// apps/web/src/components/video-player/keyboard-video-player.tsx
import React, { useEffect, useRef, useState } from 'react';
import { shortcutManager } from '@/lib/accessibility/shortcut-manager';

interface KeyboardVideoPlayerProps {
  videoUrl: string;
  title: string;
  poster?: string;
  onPlay?: () => void;
  onPause?: () => void;
  onEnded?: () => void;
  onTimeUpdate?: (currentTime: number) => void;
}

export const KeyboardVideoPlayer: React.FC<KeyboardVideoPlayerProps> = ({
  videoUrl,
  title,
  poster,
  onPlay,
  onPause,
  onEnded,
  onTimeUpdate
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Set up video event listeners
    const handlePlay = () => {
      setIsPlaying(true);
      onPlay?.();
      shortcutManager.setContext('video-player');
    };

    const handlePause = () => {
      setIsPlaying(false);
      onPause?.();
    };

    const handleEnded = () => {
      setIsPlaying(false);
      onEnded?.();
      shortcutManager.removeContext('video-player');
    };

    const handleTimeUpdate = () => {
      setCurrentTime(video.currentTime);
      onTimeUpdate?.(video.currentTime);
    };

    const handleLoadedMetadata = () => {
      setDuration(video.duration);
    };

    const handleVolumeChange = () => {
      setVolume(video.volume);
      setIsMuted(video.muted);
    };

    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('ended', handleEnded);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('volumechange', handleVolumeChange);

    // Set up fullscreen change listener
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);

    return () => {
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('ended', handleEnded);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('volumechange', handleVolumeChange);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      shortcutManager.removeContext('video-player');
    };
  }, [onPlay, onPause, onEnded, onTimeUpdate]);

  // Register video-specific shortcuts
  useEffect(() => {
    // Custom play/pause action
    shortcutManager.registerShortcut({
      id: 'video-play-pause',
      keys: ['Space', 'k'],
      description: 'Play or pause video',
      category: 'player',
      context: ['video-player'],
      action: () => {
        const video = videoRef.current;
        if (video) {
          if (video.paused) {
            video.play();
          } else {
            video.pause();
          }
        }
      },
      enabled: true,
      preventDefault: true,
      stopPropagation: true
    });

    // Seek shortcuts
    shortcutManager.registerShortcut({
      id: 'video-seek-forward',
      keys: ['ArrowRight', 'l'],
      description: 'Seek forward 10 seconds',
      category: 'player',
      context: ['video-player'],
      action: () => {
        const video = videoRef.current;
        if (video) {
          video.currentTime = Math.min(video.currentTime + 10, video.duration);
        }
      },
      enabled: true,
      preventDefault: true,
      stopPropagation: true
    });

    shortcutManager.registerShortcut({
      id: 'video-seek-backward',
      keys: ['ArrowLeft', 'j'],
      description: 'Seek backward 10 seconds',
      category: 'player',
      context: ['video-player'],
      action: () => {
        const video = videoRef.current;
        if (video) {
          video.currentTime = Math.max(video.currentTime - 10, 0);
        }
      },
      enabled: true,
      preventDefault: true,
      stopPropagation: true
    });

    // Volume shortcuts
    shortcutManager.registerShortcut({
      id: 'video-volume-up',
      keys: ['ArrowUp'],
      description: 'Increase volume by 10%',
      category: 'player',
      context: ['video-player'],
      action: () => {
        const video = videoRef.current;
        if (video) {
          video.volume = Math.min(video.volume + 0.1, 1);
        }
      },
      enabled: true,
      preventDefault: true,
      stopPropagation: true
    });

    shortcutManager.registerShortcut({
      id: 'video-volume-down',
      keys: ['ArrowDown'],
      description: 'Decrease volume by 10%',
      category: 'player',
      context: ['video-player'],
      action: () => {
        const video = videoRef.current;
        if (video) {
          video.volume = Math.max(video.volume - 0.1, 0);
        }
      },
      enabled: true,
      preventDefault: true,
      stopPropagation: true
    });

    shortcutManager.registerShortcut({
      id: 'video-mute',
      keys: ['m'],
      description: 'Toggle mute',
      category: 'player',
      context: ['video-player'],
      action: () => {
        const video = videoRef.current;
        if (video) {
          video.muted = !video.muted;
        }
      },
      enabled: true,
      preventDefault: true,
      stopPropagation: true
    });

    // Fullscreen shortcut
    shortcutManager.registerShortcut({
      id: 'video-fullscreen',
      keys: ['f'],
      description: 'Toggle fullscreen',
      category: 'player',
      context: ['video-player'],
      action: () => {
        const container = containerRef.current;
        if (container) {
          if (!document.fullscreenElement) {
            container.requestFullscreen();
          } else {
            document.exitFullscreen();
          }
        }
      },
      enabled: true,
      preventDefault: true,
      stopPropagation: true
    });

    // Speed control shortcuts
    shortcutManager.registerShortcut({
      id: 'video-speed-up',
      keys: ['>'],
      description: 'Increase playback speed',
      category: 'player',
      context: ['video-player'],
      action: () => {
        const video = videoRef.current;
        if (video) {
          const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
          const currentIndex = speeds.findIndex(speed => speed >= video.playbackRate);
          const nextIndex = Math.min(currentIndex + 1, speeds.length - 1);
          video.playbackRate = speeds[nextIndex];
        }
      },
      enabled: true,
      preventDefault: true,
      stopPropagation: true
    });

    shortcutManager.registerShortcut({
      id: 'video-speed-down',
      keys: ['<'],
      description: 'Decrease playback speed',
      category: 'player',
      context: ['video-player'],
      action: () => {
        const video = videoRef.current;
        if (video) {
          const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
          const currentIndex = speeds.findIndex(speed => speed >= video.playbackRate);
          const prevIndex = Math.max(currentIndex - 1, 0);
          video.playbackRate = speeds[prevIndex];
        }
      },
      enabled: true,
      preventDefault: true,
      stopPropagation: true
    });

    // Picture-in-Picture shortcut
    shortcutManager.registerShortcut({
      id: 'video-pip',
      keys: ['p'],
      description: 'Toggle picture-in-picture',
      category: 'player',
      context: ['video-player'],
      action: async () => {
        const video = videoRef.current;
        if (video && 'pictureInPictureEnabled' in document) {
          try {
            if (document.pictureInPictureElement) {
              await document.exitPictureInPicture();
            } else {
              await video.requestPictureInPicture();
            }
          } catch (error) {
            console.warn('Picture-in-Picture not available:', error);
          }
        }
      },
      enabled: true,
      preventDefault: true,
      stopPropagation: true
    });

    // Help shortcut
    shortcutManager.registerShortcut({
      id: 'video-help',
      keys: ['?'],
      description: 'Show keyboard shortcuts',
      category: 'player',
      context: ['video-player'],
      action: () => {
        setShowShortcuts(!showShortcuts);
      },
      enabled: true,
      preventDefault: true,
      stopPropagation: true
    });

    return () => {
      // Cleanup shortcuts when component unmounts
      // Note: In a real implementation, you'd want to track and remove specific shortcuts
    };
  }, [showShortcuts]);

  const formatTime = (time: number): string => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const shortcuts = shortcutManager.getAvailableShortcuts()
    .filter(shortcut => shortcut.context?.includes('video-player'));

  return (
    <div 
      ref={containerRef}
      className="keyboard-video-player relative bg-black rounded-lg overflow-hidden"
      role="application"
      aria-label={`Video player: ${title}`}
    >
      {/* Video Element */}
      <video
        ref={videoRef}
        src={videoUrl}
        poster={poster}
        className="w-full h-auto"
        controls={false} // We're using custom keyboard controls
        aria-label={title}
      />

      {/* Custom Controls */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4">
        <div className="flex items-center space-x-4 text-white">
          {/* Play/Pause Button */}
          <button
            onClick={() => {
              const video = videoRef.current;
              if (video) {
                if (video.paused) {
                  video.play();
                } else {
                  video.pause();
                }
              }
            }}
            className="p-2 rounded hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white"
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? '⏸️' : '▶️'}
          </button>

          {/* Time Display */}
          <span className="text-sm" aria-live="polite">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>

          {/* Volume Control */}
          <div className="flex items-center space-x-2">
            <button
              onClick={() => {
                const video = videoRef.current;
                if (video) {
                  video.muted = !video.muted;
                }
              }}
              className="p-2 rounded hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white"
              aria-label={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted ? '🔇' : '🔊'}
            </button>
            <span className="text-sm" aria-live="polite">
              {Math.round(volume * 100)}%
            </span>
          </div>

          {/* Fullscreen Button */}
          <button
            onClick={() => {
              const container = containerRef.current;
              if (container) {
                if (!document.fullscreenElement) {
                  container.requestFullscreen();
                } else {
                  document.exitFullscreen();
                }
              }
            }}
            className="p-2 rounded hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white ml-auto"
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          >
            {isFullscreen ? '🗗' : '🗖'}
          </button>

          {/* Help Button */}
          <button
            onClick={() => setShowShortcuts(!showShortcuts)}
            className="p-2 rounded hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white"
            aria-label="Show keyboard shortcuts"
          >
            ⌨️
          </button>
        </div>
      </div>

      {/* Keyboard Shortcuts Panel */}
      {showShortcuts && (
        <div className="absolute inset-0 bg-black/90 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-2xl max-h-[80vh] overflow-y-auto">
            <h2 className="text-2xl font-bold mb-4">Keyboard Shortcuts</h2>
            <div className="space-y-4">
              {Object.entries(
                shortcuts.reduce((acc, shortcut) => {
                  if (!acc[shortcut.category]) {
                    acc[shortcut.category] = [];
                  }
                  acc[shortcut.category].push(shortcut);
                  return acc;
                }, {} as Record<string, typeof shortcuts>)
              ).map(([category, categoryShortcuts]) => (
                <div key={category}>
                  <h3 className="font-semibold text-lg mb-2 capitalize">
                    {category.replace('-', ' ')}
                  </h3>
                  <ul className="space-y-2">
                    {categoryShortcuts.map(shortcut => (
                      <li key={shortcut.id} className="flex justify-between">
                        <span>{shortcut.description}</span>
                        <kbd className="px-2 py-1 bg-gray-100 rounded text-sm">
                          {shortcut.keys.join(' / ')}
                        </kbd>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <button
              onClick={() => setShowShortcuts(false)}
              className="mt-6 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Screen reader announcements */}
      <div
        className="sr-only"
        aria-live="polite"
        aria-atomic="true"
      >
        {isPlaying ? 'Video playing' : 'Video paused'}
        {isFullscreen && 'Fullscreen mode'}
        {isMuted && 'Video muted'}
      </div>
    </div>
  );
};
```

### 3. Shortcut Help Components

#### 3.1 Keyboard Shortcuts Modal
```typescript
// apps/web/src/components/accessibility/keyboard-shortcuts-modal.tsx
import React, { useState, useEffect } from 'react';
import { shortcutManager } from '@/lib/accessibility/shortcut-manager';

interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
  category?: string;
}

export const KeyboardShortcutsModal: React.FC<KeyboardShortcutsModalProps> = ({
  isOpen,
  onClose,
  category
}) => {
  const [shortcuts, setShortcuts] = useState(shortcutManager.getAvailableShortcuts());
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    if (isOpen) {
      setShortcuts(shortcutManager.getAvailableShortcuts());
    }
  }, [isOpen]);

  const filteredShortcuts = shortcuts.filter(shortcut => {
    const matchesCategory = !category || shortcut.category === category;
    const matchesSearch = !searchTerm || 
      shortcut.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
      shortcut.keys.some(key => key.toLowerCase().includes(searchTerm.toLowerCase()));
    
    return matchesCategory && matchesSearch;
  });

  const groupedShortcuts = filteredShortcuts.reduce((acc, shortcut) => {
    if (!acc[shortcut.category]) {
      acc[shortcut.category] = [];
    }
    acc[shortcut.category].push(shortcut);
    return acc;
  }, {} as Record<string, typeof filteredShortcuts>);

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-title"
    >
      <div className="bg-white rounded-lg max-w-4xl w-full max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-6 border-b">
          <div className="flex items-center justify-between">
            <h2 id="shortcuts-title" className="text-2xl font-bold">
              Keyboard Shortcuts
            </h2>
            <button
              onClick={onClose}
              className="p-2 rounded hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-label="Close shortcuts"
            >
              ✕
            </button>
          </div>
          
          {/* Search */}
          <div className="mt-4">
            <input
              type="text"
              placeholder="Search shortcuts..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-label="Search keyboard shortcuts"
            />
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {Object.entries(groupedShortcuts).map(([category, categoryShortcuts]) => (
            <div key={category} className="mb-6">
              <h3 className="text-lg font-semibold mb-3 capitalize">
                {category.replace('-', ' ')}
              </h3>
              <div className="grid gap-2">
                {categoryShortcuts.map(shortcut => (
                  <div 
                    key={shortcut.id} 
                    className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                  >
                    <div className="flex-1">
                      <div className="font-medium">{shortcut.description}</div>
                      {shortcut.context && shortcut.context.length > 0 && (
                        <div className="text-sm text-gray-600">
                          Context: {shortcut.context.join(', ')}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2">
                      {shortcut.keys.map((key, index) => (
                        <React.Fragment key={key}>
                          {index > 0 && <span className="text-gray-400">or</span>}
                          <kbd className="px-2 py-1 bg-white border border-gray-300 rounded text-sm font-mono">
                            {key}
                          </kbd>
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="p-6 border-t bg-gray-50">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-600">
              Press <kbd className="px-2 py-1 bg-white border rounded">?</kbd> to toggle this help
            </div>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Got it
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
```

#### 3.2 Shortcut Hints Component
```typescript
// apps/web/src/components/accessibility/shortcut-hints.tsx
import React, { useState, useEffect } from 'react';
import { shortcutManager } from '@/lib/accessibility/shortcut-manager';
import { shortcutPreferences } from '@/lib/accessibility/shortcut-preferences';

interface ShortcutHint {
  element: HTMLElement;
  shortcut: string;
  description: string;
  position: 'top' | 'bottom' | 'left' | 'right';
}

export const ShortcutHints: React.FC = () => {
  const [hints, setHints] = useState<ShortcutHint[]>([]);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const preferences = shortcutPreferences.getPreferences();
    setIsVisible(preferences.showShortcutHints);

    // Scan for elements with shortcut hints
    const scanForHints = () => {
      const elements = document.querySelectorAll('[data-shortcut]');
      const foundHints: ShortcutHint[] = [];

      elements.forEach(element => {
        const shortcut = element.getAttribute('data-shortcut');
        const description = element.getAttribute('data-shortcut-description') || 
                          element.getAttribute('aria-label') || 
                          element.textContent || '';
        const position = (element.getAttribute('data-shortcut-position') as any) || 'top';

        if (shortcut) {
          foundHints.push({
            element: element as HTMLElement,
            shortcut,
            description,
            position
          });
        }
      });

      setHints(foundHints);
    };

    scanForHints();

    // Re-scan when DOM changes
    const observer = new MutationObserver(scanForHints);
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    return () => observer.disconnect();
  }, []);

  if (!isVisible || hints.length === 0) return null;

  return (
    <>
      {hints.map((hint, index) => (
        <ShortcutHint
          key={index}
          element={hint.element}
          shortcut={hint.shortcut}
          description={hint.description}
          position={hint.position}
        />
      ))}
    </>
  );
};

interface ShortcutHintProps {
  element: HTMLElement;
  shortcut: string;
  description: string;
  position: 'top' | 'bottom' | 'left' | 'right';
}

const ShortcutHint: React.FC<ShortcutHintProps> = ({
  element,
  shortcut,
  description,
  position
}) => {
  const [coords, setCoords] = useState({ top: 0, left: 0 });

  useEffect(() => {
    const updateCoords = () => {
      const rect = element.getBoundingClientRect();
      let top = rect.top;
      let left = rect.left;

      switch (position) {
        case 'top':
          top -= 40;
          left += rect.width / 2;
          break;
        case 'bottom':
          top += rect.height + 10;
          left += rect.width / 2;
          break;
        case 'left':
          top += rect.height / 2;
          left -= 10;
          break;
        case 'right':
          top += rect.height / 2;
          left += rect.width + 10;
          break;
      }

      setCoords({ top, left });
    };

    updateCoords();

    const resizeObserver = new ResizeObserver(updateCoords);
    resizeObserver.observe(element);

    return () => resizeObserver.disconnect();
  }, [element, position]);

  const positionClasses = {
    top: 'transform -translate-x-1/2 -translate-y-full',
    bottom: 'transform -translate-x-1/2',
    left: 'transform -translate-y-1/2 -translate-x-full',
    right: 'transform -translate-y-1/2'
  };

  return (
    <div
      className={`fixed z-50 px-2 py-1 bg-gray-900 text-white text-xs rounded pointer-events-none ${positionClasses[position]}`}
      style={{
        top: `${coords.top}px`,
        left: `${coords.left}px`
      }}
      role="tooltip"
      aria-hidden="true"
    >
      <kbd className="font-mono">{shortcut}</kbd>
      {description && (
        <span className="ml-2 opacity-75">{description}</span>
      )}
    </div>
  );
};
```

### 4. Testing Strategy

#### 4.1 Unit Tests
```typescript
// apps/web/src/__tests__/accessibility/shortcut-manager.test.ts
import { ShortcutManager } from '@/lib/accessibility/shortcut-manager';

describe('ShortcutManager', () => {
  let manager: ShortcutManager;

  beforeEach(() => {
    manager = new ShortcutManager();
  });

  describe('shortcut registration', () => {
    it('should register a new shortcut', () => {
      const shortcut = {
        id: 'test-shortcut',
        keys: ['Ctrl+T'],
        description: 'Test shortcut',
        category: 'test' as const,
        action: jest.fn(),
        enabled: true,
        preventDefault: true,
        stopPropagation: true
      };

      manager.registerShortcut(shortcut);
      
      const shortcuts = manager.getAvailableShortcuts();
      expect(shortcuts).toContainEqual(shortcut);
    });

    it('should handle multiple keys for same shortcut', () => {
      const shortcut = {
        id: 'multi-key-shortcut',
        keys: ['Ctrl+T', 'Alt+T'],
        description: 'Multi-key shortcut',
        category: 'test' as const,
        action: jest.fn(),
        enabled: true,
        preventDefault: true,
        stopPropagation: true
      };

      manager.registerShortcut(shortcut);
      
      const shortcuts = manager.getAvailableShortcuts();
      expect(shortcuts).toContainEqual(shortcut);
    });
  });

  describe('context management', () => {
    it('should only execute shortcuts in active context', () => {
      const action = jest.fn();
      
      manager.registerShortcut({
        id: 'context-shortcut',
        keys: ['Ctrl+C'],
        description: 'Context shortcut',
        category: 'test' as const,
        context: ['video-player'],
        action,
        enabled: true,
        preventDefault: true,
        stopPropagation: true
      });

      // Should not execute when context is not active
      const event = new KeyboardEvent('keydown', {
        key: 'c',
        ctrlKey: true,
        code: 'KeyC'
      });
      
      manager.handleKeyDown(event);
      expect(action).not.toHaveBeenCalled();

      // Should execute when context is active
      manager.setContext('video-player');
      manager.handleKeyDown(event);
      expect(action).toHaveBeenCalled();
    });
  });

  describe('conflict detection', () => {
    it('should detect shortcut conflicts', () => {
      manager.registerShortcut({
        id: 'shortcut1',
        keys: ['Ctrl+S'],
        description: 'First shortcut',
        category: 'test' as const,
        action: jest.fn(),
        enabled: true,
        preventDefault: true,
        stopPropagation: true
      });

      manager.registerShortcut({
        id: 'shortcut2',
        keys: ['Ctrl+S'],
        description: 'Second shortcut',
        category: 'test' as const,
        action: jest.fn(),
        enabled: true,
        preventDefault: true,
        stopPropagation: true
      });

      const conflicts = manager.getConflicts();
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].shortcut).toBe('Ctrl+S');
      expect(conflicts[0].conflicts).toContain('shortcut1');
      expect(conflicts[0].conflicts).toContain('shortcut2');
    });
  });

  describe('help mode', () => {
    it('should toggle help mode', () => {
      const initialHelpMode = manager.isHelpModeActive();
      manager.toggleHelpMode();
      expect(manager.isHelpModeActive()).toBe(!initialHelpMode);
    });
  });
});
```

#### 4.2 Integration Tests
```typescript
// apps/web/src/__tests__/accessibility/keyboard-video-player.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { KeyboardVideoPlayer } from '@/components/video-player/keyboard-video-player';

describe('KeyboardVideoPlayer', () => {
  const mockProps = {
    videoUrl: 'https://example.com/video.mp4',
    title: 'Test Video'
  };

  it('should render video player with keyboard controls', () => {
    render(<KeyboardVideoPlayer {...mockProps} />);
    
    const video = screen.getByRole('application');
    expect(video).toBeInTheDocument();
    expect(video).toHaveAttribute('aria-label', 'Video player: Test Video');
  });

  it('should handle spacebar for play/pause', async () => {
    const user = userEvent.setup();
    render(<KeyboardVideoPlayer {...mockProps} />);
    
    const video = screen.getByRole('application').querySelector('video');
    expect(video).toBeInTheDocument();

    // Press spacebar
    await user.keyboard(' ');
    
    // Video should play (mock implementation would verify this)
    expect(video).toHaveAttribute('aria-label', 'Test Video');
  });

  it('should show keyboard shortcuts help', async () => {
    const user = userEvent.setup();
    render(<KeyboardVideoPlayer {...mockProps} />);
    
    // Press ? to show help
    await user.keyboard('?');
    
    expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument();
    expect(screen.getByText('Play or pause video')).toBeInTheDocument();
  });

  it('should handle arrow keys for seeking', async () => {
    const user = userEvent.setup();
    render(<KeyboardVideoPlayer {...mockProps} />);
    
    const video = screen.getByRole('application').querySelector('video');
    
    // Press right arrow to seek forward
    await user.keyboard('{ArrowRight}');
    
    // Press left arrow to seek backward
    await user.keyboard('{ArrowLeft}');
    
    expect(video).toBeInTheDocument();
  });

  it('should handle volume controls', async () => {
    const user = userEvent.setup();
    render(<KeyboardVideoPlayer {...mockProps} />);
    
    // Press up arrow for volume up
    await user.keyboard('{ArrowUp}');
    
    // Press down arrow for volume down
    await user.keyboard('{ArrowDown}');
    
    // Press m for mute
    await user.keyboard('m');
    
    const volumeDisplay = screen.getByText(/\d+%/);
    expect(volumeDisplay).toBeInTheDocument();
  });
});
```

#### 4.3 Accessibility Tests
```typescript
// apps/web/src/__tests__/accessibility/shortcut-a11y.test.ts
import { render, screen } from '@testing-library/react';
import { KeyboardShortcutsModal } from '@/components/accessibility/keyboard-shortcuts-modal';

describe('Keyboard Shortcuts Accessibility', () => {
  it('should have proper ARIA attributes', () => {
    render(
      <KeyboardShortcutsModal 
        isOpen={true} 
        onClose={() => {}} 
      />
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'shortcuts-title');
  });

  it('should announce shortcuts to screen readers', () => {
    render(
      <KeyboardShortcutsModal 
        isOpen={true} 
        onClose={() => {}} 
      />
    );

    // Check for live regions
    const liveRegions = document.querySelectorAll('[aria-live]');
    expect(liveRegions.length).toBeGreaterThan(0);
  });

  it('should be keyboard navigable', async () => {
    const user = userEvent.setup();
    render(
      <KeyboardShortcutsModal 
        isOpen={true} 
        onClose={() => {}} 
      />
    );

    // Tab through modal
    await user.tab();
    expect(screen.getByRole('button', { name: 'Close shortcuts' })).toHaveFocus();
    
    await user.tab();
    expect(screen.getByRole('textbox', { name: 'Search keyboard shortcuts' })).toHaveFocus();
  });
});
```

## Deliverables

### Phase 1: Core System (Week 1)
- [ ] `ShortcutManager` class with registration and execution
- [ ] `ShortcutPreferences` system for user customization
- [ ] Basic conflict detection and resolution
- [ ] Unit tests for core functionality (90% coverage)

### Phase 2: Video Player Integration (Week 2)
- [ ] `KeyboardVideoPlayer` component with full shortcut support
- [ ] Video-specific shortcuts (play/pause, seek, volume, fullscreen)
- [ ] Speed control and picture-in-picture shortcuts
- [ ] Integration tests for video player shortcuts

### Phase 3: Help System (Week 3)
- [ ] `KeyboardShortcutsModal` component
- [ ] `ShortcutHints` component for contextual hints
- [ ] Search and filtering functionality
- [ ] Accessibility compliance for help system

### Phase 4: Advanced Features (Week 4)
- [ ] Context-aware shortcuts
- [ ] Advanced conflict resolution
- [ ] Custom shortcut creation interface
- [ ] Export/import preferences functionality

### Phase 5: Testing & Polish (Week 5)
- [ ] Cross-browser compatibility testing
- [ ] Screen reader compatibility testing
- [ ] Performance optimization
- [ ] Documentation and user guides

## Success Metrics

### Quantitative Metrics
- **100%** of video player functions accessible via keyboard
- **95%+** user satisfaction with shortcut system
- **<100ms** response time for shortcut execution
- **0** critical accessibility violations

### Qualitative Metrics
- Intuitive shortcut combinations that don't conflict with browser/OS
- Clear visual feedback for shortcut actions
- Comprehensive help system for discoverability
- Seamless integration with existing accessibility features

## Risks & Mitigations

### Technical Risks
- **Shortcut conflicts**: Implement comprehensive conflict detection and user customization
- **Performance impact**: Optimize event handling and use passive listeners where possible
- **Browser compatibility**: Test across all supported browsers and provide fallbacks

### User Experience Risks
- **Discoverability**: Implement contextual hints and comprehensive help system
- **Learning curve**: Provide progressive disclosure and customizable shortcuts
- **Cognitive load**: Group shortcuts logically and provide clear visual indicators

## Dependencies

### Internal Dependencies
- Focus management system (Story 1.4.2)
- ARIA management system (Story 1.4.3)
- Video player component architecture

### External Dependencies
- Browser KeyboardEvent API
- Screen reader compatibility (NVDA, JAWS, VoiceOver)
- WCAG 2.1 guidelines and compliance testing

## Timeline

**Total Duration**: 5 weeks

**Week 1**: Core shortcut system and preferences
**Week 2**: Video player integration and basic shortcuts
**Week 3**: Help system and user interface
**Week 4**: Advanced features and customization
**Week 5**: Testing, optimization, and documentation

## Conclusion

This implementation plan provides a comprehensive keyboard shortcut system that enhances accessibility and power user experience while maintaining WCAG 2.1 Level AA compliance. The modular design allows for incremental implementation and testing, ensuring robust functionality across all supported browsers and assistive technologies.

The system prioritizes user experience through intuitive shortcuts, comprehensive help features, and customization options, making video content accessible to all users regardless of their interaction preferences or assistive technology needs.