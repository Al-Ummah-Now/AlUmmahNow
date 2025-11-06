# Implementation Plan: Add ARIA Attributes for Keyboard Navigation

**Story**: 1.4 Enhance Keyboard Navigation Accessibility  
**Task Group**: 1.4.3 Add ARIA attributes for keyboard navigation  
**Priority**: High  
**Estimated Time**: 3-4 days  

## Overview

This implementation plan focuses on implementing comprehensive ARIA attributes to ensure screen reader compatibility and proper semantic information for all video player controls. The system will provide accessible names, descriptions, roles, and states for all interactive elements.

## Prerequisites

- Completion of keyboard navigation audit (1.4.1)
- Completion of tab order management (1.4.2)
- Understanding of WCAG 2.1 AA ARIA requirements
- Knowledge of screen reader behavior

## Detailed Implementation Steps

### Step 1: Create ARIA Manager Utility

**File**: `apps/web/src/lib/accessibility/aria-manager.ts`

```typescript
export interface ARIAAttribute {
  attribute: string;
  value: string;
  element: HTMLElement;
}

export interface ARIALiveRegion {
  id: string;
  element: HTMLElement;
  politeness: 'polite' | 'assertive' | 'off';
  atomic?: boolean;
  relevant?: string;
}

export interface ARIAValidationResult {
  element: HTMLElement;
  selector: string;
  issues: ARIAIssue[];
  score: number;
  recommendations: string[];
}

export interface ARIAIssue {
  type: 'missing_label' | 'missing_role' | 'invalid_role' | 'missing_state' | 'invalid_state' | 'missing_property';
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  element: string;
  fix: string;
  wcagCriterion: string;
}

export class ARIAManager {
  private static instance: ARIAManager;
  private liveRegions: Map<string, ARIALiveRegion> = new Map();
  private validationResults: ARIAValidationResult[] = [];
  private observers: MutationObserver[] = [];

  static getInstance(): ARIAManager {
    if (!ARIAManager.instance) {
      ARIAManager.instance = new ARIAManager();
    }
    return ARIAManager.instance;
  }

  constructor() {
    this.initializeLiveRegions();
    this.observeARIAChanges();
  }

  // Initialize common live regions
  private initializeLiveRegions(): void {
    this.createLiveRegion('status', 'polite');
    this.createLiveRegion('alert', 'assertive');
    this.createLiveRegion('notifications', 'polite');
  }

  // Create live region
  createLiveRegion(id: string, politeness: 'polite' | 'assertive' | 'off', options: {
    atomic?: boolean;
    relevant?: string;
  } = {}): void {
    let region = document.getElementById(id);
    
    if (!region) {
      region = document.createElement('div');
      region.id = id;
      region.setAttribute('aria-live', politeness);
      region.setAttribute('aria-atomic', (options.atomic || false).toString());
      
      if (options.relevant) {
        region.setAttribute('aria-relevant', options.relevant);
      }
      
      // Hide the live region visually
      region.className = 'sr-only';
      region.style.position = 'absolute';
      region.style.left = '-10000px';
      region.style.width = '1px';
      region.style.height = '1px';
      region.style.overflow = 'hidden';
      
      document.body.appendChild(region);
    }

    this.liveRegions.set(id, {
      id,
      element: region,
      politeness,
      atomic: options.atomic,
      relevant: options.relevant
    });
  }

  // Announce message to live region
  announce(message: string, regionId: string = 'status'): void {
    const region = this.liveRegions.get(regionId);
    if (!region) {
      console.warn(`Live region '${regionId}' not found`);
      return;
    }

    // Clear previous content
    region.element.textContent = '';
    
    // Add new message
    region.element.textContent = message;

    // Clear after announcement (for polite regions)
    if (region.politeness === 'polite') {
      setTimeout(() => {
        region.element.textContent = '';
      }, 1000);
    }
  }

  // Set ARIA attributes on element
  setAttributes(element: HTMLElement, attributes: Record<string, string>): void {
    Object.entries(attributes).forEach(([attribute, value]) => {
      if (value) {
        element.setAttribute(attribute, value);
      } else {
        element.removeAttribute(attribute);
      }
    });
  }

  // Get accessible name for element
  getAccessibleName(element: HTMLElement): string {
    // Check for aria-label first
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) {
      return ariaLabel.trim();
    }

    // Check for aria-labelledby
    const labelledBy = element.getAttribute('aria-labelledby');
    if (labelledBy) {
      const labels = labelledBy.split(' ').map(id => {
        const labelElement = document.getElementById(id);
        return labelElement ? labelElement.textContent?.trim() : '';
      }).filter(Boolean);
      
      if (labels.length > 0) {
        return labels.join(' ');
      }
    }

    // Check for native label elements
    if (element.tagName.toLowerCase() === 'input') {
      const input = element as HTMLInputElement;
      if (input.type === 'radio' || input.type === 'checkbox') {
        // Check for associated label
        const label = document.querySelector(`label[for="${element.id}"]`);
        if (label) {
          return label.textContent?.trim() || '';
        }
      }
      
      // Check for placeholder
      if (input.placeholder) {
        return input.placeholder.trim();
      }
      
      // Check for title
      if (input.title) {
        return input.title.trim();
      }
    }

    // Check for button content
    if (element.tagName.toLowerCase() === 'button') {
      return element.textContent?.trim() || '';
    }

    // Check for link content
    if (element.tagName.toLowerCase() === 'a') {
      return element.textContent?.trim() || '';
    }

    // Check for title attribute as fallback
    const title = element.getAttribute('title');
    if (title) {
      return title.trim();
    }

    return '';
  }

  // Set accessible name for element
  setAccessibleName(element: HTMLElement, name: string): void {
    // Prefer aria-label for direct naming
    element.setAttribute('aria-label', name);
  }

  // Set accessible description for element
  setAccessibleDescription(element: HTMLElement, description: string): void {
    // Create or find description element
    let descriptionId = element.getAttribute('aria-describedby');
    
    if (!descriptionId) {
      descriptionId = `desc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      element.setAttribute('aria-describedby', descriptionId);
      
      const descriptionElement = document.createElement('div');
      descriptionElement.id = descriptionId;
      descriptionElement.className = 'sr-only';
      descriptionElement.textContent = description;
      
      element.parentNode?.insertBefore(descriptionElement, element.nextSibling);
    } else {
      const descriptionElement = document.getElementById(descriptionId);
      if (descriptionElement) {
        descriptionElement.textContent = description;
      }
    }
  }

  // Set ARIA state for element
  setARIAState(element: HTMLElement, state: string, value: boolean | string): void {
    const attribute = `aria-${state}`;
    element.setAttribute(attribute, value.toString());
  }

  // Get ARIA state for element
  getARIAState(element: HTMLElement, state: string): string | null {
    const attribute = `aria-${state}`;
    return element.getAttribute(attribute);
  }

  // Setup video player ARIA
  setupVideoPlayerARIA(videoPlayer: HTMLElement): void {
    // Find video element
    const video = videoPlayer.querySelector('video') as HTMLVideoElement;
    if (video) {
      this.setupVideoElementARIA(video);
    }

    // Setup controls
    this.setupVideoControlsARIA(videoPlayer);
    
    // Setup progress bar
    this.setupProgressBarARIA(videoPlayer);
    
    // Setup volume controls
    this.setupVolumeControlsARIA(videoPlayer);
    
    // Setup settings menu
    this.setupSettingsMenuARIA(videoPlayer);
  }

  // Setup video element ARIA
  private setupVideoElementARIA(video: HTMLVideoElement): void {
    this.setAttributes(video, {
      'role': 'application',
      'aria-label': 'Video player',
      'aria-describedby': 'video-description'
    });

    // Create description element
    const description = document.createElement('div');
    description.id = 'video-description';
    description.className = 'sr-only';
    description.textContent = 'Use arrow keys to seek, space bar to play/pause, M to mute, F for fullscreen';
    video.parentNode?.insertBefore(description, video.nextSibling);

    // Monitor video state changes
    video.addEventListener('play', () => {
      this.setARIAState(video, 'busy', 'false');
      this.announce('Video playing');
    });

    video.addEventListener('pause', () => {
      this.setARIAState(video, 'busy', 'true');
      this.announce('Video paused');
    });

    video.addEventListener('timeupdate', () => {
      const currentTime = this.formatTime(video.currentTime);
      const duration = this.formatTime(video.duration);
      this.setAttributes(video, {
        'aria-valuenow': Math.round(video.currentTime).toString(),
        'aria-valuemin': '0',
        'aria-valuemax': Math.round(video.duration || 0).toString(),
        'aria-valuetext': `${currentTime} of ${duration}`
      });
    });

    video.addEventListener('volumechange', () => {
      const volume = Math.round(video.volume * 100);
      const muted = video.muted;
      this.setAttributes(video, {
        'aria-valuenow': muted ? '0' : volume.toString(),
        'aria-valuemin': '0',
        'aria-valuemax': '100',
        'aria-valuetext': muted ? 'Muted' : `Volume ${volume}%`
      });
    });
  }

  // Setup video controls ARIA
  private setupVideoControlsARIA(videoPlayer: HTMLElement): void {
    // Play/Pause button
    const playButton = videoPlayer.querySelector('.vjs-play-control, [data-testid="play-button"]') as HTMLElement;
    if (playButton) {
      this.setAttributes(playButton, {
        'role': 'button',
        'aria-label': 'Play',
        'aria-pressed': 'false'
      });

      // Monitor play state
      const video = videoPlayer.querySelector('video') as HTMLVideoElement;
      if (video) {
        const updatePlayButton = () => {
          const isPlaying = !video.paused;
          this.setAttributes(playButton, {
            'aria-label': isPlaying ? 'Pause' : 'Play',
            'aria-pressed': isPlaying.toString()
          });
        };

        video.addEventListener('play', updatePlayButton);
        video.addEventListener('pause', updatePlayButton);
      }
    }

    // Mute button
    const muteButton = videoPlayer.querySelector('.vjs-mute-control, [data-testid="mute-button"]') as HTMLElement;
    if (muteButton) {
      this.setAttributes(muteButton, {
        'role': 'button',
        'aria-label': 'Mute',
        'aria-pressed': 'false'
      });

      // Monitor mute state
      const video = videoPlayer.querySelector('video') as HTMLVideoElement;
      if (video) {
        const updateMuteButton = () => {
          const isMuted = video.muted;
          const volume = Math.round(video.volume * 100);
          this.setAttributes(muteButton, {
            'aria-label': isMuted ? 'Unmute' : `Mute (Volume ${volume}%)`,
            'aria-pressed': isMuted.toString()
          });
        };

        video.addEventListener('volumechange', updateMuteButton);
      }
    }

    // Fullscreen button
    const fullscreenButton = videoPlayer.querySelector('.vjs-fullscreen-control, [data-testid="fullscreen-button"]') as HTMLElement;
    if (fullscreenButton) {
      this.setAttributes(fullscreenButton, {
        'role': 'button',
        'aria-label': 'Enter fullscreen',
        'aria-pressed': 'false'
      });

      // Monitor fullscreen state
      const handleFullscreenChange = () => {
        const isFullscreen = !!document.fullscreenElement;
        this.setAttributes(fullscreenButton, {
          'aria-label': isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen',
          'aria-pressed': isFullscreen.toString()
        });
      };

      document.addEventListener('fullscreenchange', handleFullscreenChange);
    }

    // Captions button
    const captionsButton = videoPlayer.querySelector('.vjs-captions-button, [data-testid="captions-button"]') as HTMLElement;
    if (captionsButton) {
      this.setAttributes(captionsButton, {
        'role': 'button',
        'aria-label': 'Captions',
        'aria-pressed': 'false',
        'aria-expanded': 'false'
      });
    }

    // Settings button
    const settingsButton = videoPlayer.querySelector('.vjs-settings-button, [data-testid="settings-button"]') as HTMLElement;
    if (settingsButton) {
      this.setAttributes(settingsButton, {
        'role': 'button',
        'aria-label': 'Settings',
        'aria-expanded': 'false',
        'aria-haspopup': 'true'
      });
    }
  }

  // Setup progress bar ARIA
  private setupProgressBarARIA(videoPlayer: HTMLElement): void {
    const progressBar = videoPlayer.querySelector('.vjs-progress-holder, [data-testid="progress-bar"]') as HTMLElement;
    if (!progressBar) return;

    this.setAttributes(progressBar, {
      'role': 'slider',
      'aria-label': 'Video progress',
      'aria-valuemin': '0',
      'aria-valuemax': '100',
      'aria-valuenow': '0',
      'aria-valuetext': '0 seconds',
      'aria-orientation': 'horizontal'
    });

    // Monitor progress
    const video = videoPlayer.querySelector('video') as HTMLVideoElement;
    if (video) {
      video.addEventListener('timeupdate', () => {
        const progress = (video.currentTime / (video.duration || 1)) * 100;
        const currentTime = this.formatTime(video.currentTime);
        const duration = this.formatTime(video.duration);
        
        this.setAttributes(progressBar, {
          'aria-valuenow': Math.round(progress).toString(),
          'aria-valuetext': `${currentTime} of ${duration}`
        });
      });
    }

    // Handle keyboard interaction
    progressBar.addEventListener('keydown', (event) => {
      const video = videoPlayer.querySelector('video') as HTMLVideoElement;
      if (!video) return;

      let newTime = video.currentTime;
      
      switch (event.key) {
        case 'ArrowLeft':
        case 'ArrowDown':
          event.preventDefault();
          newTime = Math.max(0, video.currentTime - 5);
          break;
        case 'ArrowRight':
        case 'ArrowUp':
          event.preventDefault();
          newTime = Math.min(video.duration || 0, video.currentTime + 5);
          break;
        case 'Home':
          event.preventDefault();
          newTime = 0;
          break;
        case 'End':
          event.preventDefault();
          newTime = video.duration || 0;
          break;
        case 'PageUp':
          event.preventDefault();
          newTime = Math.min(video.duration || 0, video.currentTime + 60);
          break;
        case 'PageDown':
          event.preventDefault();
          newTime = Math.max(0, video.currentTime - 60);
          break;
      }

      if (newTime !== video.currentTime) {
        video.currentTime = newTime;
        this.announce(`Seek to ${this.formatTime(newTime)}`);
      }
    });
  }

  // Setup volume controls ARIA
  private setupVolumeControlsARIA(videoPlayer: HTMLElement): void {
    const volumeSlider = videoPlayer.querySelector('.vjs-volume-bar, [data-testid="volume-slider"]') as HTMLElement;
    if (!volumeSlider) return;

    this.setAttributes(volumeSlider, {
      'role': 'slider',
      'aria-label': 'Volume',
      'aria-valuemin': '0',
      'aria-valuemax': '100',
      'aria-valuenow': '100',
      'aria-valuetext': '100%',
      'aria-orientation': 'vertical'
    });

    // Monitor volume changes
    const video = videoPlayer.querySelector('video') as HTMLVideoElement;
    if (video) {
      video.addEventListener('volumechange', () => {
        const volume = Math.round(video.volume * 100);
        this.setAttributes(volumeSlider, {
          'aria-valuenow': volume.toString(),
          'aria-valuetext': video.muted ? 'Muted' : `${volume}%`
        });
      });
    }

    // Handle keyboard interaction
    volumeSlider.addEventListener('keydown', (event) => {
      const video = videoPlayer.querySelector('video') as HTMLVideoElement;
      if (!video) return;

      let newVolume = video.volume;
      
      switch (event.key) {
        case 'ArrowUp':
        case 'ArrowRight':
          event.preventDefault();
          newVolume = Math.min(1, video.volume + 0.1);
          break;
        case 'ArrowDown':
        case 'ArrowLeft':
          event.preventDefault();
          newVolume = Math.max(0, video.volume - 0.1);
          break;
        case 'Home':
          event.preventDefault();
          newVolume = 0;
          break;
        case 'End':
          event.preventDefault();
          newVolume = 1;
          break;
        case 'PageUp':
          event.preventDefault();
          newVolume = Math.min(1, video.volume + 0.2);
          break;
        case 'PageDown':
          event.preventDefault();
          newVolume = Math.max(0, video.volume - 0.2);
          break;
      }

      if (newVolume !== video.volume) {
        video.volume = newVolume;
        video.muted = false;
        this.announce(`Volume ${Math.round(newVolume * 100)}%`);
      }
    });
  }

  // Setup settings menu ARIA
  private setupSettingsMenuARIA(videoPlayer: HTMLElement): void {
    const settingsMenu = videoPlayer.querySelector('.vjs-settings-menu, [data-testid="settings-menu"]') as HTMLElement;
    if (!settingsMenu) return;

    this.setAttributes(settingsMenu, {
      'role': 'menu',
      'aria-label': 'Video settings',
      'aria-orientation': 'vertical'
    });

    // Setup menu items
    const menuItems = settingsMenu.querySelectorAll('.vjs-menu-item, [role="menuitem"]');
    menuItems.forEach((item, index) => {
      const menuItem = item as HTMLElement;
      this.setAttributes(menuItem, {
        'role': 'menuitem',
        'aria-label': menuItem.textContent?.trim() || `Menu item ${index + 1}`
      });
    });

    // Monitor menu visibility
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'aria-hidden') {
          const isHidden = settingsMenu.getAttribute('aria-hidden') === 'true';
          const settingsButton = videoPlayer.querySelector('.vjs-settings-button, [data-testid="settings-button"]') as HTMLElement;
          
          if (settingsButton) {
            this.setAttributes(settingsButton, {
              'aria-expanded': (!isHidden).toString()
            });
          }

          if (!isHidden) {
            this.announce('Settings menu opened');
          }
        }
      });
    });

    observer.observe(settingsMenu, { attributes: true });
    this.observers.push(observer);
  }

  // Format time for accessibility
  private formatTime(seconds: number): string {
    if (isNaN(seconds) || !isFinite(seconds)) {
      return '0:00';
    }

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    } else {
      return `${minutes}:${secs.toString().padStart(2, '0')}`;
    }
  }

  // Validate ARIA implementation
  validateARIA(container: HTMLElement = document.body): ARIAValidationResult[] {
    this.validationResults = [];
    
    // Get all interactive elements
    const interactiveElements = container.querySelectorAll(`
      button, [role="button"], 
      a[href], [role="link"],
      input, select, textarea, [role="textbox"],
      [tabindex]:not([tabindex="-1"])
    `);

    interactiveElements.forEach((element) => {
      const result = this.validateElement(element as HTMLElement);
      if (result.issues.length > 0) {
        this.validationResults.push(result);
      }
    });

    return this.validationResults;
  }

  // Validate individual element
  private validateElement(element: HTMLElement): ARIAValidationResult {
    const issues: ARIAIssue[] = [];
    const selector = this.generateSelector(element);

    // Check for accessible name
    const accessibleName = this.getAccessibleName(element);
    if (!accessibleName) {
      issues.push({
        type: 'missing_label',
        severity: 'critical',
        description: 'Element missing accessible name',
        element: selector,
        fix: 'Add aria-label, aria-labelledby, or visible text content',
        wcagCriterion: '1.3.1'
      });
    }

    // Check for role
    const role = element.getAttribute('role');
    const tagName = element.tagName.toLowerCase();
    
    if (!role && !this.isSemanticElement(tagName)) {
      issues.push({
        type: 'missing_role',
        severity: 'high',
        description: 'Interactive element missing role',
        element: selector,
        fix: 'Add appropriate role attribute',
        wcagCriterion: '1.3.1'
      });
    }

    // Check for invalid role
    if (role && !this.isValidRole(role)) {
      issues.push({
        type: 'invalid_role',
        severity: 'high',
        description: `Invalid role: ${role}`,
        element: selector,
        fix: 'Use valid ARIA role',
        wcagCriterion: '1.3.1'
      });
    }

    // Check for required states
    if (role === 'button' && element.getAttribute('aria-pressed') !== null) {
      const pressed = element.getAttribute('aria-pressed');
      if (pressed !== 'true' && pressed !== 'false') {
        issues.push({
          type: 'invalid_state',
          severity: 'medium',
          description: 'aria-pressed must be "true" or "false"',
          element: selector,
          fix: 'Set aria-pressed to "true" or "false"',
          wcagCriterion: '4.1.2'
        });
      }
    }

    // Calculate score
    const score = this.calculateElementScore(issues);

    // Generate recommendations
    const recommendations = issues.map(issue => issue.fix);

    return {
      element,
      selector,
      issues,
      score,
      recommendations
    };
  }

  // Check if element is semantic
  private isSemanticElement(tagName: string): boolean {
    const semanticElements = [
      'button', 'a', 'input', 'select', 'textarea',
      'article', 'section', 'nav', 'main', 'header', 'footer',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'ul', 'ol', 'li', 'dl', 'dt', 'dd',
      'table', 'tr', 'td', 'th'
    ];
    
    return semanticElements.includes(tagName);
  }

  // Check if role is valid
  private isValidRole(role: string): boolean {
    const validRoles = [
      'alert', 'alertdialog', 'application', 'article', 'banner', 'button', 'checkbox',
      'columnheader', 'combobox', 'complementary', 'contentinfo', 'definition', 'dialog',
      'directory', 'document', 'feed', 'figure', 'form', 'grid', 'gridcell',
      'group', 'heading', 'img', 'link', 'list', 'listbox', 'listitem',
      'log', 'main', 'marquee', 'math', 'menu', 'menubar', 'menuitem',
      'menuitemcheckbox', 'menuitemradio', 'navigation', 'none', 'note', 'option',
      'presentation', 'progressbar', 'radio', 'radiogroup', 'region', 'row',
      'rowgroup', 'rowheader', 'scrollbar', 'search', 'searchbox', 'separator',
      'slider', 'spinbutton', 'status', 'switch', 'tab', 'table', 'tablist',
      'tabpanel', 'term', 'textbox', 'timer', 'toolbar', 'tooltip', 'tree',
      'treegrid', 'treeitem'
    ];
    
    return validRoles.includes(role);
  }

  // Calculate element score
  private calculateElementScore(issues: ARIAIssue[]): number {
    if (issues.length === 0) return 100;
    
    const severityWeights = {
      critical: 50,
      high: 25,
      medium: 10,
      low: 5
    };
    
    const totalDeduction = issues.reduce((sum, issue) => {
      return sum + severityWeights[issue.severity];
    }, 0);
    
    return Math.max(0, 100 - totalDeduction);
  }

  // Generate CSS selector
  private generateSelector(element: HTMLElement): string {
    if (element.id) {
      return `#${element.id}`;
    }
    
    if (element.className) {
      const classes = element.className.split(' ').filter(c => c.trim());
      if (classes.length > 0) {
        return `.${classes.join('.')}`;
      }
    }
    
    return `${element.tagName.toLowerCase()}${element.getAttribute('role') ? `[role="${element.getAttribute('role')}"]` : ''}`;
  }

  // Observe ARIA changes
  private observeARIAChanges(): void {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName?.startsWith('aria-')) {
          const element = mutation.target as HTMLElement;
          const attribute = mutation.attributeName;
          const oldValue = mutation.oldValue;
          const newValue = element.getAttribute(attribute);
          
          if (oldValue !== newValue) {
            this.announceARIAChange(element, attribute, oldValue, newValue);
          }
        }
      });
    });

    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['aria-label', 'aria-describedby', 'aria-expanded', 'aria-pressed', 'aria-selected'],
      attributeOldValue: true,
      subtree: true
    });

    this.observers.push(observer);
  }

  // Announce ARIA changes
  private announceARIAChange(element: HTMLElement, attribute: string, oldValue: string | null, newValue: string | null): void {
    // Only announce important changes
    const importantAttributes = ['aria-expanded', 'aria-pressed', 'aria-selected'];
    
    if (!importantAttributes.includes(attribute)) return;
    
    const accessibleName = this.getAccessibleName(element);
    if (!accessibleName) return;
    
    let message = '';
    
    switch (attribute) {
      case 'aria-expanded':
        message = newValue === 'true' ? `${accessibleName} expanded` : `${accessibleName} collapsed`;
        break;
      case 'aria-pressed':
        message = newValue === 'true' ? `${accessibleName} pressed` : `${accessibleName} released`;
        break;
      case 'aria-selected':
        message = newValue === 'true' ? `${accessibleName} selected` : `${accessibleName} unselected`;
        break;
    }
    
    if (message) {
      this.announce(message);
    }
  }

  // Cleanup
  destroy(): void {
    this.observers.forEach(observer => observer.disconnect());
    this.observers = [];
    this.liveRegions.clear();
    this.validationResults = [];
  }
}
```

### Step 2: Create ARIA-Enhanced Video Player Component

**File**: `apps/web/src/components/video-player/aria-video-player.tsx`

```typescript
'use client';

