# Implementation Plan: 1.4.5 - Add Skip Links for Main Content Areas

## Overview

Implement comprehensive skip links throughout the application to allow keyboard users to bypass repetitive navigation and quickly access main content areas. This implementation will follow WCAG 2.1.1 (Keyboard) and 2.4.1 (Bypass Blocks) guidelines, providing efficient navigation for screen reader users and keyboard-only users.

## Objectives

- **Primary**: Implement skip links for all major content areas and navigation blocks
- **Secondary**: Create context-aware skip links that adapt to page structure
- **Tertiary**: Provide customizable skip link preferences and persistent positioning
- **Compliance**: WCAG 2.1.1, 2.4.1, 1.4.10 (Reflow), 2.4.6 (Headings and Labels)

## Success Criteria

### Functional Requirements
- [ ] Skip links for main navigation, content, sidebar, and footer
- [ ] Context-aware skip links that adapt to page structure
- [ ] Persistent skip links that remain visible during keyboard navigation
- [ ] Skip links for video player controls and related content
- [ ] Mobile-optimized skip links with touch-friendly targets
- [ ] RTL language support for Arabic content

### Accessibility Requirements
- [ ] Skip links visible on focus for keyboard users
- [ ] Screen reader announcements for skip link destinations
- [ ] High contrast mode support for skip link visibility
- [ ] Proper ARIA attributes and semantic markup
- [ ] Focus management after skip link activation

### Technical Requirements
- [ ] Cross-browser compatibility (Chrome, Firefox, Safari, Edge)
- [ ] Mobile device compatibility with touch targets
- [ ] Performance optimization (minimal impact on page load)
- [ ] SEO-friendly implementation
- [ ] Comprehensive test coverage (90%+)

## Implementation Details

### 1. Core Skip Links System

