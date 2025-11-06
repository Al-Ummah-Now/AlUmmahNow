# Implementation Plan: Implement Proper Tab Order Management

**Story**: 1.4 Enhance Keyboard Navigation Accessibility  
**Task Group**: 1.4.2 Implement proper tab order management  
**Priority**: High  
**Estimated Time**: 3-4 days  

## Overview

This implementation plan focuses on creating a comprehensive focus management system that ensures logical, predictable tab order throughout the video player interface. The system will handle focus trapping, logical sequencing, and consistent navigation patterns.

## Prerequisites

- Completion of keyboard navigation audit (1.4.1)
- Understanding of current video player structure
- Knowledge of WCAG 2.1 AA focus order requirements

## Detailed Implementation Steps

### Step 1: Create Focus Manager Utility

**File**: `apps/web/src/lib/accessibility/focus-manager.ts`

```typescript
export interface FocusableElement {
  element: HTMLElement;
  index: number;
  group?: string;
  condition?: () => boolean;
  skip?: boolean;
}

export interface FocusTrapConfig {
  container: HTMLElement;
  initialFocus?: HTMLElement;
  restoreFocus?: HTMLElement;
  onEscape?: () => void;
  onEnter?: () => void;
}

export interface FocusGroup {
  name: string;
  elements: HTMLElement[];
  enabled: boolean;
  circular?: boolean;
}

export interface FocusOrderRule {
  selector: string;
  order: number;
  group?: string;
  condition?: () => boolean;
}

export class FocusManager {
  private static instance: FocusManager;
  private focusableElements: FocusableElement[] = [];
  private focusGroups: Map<string, FocusGroup> = new Map();
  private activeTraps: Set<FocusTrapConfig> = new Set();
  private currentFocusIndex: number = -1;
  private lastFocusedElement: HTMLElement | null = null;
  private observers: MutationObserver[] = [];

  static getInstance(): FocusManager {
    if (!FocusManager.instance) {
      FocusManager.instance = new FocusManager();
    }
    return FocusManager.instance;
  }

  constructor() {
    this.initializeEventListeners();
    this.observeDOMChanges();
  }

  // Initialize focusable elements
  initializeFocusableElements(container: HTMLElement = document.body): void {
    this.focusableElements = [];
    const elements = this.getFocusableElements(container);
    
    elements.forEach((element, index) => {
      this.focusableElements.push({
        element,
        index,
        condition: () => this.isElementVisible(element)
      });
    });

    this.sortFocusableElements();
  }

  // Get all focusable elements
  private getFocusableElements(container: HTMLElement): HTMLElement[] {
    const selectors = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
      '[contenteditable="true"]',
      'video[controls]',
      'audio[controls]',
      'summary',
      'iframe',
      'object',
      'embed',
      '[role="button"]',
      '[role="link"]',
      '[role="menuitem"]',
      '[role="option"]',
      '[role="tab"]',
      '[role="treeitem"]',
      '[role="textbox"]',
      '[role="combobox"]',
      '[role="listbox"]'
    ].join(', ');

    return Array.from(container.querySelectorAll(selectors)) as HTMLElement[];
  }

  // Check if element is visible
  private isElementVisible(element: HTMLElement): boolean {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();

    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0' &&
      rect.width > 0 &&
      rect.height > 0 &&
      !element.hasAttribute('aria-hidden')
    );
  }

  // Sort focusable elements by DOM order and custom rules
  private sortFocusableElements(): void {
    this.focusableElements.sort((a, b) => {
      // First, check if elements have custom order rules
      const aOrder = this.getElementOrder(a.element);
      const bOrder = this.getElementOrder(b.element);
      
      if (aOrder !== bOrder) {
        return aOrder - bOrder;
      }

      // Fall back to DOM order
      return a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });

    // Update indices
    this.focusableElements.forEach((element, index) => {
      element.index = index;
    });
  }

  // Get custom order for element
  private getElementOrder(element: HTMLElement): number {
    // Check for data-taborder attribute
    const tabOrder = element.getAttribute('data-taborder');
    if (tabOrder) {
      return parseInt(tabOrder);
    }

    // Check for predefined rules
    const rules = this.getFocusOrderRules();
    const rule = rules.find(r => element.matches(r.selector));
    return rule ? rule.order : 999999;
  }

  // Get focus order rules
  private getFocusOrderRules(): FocusOrderRule[] {
    return [
      // Video player specific order
      { selector: '.vjs-play-control, [data-testid="play-button"]', order: 100 },
      { selector: '.vjs-progress-holder, [data-testid="progress-bar"]', order: 200 },
      { selector: '.vjs-mute-control, [data-testid="mute-button"]', order: 300 },
      { selector: '.vjs-volume-bar, [data-testid="volume-slider"]', order: 310 },
      { selector: '.vjs-captions-button, [data-testid="captions-button"]', order: 400 },
      { selector: '.vjs-settings-button, [data-testid="settings-button"]', order: 500 },
      { selector: '.vjs-fullscreen-control, [data-testid="fullscreen-button"]', order: 600 },
      
      // Modal order
      { selector: '.modal-header .close', order: 10 },
      { selector: '.modal-title', order: 20 },
      { selector: '.modal-body :focusable', order: 30 },
      { selector: '.modal-footer button', order: 40 },
      
      // Skip links
      { selector: '.skip-link', order: 1 }
    ];
  }

  // Navigate to next focusable element
  focusNext(options: { wrap?: boolean; group?: string } = {}): boolean {
    const { wrap = true, group } = options;
    
    const currentIndex = this.getCurrentFocusIndex();
    let nextIndex = currentIndex + 1;

    // Find next focusable element
    while (nextIndex < this.focusableElements.length) {
      const element = this.focusableElements[nextIndex];
      
      if (this.isElementFocusable(element, group)) {
        this.focusElement(element.element);
        this.currentFocusIndex = nextIndex;
        return true;
      }
      
      nextIndex++;
    }

    // Wrap around if enabled
    if (wrap) {
      nextIndex = 0;
      while (nextIndex < currentIndex) {
        const element = this.focusableElements[nextIndex];
        
        if (this.isElementFocusable(element, group)) {
          this.focusElement(element.element);
          this.currentFocusIndex = nextIndex;
          return true;
        }
        
        nextIndex++;
      }
    }

    return false;
  }

  // Navigate to previous focusable element
  focusPrevious(options: { wrap?: boolean; group?: string } = {}): boolean {
    const { wrap = true, group } = options;
    
    const currentIndex = this.getCurrentFocusIndex();
    let prevIndex = currentIndex - 1;

    // Find previous focusable element
    while (prevIndex >= 0) {
      const element = this.focusableElements[prevIndex];
      
      if (this.isElementFocusable(element, group)) {
        this.focusElement(element.element);
        this.currentFocusIndex = prevIndex;
        return true;
      }
      
      prevIndex--;
    }

    // Wrap around if enabled
    if (wrap) {
      prevIndex = this.focusableElements.length - 1;
      while (prevIndex > currentIndex) {
        const element = this.focusableElements[prevIndex];
        
        if (this.isElementFocusable(element, group)) {
          this.focusElement(element.element);
          this.currentFocusIndex = prevIndex;
          return true;
        }
        
        prevIndex--;
      }
    }

    return false;
  }

  // Check if element is focusable
  private isElementFocusable(element: FocusableElement, group?: string): boolean {
    if (element.skip) return false;
    if (element.condition && !element.condition()) return false;
    if (group && element.group !== group) return false;
    
    const focusGroup = element.group ? this.focusGroups.get(element.group) : null;
    if (focusGroup && !focusGroup.enabled) return false;
    
    return true;
  }

  // Get current focus index
  private getCurrentFocusIndex(): number {
    const activeElement = document.activeElement as HTMLElement;
    if (!activeElement) return -1;

    const index = this.focusableElements.findIndex(
      element => element.element === activeElement
    );
    
    return index >= 0 ? index : -1;
  }

  // Focus element with proper handling
  focusElement(element: HTMLElement): void {
    if (!element) return;

    // Save last focused element
    this.lastFocusedElement = document.activeElement as HTMLElement;

    // Focus the element
    element.focus();

    // Scroll into view if needed
    this.scrollIntoViewIfNeeded(element);
  }

  // Scroll element into view if needed
  private scrollIntoViewIfNeeded(element: HTMLElement): void {
    const rect = element.getBoundingClientRect();
    const isInViewport = (
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= window.innerHeight &&
      rect.right <= window.innerWidth
    );

    if (!isInViewport) {
      element.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'nearest'
      });
    }
  }

  // Create focus trap
  createFocusTrap(config: FocusTrapConfig): () => void {
    const { container, initialFocus, restoreFocus, onEscape, onEnter } = config;
    
    // Save current focus
    const currentFocus = document.activeElement as HTMLElement;
    
    // Set initial focus
    if (initialFocus) {
      this.focusElement(initialFocus);
    } else {
      const firstFocusable = this.getFocusableElements(container)[0];
      if (firstFocusable) {
        this.focusElement(firstFocusable);
      }
    }

    // Add trap to active traps
    this.activeTraps.add(config);

    // Create cleanup function
    const cleanup = () => {
      this.activeTraps.delete(config);
      
      if (restoreFocus && restoreFocus !== document.activeElement) {
        this.focusElement(restoreFocus);
      } else if (currentFocus && currentFocus !== document.activeElement) {
        this.focusElement(currentFocus);
      }
    };

    return cleanup;
  }

  // Handle keyboard events for focus traps
  private handleTrapKeydown = (event: KeyboardEvent): void => {
    if (this.activeTraps.size === 0) return;

    const activeTrap = Array.from(this.activeTraps)[this.activeTraps.size - 1];
    
    switch (event.key) {
      case 'Tab':
        event.preventDefault();
        if (event.shiftKey) {
          this.focusPrevious();
        } else {
          this.focusNext();
        }
        break;
      
      case 'Escape':
        if (activeTrap.onEscape) {
          activeTrap.onEscape();
        }
        break;
      
      case 'Enter':
        if (activeTrap.onEnter) {
          activeTrap.onEnter();
        }
        break;
    }
  };

  // Initialize event listeners
  private initializeEventListeners(): void {
    document.addEventListener('keydown', this.handleKeydown);
    document.addEventListener('keydown', this.handleTrapKeydown);
  }

  // Handle global keyboard events
  private handleKeydown = (event: KeyboardEvent): void => {
    // Skip if we're in a focus trap
    if (this.activeTraps.size > 0) return;

    switch (event.key) {
      case 'Tab':
        // Let browser handle tab navigation, but we'll track it
        setTimeout(() => {
          this.currentFocusIndex = this.getCurrentFocusIndex();
        }, 0);
        break;
    }
  };

  // Create focus group
  createFocusGroup(name: string, elements: HTMLElement[], circular = false): void {
    this.focusGroups.set(name, {
      name,
      elements,
      enabled: true,
      circular
    });
  }

  // Enable/disable focus group
  setFocusGroupEnabled(name: string, enabled: boolean): void {
    const group = this.focusGroups.get(name);
    if (group) {
      group.enabled = enabled;
    }
  }

  // Navigate within focus group
  navigateInGroup(groupName: string, direction: 'next' | 'previous'): boolean {
    const group = this.focusGroups.get(groupName);
    if (!group || !group.enabled) return false;

    const currentIndex = group.elements.findIndex(
      element => element === document.activeElement
    );

    let nextIndex: number;
    
    if (direction === 'next') {
      nextIndex = currentIndex + 1;
      if (nextIndex >= group.elements.length) {
        nextIndex = group.circular ? 0 : group.elements.length - 1;
      }
    } else {
      nextIndex = currentIndex - 1;
      if (nextIndex < 0) {
        nextIndex = group.circular ? group.elements.length - 1 : 0;
      }
    }

    if (nextIndex >= 0 && nextIndex < group.elements.length) {
      this.focusElement(group.elements[nextIndex]);
      return true;
    }

    return false;
  }

  // Observe DOM changes
  private observeDOMChanges(): void {
    const observer = new MutationObserver((mutations) => {
      let shouldRebuild = false;

      mutations.forEach((mutation) => {
        if (mutation.type === 'childList') {
          // Check if focusable elements were added or removed
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const element = node as HTMLElement;
              if (this.isFocusableElement(element)) {
                shouldRebuild = true;
              }
            }
          });

          mutation.removedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const element = node as HTMLElement;
              if (this.isFocusableElement(element)) {
                shouldRebuild = true;
              }
            }
          });
        } else if (mutation.type === 'attributes') {
          const element = mutation.target as HTMLElement;
          if (this.isFocusableElement(element)) {
            shouldRebuild = true;
          }
        }
      });

      if (shouldRebuild) {
        // Debounce rebuild
        setTimeout(() => {
          this.initializeFocusableElements();
        }, 100);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['tabindex', 'disabled', 'aria-hidden', 'style']
    });

    this.observers.push(observer);
  }

  // Check if element is focusable
  private isFocusableElement(element: HTMLElement): boolean {
    const tagName = element.tagName.toLowerCase();
    const focusableTags = [
      'a', 'button', 'input', 'select', 'textarea', 
      'summary', 'video', 'audio', 'iframe'
    ];

    return (
      focusableTags.includes(tagName) ||
      element.hasAttribute('tabindex') ||
      element.hasAttribute('contenteditable') ||
      element.hasAttribute('role')
    );
  }

  // Cleanup
  destroy(): void {
    this.observers.forEach(observer => observer.disconnect());
    this.observers = [];
    this.focusableElements = [];
    this.focusGroups.clear();
    this.activeTraps.clear();
    
    document.removeEventListener('keydown', this.handleKeydown);
    document.removeEventListener('keydown', this.handleTrapKeydown);
  }
}
```

