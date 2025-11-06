# Implementation Plan: 1.4.6 - Add Visible Focus Indicators

## Overview

Implement comprehensive visible focus indicators throughout the application to ensure keyboard users can easily identify which element currently has focus. This implementation will follow WCAG 2.4.7 (Focus Visible) guidelines and provide clear, high-contrast focus indicators that work across all interactive elements.

## Objectives

- **Primary**: Implement visible focus indicators for all interactive elements
- **Secondary**: Create customizable focus indicator styles with high contrast support
- **Tertiary**: Provide focus indicator preferences and animation controls
- **Compliance**: WCAG 2.4.7 (Focus Visible), 1.4.11 (Non-text Contrast), 1.4.3 (Contrast)

## Success Criteria

### Functional Requirements
- [ ] Focus indicators on all interactive elements (buttons, links, inputs, etc.)
- [ ] High contrast focus indicators meeting WCAG AA standards
- [ ] Customizable focus indicator styles and animations
- [ ] Focus indicators visible in both light and dark themes
- [ ] RTL language support for Arabic content
- [ ] Mobile device focus indicator optimization

### Accessibility Requirements
- [ ] 3:1 minimum contrast ratio for focus indicators (WCAG AA)
- [ ] Focus indicators visible without color alone
- [ ] Consistent focus indicator behavior across all elements
- [ ] Focus indicators work with high contrast mode
- [ ] Reduced motion support for focus animations

### Technical Requirements
- [ ] Cross-browser compatibility (Chrome, Firefox, Safari, Edge)
- [ ] CSS custom properties for easy customization
- [ ] JavaScript fallback for browsers without :focus-visible support
- [ ] Performance optimization (minimal impact on interaction)
- [ ] Comprehensive test coverage (90%+)

## Implementation Details

### 1. Core Focus Indicator System