#### 1.1 Skip Links Manager
```typescript
// apps/web/src/lib/accessibility/skip-links-manager.ts
interface SkipLink {
  id: string;
  target: string;
  label: string;
  description?: string;
  priority: number;
  context?: string[];
  persistent: boolean;
  mobileOnly?: boolean;
  desktopOnly?: boolean;
}

interface SkipLinkConfig {
  showOnFocus: boolean;
  persistent: boolean;
  position: 'top' | 'fixed-top' | 'fixed-bottom';
  animation: boolean;
  highContrast: boolean;
}

class SkipLinksManager {
  private skipLinks: Map<string, SkipLink> = new Map();
  private config: SkipLinkConfig;
  private container: HTMLElement | null = null;
  private activeLinks: Set<string> = new Set();
  private currentContext: string = 'default';

  constructor(config: Partial<SkipLinkConfig> = {}) {
    this.config = {
      showOnFocus: true,
      persistent: false,
      position: 'fixed-top',
      animation: true,
      highContrast: false,
      ...config
    };

    this.initializeDefaultSkipLinks();
    this.createContainer();
    this.bindEvents();
  }

  // Register new skip link
  registerSkipLink(skipLink: SkipLink): void {
    this.skipLinks.set(skipLink.id, skipLink);
    this.updateSkipLinks();
  }

  // Remove skip link
  removeSkipLink(id: string): void {
    this.skipLinks.delete(id);
    this.updateSkipLinks();
  }

  // Set current context
  setContext(context: string): void {
    this.currentContext = context;
    this.updateSkipLinks();
  }

  // Get active skip links for current context
  getActiveSkipLinks(): SkipLink[] {
    return Array.from(this.skipLinks.values())
      .filter(link => this.isSkipLinkActive(link))
      .sort((a, b) => a.priority - b.priority);
  }

  // Check if skip link is active in current context
  private isSkipLinkActive(skipLink: SkipLink): boolean {
    // Check context
    if (skipLink.context && skipLink.context.length > 0) {
      if (!skipLink.context.includes(this.currentContext)) {
        return false;
      }
    }

    // Check mobile/desktop only
    const isMobile = window.innerWidth < 768;
    if (skipLink.mobileOnly && !isMobile) return false;
    if (skipLink.desktopOnly && isMobile) return false;

    // Check if target exists
    const target = document.querySelector(skipLink.target);
    if (!target) return false;

    return true;
  }

  // Create skip links container
  private createContainer(): void {
    this.container = document.createElement('div');
    this.container.className = 'skip-links-container';
    this.container.setAttribute('role', 'navigation');
    this.container.setAttribute('aria-label', 'Skip navigation links');
    
    this.updateContainerStyles();
    document.body.insertBefore(this.container, document.body.firstChild);
  }

  // Update container styles based on config
  private updateContainerStyles(): void {
    if (!this.container) return;

    const baseClasses = [
      'skip-links-container',
      'z-50',
      'transition-all',
      'duration-200'
    ];

    // Position classes
    switch (this.config.position) {
      case 'top':
        baseClasses.push('absolute', 'top-0', 'left-0', 'right-0');
        break;
      case 'fixed-top':
        baseClasses.push('fixed', 'top-0', 'left-0', 'right-0');
        break;
      case 'fixed-bottom':
        baseClasses.push('fixed', 'bottom-0', 'left-0', 'right-0');
        break;
    }

    // Visibility classes
    if (this.config.showOnFocus) {
      baseClasses.push('focus-within:opacity-100', 'opacity-0');
    } else {
      baseClasses.push('opacity-100');
    }

    this.container.className = baseClasses.join(' ');
  }

  // Update skip links display
  private updateSkipLinks(): void {
    if (!this.container) return;

    const activeLinks = this.getActiveSkipLinks();
    
    // Clear existing links
    this.container.innerHTML = '';

    // Add skip links
    activeLinks.forEach(skipLink => {
      const linkElement = this.createSkipLinkElement(skipLink);
      this.container!.appendChild(linkElement);
    });

    // Update active links set
    this.activeLinks = new Set(activeLinks.map(link => link.id));
  }

  // Create individual skip link element
  private createSkipLinkElement(skipLink: SkipLink): HTMLElement {
    const link = document.createElement('a');
    link.href = skipLink.target;
    link.className = this.getSkipLinkClasses(skipLink);
    link.textContent = skipLink.label;
    link.setAttribute('data-skip-link', skipLink.id);
    
    // Add ARIA attributes
    if (skipLink.description) {
      link.setAttribute('aria-describedby', `skip-link-desc-${skipLink.id}`);
    }
    
    link.setAttribute('role', 'link');
    link.setAttribute('tabindex', '0');

    // Add description if provided
    if (skipLink.description) {
      const description = document.createElement('span');
      description.id = `skip-link-desc-${skipLink.id}`;
      description.className = 'sr-only';
      description.textContent = skipLink.description;
      link.appendChild(description);
    }

    // Add click handler
    link.addEventListener('click', (event) => {
      event.preventDefault();
      this.handleSkipLink(skipLink);
    });

    // Add keyboard handler
    link.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.handleSkipLink(skipLink);
      }
    });

    return link;
  }

  // Get CSS classes for skip link
  private getSkipLinkClasses(skipLink: SkipLink): string {
    const classes = [
      'skip-link',
      'block',
      'px-4',
      'py-2',
      'bg-white',
      'text-gray-900',
      'border',
      'border-gray-300',
      'rounded',
      'text-sm',
      'font-medium',
      'focus:outline-none',
      'focus:ring-2',
      'focus:ring-blue-500',
      'focus:border-blue-500',
      'hover:bg-gray-50',
      'transition-colors',
      'duration-150'
    ];

    // High contrast mode
    if (this.config.highContrast) {
      classes.push(
        'bg-black',
        'text-white',
        'border-white',
        'focus:ring-white',
        'focus:border-white'
      );
    }

    // RTL support
    if (document.dir === 'rtl') {
      classes.push('text-right');
    }

    // Animation
    if (this.config.animation) {
      classes.push('transform', 'hover:scale-105');
    }

    return classes.join(' ');
  }

  // Handle skip link activation
  private handleSkipLink(skipLink: SkipLink): void {
    const target = document.querySelector(skipLink.target) as HTMLElement;
    
    if (!target) {
      console.warn(`Skip link target not found: ${skipLink.target}`);
      return;
    }

    // Make target focusable
    if (!target.hasAttribute('tabindex')) {
      target.setAttribute('tabindex', '-1');
    }

    // Focus target
    target.focus();

    // Scroll target into view
    target.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });

    // Announce to screen readers
    this.announceSkip(skipLink);

    // Log for analytics
    this.logSkipUsage(skipLink.id);
  }

  // Announce skip to screen readers
  private announceSkip(skipLink: SkipLink): void {
    const announcement = `Skipped to ${skipLink.label}`;
    this.announceToScreenReader(announcement);
  }

  // Announce to screen reader
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

  // Log skip usage
  private logSkipUsage(skipLinkId: string): void {
    // Analytics tracking
    if (typeof gtag !== 'undefined') {
      gtag('event', 'skip_link_used', {
        skip_link_id: skipLinkId,
        context: this.currentContext
      });
    }
  }

  // Initialize default skip links
  private initializeDefaultSkipLinks(): void {
    // Skip to main content
    this.registerSkipLink({
      id: 'skip-to-main',
      target: 'main, [role="main"], .main-content',
      label: 'Skip to main content',
      description: 'Jump directly to the main content of the page',
      priority: 1,
      persistent: true
    });

    // Skip to navigation
    this.registerSkipLink({
      id: 'skip-to-navigation',
      target: 'nav, [role="navigation"], .navigation',
      label: 'Skip to navigation',
      description: 'Jump to the main navigation menu',
      priority: 2,
      context: ['default', 'content']
    });

    // Skip to search
    this.registerSkipLink({
      id: 'skip-to-search',
      target: 'input[type="search"], .search-container, [role="search"]',
      label: 'Skip to search',
      description: 'Jump to the search functionality',
      priority: 3,
      context: ['default', 'content']
    });

    // Skip to video player
    this.registerSkipLink({
      id: 'skip-to-video',
      target: '.video-player, video, [role="application"][aria-label*="video"]',
      label: 'Skip to video player',
      description: 'Jump to the video player controls',
      priority: 4,
      context: ['video-page', 'watch-page']
    });

    // Skip to sidebar
    this.registerSkipLink({
      id: 'skip-to-sidebar',
      target: '.sidebar, aside, [role="complementary"]',
      label: 'Skip to sidebar',
      description: 'Jump to the sidebar content',
      priority: 5,
      context: ['default', 'content']
    });

    // Skip to footer
    this.registerSkipLink({
      id: 'skip-to-footer',
      target: 'footer, [role="contentinfo"]',
      label: 'Skip to footer',
      description: 'Jump to the footer section',
      priority: 6,
      context: ['default', 'content']
    });

    // Skip to comments
    this.registerSkipLink({
      id: 'skip-to-comments',
      target: '.comments, [role="complementary"].comments',
      label: 'Skip to comments',
      description: 'Jump to the comments section',
      priority: 7,
      context: ['video-page', 'watch-page']
    });

    // Skip to transcript
    this.registerSkipLink({
      id: 'skip-to-transcript',
      target: '.transcript, [role="complementary"].transcript',
      label: 'Skip to transcript',
      description: 'Jump to the video transcript',
      priority: 8,
      context: ['video-page', 'watch-page']
    });
  }

  // Bind events
  private bindEvents(): void {
    // Update skip links on DOM changes
    const observer = new MutationObserver(() => {
      this.updateSkipLinks();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Update on resize
    window.addEventListener('resize', () => {
      this.updateSkipLinks();
    });

    // Update on route changes (for SPA)
    window.addEventListener('popstate', () => {
      this.updateSkipLinks();
    });
  }

  // Update configuration
  updateConfig(newConfig: Partial<SkipLinkConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.updateContainerStyles();
    this.updateSkipLinks();
  }

  // Get current configuration
  getConfig(): SkipLinkConfig {
    return { ...this.config };
  }

  // Get all registered skip links
  getAllSkipLinks(): SkipLink[] {
    return Array.from(this.skipLinks.values());
  }

  // Export configuration
  exportConfig(): string {
    return JSON.stringify({
      config: this.config,
      skipLinks: Array.from(this.skipLinks.entries())
    }, null, 2);
  }

  // Import configuration
  importConfig(configJson: string): boolean {
    try {
      const imported = JSON.parse(configJson);
      
      if (imported.config) {
        this.updateConfig(imported.config);
      }
      
      if (imported.skipLinks) {
        this.skipLinks = new Map(imported.skipLinks);
        this.updateSkipLinks();
      }
      
      return true;
    } catch (error) {
      console.error('Failed to import skip links configuration:', error);
      return false;
    }
  }
}

// Global instance
export const skipLinksManager = new SkipLinksManager();
```