### Step 2: Create Video Player Focus Management

**File**: `apps/web/src/lib/accessibility/video-player-focus.ts`

```typescript
import { FocusManager } from './focus-manager';

export interface VideoPlayerFocusConfig {
  container: HTMLElement;
  enableKeyboardShortcuts: boolean;
  enableFocusTrapping: boolean;
  customTabOrder?: boolean;
}

export interface VideoPlayerControls {
  playButton?: HTMLElement;
  pauseButton?: HTMLElement;
  progressBar?: HTMLElement;
  volumeButton?: HTMLElement;
  volumeSlider?: HTMLElement;
  fullscreenButton?: HTMLElement;
  settingsButton?: HTMLElement;
  captionsButton?: HTMLElement;
  qualityButton?: HTMLElement;
}

export class VideoPlayerFocusManager {
  private focusManager: FocusManager;
  private container: HTMLElement;
  private controls: VideoPlayerControls;
  private config: VideoPlayerFocusConfig;
  private isSettingsOpen: boolean = false;
  private cleanupFunctions: (() => void)[] = [];

  constructor(config: VideoPlayerFocusConfig) {
    this.focusManager = FocusManager.getInstance();
    this.container = config.container;
    this.config = config;
    this.controls = {};
    
    this.initializeControls();
    this.setupFocusGroups();
    this.setupKeyboardShortcuts();
    this.setupEventListeners();
  }

  // Initialize video player controls
  private initializeControls(): void {
    this.controls = {
      playButton: this.container.querySelector('.vjs-play-control, [data-testid="play-button"]') as HTMLElement,
      progressBar: this.container.querySelector('.vjs-progress-holder, [data-testid="progress-bar"]') as HTMLElement,
      volumeButton: this.container.querySelector('.vjs-mute-control, [data-testid="volume-button"]') as HTMLElement,
      volumeSlider: this.container.querySelector('.vjs-volume-bar, [data-testid="volume-slider"]') as HTMLElement,
      fullscreenButton: this.container.querySelector('.vjs-fullscreen-control, [data-testid="fullscreen-button"]') as HTMLElement,
      settingsButton: this.container.querySelector('.vjs-settings-button, [data-testid="settings-button"]') as HTMLElement,
      captionsButton: this.container.querySelector('.vjs-captions-button, [data-testid="captions-button"]') as HTMLElement,
      qualityButton: this.container.querySelector('.vjs-quality-button, [data-testid="quality-button"]') as HTMLElement
    };
  }

  // Setup focus groups for logical navigation
  private setupFocusGroups(): void {
    // Main controls group
    const mainControls = [
      this.controls.playButton,
      this.controls.progressBar,
      this.controls.volumeButton,
      this.controls.volumeSlider,
      this.controls.captionsButton,
      this.controls.settingsButton,
      this.controls.fullscreenButton
    ].filter(Boolean) as HTMLElement[];

    this.focusManager.createFocusGroup('video-controls', mainControls, true);

    // Settings menu group
    const settingsMenu = this.container.querySelector('.vjs-settings-menu, [data-testid="settings-menu"]') as HTMLElement;
    if (settingsMenu) {
      const menuItems = Array.from(settingsMenu.querySelectorAll('.vjs-menu-item, [role="menuitem"]')) as HTMLElement[];
      this.focusManager.createFocusGroup('settings-menu', menuItems, true);
      this.focusManager.setFocusGroupEnabled('settings-menu', false);
    }

    // Quality menu group
    const qualityMenu = this.container.querySelector('.vjs-quality-menu, [data-testid="quality-menu"]') as HTMLElement;
    if (qualityMenu) {
      const qualityItems = Array.from(qualityMenu.querySelectorAll('.vjs-menu-item, [role="menuitem"]')) as HTMLElement[];
      this.focusManager.createFocusGroup('quality-menu', qualityItems, true);
      this.focusManager.setFocusGroupEnabled('quality-menu', false);
    }
  }

  // Setup keyboard shortcuts
  private setupKeyboardShortcuts(): void {
    if (!this.config.enableKeyboardShortcuts) return;

    const handleKeydown = (event: KeyboardEvent) => {
      // Only handle shortcuts when video player has focus or is active
      if (!this.isVideoPlayerActive()) return;

      switch (event.key) {
        case ' ':
        case 'k':
          event.preventDefault();
          this.togglePlayPause();
          break;
        
        case 'ArrowLeft':
          event.preventDefault();
          this.seek(-5); // Seek back 5 seconds
          break;
        
        case 'ArrowRight':
          event.preventDefault();
          this.seek(5); // Seek forward 5 seconds
          break;
        
        case 'ArrowUp':
          event.preventDefault();
          this.adjustVolume(0.1); // Increase volume
          break;
        
        case 'ArrowDown':
          event.preventDefault();
          this.adjustVolume(-0.1); // Decrease volume
          break;
        
        case 'm':
          event.preventDefault();
          this.toggleMute();
          break;
        
        case 'f':
          event.preventDefault();
          this.toggleFullscreen();
          break;
        
        case 'c':
          event.preventDefault();
          this.toggleCaptions();
          break;
        
        case 'Escape':
          event.preventDefault();
          this.closeAllMenus();
          break;
        
        case 'Enter':
        case ' ':
          // Handle menu activation
          if (this.isSettingsOpen) {
            event.preventDefault();
            this.activateCurrentMenuItem();
          }
          break;
      }
    };

    document.addEventListener('keydown', handleKeydown);
    this.cleanupFunctions.push(() => {
      document.removeEventListener('keydown', handleKeydown);
    });
  }

  // Setup event listeners
  private setupEventListeners(): void {
    // Settings menu toggle
    if (this.controls.settingsButton) {
      this.controls.settingsButton.addEventListener('click', () => {
        this.toggleSettingsMenu();
      });
    }

    // Listen for menu state changes
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'aria-hidden') {
          const target = mutation.target as HTMLElement;
          if (target.matches('.vjs-settings-menu, [data-testid="settings-menu"]')) {
            this.isSettingsOpen = target.getAttribute('aria-hidden') !== 'true';
            this.focusManager.setFocusGroupEnabled('settings-menu', this.isSettingsOpen);
          }
        }
      });
    });

    const settingsMenu = this.container.querySelector('.vjs-settings-menu, [data-testid="settings-menu"]');
    if (settingsMenu) {
      observer.observe(settingsMenu, { attributes: true });
      this.cleanupFunctions.push(() => observer.disconnect());
    }
  }

  // Check if video player is active
  private isVideoPlayerActive(): boolean {
    return this.container.contains(document.activeElement) ||
           this.container.matches(':hover') ||
           this.container.classList.contains('vjs-has-started') ||
           this.container.classList.contains('vjs-playing');
  }

  // Toggle play/pause
  private togglePlayPause(): void {
    const video = this.container.querySelector('video') as HTMLVideoElement;
    if (video) {
      if (video.paused) {
        video.play();
      } else {
        video.pause();
      }
    }
  }

  // Seek video
  private seek(seconds: number): void {
    const video = this.container.querySelector('video') as HTMLVideoElement;
    if (video) {
      video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + seconds));
    }
  }

  // Adjust volume
  private adjustVolume(delta: number): void {
    const video = this.container.querySelector('video') as HTMLVideoElement;
    if (video) {
      video.volume = Math.max(0, Math.min(1, video.volume + delta));
    }
  }

  // Toggle mute
  private toggleMute(): void {
    const video = this.container.querySelector('video') as HTMLVideoElement;
    if (video) {
      video.muted = !video.muted;
    }
  }

  // Toggle fullscreen
  private toggleFullscreen(): void {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      this.container.requestFullscreen();
    }
  }

  // Toggle captions
  private toggleCaptions(): void {
    // This would depend on the specific video player implementation
    const captionsButton = this.controls.captionsButton;
    if (captionsButton) {
      captionsButton.click();
    }
  }

  // Toggle settings menu
  private toggleSettingsMenu(): void {
    if (this.controls.settingsButton) {
      this.controls.settingsButton.click();
    }
  }

  // Close all menus
  private closeAllMenus(): void {
    // Close settings menu
    const settingsMenu = this.container.querySelector('.vjs-settings-menu, [data-testid="settings-menu"]') as HTMLElement;
    if (settingsMenu && settingsMenu.getAttribute('aria-hidden') !== 'true') {
      this.toggleSettingsMenu();
    }

    // Close quality menu
    const qualityMenu = this.container.querySelector('.vjs-quality-menu, [data-testid="quality-menu"]') as HTMLElement;
    if (qualityMenu && qualityMenu.getAttribute('aria-hidden') !== 'true') {
      // Close quality menu (implementation depends on video player)
    }
  }

  // Activate current menu item
  private activateCurrentMenuItem(): void {
    const activeElement = document.activeElement as HTMLElement;
    if (activeElement && activeElement.getAttribute('role') === 'menuitem') {
      activeElement.click();
    }
  }

  // Set focus to specific control
  focusControl(controlName: keyof VideoPlayerControls): void {
    const control = this.controls[controlName];
    if (control) {
      this.focusManager.focusElement(control);
    }
  }

  // Get current focus state
  getCurrentFocus(): HTMLElement | null {
    return document.activeElement as HTMLElement;
  }

  // Restore focus to video player
  restoreFocus(): void {
    if (this.controls.playButton) {
      this.focusManager.focusElement(this.controls.playButton);
    }
  }

  // Enable/disable focus management
  setEnabled(enabled: boolean): void {
    if (enabled) {
      this.focusManager.setFocusGroupEnabled('video-controls', true);
    } else {
      this.focusManager.setFocusGroupEnabled('video-controls', false);
      this.focusManager.setFocusGroupEnabled('settings-menu', false);
      this.focusManager.setFocusGroupEnabled('quality-menu', false);
    }
  }

  // Cleanup
  destroy(): void {
    this.cleanupFunctions.forEach(cleanup => cleanup());
    this.cleanupFunctions = [];
  }
}
```