#### 1.1 Focus Indicator Manager
```typescript
// apps/web/src/lib/accessibility/focus-indicator-manager.ts
interface FocusIndicatorConfig {
  style: 'outline' | 'ring' | 'underline' | 'background' | 'custom';
  color: string;
  width: number;
  offset: number;
  borderRadius: number;
  animation: boolean;
  animationDuration: number;
  highContrast: boolean;
  reducedMotion: boolean;
  customCSS?: string;
}

interface FocusElement {
  element: HTMLElement;
  originalTabIndex?: string;
  hasFocusIndicator: boolean;
  customConfig?: Partial<FocusIndicatorConfig>;
}

class FocusIndicatorManager {
  private config: FocusIndicatorConfig;
  private focusedElements: Set<HTMLElement> = new Set();
  private observers: MutationObserver[] = [];
  private styleElement: HTMLStyleElement | null = null;
  private isInitialized = false;

  constructor(config: Partial<FocusIndicatorConfig> = {}) {
    this.config = this.getDefaultConfig(config);
    this.initialize();
  }

  private getDefaultConfig(override: Partial<FocusIndicatorConfig>): FocusIndicatorConfig {
    return {
      style: 'ring',
      color: '#3b82f6',
      width: 2,
      offset: 2,
      borderRadius: 4,
      animation: true,
      animationDuration: 200,
      highContrast: false,
      reducedMotion: false,
      ...override
    };
  }

  // Initialize focus indicators
  private initialize(): void {
    if (this.isInitialized) return;

    this.createStyles();
    this.bindEvents();
    this.setupObservers();
    this.applyFocusIndicators();
    this.isInitialized = true;
  }

  // Create CSS styles for focus indicators
  private createStyles(): void {
    this.styleElement = document.createElement('style');
    this.styleElement.id = 'focus-indicator-styles';
    document.head.appendChild(this.styleElement);
    this.updateStyles();
  }

  // Update CSS styles based on current config
  private updateStyles(): void {
    if (!this.styleElement) return;

    const css = this.generateCSS();
    this.styleElement.textContent = css;
  }

  // Generate CSS for focus indicators
  private generateCSS(): string {
    const { style, color, width, offset, borderRadius, animation, animationDuration, highContrast, reducedMotion } = this.config;

    const baseStyles = `
      /* Base focus indicator styles */
      [data-focus-visible] {
        outline: none !important;
      }

      /* High contrast mode support */
      @media (prefers-contrast: high) {
        [data-focus-visible] {
          outline: 3px solid !important;
          outline-color: ButtonText !important;
        }
      }

      /* Reduced motion support */
      @media (prefers-reduced-motion: reduce) {
        [data-focus-visible] {
          transition: none !important;
        }
      }
    `;

    let styleSpecificCSS = '';

    switch (style) {
      case 'outline':
        styleSpecificCSS = this.generateOutlineStyles(color, width, offset, borderRadius, animation, animationDuration);
        break;
      case 'ring':
        styleSpecificCSS = this.generateRingStyles(color, width, offset, borderRadius, animation, animationDuration);
        break;
      case 'underline':
        styleSpecificCSS = this.generateUnderlineStyles(color, width, animation, animationDuration);
        break;
      case 'background':
        styleSpecificCSS = this.generateBackgroundStyles(color, animation, animationDuration);
        break;
      case 'custom':
        styleSpecificCSS = this.config.customCSS || '';
        break;
    }

    // High contrast overrides
    const highContrastCSS = highContrast ? this.generateHighContrastStyles() : '';

    return baseStyles + styleSpecificCSS + highContrastCSS;
  }

  // Generate outline style focus indicators
  private generateOutlineStyles(color: string, width: number, offset: number, borderRadius: number, animation: boolean, duration: number): string {
    const animationCSS = animation ? `
      transition: outline-color ${duration}ms ease-in-out, outline-width ${duration}ms ease-in-out;
    ` : '';

    return `
      [data-focus-visible] {
        outline: ${width}px solid ${color} !important;
        outline-offset: ${offset}px !important;
        border-radius: ${borderRadius}px !important;
        ${animationCSS}
      }

      [data-focus-visible]:hover {
        outline-color: ${this.adjustColor(color, 20)} !important;
      }
    `;
  }

  // Generate ring style focus indicators
  private generateRingStyles(color: string, width: number, offset: number, borderRadius: number, animation: boolean, duration: number): string {
    const animationCSS = animation ? `
      transition: box-shadow ${duration}ms ease-in-out;
    ` : '';

    return `
      [data-focus-visible] {
        position: relative !important;
        box-shadow: 0 0 0 ${width}px ${color} !important;
        border-radius: ${borderRadius}px !important;
        ${animationCSS}
      }

      [data-focus-visible]:hover {
        box-shadow: 0 0 0 ${width + 1}px ${this.adjustColor(color, 20)} !important;
      }

      /* Ensure ring appears outside of element */
      [data-focus-visible]::before {
        content: '' !important;
        position: absolute !important;
        top: -${offset}px !important;
        left: -${offset}px !important;
        right: -${offset}px !important;
        bottom: -${offset}px !important;
        border-radius: ${borderRadius}px !important;
        pointer-events: none !important;
        z-index: -1 !important;
      }
    `;
  }

  // Generate underline style focus indicators
  private generateUnderlineStyles(color: string, width: number, animation: boolean, duration: number): string {
    const animationCSS = animation ? `
      transition: border-bottom-color ${duration}ms ease-in-out, border-bottom-width ${duration}ms ease-in-out;
    ` : '';

    return `
      [data-focus-visible] {
        border-bottom: ${width}px solid ${color} !important;
        ${animationCSS}
      }

      [data-focus-visible]:hover {
        border-bottom-color: ${this.adjustColor(color, 20)} !important;
      }

      /* Special handling for buttons */
      button[data-focus-visible],
      [role="button"][data-focus-visible] {
        border-bottom: none !important;
        box-shadow: inset 0 -${width}px 0 ${color} !important;
        ${animationCSS}
      }

      button[data-focus-visible]:hover,
      [role="button"][data-focus-visible]:hover {
        box-shadow: inset 0 -${width + 1}px 0 ${this.adjustColor(color, 20)} !important;
      }
    `;
  }

  // Generate background style focus indicators
  private generateBackgroundStyles(color: string, animation: boolean, duration: number): string {
    const animationCSS = animation ? `
      transition: background-color ${duration}ms ease-in-out, color ${duration}ms ease-in-out;
    ` : '';

    return `
      [data-focus-visible] {
        background-color: ${color} !important;
        color: ${this.getContrastColor(color)} !important;
        ${animationCSS}
      }

      [data-focus-visible]:hover {
        background-color: ${this.adjustColor(color, 10)} !important;
      }

      /* Ensure text remains readable */
      [data-focus-visible] * {
        color: inherit !important;
      }
    `;
  }

  // Generate high contrast styles
  private generateHighContrastStyles(): string {
    return `
      @media (prefers-contrast: high) {
        [data-focus-visible] {
          outline: 3px solid ButtonText !important;
          outline-offset: 2px !important;
          background-color: Highlight !important;
          color: HighlightText !important;
        }

        [data-focus-visible] * {
          color: HighlightText !important;
        }
      }

      /* Windows High Contrast Mode */
      @media screen and (-ms-high-contrast: active) {
        [data-focus-visible] {
          outline: 3px solid windowText !important;
          background-color: highlight !important;
          color: highlightText !important;
        }
      }
    `;
  }

  // Bind focus events
  private bindEvents(): void {
    // Focus visible polyfill for browsers without :focus-visible
    if (!this.supportsFocusVisible()) {
      this.setupFocusVisiblePolyfill();
    }

    // Handle focus events
    document.addEventListener('focusin', this.handleFocusIn.bind(this));
    document.addEventListener('focusout', this.handleFocusOut.bind(this));

    // Handle keyboard navigation
    document.addEventListener('keydown', this.handleKeyDown.bind(this));
    document.addEventListener('mousedown', this.handleMouseDown.bind(this));

    // Handle preference changes
    window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', this.handleReducedMotionChange.bind(this));
    window.matchMedia('(prefers-contrast: high)').addEventListener('change', this.handleHighContrastChange.bind(this));
  }

  // Setup focus visible polyfill
  private setupFocusVisiblePolyfill(): void {
    let hadKeyboardEvent = false;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab' || e.key === 'Enter' || e.key === ' ') {
        hadKeyboardEvent = true;
      }
    };

    const handleMouseDown = () => {
      hadKeyboardEvent = false;
    };

    const handleFocusIn = (e: FocusEvent) => {
      if (hadKeyboardEvent) {
        (e.target as HTMLElement).setAttribute('data-focus-visible', 'true');
      }
    };

    const handleFocusOut = (e: FocusEvent) => {
      (e.target as HTMLElement).removeAttribute('data-focus-visible');
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('focusout', handleFocusOut);
  }

  // Check if browser supports :focus-visible
  private supportsFocusVisible(): boolean {
    try {
      return CSS.supports('selector(:focus-visible)');
    } catch {
      return false;
    }
  }

  // Handle focus in event
  private handleFocusIn(event: FocusEvent): void {
    const element = event.target as HTMLElement;
    
    if (this.shouldHaveFocusIndicator(element)) {
      element.setAttribute('data-focus-visible', 'true');
      this.focusedElements.add(element);
      this.announceFocus(element);
    }
  }

  // Handle focus out event
  private handleFocusOut(event: FocusEvent): void {
    const element = event.target as HTMLElement;
    
    element.removeAttribute('data-focus-visible');
    this.focusedElements.delete(element);
  }

  // Handle keyboard navigation
  private handleKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Tab') {
      this.isKeyboardNavigation = true;
    }
  }

  // Handle mouse interaction
  private handleMouseDown(): void {
    this.isKeyboardNavigation = false;
  }

  // Handle reduced motion preference change
  private handleReducedMotionChange(event: MediaQueryListEvent): void {
    this.updateConfig({ reducedMotion: event.matches });
  }

  // Handle high contrast preference change
  private handleHighContrastChange(event: MediaQueryListEvent): void {
    this.updateConfig({ highContrast: event.matches });
  }

  // Check if element should have focus indicator
  private shouldHaveFocusIndicator(element: HTMLElement): boolean {
    // Skip if element is not focusable
    if (!this.isFocusable(element)) return false;

    // Skip if element has custom focus indicator
    if (element.hasAttribute('data-no-focus-indicator')) return false;

    // Skip if element is inside a focus trap with custom handling
    const focusTrap = element.closest('[data-focus-trap]');
    if (focusTrap && focusTrap.hasAttribute('data-custom-focus')) return false;

    return true;
  }

  // Check if element is focusable
  private isFocusable(element: HTMLElement): boolean {
    const tagName = element.tagName.toLowerCase();
    const hasTabIndex = element.hasAttribute('tabindex');
    const isDisabled = element.hasAttribute('disabled');
    const isHidden = element.hidden || element.style.display === 'none' || element.style.visibility === 'hidden';

    if (isDisabled || isHidden) return false;

    // Check for focusable elements
    const focusableTags = ['a', 'button', 'input', 'select', 'textarea', 'details', 'summary'];
    const focusableRoles = ['button', 'link', 'menuitem', 'option', 'radio', 'checkbox', 'tab', 'textbox'];

    if (focusableTags.includes(tagName)) return true;
    if (hasTabIndex && parseInt(element.getAttribute('tabindex') || '0') >= 0) return true;
    if (focusableRoles.includes(element.getAttribute('role') || '')) return true;

    return false;
  }

  // Apply focus indicators to existing elements
  private applyFocusIndicators(): void {
    const focusableElements = document.querySelectorAll(this.getFocusableSelector());
    
    focusableElements.forEach(element => {
      if (this.shouldHaveFocusIndicator(element as HTMLElement)) {
        this.enhanceFocusability(element as HTMLElement);
      }
    });
  }

  // Get selector for focusable elements
  private getFocusableSelector(): string {
    return `
      a[href],
      button:not([disabled]),
      input:not([disabled]),
      select:not([disabled]),
      textarea:not([disabled]),
      [tabindex]:not([tabindex="-1"]):not([disabled]),
      [role="button"]:not([disabled]),
      [role="link"]:not([disabled]),
      [role="menuitem"]:not([disabled]),
      [role="option"]:not([disabled]),
      [role="radio"]:not([disabled]),
      [role="checkbox"]:not([disabled]),
      [role="tab"]:not([disabled]),
      [role="textbox"]:not([disabled]),
      details,
      summary
    `.replace(/\s+/g, ' ').trim();
  }

  // Enhance element focusability
  private enhanceFocusability(element: HTMLElement): void {
    // Ensure element has tabindex if it's focusable by role
    if (!element.hasAttribute('tabindex') && element.hasAttribute('role')) {
      const role = element.getAttribute('role');
      const focusableRoles = ['button', 'link', 'menuitem', 'option', 'radio', 'checkbox', 'tab', 'textbox'];
      
      if (focusableRoles.includes(role || '')) {
        element.setAttribute('tabindex', '0');
      }
    }

    // Add ARIA attributes if missing
    if (element.tagName.toLowerCase() === 'a' && !element.hasAttribute('href')) {
      element.setAttribute('role', 'button');
      element.setAttribute('tabindex', '0');
    }
  }

  // Setup mutation observers
  private setupObservers(): void {
    // Observe DOM changes for new elements
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const element = node as HTMLElement;
            
            // Check if element itself is focusable
            if (this.shouldHaveFocusIndicator(element)) {
              this.enhanceFocusability(element);
            }
            
            // Check child elements
            const focusableChildren = element.querySelectorAll(this.getFocusableSelector());
            focusableChildren.forEach(child => {
              if (this.shouldHaveFocusIndicator(child as HTMLElement)) {
                this.enhanceFocusability(child as HTMLElement);
              }
            });
          }
        });
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    this.observers.push(observer);
  }

  // Announce focus to screen readers
  private announceFocus(element: HTMLElement): void {
    const label = this.getElementLabel(element);
    if (label) {
      // Create temporary announcement element
      const announcement = document.createElement('div');
      announcement.setAttribute('aria-live', 'polite');
      announcement.setAttribute('aria-atomic', 'true');
      announcement.className = 'sr-only';
      announcement.textContent = `Focused on ${label}`;
      
      document.body.appendChild(announcement);
      
      setTimeout(() => {
        document.body.removeChild(announcement);
      }, 1000);
    }
  }

  // Get element label for screen reader announcement
  private getElementLabel(element: HTMLElement): string {
    // Check for explicit label
    if (element.hasAttribute('aria-label')) {
      return element.getAttribute('aria-label') || '';
    }

    // Check for aria-labelledby
    if (element.hasAttribute('aria-labelledby')) {
      const labelId = element.getAttribute('aria-labelledby');
      const labelElement = document.getElementById(labelId || '');
      if (labelElement) {
        return labelElement.textContent || '';
      }
    }

    // Check for placeholder (inputs)
    if (element.hasAttribute('placeholder')) {
      return element.getAttribute('placeholder') || '';
    }

    // Check for title attribute
    if (element.hasAttribute('title')) {
      return element.getAttribute('title') || '';
    }

    // Use text content as fallback
    return element.textContent?.trim() || element.tagName.toLowerCase();
  }

  // Utility methods
  private adjustColor(color: string, percent: number): string {
    // Simple color adjustment (in production, use a proper color library)
    const num = parseInt(color.replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const R = (num >> 16) + amt;
    const G = (num >> 8 & 0x00FF) + amt;
    const B = (num & 0x0000FF) + amt;
    return '#' + (0x1000000 + (R < 255 ? R < 1 ? 0 : R : 255) * 0x10000 +
      (G < 255 ? G < 1 ? 0 : G : 255) * 0x100 +
      (B < 255 ? B < 1 ? 0 : B : 255))
      .toString(16).slice(1);
  }

  private getContrastColor(color: string): string {
    // Simple contrast color calculation (in production, use proper contrast calculation)
    const num = parseInt(color.replace('#', ''), 16);
    const r = num >> 16;
    const g = num >> 8 & 0x00FF;
    const b = num & 0x0000FF;
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    return brightness > 128 ? '#000000' : '#ffffff';
  }

  // Public API methods
  updateConfig(newConfig: Partial<FocusIndicatorConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.updateStyles();
  }

  getConfig(): FocusIndicatorConfig {
    return { ...this.config };
  }

  addCustomFocusIndicator(selector: string, styles: Partial<FocusIndicatorConfig>): void {
    const elements = document.querySelectorAll(selector);
    elements.forEach(element => {
      (element as HTMLElement).setAttribute('data-custom-focus', 'true');
      // Apply custom styles
      Object.assign(element.style, styles);
    });
  }

  removeFocusIndicator(element: HTMLElement): void {
    element.setAttribute('data-no-focus-indicator', 'true');
  }

  restoreFocusIndicator(element: HTMLElement): void {
    element.removeAttribute('data-no-focus-indicator');
  }

  // Cleanup
  destroy(): void {
    this.observers.forEach(observer => observer.disconnect());
    this.observers = [];
    
    if (this.styleElement) {
      this.styleElement.remove();
      this.styleElement = null;
    }

    // Remove all focus indicator attributes
    document.querySelectorAll('[data-focus-visible]').forEach(element => {
      element.removeAttribute('data-focus-visible');
    });

    this.focusedElements.clear();
    this.isInitialized = false;
  }

  private isKeyboardNavigation = false;
}

// Global instance
export const focusIndicatorManager = new FocusIndicatorManager();
```