#### 1.2 Skip Links Preferences
```typescript
// apps/web/src/lib/accessibility/skip-links-preferences.ts
interface SkipLinksUserPreferences {
  enabled: boolean;
  showOnFocus: boolean;
  persistent: boolean;
  position: 'top' | 'fixed-top' | 'fixed-bottom';
  animation: boolean;
  highContrast: boolean;
  customSkipLinks: Array<{
    id: string;
    target: string;
    label: string;
    description?: string;
    priority: number;
  }>;
  disabledSkipLinks: string[];
}

class SkipLinksPreferences {
  private readonly STORAGE_KEY = 'al-ummah-skip-links-preferences';
  private preferences: SkipLinksUserPreferences;

  constructor() {
    this.preferences = this.loadPreferences();
  }

  // Load preferences from localStorage
  private loadPreferences(): SkipLinksUserPreferences {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (error) {
      console.warn('Failed to load skip links preferences:', error);
    }

    return this.getDefaultPreferences();
  }

  private getDefaultPreferences(): SkipLinksUserPreferences {
    return {
      enabled: true,
      showOnFocus: true,
      persistent: false,
      position: 'fixed-top',
      animation: true,
      highContrast: false,
      customSkipLinks: [],
      disabledSkipLinks: []
    };
  }

  // Save preferences to localStorage
  savePreferences(): void {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.preferences));
    } catch (error) {
      console.warn('Failed to save skip links preferences:', error);
    }
  }

  // Get all preferences
  getPreferences(): SkipLinksUserPreferences {
    return { ...this.preferences };
  }

  // Update preference
  updatePreference<K extends keyof SkipLinksUserPreferences>(
    key: K,
    value: SkipLinksUserPreferences[K]
  ): void {
    this.preferences[key] = value;
    this.savePreferences();
  }

  // Add custom skip link
  addCustomSkipLink(skipLink: SkipLinksUserPreferences['customSkipLinks'][0]): void {
    this.preferences.customSkipLinks.push(skipLink);
    this.savePreferences();
  }

  // Remove custom skip link
  removeCustomSkipLink(id: string): void {
    this.preferences.customSkipLinks = this.preferences.customSkipLinks.filter(
      link => link.id !== id
    );
    this.savePreferences();
  }

  // Enable/disable skip link
  toggleSkipLink(skipLinkId: string, enabled: boolean): void {
    if (enabled) {
      this.preferences.disabledSkipLinks = this.preferences.disabledSkipLinks.filter(
        id => id !== skipLinkId
      );
    } else {
      if (!this.preferences.disabledSkipLinks.includes(skipLinkId)) {
        this.preferences.disabledSkipLinks.push(skipLinkId);
      }
    }
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
      console.error('Failed to import skip links preferences:', error);
      return false;
    }
  }
}

export const skipLinksPreferences = new SkipLinksPreferences();
```