### Step 3: Create Focus Trap Component

**File**: `apps/web/src/components/accessibility/focus-trap.tsx`

```typescript
'use client';

import { useEffect, useRef, ReactNode } from 'react';
import { FocusManager, FocusTrapConfig } from '@/lib/accessibility/focus-manager';

interface FocusTrapProps {
  children: ReactNode;
  enabled?: boolean;
  initialFocus?: string; // CSS selector
  restoreFocus?: string; // CSS selector
  onEscape?: () => void;
  onEnter?: () => void;
  className?: string;
}

export function FocusTrap({
  children,
  enabled = true,
  initialFocus,
  restoreFocus,
  onEscape,
  onEnter,
  className
}: FocusTrapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!enabled || !containerRef.current) return;

    const focusManager = FocusManager.getInstance();
    
    // Find initial focus element
    const initialFocusElement = initialFocus 
      ? containerRef.current.querySelector(initialFocus) as HTMLElement
      : undefined;

    // Find restore focus element
    const restoreFocusElement = restoreFocus
      ? document.querySelector(restoreFocus) as HTMLElement
      : undefined;

    // Create focus trap
    const config: FocusTrapConfig = {
      container: containerRef.current,
      initialFocus: initialFocusElement,
      restoreFocus: restoreFocusElement,
      onEscape,
      onEnter
    };

    cleanupRef.current = focusManager.createFocusTrap(config);

    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, [enabled, initialFocus, restoreFocus, onEscape, onEnter]);

  return (
    <div ref={containerRef} className={className}>
      {children}
    </div>
  );
}

// Hook for focus trap
export function useFocusTrap(config: {
  container: HTMLElement | null;
  initialFocus?: string;
  restoreFocus?: string;
  onEscape?: () => void;
  onEnter?: () => void;
  enabled?: boolean;
}) {
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!config.enabled || !config.container) return;

    const focusManager = FocusManager.getInstance();
    
    const initialFocusElement = config.initialFocus 
      ? config.container.querySelector(config.initialFocus) as HTMLElement
      : undefined;

    const restoreFocusElement = config.restoreFocus
      ? document.querySelector(config.restoreFocus) as HTMLElement
      : undefined;

    const trapConfig: FocusTrapConfig = {
      container: config.container,
      initialFocus: initialFocusElement,
      restoreFocus: restoreFocusElement,
      onEscape: config.onEscape,
      onEnter: config.onEnter
    };

    cleanupRef.current = focusManager.createFocusTrap(trapConfig);

    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, [config.container, config.initialFocus, config.restoreFocus, config.onEscape, config.onEnter, config.enabled]);

  return {
    isActive: cleanupRef.current !== null
  };
}
```