#### 1.2 Focus Indicator Preferences
```typescript
// apps/web/src/lib/accessibility/focus-indicator-preferences.ts
interface FocusIndicatorUserPreferences {
  enabled: boolean;
  style: 'outline' | 'ring' | 'underline' | 'background' | 'custom';
  color: string;
  width: number;
  offset: number;
  borderRadius: number;
  animation: boolean;
  animationDuration: number;
  highContrast: boolean;
  reducedMotion: boolean;
  customCSS?: string;
  perElementSettings: Record<string, Partial<FocusIndicatorUserPreferences>>;
}

class FocusIndicatorPreferences {
  private readonly STORAGE_KEY = 'al-ummah-focus-indicator-preferences';
  private preferences: FocusIndicatorUserPreferences;

  constructor() {
    this.preferences = this.loadPreferences();
  }

  // Load preferences from localStorage
  private loadPreferences(): FocusIndicatorUserPreferences {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (error) {
      console.warn('Failed to load focus indicator preferences:', error);
    }

    return this.getDefaultPreferences();
  }

  private getDefaultPreferences(): FocusIndicatorUserPreferences {
    return {
      enabled: true,
      style: 'ring',
      color: '#3b82f6',
      width: 2,
      offset: 2,
      borderRadius: 4,
      animation: true,
      animationDuration: 200,
      highContrast: false,
      reducedMotion: false,
      perElementSettings: {}
    };
  }

  // Save preferences to localStorage
  savePreferences(): void {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.preferences));
    } catch (error) {
      console.warn('Failed to save focus indicator preferences:', error);
    }
  }

  // Get all preferences
  getPreferences(): FocusIndicatorUserPreferences {
    return { ...this.preferences };
  }

  // Update preference
  updatePreference<K extends keyof FocusIndicatorUserPreferences>(
    key: K,
    value: FocusIndicatorUserPreferences[K]
  ): void {
    this.preferences[key] = value;
    this.savePreferences();
  }

  // Update multiple preferences
  updatePreferences(updates: Partial<FocusIndicatorUserPreferences>): void {
    this.preferences = { ...this.preferences, ...updates };
    this.savePreferences();
  }

  // Set per-element preferences
  setElementPreferences(elementId: string, preferences: Partial<FocusIndicatorUserPreferences>): void {
    this.preferences.perElementSettings[elementId] = preferences;
    this.savePreferences();
  }

  // Get per-element preferences
  getElementPreferences(elementId: string): Partial<FocusIndicatorUserPreferences> {
    return this.preferences.perElementSettings[elementId] || {};
  }

  // Remove element preferences
  removeElementPreferences(elementId: string): void {
    delete this.preferences.perElementSettings[elementId];
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
      console.error('Failed to import focus indicator preferences:', error);
      return false;
    }
  }

  // Validate preferences
  validatePreferences(preferences: Partial<FocusIndicatorUserPreferences>): boolean {
    // Validate color format
    if (preferences.color && !/^#[0-9A-F]{6}$/i.test(preferences.color)) {
      return false;
    }

    // Validate numeric values
    if (preferences.width !== undefined && (preferences.width < 1 || preferences.width > 10)) {
      return false;
    }

    if (preferences.offset !== undefined && (preferences.offset < 0 || preferences.offset > 20)) {
      return false;
    }

    if (preferences.borderRadius !== undefined && (preferences.borderRadius < 0 || preferences.borderRadius > 50)) {
      return false;
    }

    if (preferences.animationDuration !== undefined && (preferences.animationDuration < 0 || preferences.animationDuration > 2000)) {
      return false;
    }

    return true;
  }
}

export const focusIndicatorPreferences = new FocusIndicatorPreferences();
```