### 2. React Components

#### 2.1 Skip Links Provider
```typescript
// apps/web/src/components/accessibility/skip-links-provider.tsx
import React, { createContext, useContext, useEffect, useState } from 'react';
import { skipLinksManager } from '@/lib/accessibility/skip-links-manager';
import { skipLinksPreferences } from '@/lib/accessibility/skip-links-preferences';

interface SkipLinksContextType {
  isEnabled: boolean;
  config: any;
  updateConfig: (config: any) => void;
  addCustomSkipLink: (link: any) => void;
  removeCustomSkipLink: (id: string) => void;
}

const SkipLinksContext = createContext<SkipLinksContextType | null>(null);

export const useSkipLinks = () => {
  const context = useContext(SkipLinksContext);
  if (!context) {
    throw new Error('useSkipLinks must be used within SkipLinksProvider');
  }
  return context;
};

interface SkipLinksProviderProps {
  children: React.ReactNode;
}

export const SkipLinksProvider: React.FC<SkipLinksProviderProps> = ({ children }) => {
  const [preferences, setPreferences] = useState(skipLinksPreferences.getPreferences());

  useEffect(() => {
    // Update skip links manager with current preferences
    skipLinksManager.updateConfig({
      showOnFocus: preferences.showOnFocus,
      persistent: preferences.persistent,
      position: preferences.position,
      animation: preferences.animation,
      highContrast: preferences.highContrast
    });

    // Add custom skip links
    preferences.customSkipLinks.forEach(link => {
      skipLinksManager.registerSkipLink({
        ...link,
        context: [],
        persistent: false
      });
    });

    // Disable skip links
    preferences.disabledSkipLinks.forEach(id => {
      skipLinksManager.removeSkipLink(id);
    });
  }, [preferences]);

  const updateConfig = (newConfig: Partial<typeof preferences>) => {
    const updatedPreferences = { ...preferences, ...newConfig };
    setPreferences(updatedPreferences);
    skipLinksPreferences.updatePreference('enabled', updatedPreferences.enabled);
    skipLinksPreferences.updatePreference('showOnFocus', updatedPreferences.showOnFocus);
    skipLinksPreferences.updatePreference('persistent', updatedPreferences.persistent);
    skipLinksPreferences.updatePreference('position', updatedPreferences.position);
    skipLinksPreferences.updatePreference('animation', updatedPreferences.animation);
    skipLinksPreferences.updatePreference('highContrast', updatedPreferences.highContrast);
  };

  const addCustomSkipLink = (link: any) => {
    skipLinksPreferences.addCustomSkipLink(link);
    setPreferences(skipLinksPreferences.getPreferences());
  };

  const removeCustomSkipLink = (id: string) => {
    skipLinksPreferences.removeCustomSkipLink(id);
    setPreferences(skipLinksPreferences.getPreferences());
  };

  const value: SkipLinksContextType = {
    isEnabled: preferences.enabled,
    config: preferences,
    updateConfig,
    addCustomSkipLink,
    removeCustomSkipLink
  };

  return (
    <SkipLinksContext.Provider value={value}>
      {children}
    </SkipLinksContext.Provider>
  );
};
```