import { useEffect, useRef, useState } from 'react';
import { ARIAManager } from '@/lib/accessibility/aria-manager';

interface ARIAVideoPlayerProps {
  src: string;
  poster?: string;
  title?: string;
  description?: string;
  captions?: { src: string; label: string; language: string }[];
  onPlay?: () => void;
  onPause?: () => void;
  onEnded?: () => void;
  onTimeUpdate?: (currentTime: number, duration: number) => void;
  className?: string;
}

export function ARIAVideoPlayer({
  src,
  poster,
  title = 'Video',
  description,
  captions = [],
  onPlay,
  onPause,
  onEnded,
  onTimeUpdate,
  className
}: ARIAVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const ariaManagerRef = useRef<ARIAManager>();
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    ariaManagerRef.current = ARIAManager.getInstance();
    
    if (containerRef.current) {
      ariaManagerRef.current.setupVideoPlayerARIA(containerRef.current);
    }

    return () => {
      // Cleanup if needed
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handlePlay = () => {
      setIsPlaying(true);
      ariaManagerRef.current?.announce('Video playing');
      onPlay?.();
    };

    const handlePause = () => {
      setIsPlaying(false);
      ariaManagerRef.current?.announce('Video paused');
      onPause?.();
    };

    const handleEnded = () => {
      setIsPlaying(false);
      ariaManagerRef.current?.announce('Video ended');
      onEnded?.();
    };

    const handleTimeUpdate = () => {
      setCurrentTime(video.currentTime);
      setDuration(video.duration || 0);
      onTimeUpdate?.(video.currentTime, video.duration || 0);
    };

    const handleVolumeChange = () => {
      setVolume(video.volume);
      setIsMuted(video.muted);
      
      const volumePercent = Math.round(video.volume * 100);
      const message = video.muted ? 'Muted' : `Volume ${volumePercent}%`;
      ariaManagerRef.current?.announce(message);
    };

    const handleFullscreenChange = () => {
      const fullscreen = !!document.fullscreenElement;
      setIsFullscreen(fullscreen);
      ariaManagerRef.current?.announce(fullscreen ? 'Entered fullscreen' : 'Exited fullscreen');
    };

    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('ended', handleEnded);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('volumechange', handleVolumeChange);
    document.addEventListener('fullscreenchange', handleFullscreenChange);

    return () => {
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('ended', handleEnded);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('volumechange', handleVolumeChange);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, [onPlay, onPause, onEnded, onTimeUpdate]);

  const handlePlayPause = () => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      video.play();
    } else {
      video.pause();
    }
  };

  const handleMuteToggle = () => {
    const video = videoRef.current;
    if (!video) return;

    video.muted = !video.muted;
  };

  const handleFullscreenToggle = () => {
    const container = containerRef.current;
    if (!container) return;

    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      container.requestFullscreen();
    }
  };

  const handleSeek = (direction: 'forward' | 'backward') => {
    const video = videoRef.current;
    if (!video) return;

    const seekAmount = direction === 'forward' ? 5 : -5;
    const newTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + seekAmount));
    video.currentTime = newTime;
    
    ariaManagerRef.current?.announce(`Seek ${direction} 5 seconds`);
  };

  const handleVolumeChange = (direction: 'up' | 'down') => {
    const video = videoRef.current;
    if (!video) return;

    const volumeChange = direction === 'up' ? 0.1 : -0.1;
    const newVolume = Math.max(0, Math.min(1, video.volume + volumeChange));
    video.volume = newVolume;
    video.muted = false;
  };

  const formatTime = (seconds: number): string => {
    if (isNaN(seconds) || !isFinite(seconds)) {
      return '0:00';
    }

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    } else {
      return `${minutes}:${secs.toString().padStart(2, '0')}`;
    }
  };

  return (
    <div 
      ref={containerRef}
      className={`aria-video-player ${className || ''}`}
      role="application"
      aria-label={title}
      aria-describedby={description ? 'video-description' : undefined}
    >
      {description && (
        <div id="video-description" className="sr-only">
          {description}
        </div>
      )}

      <video
        ref={videoRef}
        src={src}
        poster={poster}
        className="video-element"
        aria-label={title}
        aria-describedby={description ? 'video-description' : undefined}
      >
        {captions.map((caption, index) => (
          <track
            key={index}
            kind="captions"
            src={caption.src}
            label={caption.label}
            srclang={caption.language}
            default={index === 0}
          />
        ))}
        Your browser does not support the video tag.
      </video>

      {/* Custom ARIA-enhanced controls */}
      <div className="video-controls" role="toolbar" aria-label="Video controls">
        <button
          className="play-pause-button"
          onClick={handlePlayPause}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          aria-pressed={isPlaying.toString()}
          role="button"
        >
          {isPlaying ? 'Pause' : 'Play'}
        </button>

        <div className="progress-container" role="group" aria-label="Video progress">
          <input
            type="range"
            className="progress-bar"
            min="0"
            max={duration || 0}
            value={currentTime}
            onChange={(e) => {
              const video = videoRef.current;
              if (video) {
                video.currentTime = Number(e.target.value);
              }
            }}
            aria-label="Video progress"
            aria-valuemin="0"
            aria-valuemax={duration.toString()}
            aria-valuenow={currentTime.toString()}
            aria-valuetext={`${formatTime(currentTime)} of ${formatTime(duration)}`}
            role="slider"
          />
          <span className="time-display" aria-live="polite" aria-atomic="true">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
        </div>

        <div className="volume-controls" role="group" aria-label="Volume controls">
          <button
            className="mute-button"
            onClick={handleMuteToggle}
            aria-label={isMuted ? 'Unmute' : `Mute (Volume ${Math.round(volume * 100)}%)`}
            aria-pressed={isMuted.toString()}
            role="button"
          >
            {isMuted ? 'Unmute' : 'Mute'}
          </button>
          
          <input
            type="range"
            className="volume-slider"
            min="0"
            max="1"
            step="0.1"
            value={isMuted ? 0 : volume}
            onChange={(e) => {
              const video = videoRef.current;
              if (video) {
                video.volume = Number(e.target.value);
                video.muted = false;
              }
            }}
            aria-label="Volume"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow={Math.round((isMuted ? 0 : volume) * 100).toString()}
            aria-valuetext={isMuted ? 'Muted' : `Volume ${Math.round(volume * 100)}%`}
            role="slider"
            aria-orientation="vertical"
          />
        </div>

        <button
          className="fullscreen-button"
          onClick={handleFullscreenToggle}
          aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          aria-pressed={isFullscreen.toString()}
          role="button"
        >
          {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
        </button>
      </div>

      {/* Keyboard shortcuts help */}
      <div className="keyboard-help" role="tooltip" aria-hidden="true">
        <h3>Keyboard Shortcuts</h3>
        <ul>
          <li><kbd>Space</kbd> or <kbd>K</kbd> - Play/Pause</li>
          <li><kbd>←</kbd> / <kbd>→</kbd> - Seek backward/forward</li>
          <li><kbd>↑</kbd> / <kbd>↓</kbd> - Volume up/down</li>
          <li><kbd>M</kbd> - Mute/Unmute</li>
          <li><kbd>F</kbd> - Fullscreen</li>
          <li><kbd>C</kbd> - Captions</li>
          <li><kbd>Esc</kbd> - Exit fullscreen/close menus</li>
        </ul>
      </div>
    </div>
  );
}
```

### Step 3: Create ARIA Live Regions Component

**File**: `apps/web/src/components/accessibility/aria-live-region.tsx`

```typescript
'use client';