### Step 4: Create Skip Links Component

**File**: `apps/web/src/components/accessibility/skip-links.tsx`

```typescript
'use client';

import { useEffect, useState } from 'react';

interface SkipLink {
  id: string;
  label: string;
  target: string; // CSS selector
  enabled?: boolean;
}

interface SkipLinksProps {
  links: SkipLink[];
  className?: string;
}

export function SkipLinks({ links, className = '' }: SkipLinksProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Show skip links when tab is pressed
      if (event.key === 'Tab') {
        setIsVisible(true);
      }
    };

    const handleMouseDown = () => {
      // Hide skip links when mouse is used
      setIsVisible(false);
    };

    const handleFocus = (event: FocusEvent) => {
      // Keep visible if focus is on skip link
      const target = event.target as HTMLElement;
      if (target.closest('.skip-links')) {
        setIsVisible(true);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('focus', handleFocus, true);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('focus', handleFocus, true);
    };
  }, []);

  const handleSkipLinkClick = (target: string) => {
    const targetElement = document.querySelector(target) as HTMLElement;
    if (targetElement) {
      targetElement.focus();
      targetElement.scrollIntoView();
      setIsVisible(false);
    }
  };

  if (!isVisible) {
    return null;
  }

  return (
    <div className={`skip-links fixed top-0 left-0 z-50 ${className}`}>
      {links.map((link) => (
        link.enabled !== false && (
          <a
            key={link.id}
            href={link.target}
            onClick={(e) => {
              e.preventDefault();
              handleSkipLinkClick(link.target);
            }}
            className="block bg-blue-600 text-white px-4 py-2 text-sm font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 mb-1"
          >
            {link.label}
          </a>
        )
      ))}
    </div>
  );
}

// Default skip links for video player
export function VideoPlayerSkipLinks() {
  const skipLinks: SkipLink[] = [
    {
      id: 'skip-to-main-content',
      label: 'Skip to main content',
      target: '#main-content'
    },
    {
      id: 'skip-to-video',
      label: 'Skip to video',
      target: 'video, [data-testid="video-element"]'
    },
    {
      id: 'skip-to-controls',
      label: 'Skip to video controls',
      target: '.vjs-control-bar, [data-testid="video-controls"]'
    }
  ];

  return <SkipLinks links={skipLinks} />;
}

// Hook for managing skip links
export function useSkipLinks(links: SkipLink[]) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Tab') {
        setIsVisible(true);
      }
    };

    const handleMouseDown = () => {
      setIsVisible(false);
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleMouseDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleMouseDown);
    };
  }, []);

  const showSkipLinks = () => setIsVisible(true);
  const hideSkipLinks = () => setIsVisible(false);

  return {
    isVisible,
    showSkipLinks,
    hideSkipLinks,
    skipLinks: links.filter(link => link.enabled !== false)
  };
}
```