#### 2.2 Skip Links Settings Component
```typescript
// apps/web/src/components/accessibility/skip-links-settings.tsx
import React, { useState } from 'react';
import { useSkipLinks } from './skip-links-provider';

interface SkipLinksSettingsProps {
  onClose?: () => void;
}

export const SkipLinksSettings: React.FC<SkipLinksSettingsProps> = ({ onClose }) => {
  const { config, updateConfig, addCustomSkipLink, removeCustomSkipLink } = useSkipLinks();
  const [showAddForm, setShowAddForm] = useState(false);
  const [newLink, setNewLink] = useState({
    id: '',
    target: '',
    label: '',
    description: '',
    priority: 10
  });

  const handleAddCustomLink = () => {
    if (newLink.id && newLink.target && newLink.label) {
      addCustomSkipLink(newLink);
      setNewLink({
        id: '',
        target: '',
        label: '',
        description: '',
        priority: 10
      });
      setShowAddForm(false);
    }
  };

  return (
    <div className="bg-white rounded-lg p-6 max-w-2xl mx-auto">
      <h2 className="text-2xl font-bold mb-6">Skip Links Settings</h2>

      {/* General Settings */}
      <div className="space-y-4 mb-6">
        <h3 className="text-lg font-semibold">General Settings</h3>
        
        <div className="flex items-center justify-between">
          <label htmlFor="show-on-focus" className="text-sm font-medium">
            Show on focus only
          </label>
          <input
            id="show-on-focus"
            type="checkbox"
            checked={config.showOnFocus}
            onChange={(e) => updateConfig({ showOnFocus: e.target.checked })}
            className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
          />
        </div>

        <div className="flex items-center justify-between">
          <label htmlFor="persistent" className="text-sm font-medium">
            Always visible
          </label>
          <input
            id="persistent"
            type="checkbox"
            checked={config.persistent}
            onChange={(e) => updateConfig({ persistent: e.target.checked })}
            className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
          />
        </div>

        <div className="flex items-center justify-between">
          <label htmlFor="animation" className="text-sm font-medium">
            Enable animations
          </label>
          <input
            id="animation"
            type="checkbox"
            checked={config.animation}
            onChange={(e) => updateConfig({ animation: e.target.checked })}
            className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
          />
        </div>

        <div className="flex items-center justify-between">
          <label htmlFor="high-contrast" className="text-sm font-medium">
            High contrast mode
          </label>
          <input
            id="high-contrast"
            type="checkbox"
            checked={config.highContrast}
            onChange={(e) => updateConfig({ highContrast: e.target.checked })}
            className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
          />
        </div>

        <div>
          <label htmlFor="position" className="block text-sm font-medium mb-2">
            Position
          </label>
          <select
            id="position"
            value={config.position}
            onChange={(e) => updateConfig({ position: e.target.value as any })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="fixed-top">Fixed Top</option>
            <option value="fixed-bottom">Fixed Bottom</option>
            <option value="top">Top</option>
          </select>
        </div>
      </div>

      {/* Custom Skip Links */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Custom Skip Links</h3>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            Add Custom Link
          </button>
        </div>

        {/* Add Custom Link Form */}
        {showAddForm && (
          <div className="bg-gray-50 p-4 rounded-lg space-y-3">
            <div>
              <label htmlFor="link-id" className="block text-sm font-medium mb-1">
                ID
              </label>
              <input
                id="link-id"
                type="text"
                value={newLink.id}
                onChange={(e) => setNewLink({ ...newLink, id: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="unique-id"
              />
            </div>

            <div>
              <label htmlFor="link-target" className="block text-sm font-medium mb-1">
                Target Selector
              </label>
              <input
                id="link-target"
                type="text"
                value={newLink.target}
                onChange={(e) => setNewLink({ ...newLink, target: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder=".my-element, #my-id"
              />
            </div>

            <div>
              <label htmlFor="link-label" className="block text-sm font-medium mb-1">
                Label
              </label>
              <input
                id="link-label"
                type="text"
                value={newLink.label}
                onChange={(e) => setNewLink({ ...newLink, label: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Skip to my content"
              />
            </div>

            <div>
              <label htmlFor="link-description" className="block text-sm font-medium mb-1">
                Description (optional)
              </label>
              <input
                id="link-description"
                type="text"
                value={newLink.description}
                onChange={(e) => setNewLink({ ...newLink, description: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Jump to my custom content"
              />
            </div>

            <div>
              <label htmlFor="link-priority" className="block text-sm font-medium mb-1">
                Priority
              </label>
              <input
                id="link-priority"
                type="number"
                value={newLink.priority}
                onChange={(e) => setNewLink({ ...newLink, priority: parseInt(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                min="1"
                max="100"
              />
            </div>

            <div className="flex space-x-2">
              <button
                onClick={handleAddCustomLink}
                className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                Add Link
              </button>
              <button
                onClick={() => setShowAddForm(false)}
                className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Custom Links List */}
        {config.customSkipLinks.length > 0 && (
          <div className="space-y-2">
            {config.customSkipLinks.map((link) => (
              <div key={link.id} className="flex items-center justify-between p-3 bg-gray-50 rounded">
                <div>
                  <div className="font-medium">{link.label}</div>
                  <div className="text-sm text-gray-600">Target: {link.target}</div>
                  {link.description && (
                    <div className="text-sm text-gray-600">{link.description}</div>
                  )}
                </div>
                <button
                  onClick={() => removeCustomSkipLink(link.id)}
                  className="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      {onClose && (
        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
};
```

### 3. CSS Styles

