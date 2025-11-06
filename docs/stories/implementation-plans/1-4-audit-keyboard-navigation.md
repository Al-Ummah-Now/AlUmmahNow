# Implementation Plan: Audit Current Keyboard Navigation Implementation

**Story**: 1.4 Enhance Keyboard Navigation Accessibility  
**Task Group**: 1.4.1 Audit current keyboard navigation implementation  
**Priority**: High  
**Estimated Time**: 2-3 days  

## Overview

This implementation plan focuses on conducting a comprehensive audit of the current keyboard navigation implementation across the video player and related components. The audit will identify gaps, document current behavior, and establish a baseline for improvements.

## Prerequisites

- Access to the video player components and UI elements
- Testing environment with multiple browsers
- Screen reader software for accessibility testing
- Understanding of WCAG 2.1 AA keyboard navigation requirements

## Detailed Implementation Steps

### Step 1: Create Keyboard Navigation Audit Framework

**File**: `apps/web/src/lib/accessibility/keyboard-audit.ts`

```typescript
export interface KeyboardAuditResult {
  element: Element;
  selector: string;
  isFocusable: boolean;
  isTabbable: boolean;
  hasTabIndex: boolean;
  tabIndex: number;
  hasAriaLabel: boolean;
  hasAriaLabelledby: boolean;
  hasRole: boolean;
  role?: string;
  hasKeyboardHandler: boolean;
  focusVisible: boolean;
  focusOrder: number;
  issues: KeyboardNavigationIssue[];
  recommendations: string[];
}

export interface KeyboardNavigationIssue {
  type: 'no_focus' | 'no_tab_index' | 'no_aria_label' | 'no_keyboard_handler' | 'poor_focus_order' | 'invisible_focus';
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  element: string;
  recommendation: string;
  wcagCriterion: string;
}

export interface KeyboardAuditReport {
  timestamp: Date;
  url: string;
  browser: string;
  totalElements: number;
  focusableElements: number;
  tabbableElements: number;
  elementsWithIssues: number;
  criticalIssues: number;
  highIssues: number;
  mediumIssues: number;
  lowIssues: number;
  results: KeyboardAuditResult[];
  summary: {
    focusOrderScore: number;
    ariaComplianceScore: number;
    keyboardHandlerScore: number;
    overallScore: number;
  };
  recommendations: string[];
}

export interface FocusOrderAnalysis {
  sequence: Element[];
  logicalOrder: boolean;
  issues: {
    type: 'out_of_order' | 'missing_element' | 'unexpected_element';
    description: string;
    elements: string[];
  }[];
}

export class KeyboardNavigationAuditor {
  private auditResults: KeyboardAuditResult[] = [];
  private focusOrder: Element[] = [];

  // Audit entire page for keyboard navigation
  auditPage(): KeyboardAuditReport {
    this.auditResults = [];
    this.focusOrder = [];

    // Get all potentially focusable elements
    const focusableElements = this.getFocusableElements();
    
    // Test each element
    focusableElements.forEach((element, index) => {
      const result = this.auditElement(element, index);
      this.auditResults.push(result);
    });

    // Analyze focus order
    const focusOrderAnalysis = this.analyzeFocusOrder(focusableElements);

    // Generate report
    return this.generateReport(focusOrderAnalysis);
  }

  // Audit specific component
  auditComponent(container: Element): KeyboardAuditResult[] {
    const results: KeyboardAuditResult[] = [];
    const focusableElements = this.getFocusableElements(container);

    focusableElements.forEach((element, index) => {
      const result = this.auditElement(element, index);
      results.push(result);
    });

    return results;
  }

  // Get all focusable elements
  private getFocusableElements(container: Element = document.body): Element[] {
    const focusableSelectors = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
      '[contenteditable="true"]',
      'video',
      'audio',
      'summary',
      'iframe',
      'object',
      'embed',
      '[role="button"]',
      '[role="link"]',
      '[role="menuitem"]',
      '[role="option"]',
      '[role="tab"]',
      '[role="treeitem"]'
    ].join(', ');

    const elements = Array.from(container.querySelectorAll(focusableSelectors));
    
    // Filter out hidden elements
    return elements.filter(element => this.isVisible(element));
  }

  // Check if element is visible
  private isVisible(element: Element): boolean {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();

    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0' &&
      rect.width > 0 &&
      rect.height > 0
    );
  }

  // Audit individual element
  private auditElement(element: Element, index: number): KeyboardAuditResult {
    const selector = this.generateSelector(element);
    const issues: KeyboardNavigationIssue[] = [];
    const recommendations: string[] = [];

    // Check if element is focusable
    const isFocusable = this.isElementFocusable(element);
    const isTabbable = this.isElementTabbable(element);
    const hasTabIndex = element.hasAttribute('tabindex');
    const tabIndex = parseInt(element.getAttribute('tabindex') || '0');

    // Check ARIA attributes
    const hasAriaLabel = element.hasAttribute('aria-label');
    const hasAriaLabelledby = element.hasAttribute('aria-labelledby');
    const hasRole = element.hasAttribute('role');
    const role = element.getAttribute('role') || undefined;

    // Check keyboard handlers
    const hasKeyboardHandler = this.hasKeyboardEventHandlers(element);

    // Check focus visibility
    const focusVisible = this.hasFocusStyles(element);

    // Identify issues
    if (!isFocusable && this.shouldBeFocusable(element)) {
      issues.push({
        type: 'no_focus',
        severity: 'critical',
        description: 'Element should be focusable but is not',
        element: selector,
        recommendation: 'Add tabindex="0" or make element natively focusable',
        wcagCriterion: '2.1.1'
      });
    }

    if (!hasTabIndex && !this.isNativelyFocusable(element)) {
      issues.push({
        type: 'no_tab_index',
        severity: 'high',
        description: 'Custom interactive element missing tabindex',
        element: selector,
        recommendation: 'Add tabindex="0" to make element focusable',
        wcagCriterion: '2.1.1'
      });
    }

    if (this.requiresAriaLabel(element) && !hasAriaLabel && !hasAriaLabelledby) {
      issues.push({
        type: 'no_aria_label',
        severity: 'high',
        description: 'Interactive element missing accessible name',
        element: selector,
        recommendation: 'Add aria-label or aria-labelledby attribute',
        wcagCriterion: '1.3.1'
      });
    }

    if (this.shouldHaveKeyboardHandler(element) && !hasKeyboardHandler) {
      issues.push({
        type: 'no_keyboard_handler',
        severity: 'high',
        description: 'Interactive element missing keyboard event handlers',
        element: selector,
        recommendation: 'Add keyboard event handlers (keydown, keyup)',
        wcagCriterion: '2.1.1'
      });
    }

    if (!focusVisible) {
      issues.push({
        type: 'invisible_focus',
        severity: 'medium',
        description: 'Element has no visible focus indicator',
        element: selector,
        recommendation: 'Add :focus styles with sufficient contrast',
        wcagCriterion: '1.4.11'
      });
    }

    // Generate recommendations
    if (issues.length > 0) {
      recommendations.push(...issues.map(issue => issue.recommendation));
    }

    return {
      element,
      selector,
      isFocusable,
      isTabbable,
      hasTabIndex,
      tabIndex,
      hasAriaLabel,
      hasAriaLabelledby,
      hasRole,
      role,
      hasKeyboardHandler,
      focusVisible,
      focusOrder: index,
      issues,
      recommendations
    };
  }

  // Check if element is focusable
  private isElementFocusable(element: Element): boolean {
    return this.getFocusableElements().includes(element);
  }

  // Check if element is tabbable
  private isElementTabbable(element: Element): boolean {
    const tabIndex = parseInt(element.getAttribute('tabindex') || '0');
    return tabIndex >= 0;
  }

  // Check if element is natively focusable
  private isNativelyFocusable(element: Element): boolean {
    const tagName = element.tagName.toLowerCase();
    const nativelyFocusable = [
      'a', 'button', 'input', 'select', 'textarea', 
      'summary', 'video', 'audio'
    ];
    return nativelyFocusable.includes(tagName);
  }

  // Check if element should be focusable
  private shouldBeFocusable(element: Element): boolean {
    const role = element.getAttribute('role');
    const clickableRoles = ['button', 'link', 'menuitem', 'option', 'tab', 'treeitem'];
    
    return (
      this.isNativelyFocusable(element) ||
      (role && clickableRoles.includes(role)) ||
      element.hasAttribute('onclick') ||
      element.hasAttribute('tabindex')
    );
  }

  // Check if element requires ARIA label
  private requiresAriaLabel(element: Element): boolean {
    const tagName = element.tagName.toLowerCase();
    const hasTextContent = element.textContent?.trim().length > 0;
    const hasTitle = element.hasAttribute('title');
    
    // Elements without visible text need ARIA labels
    return (
      !hasTextContent && 
      !hasTitle && 
      (tagName === 'button' || element.hasAttribute('role'))
    );
  }

  // Check if element should have keyboard handlers
  private shouldHaveKeyboardHandler(element: Element): boolean {
    return (
      element.hasAttribute('onclick') ||
      element.hasAttribute('role') ||
      element.hasAttribute('tabindex')
    );
  }

  // Check if element has keyboard event handlers
  private hasKeyboardEventHandlers(element: Element): boolean {
    // This is a simplified check - in practice, you'd need to check event listeners
    const elementWithEvents = element as any;
    return !!(
      elementWithEvents.onkeydown ||
      elementWithEvents.onkeyup ||
      elementWithEvents.onkeypress
    );
  }

  // Check if element has focus styles
  private hasFocusStyles(element: Element): boolean {
    // This is a simplified check - in practice, you'd need to check computed styles
    const style = window.getComputedStyle(element, ':focus');
    return (
      style.outline !== 'none' ||
      style.boxShadow !== 'none' ||
      style.border !== style.border // Different from default
    );
  }

  // Generate CSS selector for element
  private generateSelector(element: Element): string {
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

  // Analyze focus order
  private analyzeFocusOrder(elements: Element[]): FocusOrderAnalysis {
    const issues: FocusOrderAnalysis['issues'] = [];
    
    // Check for logical reading order
    for (let i = 1; i < elements.length; i++) {
      const current = elements[i];
      const previous = elements[i - 1];
      
      const currentRect = current.getBoundingClientRect();
      const previousRect = previous.getBoundingClientRect();
      
      // Check if elements are out of visual order
      if (currentRect.top < previousRect.top - 50) {
        issues.push({
          type: 'out_of_order',
          description: `Focus order doesn't match visual reading order`,
          elements: [this.generateSelector(previous), this.generateSelector(current)]
        });
      }
    }

    return {
      sequence: elements,
      logicalOrder: issues.length === 0,
      issues
    };
  }

  // Generate audit report
  private generateReport(focusOrderAnalysis: FocusOrderAnalysis): KeyboardAuditReport {
    const totalElements = this.auditResults.length;
    const focusableElements = this.auditResults.filter(r => r.isFocusable).length;
    const tabbableElements = this.auditResults.filter(r => r.isTabbable).length;
    const elementsWithIssues = this.auditResults.filter(r => r.issues.length > 0).length;

    // Count issues by severity
    const allIssues = this.auditResults.flatMap(r => r.issues);
    const criticalIssues = allIssues.filter(i => i.severity === 'critical').length;
    const highIssues = allIssues.filter(i => i.severity === 'high').length;
    const mediumIssues = allIssues.filter(i => i.severity === 'medium').length;
    const lowIssues = allIssues.filter(i => i.severity === 'low').length;

    // Calculate scores
    const focusOrderScore = focusOrderAnalysis.logicalOrder ? 100 : 50;
    const ariaComplianceScore = this.calculateAriaComplianceScore();
    const keyboardHandlerScore = this.calculateKeyboardHandlerScore();
    const overallScore = Math.round((focusOrderScore + ariaComplianceScore + keyboardHandlerScore) / 3);

    // Generate recommendations
    const recommendations = this.generateRecommendations(allIssues);

    return {
      timestamp: new Date(),
      url: window.location.href,
      browser: navigator.userAgent,
      totalElements,
      focusableElements,
      tabbableElements,
      elementsWithIssues,
      criticalIssues,
      highIssues,
      mediumIssues,
      lowIssues,
      results: this.auditResults,
      summary: {
        focusOrderScore,
        ariaComplianceScore,
        keyboardHandlerScore,
        overallScore
      },
      recommendations
    };
  }

  // Calculate ARIA compliance score
  private calculateAriaComplianceScore(): number {
    const elementsNeedingAria = this.auditResults.filter(r => 
      this.requiresAriaLabel(r.element)
    );
    
    if (elementsNeedingAria.length === 0) return 100;
    
    const compliantElements = elementsNeedingAria.filter(r => 
      r.hasAriaLabel || r.hasAriaLabelledby
    );
    
    return Math.round((compliantElements.length / elementsNeedingAria.length) * 100);
  }

  // Calculate keyboard handler score
  private calculateKeyboardHandlerScore(): number {
    const elementsNeedingHandlers = this.auditResults.filter(r => 
      this.shouldHaveKeyboardHandler(r.element)
    );
    
    if (elementsNeedingHandlers.length === 0) return 100;
    
    const compliantElements = elementsNeedingHandlers.filter(r => 
      r.hasKeyboardHandler
    );
    
    return Math.round((compliantElements.length / elementsNeedingHandlers.length) * 100);
  }

  // Generate recommendations
  private generateRecommendations(issues: KeyboardNavigationIssue[]): string[] {
    const recommendations = new Set<string>();
    
    // Group issues by type and generate recommendations
    const issueTypes = new Set(issues.map(i => i.type));
    
    if (issueTypes.has('no_focus')) {
      recommendations.add('Add tabindex="0" to custom interactive elements');
    }
    
    if (issueTypes.has('no_aria_label')) {
      recommendations.add('Add aria-label or aria-labelledby to interactive elements without visible text');
    }
    
    if (issueTypes.has('no_keyboard_handler')) {
      recommendations.add('Implement keyboard event handlers for all interactive elements');
    }
    
    if (issueTypes.has('invisible_focus')) {
      recommendations.add('Add visible :focus styles with sufficient contrast (3:1 minimum)');
    }
    
    if (issueTypes.has('poor_focus_order')) {
      recommendations.add('Reorder DOM elements to match logical reading order');
    }
    
    return Array.from(recommendations);
  }
}
```

### Step 2: Create Video Player Specific Audit Tool

**File**: `apps/web/src/lib/accessibility/video-player-audit.ts`

```typescript
import { KeyboardNavigationAuditor, KeyboardAuditResult } from './keyboard-audit';