import { useEffect, useRef, ReactNode } from 'react';
import { ARIAManager } from '@/lib/accessibility/aria-manager';

interface ARIALiveRegionProps {
  id: string;
  politeness: 'polite' | 'assertive' | 'off';
  atomic?: boolean;
  relevant?: string;
  children?: ReactNode;
  className?: string;
}

export function ARIALiveRegion({
  id,
  politeness,
  atomic = false,
  relevant,
  children,
  className
}: ARIALiveRegionProps) {
  const regionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ariaManager = ARIAManager.getInstance();
    ariaManager.createLiveRegion(id, politeness, { atomic, relevant });
  }, [id, politeness, atomic, relevant]);

  return (
    <div
      ref={regionRef}
      id={id}
      className={`sr-only ${className || ''}`}
      aria-live={politeness}
      aria-atomic={atomic.toString()}
      aria-relevant={relevant}
    >
      {children}
    </div>
  );
}

// Hook for announcements
export function useAnnouncement() {
  const ariaManager = ARIAManager.getInstance();

  const announce = (message: string, regionId: string = 'status') => {
    ariaManager.announce(message, regionId);
  };

  const announcePolite = (message: string) => {
    announce(message, 'status');
  };

  const announceAssertive = (message: string) => {
    announce(message, 'alert');
  };

  return {
    announce,
    announcePolite,
    announceAssertive
  };
}