#### 3.1 Skip Links Styles
```css
/* apps/web/src/styles/accessibility/skip-links.css */

/* Skip Links Container */
.skip-links-container {
  /* Base styles */
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 14px;
  line-height: 1.5;
}

/* Skip Links */
.skip-link {
  /* Positioning */
  position: relative;
  display: block;
  width: 100%;
  
  /* Spacing */
  margin: 2px 0;
  padding: 8px 16px;
  
  /* Visual */
  background-color: #ffffff;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  color: #111827;
  text-decoration: none;
  font-weight: 500;
  
  /* Transitions */
  transition: all 0.15s ease-in-out;
  
  /* Focus styles */
  outline: none;
}

.skip-link:hover,
.skip-link:focus {
  background-color: #f9fafb;
  border-color: #3b82f6;
  color: #111827;
  text-decoration: none;
}

.skip-link:focus {
  box-shadow: 0 0 0 2px #3b82f6;
}

/* High Contrast Mode */
@media (prefers-contrast: high) {
  .skip-link {
    background-color: #000000;
    border-color: #ffffff;
    color: #ffffff;
  }
  
  .skip-link:hover,
  .skip-link:focus {
    background-color: #ffffff;
    border-color: #000000;
    color: #000000;
  }
  
  .skip-link:focus {
    box-shadow: 0 0 0 2px #ffffff;
  }
}

/* Reduced Motion */
@media (prefers-reduced-motion: reduce) {
  .skip-link {
    transition: none;
  }
  
  .skip-links-container {
    transition: none;
  }
}

/* Mobile Styles */
@media (max-width: 767px) {
  .skip-link {
    padding: 12px 16px;
    font-size: 16px;
    min-height: 44px; /* Touch target size */
  }
}

/* RTL Support */
[dir="rtl"] .skip-link {
  text-align: right;
}

/* Fixed Top Position */
.skip-links-container.fixed-top {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 9999;
}

/* Fixed Bottom Position */
.skip-links-container.fixed-bottom {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 9999;
}

/* Top Position */
.skip-links-container.top {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 9999;
}

/* Show on Focus */
.skip-links-container.focus-within {
  opacity: 1 !important;
}

/* Animation */
.skip-links-container .skip-link {
  transform: translateY(0);
}

.skip-links-container .skip-link:hover {
  transform: translateY(-1px);
}

/* Screen Reader Only */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* Focus Visible Support */
.skip-link:focus-visible {
  outline: 2px solid #3b82f6;
  outline-offset: 2px;
}

/* Print Styles */
@media print {
  .skip-links-container {
    display: none;
  }
}
```

### 4. Page-Specific Skip Links

#### 4.1 Video Page Skip Links
```typescript
// apps/web/src/pages/video/skip-links-config.ts
import { skipLinksManager } from '@/lib/accessibility/skip-links-manager';

export const configureVideoPageSkipLinks = (): void => {
  // Set context for video page
  skipLinksManager.setContext('video-page');

  // Add video-specific skip links
  skipLinksManager.registerSkipLink({
    id: 'skip-to-video-controls',
    target: '.video-controls, .video-player-controls',
    label: 'Skip to video controls',
    description: 'Jump to the video player control buttons',
    priority: 4,
    context: ['video-page']
  });

  skipLinksManager.registerSkipLink({
    id: 'skip-to-video-info',
    target: '.video-info, .video-metadata',
    label: 'Skip to video information',
    description: 'Jump to video title, description, and metadata',
    priority: 5,
    context: ['video-page']
  });

  skipLinksManager.registerSkipLink({
    id: 'skip-to-related-videos',
    target: '.related-videos, .video-suggestions',
    label: 'Skip to related videos',
    description: 'Jump to related videos and suggestions',
    priority: 6,
    context: ['video-page']
  });

  skipLinksManager.registerSkipLink({
    id: 'skip-to-comments',
    target: '.comments-section, .video-comments',
    label: 'Skip to comments',
    description: 'Jump to the comments section',
    priority: 7,
    context: ['video-page']
  });

  skipLinksManager.registerSkipLink({
    id: 'skip-to-transcript',
    target: '.transcript-section, .video-transcript',
    label: 'Skip to transcript',
    description: 'Jump to the video transcript',
    priority: 8,
    context: ['video-page']
  });

  skipLinksManager.registerSkipLink({
    id: 'skip-to-chapters',
    target: '.video-chapters, .chapter-navigation',
    label: 'Skip to chapters',
    description: 'Jump to video chapters navigation',
    priority: 9,
    context: ['video-page']
  });
};

// Cleanup function
export const cleanupVideoPageSkipLinks = (): void => {
  // Remove video-specific skip links
  const videoPageSkipLinks = [
    'skip-to-video-controls',
    'skip-to-video-info',
    'skip-to-related-videos',
    'skip-to-comments',
    'skip-to-transcript',
    'skip-to-chapters'
  ];

  videoPageSkipLinks.forEach(id => {
    skipLinksManager.removeSkipLink(id);
  });

  // Reset context
  skipLinksManager.setContext('default');
};
```

#### 4.2 Home Page Skip Links
```typescript
// apps/web/src/pages/home/skip-links-config.ts
import { skipLinksManager } from '@/lib/accessibility/skip-links-manager';

export const configureHomePageSkipLinks = (): void => {
  // Set context for home page
  skipLinksManager.setContext('home-page');

  // Add home page specific skip links
  skipLinksManager.registerSkipLink({
    id: 'skip-to-featured-content',
    target: '.featured-content, .hero-section',
    label: 'Skip to featured content',
    description: 'Jump to featured videos and content',
    priority: 4,
    context: ['home-page']
  });

  skipLinksManager.registerSkipLink({
    id: 'skip-to-categories',
    target: '.categories, .video-categories',
    label: 'Skip to categories',
    description: 'Jump to video categories and browsing',
    priority: 5,
    context: ['home-page']
  });

  skipLinksManager.registerSkipLink({
    id: 'skip-to-trending',
    target: '.trending-videos, .trending-section',
    label: 'Skip to trending videos',
    description: 'Jump to trending and popular videos',
    priority: 6,
    context: ['home-page']
  });

  skipLinksManager.registerSkipLink({
    id: 'skip-to-recommended',
    target: '.recommended-videos, .recommendations',
    label: 'Skip to recommended videos',
    description: 'Jump to personalized recommendations',
    priority: 7,
    context: ['home-page']
  });
};

// Cleanup function
export const cleanupHomePageSkipLinks = (): void => {
  // Remove home page specific skip links
  const homePageSkipLinks = [
    'skip-to-featured-content',
    'skip-to-categories',
    'skip-to-trending',
    'skip-to-recommended'
  ];

  homePageSkipLinks.forEach(id => {
    skipLinksManager.removeSkipLink(id);
  });

  // Reset context
  skipLinksManager.setContext('default');
};
```