### Step 5: Create Focus Indicator Styles

**File**: `apps/web/src/styles/accessibility/focus-indicators.css`

```css
/* High contrast focus indicators for WCAG 2.1 AA compliance */

/* Base focus styles */
:focus {
  outline: 2px solid #2563eb;
  outline-offset: 2px;
}

/* High contrast focus for better visibility */
@media (prefers-contrast: high) {
  :focus {
    outline: 3px solid #000000;
    outline-offset: 2px;
    background-color: #ffff00;
    color: #000000;
  }
}

/* Focus for interactive elements */
button:focus,
input:focus,
select:focus,
textarea:focus,
a:focus,
[role="button"]:focus,
[role="link"]:focus,
[role="menuitem"]:focus,
[role="option"]:focus,
[role="tab"]:focus {
  outline: 2px solid #2563eb;
  outline-offset: 2px;
  box-shadow: 0 0 0 2px #2563eb;
}

/* Video player specific focus styles */
.vjs-control-bar:focus-within {
  outline: 2px solid #2563eb;
  outline-offset: 2px;
}

.vjs-play-control:focus,
.vjs-mute-control:focus,
.vjs-volume-bar:focus,
.vjs-progress-holder:focus,
.vjs-fullscreen-control:focus,
.vjs-settings-button:focus,
.vjs-captions-button:focus {
  outline: 2px solid #2563eb;
  outline-offset: 2px;
  box-shadow: 0 0 0 2px #2563eb;
}

/* Skip links focus styles */
.skip-links a:focus {
  outline: 2px solid #ffffff;
  outline-offset: -2px;
  background-color: #1d4ed8;
}

/* Modal focus styles */
.modal:focus-within {
  outline: 3px solid #2563eb;
  outline-offset: 2px;
}

.modal-content:focus {
  outline: 2px solid #2563eb;
  outline-offset: 2px;
}

/* Menu focus styles */
.menu:focus-within {
  outline: 2px solid #2563eb;
  outline-offset: 2px;
}

.menu-item:focus {
  outline: 2px solid #2563eb;
  outline-offset: 2px;
  background-color: #f3f4f6;
}

/* High contrast mode support */
@media (prefers-contrast: high) {
  :focus {
    outline: 3px solid #ffffff;
    outline-offset: 2px;
    background-color: #000000;
    color: #ffffff;
  }

  .vjs-control-bar:focus-within {
    outline: 3px solid #ffffff;
    outline-offset: 2px;
  }

  .skip-links a:focus {
    background-color: #000000;
    color: #ffffff;
    outline: 3px solid #ffffff;
  }
}

/* Reduced motion support */
@media (prefers-reduced-motion: reduce) {
  :focus {
    transition: none;
  }

  *:focus {
    transition: none;
  }
}

/* Dark theme focus styles */
@media (prefers-color-scheme: dark) {
  :focus {
    outline-color: #60a5fa;
  }

  button:focus,
  input:focus,
  select:focus,
  textarea:focus,
  a:focus {
    outline-color: #60a5fa;
    box-shadow: 0 0 0 2px #60a5fa;
  }

  .vjs-play-control:focus,
  .vjs-mute-control:focus,
  .vjs-volume-bar:focus,
  .vjs-progress-holder:focus,
  .vjs-fullscreen-control:focus,
  .vjs-settings-button:focus,
  .vjs-captions-button:focus {
    outline-color: #60a5fa;
    box-shadow: 0 0 0 2px #60a5fa;
  }
}

/* RTL support */
[dir="rtl"] :focus {
  outline-offset: 2px;
}

[dir="rtl"] .skip-links {
  right: 0;
  left: auto;
}

/* Invisible focus for screen readers only */
.sr-only-focusable:focus {
  position: static;
  width: auto;
  height: auto;
  padding: inherit;
  margin: inherit;
  overflow: visible;
  clip: auto;
  white-space: normal;
}
```