### 2. React Components

#### 2.1 Focus Indicator Provider
```typescript
// apps/web/src/components/accessibility/focus-indicator-provider.tsx
import React, { createContext, useContext, useEffect, useState } from 'react';
import { focusIndicatorManager } from '@/lib/accessibility/focus-indicator-manager';
import { focusIndicatorPreferences } from '@/lib/accessibility/focus-indicator-preferences';

interface FocusIndicatorContextType {
  isEnabled: boolean;
  config: any;
  updateConfig: (config: any) => void;
  updatePreferences: (preferences: any) => void;
  resetToDefaults: () => void;
}

const FocusIndicatorContext = createContext<FocusIndicatorContextType | null>(null);

export const useFocusIndicators = () => {
  const context = useContext(FocusIndicatorContext);
  if (!context) {
    throw new Error('useFocusIndicators must be used within FocusIndicatorProvider');
  }
  return context;
};

interface FocusIndicatorProviderProps {
  children: React.ReactNode;
}

export const FocusIndicatorProvider: React.FC<FocusIndicatorProviderProps> = ({ children }) => {
  const [preferences, setPreferences] = useState(focusIndicatorPreferences.getPreferences());

  useEffect(() => {
    // Update focus indicator manager with current preferences
    focusIndicatorManager.updateConfig({
      style: preferences.style,
      color: preferences.color,
      width: preferences.width,
      offset: preferences.offset,
      borderRadius: preferences.borderRadius,
      animation: preferences.animation,
      animationDuration: preferences.animationDuration,
      highContrast: preferences.highContrast,
      reducedMotion: preferences.reducedMotion,
      customCSS: preferences.customCSS
    });

    // Enable/disable based on preferences
    if (preferences.enabled) {
      focusIndicatorManager.updateConfig({});
    }
  }, [preferences]);

  const updateConfig = (newConfig: Partial<typeof preferences>) => {
    const updatedPreferences = { ...preferences, ...newConfig };
    setPreferences(updatedPreferences);
    focusIndicatorPreferences.updatePreferences(updatedPreferences);
  };

  const updatePreferences = (newPreferences: Partial<typeof preferences>) => {
    const updatedPreferences = { ...preferences, ...newPreferences };
    setPreferences(updatedPreferences);
    focusIndicatorPreferences.updatePreferences(updatedPreferences);
  };

  const resetToDefaults = () => {
    focusIndicatorPreferences.resetToDefaults();
    setPreferences(focusIndicatorPreferences.getPreferences());
  };

  const value: FocusIndicatorContextType = {
    isEnabled: preferences.enabled,
    config: preferences,
    updateConfig,
    updatePreferences,
    resetToDefaults
  };

  return (
    <FocusIndicatorContext.Provider value={value}>
      {children}
    </FocusIndicatorContext.Provider>
  );
};
```