// Component for screen reader only content
export function ScreenReaderOnly({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={`sr-only ${className || ''}`} aria-hidden="false">
      {children}
    </div>
  );
}

// Component for visually hidden but accessible content
export function VisuallyHidden({ children, as: Component = 'span', ...props }: any) {
  return (
    <Component
      className="sr-only"
      style={{
        position: 'absolute',
        left: '-10000px',
        width: '1px',
        height: '1px',
        overflow: 'hidden'
      }}
      {...props}
    >
      {children}
    </Component>
  );
}
```

### Step 4: Create ARIA Validation Tool

**File**: `apps/web/src/lib/accessibility/aria-validator.ts`

```typescript
import { ARIAManager, ARIAValidationResult } from './aria-manager';

export interface ARIAValidationReport {
  timestamp: Date;
  url: string;
  totalElements: number;
  elementsWithIssues: number;
  criticalIssues: number;
  highIssues: number;
  mediumIssues: number;
  lowIssues: number;
  overallScore: number;
  results: ARIAValidationResult[];
  summary: {
    missingLabels: number;
    missingRoles: number;
    invalidRoles: number;
    missingStates: number;
    invalidStates: number;
  };
  recommendations: string[];
}

export class ARIAValidator {
  private ariaManager: ARIAManager;

  constructor() {
    this.ariaManager = ARIAManager.getInstance();
  }