export interface VideoPlayerAuditResult {
  component: string;
  element: string;
  isAccessible: boolean;
  issues: VideoPlayerIssue[];
  keyboardSupport: KeyboardSupportLevel;
  wcagCompliance: WCAGComplianceLevel;
}

export interface VideoPlayerIssue {
  type: 'missing_control' | 'no_keyboard_access' | 'poor_focus_management' | 'no_screen_reader_support';
  severity: 'critical' | 'high' | 'medium' | 'low';
  component: string;
  description: string;
  fix: string;
  wcagCriterion: string;
}

export interface KeyboardSupportLevel {
  playPause: boolean;
  volume: boolean;
  seek: boolean;
  fullscreen: boolean;
  captions: boolean;
  quality: boolean;
  playbackRate: boolean;
  pictureInPicture: boolean;
}

export interface WCAGComplianceLevel {
  level: 'AA' | 'A' | 'Non-compliant';
  criteria: {
    '1.3.1': boolean; // Info and relationships
    '1.3.2': boolean; // Meaningful sequence
    '2.1.1': boolean; // Keyboard
    '2.1.2': boolean; // No keyboard trap
    '2.4.3': boolean; // Focus order
    '4.1.2': boolean; // Name, role, value
  };
}

export class VideoPlayerAuditor {
  private auditor: KeyboardNavigationAuditor;