#### 2.2 Focus Indicator Settings Component
```typescript
// apps/web/src/components/accessibility/focus-indicator-settings.tsx
import React, { useState } from 'react';
import { useFocusIndicators } from './focus-indicator-provider';

interface FocusIndicatorSettingsProps {
  onClose?: () => void;
}

export const FocusIndicatorSettings: React.FC<FocusIndicatorSettingsProps> = ({ onClose }) => {
  const { config, updateConfig, resetToDefaults } = useFocusIndicators();
  const [customCSS, setCustomCSS] = useState(config.customCSS || '');

  const handleStyleChange = (style: string) => {
    updateConfig({ style });
  };

  const handleColorChange = (color: string) => {
    updateConfig({ color });
  };

  const handleWidthChange = (width: number) => {
    updateConfig({ width });
  };

  const handleOffsetChange = (offset: number) => {
    updateConfig({ offset });
  };

  const handleBorderRadiusChange = (borderRadius: number) => {
    updateConfig({ borderRadius });
  };

  const handleAnimationToggle = () => {
    updateConfig({ animation: !config.animation });
  };

  const handleAnimationDurationChange = (animationDuration: number) => {
    updateConfig({ animationDuration });
  };

  const handleHighContrastToggle = () => {
    updateConfig({ highContrast: !config.highContrast });
  };

  const handleReducedMotionToggle = () => {
    updateConfig({ reducedMotion: !config.reducedMotion });
  };

  const handleCustomCSSChange = (css: string) => {
    setCustomCSS(css);
    updateConfig({ customCSS: css });
  };

  const handleReset = () => {
    resetToDefaults();
    setCustomCSS('');
  };

  return (
    <div className="bg-white rounded-lg p-6 max-w-2xl mx-auto">
      <h2 className="text-2xl font-bold mb-6">Focus Indicator Settings</h2>

      {/* Style Selection */}
      <div className="space-y-4 mb-6">
        <h3 className="text-lg font-semibold">Focus Indicator Style</h3>
        
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {[
            { value: 'outline', label: 'Outline', description: 'Traditional outline' },
            { value: 'ring', label: 'Ring', description: 'Modern ring style' },
            { value: 'underline', label: 'Underline', description: 'Bottom underline' },
            { value: 'background', label: 'Background', description: 'Background highlight' },
            { value: 'custom', label: 'Custom', description: 'Custom CSS' }
          ].map((style) => (
            <button
              key={style.value}
              onClick={() => handleStyleChange(style.value)}
              className={`p-3 rounded-lg border-2 transition-colors ${
                config.style === style.value
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-300 hover:border-gray-400'
              }`}
            >
              <div className="font-medium">{style.label}</div>
              <div className="text-sm text-gray-600">{style.description}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Color and Appearance */}
      <div className="space-y-4 mb-6">
        <h3 className="text-lg font-semibold">Color and Appearance</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="focus-color" className="block text-sm font-medium mb-2">
              Focus Color
            </label>
            <div className="flex items-center space-x-2">
              <input
                id="focus-color"
                type="color"
                value={config.color}
                onChange={(e) => handleColorChange(e.target.value)}
                className="w-12 h-12 rounded border border-gray-300"
              />
              <input
                type="text"
                value={config.color}
                onChange={(e) => handleColorChange(e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="#3b82f6"
              />
            </div>
          </div>

          <div>
            <label htmlFor="focus-width" className="block text-sm font-medium mb-2">
              Width: {config.width}px
            </label>
            <input
              id="focus-width"
              type="range"
              min="1"
              max="10"
              value={config.width}
              onChange={(e) => handleWidthChange(parseInt(e.target.value))}
              className="w-full"
            />
          </div>

          <div>
            <label htmlFor="focus-offset" className="block text-sm font-medium mb-2">
              Offset: {config.offset}px
            </label>
            <input
              id="focus-offset"
              type="range"
              min="0"
              max="20"
              value={config.offset}
              onChange={(e) => handleOffsetChange(parseInt(e.target.value))}
              className="w-full"
            />
          </div>

          <div>
            <label htmlFor="focus-radius" className="block text-sm font-medium mb-2">
              Border Radius: {config.borderRadius}px
            </label>
            <input
              id="focus-radius"
              type="range"
              min="0"
              max="50"
              value={config.borderRadius}
              onChange={(e) => handleBorderRadiusChange(parseInt(e.target.value))}
              className="w-full"
            />
          </div>
        </div>
      </div>

      {/* Animation Settings */}
      <div className="space-y-4 mb-6">
        <h3 className="text-lg font-semibold">Animation</h3>
        
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label htmlFor="enable-animation" className="text-sm font-medium">
              Enable animations
            </label>
            <input
              id="enable-animation"
              type="checkbox"
              checked={config.animation}
              onChange={handleAnimationToggle}
              className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
            />
          </div>

          {config.animation && (
            <div>
              <label htmlFor="animation-duration" className="block text-sm font-medium mb-2">
                Animation Duration: {config.animationDuration}ms
              </label>
              <input
                id="animation-duration"
                type="range"
                min="0"
                max="2000"
                step="50"
                value={config.animationDuration}
                onChange={(e) => handleAnimationDurationChange(parseInt(e.target.value))}
                className="w-full"
              />
            </div>
          )}
        </div>
      </div>

      {/* Accessibility Options */}
      <div className="space-y-4 mb-6">
        <h3 className="text-lg font-semibold">Accessibility Options</h3>
        
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label htmlFor="high-contrast" className="text-sm font-medium">
              High contrast mode
            </label>
            <input
              id="high-contrast"
              type="checkbox"
              checked={config.highContrast}
              onChange={handleHighContrastToggle}
              className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
            />
          </div>

          <div className="flex items-center justify-between">
            <label htmlFor="reduced-motion" className="text-sm font-medium">
              Reduced motion
            </label>
            <input
              id="reduced-motion"
              type="checkbox"
              checked={config.reducedMotion}
              onChange={handleReducedMotionToggle}
              className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
            />
          </div>
        </div>
      </div>

      {/* Custom CSS */}
      {config.style === 'custom' && (
        <div className="space-y-4 mb-6">
          <h3 className="text-lg font-semibold">Custom CSS</h3>
          
          <div>
            <label htmlFor="custom-css" className="block text-sm font-medium mb-2">
              Custom CSS for focus indicators
            </label>
            <textarea
              id="custom-css"
              value={customCSS}
              onChange={(e) => handleCustomCSSChange(e.target.value)}
              rows={8}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
              placeholder="[data-focus-visible] {&#10;  /* Your custom CSS here */&#10;}"
            />
          </div>
        </div>
      )}

      {/* Preview */}
      <div className="space-y-4 mb-6">
        <h3 className="text-lg font-semibold">Preview</h3>
        
        <div className="p-4 border border-gray-300 rounded-lg">
          <p className="text-sm text-gray-600 mb-3">Tab through these elements to preview focus indicators:</p>
          
          <div className="space-y-2">
            <button className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
              Button
            </button>
            
            <a href="#" className="text-blue-600 hover:underline">
              Link
            </a>
            
            <input
              type="text"
              placeholder="Text input"
              className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            
            <select className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option>Option 1</option>
              <option>Option 2</option>
            </select>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-between">
        <button
          onClick={handleReset}
          className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500"
        >
          Reset to Defaults
        </button>
        
        {onClose && (
          <button
            onClick={onClose}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            Close
          </button>
        )}
      </div>
    </div>
  );
};
```