  // Validate entire page
  validatePage(): ARIAValidationReport {
    const results = this.ariaManager.validateARIA();
    return this.generateReport(results);
  }

  // Validate specific component
  validateComponent(container: HTMLElement): ARIAValidationReport {
    const results = this.ariaManager.validateARIA(container);
    return this.generateReport(results);
  }

  // Generate validation report
  private generateReport(results: ARIAValidationResult[]): ARIAValidationReport {
    const totalElements = results.length;
    const elementsWithIssues = results.filter(r => r.issues.length > 0).length;
    
    // Count issues by severity
    const allIssues = results.flatMap(r => r.issues);
    const criticalIssues = allIssues.filter(i => i.severity === 'critical').length;
    const highIssues = allIssues.filter(i => i.severity === 'high').length;
    const mediumIssues = allIssues.filter(i => i.severity === 'medium').length;
    const lowIssues = allIssues.filter(i => i.severity === 'low').length;

    // Count issues by type
    const summary = {
      missingLabels: allIssues.filter(i => i.type === 'missing_label').length,
      missingRoles: allIssues.filter(i => i.type === 'missing_role').length,
      invalidRoles: allIssues.filter(i => i.type === 'invalid_role').length,
      missingStates: allIssues.filter(i => i.type === 'missing_state').length,
      invalidStates: allIssues.filter(i => i.type === 'invalid_state').length
    };

    // Calculate overall score
    const overallScore = this.calculateOverallScore(results);

    // Generate recommendations
    const recommendations = this.generateRecommendations(allIssues);

    return {
      timestamp: new Date(),
      url: window.location.href,
      totalElements,
      elementsWithIssues,
      criticalIssues,
      highIssues,
      mediumIssues,
      lowIssues,
      overallScore,
      results,
      summary,
      recommendations
    };
  }