## Testing Strategy

### Unit Tests

**File**: `apps/web/src/lib/accessibility/__tests__/focus-manager.test.ts`

```typescript
import { FocusManager } from '../focus-manager';

describe('FocusManager', () => {
  let focusManager: FocusManager;

  beforeEach(() => {
    focusManager = FocusManager.getInstance();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    focusManager.destroy();
  });

  describe('initializeFocusableElements', () => {
    it('should identify all focusable elements', () => {
      document.body.innerHTML = `
        <button id="btn1">Button 1</button>
        <a href="#" id="link1">Link 1</a>
        <input type="text" id="input1" />
        <div id="div1" tabindex="0">Div 1</div>
      `;

      focusManager.initializeFocusableElements();

      // Should find all focusable elements
      expect(document.getElementById('btn1')).not.toBeNull();
      expect(document.getElementById('link1')).not.toBeNull();
      expect(document.getElementById('input1')).not.toBeNull();
      expect(document.getElementById('div1')).not.toBeNull();
    });

    it('should respect custom tab order', () => {
      document.body.innerHTML = `
        <button id="btn1" data-taborder="2">Button 1</button>
        <button id="btn2" data-taborder="1">Button 2</button>
        <button id="btn3">Button 3</button>
      `;

      focusManager.initializeFocusableElements();

      // btn2 should come before btn1 due to data-taborder
      const btn2 = document.getElementById('btn2') as HTMLElement;
      const btn1 = document.getElementById('btn1') as HTMLElement;
      
      expect(btn2.compareDocumentPosition(btn1) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(true);
    });
  });

  describe('focusNext', () => {
    it('should focus next element', () => {
      document.body.innerHTML = `
        <button id="btn1">Button 1</button>
        <button id="btn2">Button 2</button>
        <button id="btn3">Button 3</button>
      `;

      focusManager.initializeFocusableElements();
      
      // Focus first button
      const btn1 = document.getElementById('btn1') as HTMLElement;
      btn1.focus();

      // Focus next
      const result = focusManager.focusNext();
      
      expect(result).toBe(true);
      expect(document.activeElement).toBe(document.getElementById('btn2'));
    });

    it('should wrap around when enabled', () => {
      document.body.innerHTML = `
        <button id="btn1">Button 1</button>
        <button id="btn2">Button 2</button>
      `;

      focusManager.initializeFocusableElements();
      
      // Focus last button
      const btn2 = document.getElementById('btn2') as HTMLElement;
      btn2.focus();

      // Focus next should wrap to first
      const result = focusManager.focusNext({ wrap: true });
      
      expect(result).toBe(true);
      expect(document.activeElement).toBe(document.getElementById('btn1'));
    });
  });

  describe('createFocusTrap', () => {
    it('should trap focus within container', () => {
      document.body.innerHTML = `
        <button id="outside">Outside</button>
        <div id="trap-container">
          <button id="inside1">Inside 1</button>
          <button id="inside2">Inside 2</button>
        </div>
      `;

      const container = document.getElementById('trap-container') as HTMLElement;
      const cleanup = focusManager.createFocusTrap({ container });

      // Focus should be trapped inside
      const inside1 = document.getElementById('inside1') as HTMLElement;
      inside1.focus();

      // Try to focus outside (should not work in real implementation)
      const outside = document.getElementById('outside') as HTMLElement;
      outside.focus();

      // In a real test, you'd verify that focus stays trapped
      expect(document.activeElement).toBe(inside1);

      cleanup();
    });
  });

  describe('createFocusGroup', () => {
    it('should create focus group', () => {
      document.body.innerHTML = `
        <button id="group1-1">Group 1 - 1</button>
        <button id="group1-2">Group 1 - 2</button>
        <button id="group2-1">Group 2 - 1</button>
      `;

      const group1Elements = [
        document.getElementById('group1-1') as HTMLElement,
        document.getElementById('group1-2') as HTMLElement
      ];

      focusManager.createFocusGroup('group1', group1Elements, true);

      // Test navigation within group
      const result = focusManager.navigateInGroup('group1', 'next');
      expect(result).toBe(true);
    });
  });
});
```