### 3. CSS Styles

#### 3.1 Focus Indicator Base Styles
```css
/* apps/web/src/styles/accessibility/focus-indicators.css */

/* Base focus indicator styles */
[data-focus-visible] {
  outline: none !important;
}

/* Focus indicator styles will be dynamically generated */
/* This file contains base styles and utilities */

/* High contrast mode support */
@media (prefers-contrast: high) {
  [data-focus-visible] {
    outline: 3px solid ButtonText !important;
    outline-offset: 2px !important;
  }
}

/* Windows High Contrast Mode */
@media screen and (-ms-high-contrast: active) {
  [data-focus-visible] {
    outline: 3px solid windowText !important;
    background-color: highlight !important;
    color: highlightText !important;
  }
}

/* Reduced motion support */
@media (prefers-reduced-motion: reduce) {
  [data-focus-visible] {
    transition: none !important;
  }
}

/* Focus indicator utilities */
.focus-indicator-outline {
  outline: 2px solid #3b82f6 !important;
  outline-offset: 2px !important;
}

.focus-indicator-ring {
  box-shadow: 0 0 0 2px #3b82f6 !important;
}

.focus-indicator-underline {
  border-bottom: 2px solid #3b82f6 !important;
}

.focus-indicator-background {
  background-color: #3b82f6 !important;
  color: #ffffff !important;
}

/* No focus indicator utility */
.no-focus-indicator {
  outline: none !important;
  box-shadow: none !important;
}

/* Skip focus indicator for specific elements */
[data-no-focus-indicator] {
  outline: none !important;
  box-shadow: none !important;
}

/* Focus trap custom focus indicators */
[data-focus-trap][data-custom-focus] [data-focus-visible] {
  /* Custom focus indicators for focus traps */
  outline: 2px solid #10b981 !important;
  outline-offset: 1px !important;
}

/* Video player specific focus indicators */
.video-player [data-focus-visible] {
  outline: 2px solid #3b82f6 !important;
  outline-offset: 1px !important;
}

.video-player .video-controls [data-focus-visible] {
  outline: 2px solid #ffffff !important;
  outline-offset: 1px !important;
}

/* Mobile focus indicators */
@media (max-width: 767px) {
  [data-focus-visible] {
    outline-width: 3px !important;
    outline-offset: 3px !important;
  }
}

/* RTL support */
[dir="rtl"] [data-focus-visible] {
  /* RTL-specific focus indicator adjustments */
  outline-offset: 2px !important;
}

/* Print styles */
@media print {
  [data-focus-visible] {
    outline: none !important;
    box-shadow: none !important;
  }
}

/* Focus indicator animations */
@keyframes focus-pulse {
  0% {
    opacity: 1;
  }
  50% {
    opacity: 0.7;
  }
  100% {
    opacity: 1;
  }
}

.focus-indicator-pulse {
  animation: focus-pulse 1.5s ease-in-out infinite;
}

/* Focus indicator transitions */
.focus-indicator-transition {
  transition: outline-color 0.2s ease-in-out,
              outline-width 0.2s ease-in-out,
              box-shadow 0.2s ease-in-out,
              background-color 0.2s ease-in-out;
}

/* Component-specific focus indicators */

/* Buttons */
button[data-focus-visible],
[role="button"][data-focus-visible] {
  outline: 2px solid #3b82f6 !important;
  outline-offset: 2px !important;
}

/* Links */
a[data-focus-visible] {
  outline: 2px solid #3b82f6 !important;
  outline-offset: 2px !important;
}

/* Form inputs */
input[data-focus-visible],
textarea[data-focus-visible],
select[data-focus-visible] {
  outline: 2px solid #3b82f6 !important;
  outline-offset: 1px !important;
  border-color: #3b82f6 !important;
}

/* Custom components */
.custom-button[data-focus-visible] {
  box-shadow: 0 0 0 2px #3b82f6 !important;
}

.custom-link[data-focus-visible] {
  border-bottom: 2px solid #3b82f6 !important;
}

/* Accessibility focus indicators for screen readers */
.sr-only-focus:focus {
  position: static !important;
  width: auto !important;
  height: auto !important;
  padding: 0.5rem !important;
  margin: 0 !important;
  overflow: visible !important;
  clip: auto !important;
  white-space: normal !important;
  border: 2px solid #3b82f6 !important;
  background-color: #ffffff !important;
  color: #000000 !important;
}
```