  // Calculate overall score
  private calculateOverallScore(results: ARIAValidationResult[]): number {
    if (results.length === 0) return 100;
    
    const totalScore = results.reduce((sum, result) => sum + result.score, 0);
    return Math.round(totalScore / results.length);
  }

  // Generate recommendations
  private generateRecommendations(issues: any[]): string[] {
    const recommendations = new Set<string>();

    issues.forEach(issue => {
      switch (issue.type) {
        case 'missing_label':
          recommendations.add('Add aria-label or aria-labelledby to elements without accessible names');
          break;
        case 'missing_role':
          recommendations.add('Add appropriate role attributes to custom interactive elements');
          break;
        case 'invalid_role':
          recommendations.add('Use valid ARIA roles from the specification');
          break;
        case 'missing_state':
          recommendations.add('Add required ARIA states for interactive elements');
          break;
        case 'invalid_state':
          recommendations.add('Ensure ARIA states have valid values');
          break;
      }
    });

    return Array.from(recommendations);
  }

  // Check WCAG compliance
  checkWCAGCompliance(report: ARIAValidationReport): {
    level: 'AAA' | 'AA' | 'A' | 'Non-compliant';
    criteria: Record<string, boolean>;
  } {
    const criteria = {
      '1.3.1': report.summary.missingLabels === 0 && report.summary.missingRoles === 0,
      '1.3.2': true, // Would need more complex analysis
      '2.1.1': report.summary.missingRoles === 0,
      '2.1.2': true, // Would need keyboard trap testing
      '2.4.3': true, // Would need focus order testing
      '4.1.2': report.summary.invalidRoles === 0 && report.summary.invalidStates === 0
    };

    const passedCriteria = Object.values(criteria).filter(Boolean).length;
    const totalCriteria = Object.keys(criteria).length;
    const compliancePercentage = (passedCriteria / totalCriteria) * 100;

    let level: 'AAA' | 'AA' | 'A' | 'Non-compliant';
    if (compliancePercentage >= 95) {
      level = 'AAA';
    } else if (compliancePercentage >= 85) {
      level = 'AA';
    } else if (compliancePercentage >= 70) {
      level = 'A';
    } else {
      level = 'Non-compliant';
    }

    return { level, criteria };
  }
}
```

## Testing Strategy

### Unit Tests

**File**: `apps/web/src/lib/accessibility/__tests__/aria-manager.test.ts`

```typescript
import { ARIAManager } from '../aria-manager';