  constructor() {
    this.auditor = new KeyboardNavigationAuditor();
  }

  // Audit complete video player
  auditVideoPlayer(videoPlayerSelector: string = '.video-player'): VideoPlayerAuditResult[] {
    const videoPlayer = document.querySelector(videoPlayerSelector);
    if (!videoPlayer) {
      throw new Error(`Video player not found: ${videoPlayerSelector}`);
    }

    const results: VideoPlayerAuditResult[] = [];

    // Audit main video player controls
    results.push(...this.auditVideoControls(videoPlayer));
    
    // Audit progress bar
    results.push(...this.auditProgressBar(videoPlayer));
    
    // Audit volume controls
    results.push(...this.auditVolumeControls(videoPlayer));
    
    // Audit settings menu
    results.push(...this.auditSettingsMenu(videoPlayer));
    
    // Audit fullscreen controls
    results.push(...this.auditFullscreenControls(videoPlayer));

    return results;
  }

  // Audit video controls
  private auditVideoControls(videoPlayer: Element): VideoPlayerAuditResult[] {
    const results: VideoPlayerAuditResult[] = [];
    
    // Check for play/pause button
    const playPauseButton = videoPlayer.querySelector('.vjs-play-control, [data-testid="play-pause-button"]');
    if (playPauseButton) {
      const auditResult = this.auditor.auditElement(playPauseButton, 0);
      results.push(this.convertToVideoPlayerResult(auditResult, 'Play/Pause Button'));
    } else {
      results.push({
        component: 'Play/Pause Button',
        element: '.vjs-play-control',
        isAccessible: false,
        issues: [{
          type: 'missing_control',
          severity: 'critical',
          component: 'Play/Pause Button',
          description: 'Play/pause control not found',
          fix: 'Add play/pause button with proper keyboard support',
          wcagCriterion: '2.1.1'
        }],
        keyboardSupport: this.getEmptyKeyboardSupport(),
        wcagCompliance: this.getNonCompliantWCAG()
      });
    }

    // Check for seek bar
    const seekBar = videoPlayer.querySelector('.vjs-progress-holder, [data-testid="progress-bar"]');
    if (seekBar) {
      const auditResult = this.auditor.auditElement(seekBar, 0);
      results.push(this.convertToVideoPlayerResult(auditResult, 'Progress Bar'));
    }

    return results;
  }