### 4. Testing Strategy

#### 4.1 Unit Tests
```typescript
// apps/web/src/__tests__/accessibility/focus-indicator-manager.test.ts
import { FocusIndicatorManager } from '@/lib/accessibility/focus-indicator-manager';

describe('FocusIndicatorManager', () => {
  let manager: FocusIndicatorManager;

  beforeEach(() => {
    manager = new FocusIndicatorManager();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    manager.destroy();
    document.body.innerHTML = '';
  });

  describe('initialization', () => {
    it('should initialize with default config', () => {
      const config = manager.getConfig();
      expect(config.style).toBe('ring');
      expect(config.color).toBe('#3b82f6');
      expect(config.width).toBe(2);
    });

    it('should initialize with custom config', () => {
      const customManager = new FocusIndicatorManager({
        style: 'outline',
        color: '#ff0000',
        width: 3
      });

      const config = customManager.getConfig();
      expect(config.style).toBe('outline');
      expect(config.color).toBe('#ff0000');
      expect(config.width).toBe(3);

      customManager.destroy();
    });
  });

  describe('config updates', () => {
    it('should update config', () => {
      manager.updateConfig({
        style: 'outline',
        color: '#00ff00'
      });

      const config = manager.getConfig();
      expect(config.style).toBe('outline');
      expect(config.color).toBe('#00ff00');
    });

    it('should generate CSS when config updates', () => {
      const styleElement = document.querySelector('#focus-indicator-styles');
      expect(styleElement).toBeInTheDocument();

      manager.updateConfig({ color: '#ff0000' });
      
      expect(styleElement?.textContent).toContain('#ff0000');
    });
  });

  describe('focus detection', () => {
    beforeEach(() => {
      document.body.innerHTML = `
        <button id="test-button">Test Button</button>
        <a href="#" id="test-link">Test Link</a>
        <input type="text" id="test-input" />
        <div id="test-div" tabindex="0">Test Div</div>
      `;
    });

    it('should detect focusable elements', () => {
      const button = document.getElementById('test-button') as HTMLElement;
      const link = document.getElementById('test-link') as HTMLElement;
      const input = document.getElementById('test-input') as HTMLElement;
      const div = document.getElementById('test-div') as HTMLElement;

      expect(manager['isFocusable'](button)).toBe(true);
      expect(manager['isFocusable'](link)).toBe(true);
      expect(manager['isFocusable'](input)).toBe(true);
      expect(manager['isFocusable'](div)).toBe(true);
    });

    it('should add focus indicator on focus', () => {
      const button = document.getElementById('test-button') as HTMLElement;
      
      button.focus();
      
      expect(button.hasAttribute('data-focus-visible')).toBe(true);
    });

    it('should remove focus indicator on blur', () => {
      const button = document.getElementById('test-button') as HTMLElement;
      
      button.focus();
      expect(button.hasAttribute('data-focus-visible')).toBe(true);
      
      button.blur();
      expect(button.hasAttribute('data-focus-visible')).toBe(false);
    });
  });

  describe('element enhancement', () => {
    it('should enhance element focusability', () => {
      document.body.innerHTML = `
        <div role="button" id="role-button">Role Button</div>
        <a id="no-href-link">No Href Link</a>
      `;

      const roleButton = document.getElementById('role-button') as HTMLElement;
      const noHrefLink = document.getElementById('no-href-link') as HTMLElement;

      manager['enhanceFocusability'](roleButton);
      manager['enhanceFocusability'](noHrefLink);

      expect(roleButton.hasAttribute('tabindex')).toBe(true);
      expect(roleButton.getAttribute('tabindex')).toBe('0');

      expect(noHrefLink.hasAttribute('role')).toBe(true);
      expect(noHrefLink.getAttribute('role')).toBe('button');
      expect(noHrefLink.hasAttribute('tabindex')).toBe(true);
    });
  });

  describe('custom focus indicators', () => {
    it('should add custom focus indicator', () => {
      document.body.innerHTML = `
        <div class="custom-element">Custom Element</div>
      `;

      manager.addCustomFocusIndicator('.custom-element', {
        style: 'outline',
        color: '#ff0000'
      });

      const element = document.querySelector('.custom-element') as HTMLElement;
      expect(element.hasAttribute('data-custom-focus')).toBe(true);
    });

    it('should remove focus indicator', () => {
      document.body.innerHTML = `
        <button id="test-button">Test Button</button>
      `;

      const button = document.getElementById('test-button') as HTMLElement;
      manager.removeFocusIndicator(button);

      expect(button.hasAttribute('data-no-focus-indicator')).toBe(true);
    });

    it('should restore focus indicator', () => {
      document.body.innerHTML = `
        <button id="test-button">Test Button</button>
      `;

      const button = document.getElementById('test-button') as HTMLElement;
      manager.removeFocusIndicator(button);
      manager.restoreFocusIndicator(button);

      expect(button.hasAttribute('data-no-focus-indicator')).toBe(false);
    });
  });

  describe('accessibility', () => {
    it('should announce focus to screen readers', () => {
      const announcementSpy = jest.spyOn(manager as any, 'announceToScreenReader');
      
      document.body.innerHTML = `
        <button aria-label="Test Button">Test Button</button>
      `;

      const button = document.querySelector('button') as HTMLElement;
      button.focus();

      expect(announcementSpy).toHaveBeenCalledWith('Focused on Test Button');
    });

    it('should handle high contrast mode', () => {
      manager.updateConfig({ highContrast: true });
      
      const config = manager.getConfig();
      expect(config.highContrast).toBe(true);
    });

    it('should handle reduced motion', () => {
      manager.updateConfig({ reducedMotion: true });
      
      const config = manager.getConfig();
      expect(config.reducedMotion).toBe(true);
    });
  });
});
```