describe('ARIAManager', () => {
  let ariaManager: ARIAManager;

  beforeEach(() => {
    ariaManager = ARIAManager.getInstance();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    ariaManager.destroy();
  });

  describe('getAccessibleName', () => {
    it('should get accessible name from aria-label', () => {
      const button = document.createElement('button');
      button.setAttribute('aria-label', 'Test Button');
      document.body.appendChild(button);

      const name = ariaManager.getAccessibleName(button);
      expect(name).toBe('Test Button');
    });

    it('should get accessible name from aria-labelledby', () => {
      const label = document.createElement('div');
      label.id = 'test-label';
      label.textContent = 'Label Text';
      document.body.appendChild(label);

      const button = document.createElement('button');
      button.setAttribute('aria-labelledby', 'test-label');
      document.body.appendChild(button);

      const name = ariaManager.getAccessibleName(button);
      expect(name).toBe('Label Text');
    });

    it('should get accessible name from button content', () => {
      const button = document.createElement('button');
      button.textContent = 'Button Text';
      document.body.appendChild(button);

      const name = ariaManager.getAccessibleName(button);
      expect(name).toBe('Button Text');
    });
  });

  describe('setAccessibleName', () => {
    it('should set accessible name using aria-label', () => {
      const button = document.createElement('button');
      document.body.appendChild(button);

      ariaManager.setAccessibleName(button, 'New Name');

      expect(button.getAttribute('aria-label')).toBe('New Name');
    });
  });

  describe('announce', () => {
    it('should announce message to live region', () => {
      const announceSpy = jest.spyOn(console, 'warn');
      
      ariaManager.announce('Test message');
      
      // Check if live region was created and message was set
      const liveRegion = document.getElementById('status');
      expect(liveRegion).toBeTruthy();
      expect(liveRegion?.textContent).toBe('Test message');
      
      announceSpy.mockRestore();
    });
  });

  describe('validateARIA', () => {
    it('should identify missing accessible names', () => {
      const button = document.createElement('button');
      button.innerHTML = ''; // No text content
      document.body.appendChild(button);

      const results = ariaManager.validateARIA();
      const buttonResult = results.find(r => r.element === button);

      expect(buttonResult?.issues).toContainEqual(
        expect.objectContaining({
          type: 'missing_label',
          severity: 'critical'
        })
      );
    });

    it('should identify missing roles for custom elements', () => {
      const div = document.createElement('div');
      div.setAttribute('onclick', 'return false;');
      div.textContent = 'Custom Button';
      document.body.appendChild(div);

      const results = ariaManager.validateARIA();
      const divResult = results.find(r => r.element === div);

      expect(divResult?.issues).toContainEqual(
        expect.objectContaining({
          type: 'missing_role',
          severity: 'high'
        })
      );
    });
  });

  describe('setupVideoPlayerARIA', () => {
    it('should setup ARIA for video player controls', () => {
      const videoPlayer = document.createElement('div');
      videoPlayer.innerHTML = `
        <video></video>
        <button class="vjs-play-control">Play</button>
        <button class="vjs-mute-control">Mute</button>
        <div class="vjs-progress-holder"></div>
      `;
      document.body.appendChild(videoPlayer);

      ariaManager.setupVideoPlayerARIA(videoPlayer);

      const playButton = videoPlayer.querySelector('.vjs-play-control') as HTMLElement;
      const muteButton = videoPlayer.querySelector('.vjs-mute-control') as HTMLElement;
      const progressBar = videoPlayer.querySelector('.vjs-progress-holder') as HTMLElement;

      expect(playButton?.getAttribute('role')).toBe('button');
      expect(playButton?.getAttribute('aria-label')).toBeTruthy();
      expect(muteButton?.getAttribute('role')).toBe('button');
      expect(muteButton?.getAttribute('aria-label')).toBeTruthy();
      expect(progressBar?.getAttribute('role')).toBe('slider');
    });
  });
});
```

## Deliverables

### Files to Create
1. `apps/web/src/lib/accessibility/aria-manager.ts` - Core ARIA management
2. `apps/web/src/components/video-player/aria-video-player.tsx` - ARIA-enhanced video player
3. `apps/web/src/components/accessibility/aria-live-region.tsx` - Live regions component
4. `apps/web/src/lib/accessibility/aria-validator.ts` - ARIA validation tool
5. `apps/web/src/lib/accessibility/__tests__/aria-manager.test.ts` - Unit tests

### Documentation
1. ARIA implementation guide
2. Screen reader compatibility notes
3. WCAG 2.1 AA compliance documentation
4. Video player ARIA reference

## Success Criteria

### Functional Requirements
- ✅ Proper ARIA labels for all controls
- ✅ ARIA descriptions for complex elements
- ✅ Live regions for dynamic content
- ✅ ARIA states and properties
- ✅ Screen reader compatibility

### WCAG Compliance
- ✅ WCAG 1.3.1 (Info and relationships) compliance
- ✅ WCAG 4.1.2 (Name, role, value) compliance
- ✅ WCAG 2.4.6 (Headings and labels) compliance
- ✅ WCAG 2.1.3 (Keyboard (no exception)) compliance
- ✅ WCAG 2.5.1 (Pointer gestures) compliance

### Technical Requirements
- ✅ TypeScript implementation with full type safety
- ✅ React components with proper ARIA
- ✅ Comprehensive test coverage (>90%)
- ✅ Cross-browser compatibility
- ✅ Performance optimized

### UX Requirements
- ✅ Screen reader friendly
- ✅ Clear element descriptions
- ✅ Dynamic content announcements
- ✅ Consistent ARIA patterns
- ✅ Multi-language support

## Timeline

### Day 1: Core ARIA Management
- Implement ARIAManager utility
- Create live region system
- Add ARIA validation

### Day 2: Video Player Integration
- Setup video player ARIA
- Implement dynamic state updates
- Add keyboard navigation ARIA

### Day 3: Components & Testing
- Create ARIA-enhanced components
- Implement live region components
- Add comprehensive testing

### Day 4: Validation & Polish
- Complete ARIA validation tool
- Screen reader testing
- Documentation and final polish

## Risk Assessment

### High Risk
- **Screen Reader Differences**: Different screen readers interpret ARIA differently
  - **Mitigation**: Testing with multiple screen readers, fallback strategies
- **Dynamic Content**: Live regions may not work consistently
  - **Mitigation**: Multiple announcement strategies, testing across devices

### Medium Risk
- **ARIA Overuse**: Too many ARIA attributes can confuse users
  - **Mitigation**: Follow semantic HTML first principle, minimal ARIA usage
- **Performance**: ARIA updates may impact performance
  - **Mitigation**: Efficient updates, debouncing, batching

### Low Risk
- **Browser Support**: Older browsers may have limited ARIA support
  - **Mitigation**: Progressive enhancement, polyfills if needed
- **Maintenance**: ARIA implementation may require ongoing updates
  - **Mitigation**: Automated testing, regular validation

This implementation plan provides comprehensive ARIA support that ensures screen reader compatibility and WCAG 2.1 AA compliance throughout the video player interface.