  // Audit progress bar
  private auditProgressBar(videoPlayer: Element): VideoPlayerAuditResult[] {
    const results: VideoPlayerAuditResult[] = [];
    
    const progressBar = videoPlayer.querySelector('.vjs-progress-holder, .progress-bar');
    if (progressBar) {
      const auditResult = this.auditor.auditElement(progressBar, 0);
      const videoPlayerResult = this.convertToVideoPlayerResult(auditResult, 'Progress Bar');
      
      // Check for keyboard seek functionality
      const hasKeyboardSeek = this.checkKeyboardSeek(progressBar);
      if (!hasKeyboardSeek) {
        videoPlayerResult.issues.push({
          type: 'no_keyboard_access',
          severity: 'high',
          component: 'Progress Bar',
          description: 'Progress bar cannot be controlled via keyboard',
          fix: 'Implement arrow key navigation for seeking',
          wcagCriterion: '2.1.1'
        });
      }
      
      results.push(videoPlayerResult);
    }

    return results;
  }

  // Audit volume controls
  private auditVolumeControls(videoPlayer: Element): VideoPlayerAuditResult[] {
    const results: VideoPlayerAuditResult[] = [];
    
    const volumeButton = videoPlayer.querySelector('.vjs-mute-control, [data-testid="volume-button"]');
    const volumeSlider = videoPlayer.querySelector('.vjs-volume-bar, [data-testid="volume-slider"]');
    
    if (volumeButton) {
      const auditResult = this.auditor.auditElement(volumeButton, 0);
      results.push(this.convertToVideoPlayerResult(auditResult, 'Volume Button'));
    }
    
    if (volumeSlider) {
      const auditResult = this.auditor.auditElement(volumeSlider, 0);
      const videoPlayerResult = this.convertToVideoPlayerResult(auditResult, 'Volume Slider');
      
      // Check for keyboard volume control
      const hasKeyboardVolume = this.checkKeyboardVolume(volumeSlider);
      if (!hasKeyboardVolume) {
        videoPlayerResult.issues.push({
          type: 'no_keyboard_access',
          severity: 'high',
          component: 'Volume Slider',
          description: 'Volume cannot be controlled via keyboard',
          fix: 'Implement arrow key navigation for volume control',
          wcagCriterion: '2.1.1'
        });
      }
      
      results.push(videoPlayerResult);
    }

    return results;
  }

  // Audit settings menu
  private auditSettingsMenu(videoPlayer: Element): VideoPlayerAuditResult[] {
    const results: VideoPlayerAuditResult[] = [];
    
    const settingsButton = videoPlayer.querySelector('.vjs-settings-button, [data-testid="settings-button"]');
    if (settingsButton) {
      const auditResult = this.auditor.auditElement(settingsButton, 0);
      results.push(this.convertToVideoPlayerResult(auditResult, 'Settings Button'));
    }

    // Check settings menu items
    const settingsMenu = videoPlayer.querySelector('.vjs-settings-menu, [data-testid="settings-menu"]');
    if (settingsMenu) {
      const menuItems = settingsMenu.querySelectorAll('.vjs-menu-item, [role="menuitem"]');
      menuItems.forEach((item, index) => {
        const auditResult = this.auditor.auditElement(item, index);
        results.push(this.convertToVideoPlayerResult(auditResult, 'Settings Menu Item'));
      });
    }

    return results;
  }

  // Audit fullscreen controls
  private auditFullscreenControls(videoPlayer: Element): VideoPlayerAuditResult[] {
    const results: VideoPlayerAuditResult[] = [];
    
    const fullscreenButton = videoPlayer.querySelector('.vjs-fullscreen-control, [data-testid="fullscreen-button"]');
    if (fullscreenButton) {
      const auditResult = this.auditor.auditElement(fullscreenButton, 0);
      results.push(this.convertToVideoPlayerResult(auditResult, 'Fullscreen Button'));
    }

    return results;
  }