### 5. Testing Strategy

#### 5.1 Unit Tests
```typescript
// apps/web/src/__tests__/accessibility/skip-links-manager.test.ts
import { SkipLinksManager } from '@/lib/accessibility/skip-links-manager';

describe('SkipLinksManager', () => {
  let manager: SkipLinksManager;

  beforeEach(() => {
    manager = new SkipLinksManager();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('skip link registration', () => {
    it('should register a new skip link', () => {
      const skipLink = {
        id: 'test-skip',
        target: '#test-target',
        label: 'Test Skip Link',
        priority: 1,
        context: [],
        persistent: false
      };

      manager.registerSkipLink(skipLink);
      
      const allLinks = manager.getAllSkipLinks();
      expect(allLinks).toContainEqual(skipLink);
    });

    it('should remove a skip link', () => {
      const skipLink = {
        id: 'test-skip',
        target: '#test-target',
        label: 'Test Skip Link',
        priority: 1,
        context: [],
        persistent: false
      };

      manager.registerSkipLink(skipLink);
      manager.removeSkipLink('test-skip');
      
      const allLinks = manager.getAllSkipLinks();
      expect(allLinks).not.toContainEqual(skipLink);
    });
  });

  describe('context management', () => {
    it('should only show skip links for current context', () => {
      const contextLink = {
        id: 'context-skip',
        target: '#context-target',
        label: 'Context Skip Link',
        priority: 1,
        context: ['video-page'],
        persistent: false
      };

      const defaultLink = {
        id: 'default-skip',
        target: '#default-target',
        label: 'Default Skip Link',
        priority: 1,
        context: [],
        persistent: false
      };

      manager.registerSkipLink(contextLink);
      manager.registerSkipLink(defaultLink);

      // Default context should show default link only
      let activeLinks = manager.getActiveSkipLinks();
      expect(activeLinks).toContainEqual(defaultLink);
      expect(activeLinks).not.toContainEqual(contextLink);

      // Video page context should show context link
      manager.setContext('video-page');
      activeLinks = manager.getActiveSkipLinks();
      expect(activeLinks).toContainEqual(contextLink);
      expect(activeLinks).not.toContainEqual(defaultLink);
    });
  });

  describe('target validation', () => {
    beforeEach(() => {
      // Create test target element
      const target = document.createElement('div');
      target.id = 'test-target';
      document.body.appendChild(target);
    });

    it('should only show skip links with valid targets', () => {
      const validLink = {
        id: 'valid-skip',
        target: '#test-target',
        label: 'Valid Skip Link',
        priority: 1,
        context: [],
        persistent: false
      };

      const invalidLink = {
        id: 'invalid-skip',
        target: '#non-existent-target',
        label: 'Invalid Skip Link',
        priority: 1,
        context: [],
        persistent: false
      };

      manager.registerSkipLink(validLink);
      manager.registerSkipLink(invalidLink);

      const activeLinks = manager.getActiveSkipLinks();
      expect(activeLinks).toContainEqual(validLink);
      expect(activeLinks).not.toContainEqual(invalidLink);
    });
  });

  describe('skip link activation', () => {
    beforeEach(() => {
      // Create test target element
      const target = document.createElement('div');
      target.id = 'test-target';
      target.tabIndex = -1;
      document.body.appendChild(target);
    });

    it('should focus target when skip link is activated', () => {
      const skipLink = {
        id: 'test-skip',
        target: '#test-target',
        label: 'Test Skip Link',
        priority: 1,
        context: [],
        persistent: false
      };

      manager.registerSkipLink(skipLink);
      
      // Simulate skip link activation
      manager.handleSkipLink(skipLink);

      const target = document.getElementById('test-target');
      expect(target).toHaveFocus();
    });
  });
});
```