## Deliverables

### Files to Create
1. `apps/web/src/lib/accessibility/focus-manager.ts` - Core focus management
2. `apps/web/src/lib/accessibility/video-player-focus.ts` - Video player focus management
3. `apps/web/src/components/accessibility/focus-trap.tsx` - Focus trap component
4. `apps/web/src/components/accessibility/skip-links.tsx` - Skip links component
5. `apps/web/src/styles/accessibility/focus-indicators.css` - Focus indicator styles
6. `apps/web/src/lib/accessibility/__tests__/focus-manager.test.ts` - Unit tests

### Documentation
1. Focus management API documentation
2. Video player keyboard navigation guide
3. WCAG 2.1 AA compliance documentation
4. Browser compatibility notes

## Success Criteria

### Functional Requirements
- ✅ Logical tab order throughout video player
- ✅ Focus trapping for modal dialogs
- ✅ Skip links for main content areas
- ✅ Keyboard navigation for all controls
- ✅ Consistent navigation patterns

### WCAG Compliance
- ✅ WCAG 2.1.1 (Keyboard) compliance
- ✅ WCAG 2.1.2 (No Keyboard Trap) compliance
- ✅ WCAG 2.4.3 (Focus Order) compliance
- ✅ WCAG 1.4.11 (Non-text Contrast) compliance
- ✅ WCAG 2.4.1 (Bypass Blocks) compliance