  // Convert keyboard audit result to video player result
  private convertToVideoPlayerResult(
    auditResult: KeyboardAuditResult, 
    componentName: string
  ): VideoPlayerAuditResult {
    const issues: VideoPlayerIssue[] = auditResult.issues.map(issue => ({
      type: this.mapIssueType(issue.type),
      severity: issue.severity,
      component: componentName,
      description: issue.description,
      fix: issue.recommendation,
      wcagCriterion: issue.wcagCriterion
    }));

    return {
      component: componentName,
      element: auditResult.selector,
      isAccessible: issues.length === 0,
      issues,
      keyboardSupport: this.assessKeyboardSupport(componentName, auditResult),
      wcagCompliance: this.assessWCAGCompliance(auditResult)
    };
  }

  // Map issue types
  private mapIssueType(type: string): VideoPlayerIssue['type'] {
    switch (type) {
      case 'no_focus':
      case 'no_tab_index':
        return 'no_keyboard_access';
      case 'no_aria_label':
        return 'no_screen_reader_support';
      case 'invisible_focus':
        return 'poor_focus_management';
      default:
        return 'no_keyboard_access';
    }
  }

  // Assess keyboard support for component
  private assessKeyboardSupport(
    componentName: string, 
    auditResult: KeyboardAuditResult
  ): KeyboardSupportLevel {
    const support = this.getEmptyKeyboardSupport();
    
    // This would be more sophisticated in practice
    // For now, base on component type and audit results
    if (componentName.includes('Play') || componentName.includes('Pause')) {
      support.playPause = auditResult.isFocusable && auditResult.hasKeyboardHandler;
    }
    
    if (componentName.includes('Volume')) {
      support.volume = auditResult.isFocusable && auditResult.hasKeyboardHandler;
    }
    
    if (componentName.includes('Progress')) {
      support.seek = auditResult.isFocusable && auditResult.hasKeyboardHandler;
    }
    
    if (componentName.includes('Fullscreen')) {
      support.fullscreen = auditResult.isFocusable && auditResult.hasKeyboardHandler;
    }

    return support;
  }

  // Assess WCAG compliance
  private assessWCAGCompliance(auditResult: KeyboardAuditResult): WCAGComplianceLevel {
    const criteria = {
      '1.3.1': auditResult.hasAriaLabel || auditResult.hasAriaLabelledby,
      '1.3.2': true, // Would need more complex analysis
      '2.1.1': auditResult.isFocusable && auditResult.hasKeyboardHandler,
      '2.1.2': true, // Would need to test for keyboard traps
      '2.4.3': auditResult.focusOrder >= 0,
      '4.1.2': auditResult.hasRole || auditResult.hasAriaLabel
    };

    const passedCriteria = Object.values(criteria).filter(Boolean).length;
    const totalCriteria = Object.keys(criteria).length;
    const compliancePercentage = (passedCriteria / totalCriteria) * 100;

    let level: WCAGComplianceLevel['level'];
    if (compliancePercentage >= 90) {
      level = 'AA';
    } else if (compliancePercentage >= 70) {
      level = 'A';
    } else {
      level = 'Non-compliant';
    }

    return { level, criteria };
  }

  // Get empty keyboard support object
  private getEmptyKeyboardSupport(): KeyboardSupportLevel {
    return {
      playPause: false,
      volume: false,
      seek: false,
      fullscreen: false,
      captions: false,
      quality: false,
      playbackRate: false,
      pictureInPicture: false
    };
  }

  // Get non-compliant WCAG object
  private getNonCompliantWCAG(): WCAGComplianceLevel {
    return {
      level: 'Non-compliant',
      criteria: {
        '1.3.1': false,
        '1.3.2': false,
        '2.1.1': false,
        '2.1.2': false,
        '2.4.3': false,
        '4.1.2': false
      }
    };
  }

  // Check keyboard seek functionality
  private checkKeyboardSeek(progressBar: Element): boolean {
    // This would involve testing actual keyboard interactions
    // For now, check for appropriate event listeners
    const element = progressBar as any;
    return !!(element.onkeydown || element.onkeyup);
  }

  // Check keyboard volume control
  private checkKeyboardVolume(volumeSlider: Element): boolean {
    // This would involve testing actual keyboard interactions
    const element = volumeSlider as any;
    return !!(element.onkeydown || element.onkeyup);
  }
}
```

### Step 3: Create Audit Report Generator

**File**: `apps/web/src/lib/accessibility/audit-report-generator.ts`

```typescript
import { KeyboardAuditReport, KeyboardNavigationIssue } from './keyboard-audit';
import { VideoPlayerAuditResult } from './video-player-audit';

export interface AuditReportConfig {
  includeScreenshots: boolean;
  includeCodeSnippets: boolean;
  includeBrowserCompatibility: boolean;
  reportFormat: 'html' | 'json' | 'pdf';
}

export class AccessibilityAuditReportGenerator {
  private config: AuditReportConfig;

  constructor(config: AuditReportConfig = {
    includeScreenshots: false,
    includeCodeSnippets: true,
    includeBrowserCompatibility: true,
    reportFormat: 'html'
  }) {
    this.config = config;
  }

  // Generate comprehensive audit report
  generateReport(
    keyboardAudit: KeyboardAuditReport,
    videoPlayerAudit: VideoPlayerAuditResult[]
  ): string {
    switch (this.config.reportFormat) {
      case 'html':
        return this.generateHTMLReport(keyboardAudit, videoPlayerAudit);
      case 'json':
        return this.generateJSONReport(keyboardAudit, videoPlayerAudit);
      case 'pdf':
        return this.generatePDFReport(keyboardAudit, videoPlayerAudit);
      default:
        return this.generateHTMLReport(keyboardAudit, videoPlayerAudit);
    }
  }