#### 5.2 Integration Tests
```typescript
// apps/web/src/__tests__/accessibility/skip-links-integration.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { SkipLinksProvider } from '@/components/accessibility/skip-links-provider';
import { skipLinksManager } from '@/lib/accessibility/skip-links-manager';

// Mock the skip links manager
jest.mock('@/lib/accessibility/skip-links-manager');

describe('Skip Links Integration', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <main id="main-content">
        <h1>Main Content</h1>
        <p>This is the main content of the page.</p>
      </main>
      <nav id="navigation">
        <ul>
          <li><a href="/">Home</a></li>
          <li><a href="/videos">Videos</a></li>
        </ul>
      </nav>
    `;
  });

  it('should render skip links provider', () => {
    render(
      <SkipLinksProvider>
        <div>Test Content</div>
      </SkipLinksProvider>
    );

    expect(screen.getByText('Test Content')).toBeInTheDocument();
  });

  it('should handle skip link activation', () => {
    const mockHandleSkipLink = jest.fn();
    (skipLinksManager.handleSkipLink as jest.Mock) = mockHandleSkipLink;

    render(
      <SkipLinksProvider>
        <div>Test Content</div>
      </SkipLinksProvider>
    );

    // Simulate skip link click
    const skipLink = document.createElement('a');
    skipLink.href = '#main-content';
    skipLink.click();

    // Note: In a real test, you'd need to set up the actual skip links
    // This is a simplified example
  });
});
```

#### 5.3 Accessibility Tests
```typescript
// apps/web/src/__tests__/accessibility/skip-links-a11y.test.ts
import { render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { SkipLinksProvider } from '@/components/accessibility/skip-links-provider';

// Extend Jest matchers
expect.extend(toHaveNoViolations);

describe('Skip Links Accessibility', () => {
  it('should have no accessibility violations', async () => {
    const { container } = render(
      <SkipLinksProvider>
        <div>Test Content</div>
      </SkipLinksProvider>
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('should have proper ARIA attributes', () => {
    render(
      <SkipLinksProvider>
        <div>Test Content</div>
      </SkipLinksProvider>
    );

    // Check for skip links container
    const container = document.querySelector('.skip-links-container');
    expect(container).toHaveAttribute('role', 'navigation');
    expect(container).toHaveAttribute('aria-label', 'Skip navigation links');
  });

  it('should be keyboard navigable', () => {
    render(
      <SkipLinksProvider>
        <div>Test Content</div>
      </SkipLinksProvider>
    );

    // Check for keyboard navigation
    const skipLinks = document.querySelectorAll('.skip-link');
    skipLinks.forEach(link => {
      expect(link).toHaveAttribute('tabindex', '0');
    });
  });
});
```

## Deliverables

### Phase 1: Core System (Week 1)
- [ ] `SkipLinksManager` class with registration and context management
- [ ] `SkipLinksPreferences` system for user customization
- [ ] Basic skip links container and styling
- [ ] Unit tests for core functionality (90% coverage)

### Phase 2: React Integration (Week 2)
- [ ] `SkipLinksProvider` React component
- [ ] `SkipLinksSettings` component for user preferences
- [ ] Integration with existing page structure
- [ ] Integration tests for React components

### Phase 3: Page-Specific Implementation (Week 3)
- [ ] Video page skip links configuration
- [ ] Home page skip links configuration
- [ ] Context-aware skip link management
- [ ] Mobile-optimized skip links

### Phase 4: Advanced Features (Week 4)
- [ ] Custom skip link creation interface
- [ ] High contrast mode support
- [ ] RTL language support
- [ ] Export/import preferences functionality

### Phase 5: Testing & Polish (Week 5)
- [ ] Cross-browser compatibility testing
- [ ] Screen reader compatibility testing
- [ ] Performance optimization
- [ ] Documentation and user guides

## Success Metrics

### Quantitative Metrics
- **100%** of major content areas accessible via skip links
- **95%+** user satisfaction with skip link functionality
- **<50ms** response time for skip link activation
- **0** critical accessibility violations

### Qualitative Metrics
- Intuitive skip link labels and descriptions
- Context-aware skip links that adapt to page structure
- Seamless integration with existing navigation
- Comprehensive customization options

## Risks & Mitigations

### Technical Risks
- **Target element availability**: Implement robust target detection and fallbacks
- **Performance impact**: Optimize DOM queries and use efficient event handling
- **Browser compatibility**: Test across all supported browsers and provide polyfills

### User Experience Risks
- **Discoverability**: Implement visible-on-focus behavior and user education
- **Cognitive load**: Group skip links logically and provide clear labels
- **Mobile usability**: Ensure touch-friendly targets and mobile-optimized positioning

## Dependencies

### Internal Dependencies
- Focus management system (Story 1.4.2)
- ARIA management system (Story 1.4.3)
- Page routing and navigation structure

### External Dependencies
- Browser DOM APIs
- Screen reader compatibility (NVDA, JAWS, VoiceOver)
- WCAG 2.1 guidelines and compliance testing

## Timeline

**Total Duration**: 5 weeks

**Week 1**: Core skip links system and preferences
**Week 2**: React integration and settings interface
**Week 3**: Page-specific configurations and mobile optimization
**Week 4**: Advanced features and customization options
**Week 5**: Testing, optimization, and documentation

## Conclusion

This implementation plan provides a comprehensive skip links system that enhances keyboard navigation and screen reader accessibility while maintaining WCAG 2.1 Level AA compliance. The context-aware design ensures that skip links are relevant to the current page structure, while the customization options allow users to personalize their navigation experience.

The system prioritizes user experience through intuitive labeling, responsive design, and seamless integration with existing accessibility features, making content accessible to all users regardless of their assistive technology needs or navigation preferences.