### Technical Requirements
- ✅ TypeScript implementation with full type safety
- ✅ React components with proper hooks
- ✅ Comprehensive test coverage (>90%)
- ✅ Cross-browser compatibility
- ✅ Performance optimized

### UX Requirements
- ✅ Visible focus indicators
- ✅ Predictable navigation behavior
- ✅ Efficient keyboard shortcuts
- ✅ Clear visual feedback
- ✅ Accessibility for screen readers

## Timeline

### Day 1: Core Focus Management
- Implement FocusManager utility
- Create focus order management
- Add focus trapping functionality

### Day 2: Video Player Integration
- Implement video player focus management
- Create keyboard shortcuts
- Add focus groups for controls

### Day 3: UI Components & Styling
- Create FocusTrap and SkipLinks components
- Implement focus indicator styles
- Add RTL and high contrast support

### Day 4: Testing & Polish
- Complete unit and integration tests
- Cross-browser testing
- Documentation and final polish

## Risk Assessment

### High Risk
- **Browser Differences**: Focus behavior varies between browsers
  - **Mitigation**: Comprehensive testing, browser-specific workarounds
- **Dynamic Content**: Video player has dynamic elements
  - **Mitigation**: MutationObserver integration, dynamic focus management

### Medium Risk
- **Performance**: Focus management may impact performance
  - **Mitigation**: Efficient algorithms, debouncing, caching
- **Third-party Components**: Video.js may have its own focus management
  - **Mitigation**: Integration with Video.js APIs, careful testing

### Low Risk
- **Screen Reader Compatibility**: Different screen readers may behave differently
  - **Mitigation**: Testing with multiple screen readers, ARIA compliance
- **Mobile Keyboard**: External keyboards on mobile devices
  - **Mitigation**: Mobile testing, touch fallback support

This implementation plan provides a comprehensive focus management system that ensures logical, predictable keyboard navigation throughout the video player interface.