#### 4.2 Integration Tests
```typescript
// apps/web/src/__tests__/accessibility/focus-indicator-integration.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { FocusIndicatorProvider } from '@/components/accessibility/focus-indicator-provider';
import { focusIndicatorManager } from '@/lib/accessibility/focus-indicator-manager';

// Mock the focus indicator manager
jest.mock('@/lib/accessibility/focus-indicator-manager');

describe('Focus Indicator Integration', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('should render focus indicator provider', () => {
    render(
      <FocusIndicatorProvider>
        <div>Test Content</div>
      </FocusIndicatorProvider>
    );

    expect(screen.getByText('Test Content')).toBeInTheDocument();
  });

  it('should handle focus indicator configuration', () => {
    const mockUpdateConfig = jest.fn();
    (focusIndicatorManager.updateConfig as jest.Mock) = mockUpdateConfig;

    render(
      <FocusIndicatorProvider>
        <div>Test Content</div>
      </FocusIndicatorProvider>
    );

    expect(mockUpdateConfig).toHaveBeenCalled();
  });

  it('should apply focus indicators to interactive elements', () => {
    document.body.innerHTML = `
      <button>Test Button</button>
      <a href="#">Test Link</a>
      <input type="text" placeholder="Test Input" />
    `;

    render(
      <FocusIndicatorProvider>
        <div>Test Content</div>
      </FocusIndicatorProvider>
    );

    const button = document.querySelector('button');
    const link = document.querySelector('a');
    const input = document.querySelector('input');

    expect(button).toBeInTheDocument();
    expect(link).toBeInTheDocument();
    expect(input).toBeInTheDocument();
  });
});
```

#### 4.3 Accessibility Tests
```typescript
// apps/web/src/__tests__/accessibility/focus-indicator-a11y.test.ts
import { render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { FocusIndicatorProvider } from '@/components/accessibility/focus-indicator-provider';

// Extend Jest matchers
expect.extend(toHaveNoViolations);

describe('Focus Indicator Accessibility', () => {
  it('should have no accessibility violations', async () => {
    const { container } = render(
      <FocusIndicatorProvider>
        <div>
          <button>Test Button</button>
          <a href="#">Test Link</a>
          <input type="text" placeholder="Test Input" />
        </div>
      </FocusIndicatorProvider>
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('should have proper focus indicators', () => {
    render(
      <FocusIndicatorProvider>
        <div>
          <button>Test Button</button>
          <a href="#">Test Link</a>
          <input type="text" placeholder="Test Input" />
        </div>
      </FocusIndicatorProvider>
    );

    const button = screen.getByRole('button');
    const link = screen.getByRole('link');
    const input = screen.getByRole('textbox');

    // Check that elements are focusable
    expect(button).toHaveAttribute('tabindex', '0');
    expect(link).toHaveAttribute('tabindex', '0');
    expect(input).toHaveAttribute('tabindex', '0');
  });

  it('should support keyboard navigation', () => {
    render(
      <FocusIndicatorProvider>
        <div>
          <button>Button 1</button>
          <button>Button 2</button>
          <button>Button 3</button>
        </div>
      </FocusIndicatorProvider>
    );

    const buttons = screen.getAllByRole('button');
    
    // Test tab navigation
    buttons[0].focus();
    expect(buttons[0]).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Tab' });
    expect(buttons[1]).toHaveFocus();
  });
});
```

## Deliverables

### Phase 1: Core System (Week 1)
- [ ] `FocusIndicatorManager` class with comprehensive focus management
- [ ] `FocusIndicatorPreferences` system for user customization
- [ ] Dynamic CSS generation for different focus styles
- [ ] Unit tests for core functionality (90% coverage)

### Phase 2: React Integration (Week 2)
- [ ] `FocusIndicatorProvider` React component
- [ ] `FocusIndicatorSettings` component for user preferences
- [ ] Integration with existing component library
- [ ] Integration tests for React components

### Phase 3: Style Implementation (Week 3)
- [ ] Multiple focus indicator styles (outline, ring, underline, background)
- [ ] High contrast mode support
- [ ] Reduced motion support
- [ ] RTL language support

### Phase 4: Advanced Features (Week 4)
- [ ] Custom CSS support for advanced users
- [ ] Per-element focus indicator customization
- [ ] Component-specific focus indicators
- [ ] Mobile optimization

### Phase 5: Testing & Polish (Week 5)
- [ ] Cross-browser compatibility testing
- [ ] Screen reader compatibility testing
- [ ] Performance optimization
- [ ] Documentation and user guides

## Success Metrics

### Quantitative Metrics
- **100%** of interactive elements have visible focus indicators
- **3:1** minimum contrast ratio for focus indicators (WCAG AA)
- **<50ms** response time for focus indicator updates
- **0** critical accessibility violations

### Qualitative Metrics
- Clear, visible focus indicators that are easy to see
- Consistent focus indicator behavior across all elements
- Customizable options for different user preferences
- Seamless integration with existing design system

## Risks & Mitigations

### Technical Risks
- **Browser compatibility**: Implement polyfills for :focus-visible and test across browsers
- **Performance impact**: Optimize CSS generation and use efficient event handling
- **Style conflicts**: Use CSS specificity and proper naming conventions

### User Experience Risks
- **Visual clutter**: Provide customization options and subtle animations
- **Accessibility conflicts**: Ensure focus indicators work with high contrast and reduced motion
- **Design consistency**: Work with design team to align with brand guidelines

## Dependencies

### Internal Dependencies
- Focus management system (Story 1.4.2)
- ARIA management system (Story 1.4.3)
- Component library and design system

### External Dependencies
- Browser CSS support and polyfills
- Screen reader compatibility (NVDA, JAWS, VoiceOver)
- WCAG 2.1 guidelines and compliance testing

## Timeline

**Total Duration**: 5 weeks

**Week 1**: Core focus indicator system and preferences
**Week 2**: React integration and settings interface
**Week 3**: Multiple focus styles and accessibility features
**Week 4**: Advanced customization and mobile optimization
**Week 5**: Testing, optimization, and documentation

## Conclusion

This implementation plan provides a comprehensive focus indicator system that enhances keyboard navigation accessibility while maintaining WCAG 2.1 Level AA compliance. The customizable design allows users to personalize their focus experience while ensuring consistent, visible focus indicators across all interactive elements.

The system prioritizes accessibility through high contrast support, reduced motion options, and screen reader compatibility, making the application usable for all users regardless of their assistive technology needs or visual preferences.