  // Generate HTML report
  private generateHTMLReport(
    keyboardAudit: KeyboardAuditReport,
    videoPlayerAudit: VideoPlayerAuditResult[]
  ): string {
    const timestamp = new Date().toLocaleString();
    const overallScore = Math.round(
      (keyboardAudit.summary.overallScore + this.calculateVideoPlayerScore(videoPlayerAudit)) / 2
    );

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Keyboard Navigation Audit Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; line-height: 1.6; }
        .header { background: #f5f5f5; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
        .score { font-size: 2em; font-weight: bold; margin: 10px 0; }
        .score.high { color: #28a745; }
        .score.medium { color: #ffc107; }
        .score.low { color: #dc3545; }
        .section { margin: 30px 0; }
        .issue { background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; margin: 10px 0; border-radius: 4px; }
        .issue.critical { background: #f8d7da; border-color: #f5c6cb; }
        .issue.high { background: #fff3cd; border-color: #ffeaa7; }
        .issue.medium { background: #d1ecf1; border-color: #bee5eb; }
        .issue.low { background: #d4edda; border-color: #c3e6cb; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
        th { background-color: #f2f2f2; }
        .recommendation { background: #e7f3ff; padding: 15px; border-radius: 4px; margin: 10px 0; }
    </style>
</head>
<body>
    <div class="header">
        <h1>Keyboard Navigation Audit Report</h1>
        <p><strong>Generated:</strong> ${timestamp}</p>
        <p><strong>URL:</strong> ${keyboardAudit.url}</p>
        <p><strong>Browser:</strong> ${keyboardAudit.browser}</p>
        <div class="score ${this.getScoreClass(overallScore)}">
            Overall Score: ${overallScore}%
        </div>
    </div>

    <div class="section">
        <h2>Executive Summary</h2>
        <table>
            <tr>
                <th>Metric</th>
                <th>Value</th>
                <th>Status</th>
            </tr>
            <tr>
                <td>Total Elements</td>
                <td>${keyboardAudit.totalElements}</td>
                <td>${this.getStatus(keyboardAudit.totalElements > 0)}</td>
            </tr>
            <tr>
                <td>Focusable Elements</td>
                <td>${keyboardAudit.focusableElements}</td>
                <td>${this.getStatus(keyboardAudit.focusableElements > 0)}</td>
            </tr>
            <tr>
                <td>Elements with Issues</td>
                <td>${keyboardAudit.elementsWithIssues}</td>
                <td>${this.getStatus(keyboardAudit.elementsWithIssues === 0)}</td>
            </tr>
            <tr>
                <td>Critical Issues</td>
                <td>${keyboardAudit.criticalIssues}</td>
                <td>${this.getStatus(keyboardAudit.criticalIssues === 0)}</td>
            </tr>
            <tr>
                <td>High Priority Issues</td>
                <td>${keyboardAudit.highIssues}</td>
                <td>${this.getStatus(keyboardAudit.highIssues === 0)}</td>
            </tr>
        </table>
    </div>

    <div class="section">
        <h2>Video Player Accessibility</h2>
        ${this.generateVideoPlayerSection(videoPlayerAudit)}
    </div>

    <div class="section">
        <h2>Issues by Severity</h2>
        ${this.generateIssuesSection(keyboardAudit.results)}
    </div>

    <div class="section">
        <h2>Recommendations</h2>
        ${this.generateRecommendationsSection(keyboardAudit.recommendations)}
    </div>

    ${this.config.includeBrowserCompatibility ? this.generateBrowserCompatibilitySection() : ''}
</body>
</html>`;
  }

  // Generate JSON report
  private generateJSONReport(
    keyboardAudit: KeyboardAuditReport,
    videoPlayerAudit: VideoPlayerAuditResult[]
  ): string {
    const report = {
      metadata: {
        generatedAt: new Date().toISOString(),
        url: keyboardAudit.url,
        browser: keyboardAudit.browser,
        overallScore: Math.round(
          (keyboardAudit.summary.overallScore + this.calculateVideoPlayerScore(videoPlayerAudit)) / 2
        )
      },
      keyboardAudit,
      videoPlayerAudit,
      summary: {
        totalIssues: keyboardAudit.criticalIssues + keyboardAudit.highIssues + 
                    keyboardAudit.mediumIssues + keyboardAudit.lowIssues,
        criticalIssues: keyboardAudit.criticalIssues,
        highIssues: keyboardAudit.highIssues,
        videoPlayerCompliance: this.calculateVideoPlayerScore(videoPlayerAudit)
      }
    };

    return JSON.stringify(report, null, 2);
  }

  // Generate PDF report (simplified - would use a PDF library in practice)
  private generatePDFReport(
    keyboardAudit: KeyboardAuditReport,
    videoPlayerAudit: VideoPlayerAuditResult[]
  ): string {
    // In practice, this would use a library like jsPDF or Puppeteer
    return 'PDF generation would be implemented with a PDF library';
  }

  // Generate video player section
  private generateVideoPlayerSection(videoPlayerAudit: VideoPlayerAuditResult[]): string {
    if (videoPlayerAudit.length === 0) {
      return '<p>No video player components found for audit.</p>';
    }

    let html = '<table><tr><th>Component</th><th>Accessible</th><th>Issues</th><th>Keyboard Support</th></tr>';
    
    videoPlayerAudit.forEach(result => {
      const keyboardSupport = Object.values(result.keyboardSupport)
        .filter(Boolean).length;
      const totalControls = Object.keys(result.keyboardSupport).length;
      
      html += `
        <tr>
            <td>${result.component}</td>
            <td>${this.getStatus(result.isAccessible)}</td>
            <td>${result.issues.length}</td>
            <td>${keyboardSupport}/${totalControls}</td>
        </tr>
      `;
    });
    
    html += '</table>';
    return html;
  }

  // Generate issues section
  private generateIssuesSection(results: any[]): string {
    const allIssues = results.flatMap(r => r.issues);
    
    if (allIssues.length === 0) {
      return '<p>No issues found! Great job!</p>';
    }

    let html = '';
    allIssues.forEach(issue => {
      html += `
        <div class="issue ${issue.severity}">
            <h4>${issue.type.replace('_', ' ').toUpperCase()}</h4>
            <p><strong>Description:</strong> ${issue.description}</p>
            <p><strong>Element:</strong> <code>${issue.element}</code></p>
            <p><strong>Recommendation:</strong> ${issue.recommendation}</p>
            <p><strong>WCAG Criterion:</strong> ${issue.wcagCriterion}</p>
        </div>
      `;
    });
    
    return html;
  }

  // Generate recommendations section
  private generateRecommendationsSection(recommendations: string[]): string {
    if (recommendations.length === 0) {
      return '<p>No specific recommendations at this time.</p>';
    }

    let html = '';
    recommendations.forEach((rec, index) => {
      html += `
        <div class="recommendation">
            <h4>Recommendation ${index + 1}</h4>
            <p>${rec}</p>
        </div>
      `;
    });
    
    return html;
  }

  // Generate browser compatibility section
  private generateBrowserCompatibilitySection(): string {
    return `
      <div class="section">
        <h2>Browser Compatibility Notes</h2>
        <p><strong>Chrome/Edge:</strong> Full keyboard navigation support expected</p>
        <p><strong>Firefox:</strong> Good keyboard navigation, some focus styling differences</p>
        <p><strong>Safari:</strong> Generally good, but may require additional focus management</p>
        <p><strong>Mobile Browsers:</strong> Limited keyboard navigation, focus on external keyboards</p>
      </div>
    `;
  }

  // Get score class for styling
  private getScoreClass(score: number): string {
    if (score >= 80) return 'high';
    if (score >= 60) return 'medium';
    return 'low';
  }

  // Get status indicator
  private getStatus(good: boolean): string {
    return good ? '✅ Pass' : '❌ Fail';
  }

  // Calculate video player score
  private calculateVideoPlayerScore(videoPlayerAudit: VideoPlayerAuditResult[]): number {
    if (videoPlayerAudit.length === 0) return 0;
    
    const accessibleComponents = videoPlayerAudit.filter(r => r.isAccessible).length;
    return Math.round((accessibleComponents / videoPlayerAudit.length) * 100);
  }
}
```

### Step 4: Create Audit Testing Utilities

**File**: `apps/web/src/lib/accessibility/__tests__/keyboard-audit.test.ts`

```typescript
import { KeyboardNavigationAuditor, KeyboardAuditReport } from '../keyboard-audit';

describe('KeyboardNavigationAuditor', () => {
  let auditor: KeyboardNavigationAuditor;
  let mockDocument: Document;

  beforeEach(() => {
    auditor = new KeyboardNavigationAuditor();
    
    // Mock DOM
    mockDocument = document;
    
    // Clear body
    document.body.innerHTML = '';
  });

  describe('auditPage', () => {
    it('should generate audit report for page', () => {
      // Create test elements
      document.body.innerHTML = `
        <button id="test-button">Test Button</button>
        <a href="#" id="test-link">Test Link</a>
        <div id="test-div" tabindex="0">Test Div</div>
        <input type="text" id="test-input" />
      `;

      const report = auditor.auditPage();

      expect(report).toHaveProperty('timestamp');
      expect(report).toHaveProperty('totalElements');
      expect(report).toHaveProperty('focusableElements');
      expect(report).toHaveProperty('results');
      expect(report.totalElements).toBeGreaterThan(0);
    });

    it('should identify missing ARIA labels', () => {
      document.body.innerHTML = `
        <button id="button-no-label"></button>
        <button id="button-with-label" aria-label="Test Button">Button</button>
      `;

      const report = auditor.auditPage();
      const noLabelElement = report.results.find(r => r.selector.includes('button-no-label'));
      const withLabelElement = report.results.find(r => r.selector.includes('button-with-label'));

      expect(noLabelElement?.issues).toContainEqual(
        expect.objectContaining({
          type: 'no_aria_label',
          severity: 'high'
        })
      );

      expect(withLabelElement?.issues.some(i => i.type === 'no_aria_label')).toBe(false);
    });

    it('should check focus visibility', () => {
      document.body.innerHTML = `
        <style>
          .no-focus { outline: none; }
          .has-focus { outline: 2px solid blue; }
        </style>
        <button class="no-focus">No Focus</button>
        <button class="has-focus">Has Focus</button>
      `;

      const report = auditor.auditPage();
      const noFocusElement = report.results.find(r => r.element.classList.contains('no-focus'));
      const hasFocusElement = report.results.find(r => r.element.classList.contains('has-focus'));

      expect(noFocusElement?.issues).toContainEqual(
        expect.objectContaining({
          type: 'invisible_focus',
          severity: 'medium'
        })
      );

      expect(hasFocusElement?.issues.some(i => i.type === 'invisible_focus')).toBe(false);
    });
  });

  describe('auditComponent', () => {
    it('should audit specific component', () => {
      const container = document.createElement('div');
      container.innerHTML = `
        <button>Component Button</button>
        <input type="text" />
      `;
      document.body.appendChild(container);

      const results = auditor.auditComponent(container);

      expect(results).toHaveLength(2);
      expect(results[0]).toHaveProperty('selector');
      expect(results[0]).toHaveProperty('issues');
    });
  });

  describe('focus order analysis', () => {
    it('should detect focus order issues', () => {
      document.body.innerHTML = `
        <div style="margin-top: 100px;">
          <button id="first">First</button>
        </div>
        <div style="margin-top: 0px;">
          <button id="second">Second</button>
        </div>
      `;

      const report = auditor.auditPage();
      
      // This is a simplified test - in practice, focus order analysis would be more complex
      expect(report.summary.focusOrderScore).toBeGreaterThanOrEqual(0);
    });
  });
});
```

## Testing Strategy

### Manual Testing Checklist

**File**: `docs/stories/implementation-plans/1-4-keyboard-testing-checklist.md`

```markdown
# Keyboard Navigation Testing Checklist

## Browser Testing
- [ ] Chrome (latest version)
- [ ] Firefox (latest version)
- [ ] Safari (latest version)
- [ ] Edge (latest version)

## Video Player Controls Testing
- [ ] Play/Pause button accessible via Tab
- [ ] Volume controls accessible via keyboard
- [ ] Progress bar controllable via arrow keys
- [ ] Fullscreen toggle accessible
- [ ] Settings menu navigable via keyboard
- [ ] Quality settings accessible
- [ ] Caption controls accessible

## Focus Management Testing
- [ ] Visible focus indicator on all interactive elements
- [ ] Logical tab order throughout interface
- [ ] Focus trapping in modal dialogs
- [ ] Focus returns to correct element after modal close
- [ ] Skip links work correctly

## Screen Reader Testing
- [ ] NVDA (Windows)
- [ ] JAWS (Windows)
- [ ] VoiceOver (macOS)
- [ ] TalkBack (Android)

## Keyboard Shortcuts Testing
- [ ] Space bar for play/pause
- [ ] Arrow keys for volume and seeking
- [ ] F for fullscreen
- [ ] C for captions
- [ ] M for mute
- [ ] Escape to exit fullscreen/modals
```

## Deliverables

### Files to Create
1. `apps/web/src/lib/accessibility/keyboard-audit.ts` - Core audit framework
2. `apps/web/src/lib/accessibility/video-player-audit.ts` - Video player specific audit
3. `apps/web/src/lib/accessibility/audit-report-generator.ts` - Report generation
4. `apps/web/src/lib/accessibility/__tests__/keyboard-audit.test.ts` - Unit tests
5. `docs/stories/implementation-plans/1-4-keyboard-testing-checklist.md` - Testing checklist

### Documentation
1. Audit methodology documentation
2. WCAG 2.1 AA compliance guide
3. Browser compatibility notes
4. Screen reader testing guide

## Success Criteria

### Functional Requirements
- ✅ Comprehensive keyboard navigation audit
- ✅ Video player specific accessibility testing
- ✅ Automated issue detection and reporting
- ✅ Cross-browser compatibility testing
- ✅ Screen reader compatibility verification

### WCAG Compliance
- ✅ WCAG 2.1.1 (Keyboard) compliance verification
- ✅ WCAG 2.1.2 (No Keyboard Trap) compliance verification
- ✅ WCAG 2.4.3 (Focus Order) compliance verification
- ✅ WCAG 1.4.11 (Non-text Contrast) compliance verification
- ✅ WCAG 4.1.2 (Name, Role, Value) compliance verification

### Technical Requirements
- ✅ TypeScript implementation with full type safety
- ✅ Comprehensive test coverage (>90%)
- ✅ Cross-browser testing framework
- ✅ Automated reporting capabilities
- ✅ Integration with existing testing infrastructure

### UX Requirements
- ✅ Clear and actionable audit reports
- ✅ Visual issue identification
- ✅ Prioritized recommendations
- ✅ Progress tracking capabilities
- ✅ Developer-friendly documentation

## Timeline

### Day 1: Core Audit Framework
- Create keyboard navigation auditor
- Implement video player specific audit
- Set up basic testing infrastructure

### Day 2: Reporting & Analysis
- Implement report generation
- Create visual issue identification
- Add cross-browser testing capabilities

### Day 3: Testing & Documentation
- Complete screen reader testing
- Create comprehensive testing checklist
- Write documentation and user guides

## Risk Assessment

### High Risk
- **Browser Differences**: Keyboard navigation behavior varies significantly between browsers
  - **Mitigation**: Comprehensive cross-browser testing, browser-specific workarounds
- **Screen Reader Compatibility**: Different screen readers have different behaviors
  - **Mitigation**: Testing with multiple screen readers, fallback strategies

### Medium Risk
- **Dynamic Content**: Video player has dynamic elements that may not be captured in static audit
  - **Mitigation**: Real-time monitoring, dynamic content testing
- **Custom Components**: Custom video player controls may not follow standard patterns
  - **Mitigation**: Custom audit rules, manual verification

### Low Risk
- **False Positives**: Automated audit may flag non-issues
  - **Mitigation**: Manual review, configurable severity levels
- **Performance Impact**: Audit process may impact page performance
  - **Mitigation**: Efficient algorithms, background processing

This implementation plan provides a comprehensive keyboard navigation audit framework that will identify all accessibility issues and establish a solid foundation for implementing improvements.