# Implementation Plan: 1.4.7 - Complete Screen Reader Compatibility Testing

## Overview

Implement comprehensive screen reader compatibility testing framework and tools to ensure all keyboard navigation features work seamlessly with assistive technologies. This implementation will create automated testing tools, manual testing procedures, and continuous monitoring for screen reader compatibility across NVDA, JAWS, VoiceOver, and other major screen readers.

## Objectives

- **Primary**: Create comprehensive screen reader testing framework and tools
- **Secondary**: Implement automated accessibility testing with screen reader simulation
- **Tertiary**: Establish continuous monitoring and regression testing for screen reader compatibility
- **Compliance**: WCAG 2.1.1 (Keyboard), 2.4.2 (Page Titled), 2.4.3 (Focus Order), 4.1.2 (Name, Role, Value)

## Success Criteria

### Functional Requirements
- [ ] Automated screen reader testing framework
- [ ] Manual testing procedures for all major screen readers
- [ ] Screen reader compatibility reports and scoring
- [ ] Continuous integration testing for accessibility regressions
- [ ] Screen reader announcement validation system
- [ ] Focus order testing and validation

### Accessibility Requirements
- [ ] NVDA compatibility (Windows, Firefox/Chrome)
- [ ] JAWS compatibility (Windows, Firefox/Chrome/Edge)
- [ ] VoiceOver compatibility (macOS, Safari)
- [ ] TalkBack compatibility (Android, Chrome)
- [ ] Voice Access compatibility (Android)
- [ ] Windows Speech Recognition compatibility

### Technical Requirements
- [ ] Cross-browser screen reader testing
- [ ] Automated testing with screen reader simulation
- [ ] Manual testing documentation and procedures
- [ ] Performance impact assessment
- [ ] Comprehensive test coverage (95%+)

## Implementation Details

### 1. Screen Reader Testing Framework

#### 1.1 Screen Reader Test Manager
```typescript
// apps/web/src/lib/accessibility/screen-reader-test-manager.ts
interface ScreenReaderTest {
  id: string;
  name: string;
  description: string;
  category: 'navigation' | 'content' | 'forms' | 'media' | 'keyboard';
  priority: 'high' | 'medium' | 'low';
  automated: boolean;
  manual: boolean;
  testFunction?: () => Promise<TestResult>;
  manualProcedure?: string[];
  expectedResults: string[];
  wcagCriteria: string[];
  screenReaders: ScreenReaderType[];
}

interface TestResult {
  passed: boolean;
  score: number;
  issues: TestIssue[];
  announcements: string[];
  focusOrder: string[];
  performance: {
    duration: number;
    memoryUsage: number;
  };
  screenshot?: string;
  html?: string;
}

interface TestIssue {
  severity: 'critical' | 'major' | 'minor' | 'info';
  type: 'announcement' | 'focus' | 'navigation' | 'content' | 'performance';
  description: string;
  element?: string;
  expected?: string;
  actual?: string;
  recommendation?: string;
}

type ScreenReaderType = 'nvda' | 'jaws' | 'voiceover' | 'talkback' | 'voiceaccess' | 'windows-speech';

interface ScreenReaderConfig {
  enabled: boolean;
  testCategories: string[];
  screenReaders: ScreenReaderType[];
  automated: boolean;
  manual: boolean;
  performanceThreshold: number;
  screenshotCapture: boolean;
  htmlCapture: boolean;
  announcementCapture: boolean;
}

class ScreenReaderTestManager {
  private tests: Map<string, ScreenReaderTest> = new Map();
  private config: ScreenReaderConfig;
  private isRunning = false;
  private currentTest: ScreenReaderTest | null = null;
  private results: Map<string, TestResult> = new Map();
  private announcementCapture: AnnouncementCapture;
  private focusTracker: FocusTracker;
  private performanceMonitor: PerformanceMonitor;

  constructor(config: Partial<ScreenReaderConfig> = {}) {
    this.config = this.getDefaultConfig(config);
    this.announcementCapture = new AnnouncementCapture();
    this.focusTracker = new FocusTracker();
    this.performanceMonitor = new PerformanceMonitor();
    
    this.initializeDefaultTests();
  }

  private getDefaultConfig(override: Partial<ScreenReaderConfig>): ScreenReaderConfig {
    return {
      enabled: true,
      testCategories: ['navigation', 'content', 'forms', 'media', 'keyboard'],
      screenReaders: ['nvda', 'jaws', 'voiceover', 'talkback'],
      automated: true,
      manual: true,
      performanceThreshold: 1000, // ms
      screenshotCapture: true,
      htmlCapture: true,
      announcementCapture: true,
      ...override
    };
  }

  // Initialize default screen reader tests
  private initializeDefaultTests(): void {
    // Navigation Tests
    this.registerTest({
      id: 'sr-nav-001',
      name: 'Main Navigation Accessibility',
      description: 'Test main navigation menu screen reader compatibility',
      category: 'navigation',
      priority: 'high',
      automated: true,
      manual: true,
      expectedResults: [
        'Navigation menu is announced as "navigation" landmark',
        'Menu items are announced as links or buttons',
        'Current page is indicated in navigation',
        'Skip links work correctly with screen readers'
      ],
      wcagCriteria: ['2.4.1', '2.4.2', '4.1.2'],
      screenReaders: ['nvda', 'jaws', 'voiceover', 'talkback'],
      testFunction: this.testMainNavigation.bind(this),
      manualProcedure: [
        'Navigate to main navigation using screen reader',
        'Listen to navigation announcements',
        'Test each menu item for proper labeling',
        'Verify current page indication',
        'Test skip links functionality'
      ]
    });

    // Video Player Tests
    this.registerTest({
      id: 'sr-media-001',
      name: 'Video Player Screen Reader Support',
      description: 'Test video player controls and content accessibility',
      category: 'media',
      priority: 'high',
      automated: true,
      manual: true,
      expectedResults: [
        'Video player is announced as application landmark',
        'Play/pause button is properly labeled',
        'Progress bar announces time and position',
        'Volume controls announce current level',
        'Fullscreen button is properly labeled'
      ],
      wcagCriteria: ['1.2.1', '2.4.3', '4.1.2'],
      screenReaders: ['nvda', 'jaws', 'voiceover', 'talkback'],
      testFunction: this.testVideoPlayer.bind(this),
      manualProcedure: [
        'Navigate to video player using screen reader',
        'Test play/pause button announcements',
        'Test progress bar interaction and announcements',
        'Test volume controls',
        'Test fullscreen and other controls',
        'Verify video content descriptions if available'
      ]
    });

    // Form Tests
    this.registerTest({
      id: 'sr-forms-001',
      name: 'Form Field Accessibility',
      description: 'Test form fields and validation screen reader compatibility',
      category: 'forms',
      priority: 'high',
      automated: true,
      manual: true,
      expectedResults: [
        'Form fields have proper labels',
        'Required fields are announced',
        'Error messages are announced',
        'Validation feedback is provided',
        'Form submission is announced'
      ],
      wcagCriteria: ['3.3.1', '3.3.2', '4.1.2'],
      screenReaders: ['nvda', 'jaws', 'voiceover', 'talkback'],
      testFunction: this.testFormFields.bind(this),
      manualProcedure: [
        'Navigate to form using screen reader',
        'Test each form field for proper labeling',
        'Test required field announcements',
        'Test form validation and error messages',
        'Test form submission feedback'
      ]
    });

    // Keyboard Navigation Tests
    this.registerTest({
      id: 'sr-keyboard-001',
      name: 'Keyboard Navigation with Screen Reader',
      description: 'Test keyboard navigation compatibility with screen readers',
      category: 'keyboard',
      priority: 'high',
      automated: true,
      manual: true,
      expectedResults: [
        'Tab order follows logical sequence',
        'Focus is properly announced',
        'Skip links work with screen readers',
        'Focus indicators are visible',
        'Keyboard traps are avoided'
      ],
      wcagCriteria: ['2.1.1', '2.1.2', '2.4.3'],
      screenReaders: ['nvda', 'jaws', 'voiceover', 'talkback'],
      testFunction: this.testKeyboardNavigation.bind(this),
      manualProcedure: [
        'Enable screen reader',
        'Navigate page using Tab key',
        'Listen to focus announcements',
        'Test skip links functionality',
        'Verify no keyboard traps exist',
        'Test focus indicator visibility'
      ]
    });

    // Content Structure Tests
    this.registerTest({
      id: 'sr-content-001',
      name: 'Content Structure and Headings',
      description: 'Test page content structure and heading hierarchy',
      category: 'content',
      priority: 'medium',
      automated: true,
      manual: true,
      expectedResults: [
        'Page title is announced',
        'Heading hierarchy is logical',
        'Landmarks are properly identified',
        'Lists are announced correctly',
        'Links are descriptive'
      ],
      wcagCriteria: ['1.3.1', '2.4.1', '2.4.6'],
      screenReaders: ['nvda', 'jaws', 'voiceover', 'talkback'],
      testFunction: this.testContentStructure.bind(this),
      manualProcedure: [
        'Navigate page using screen reader heading navigation',
        'Verify heading hierarchy (h1, h2, h3, etc.)',
        'Test landmark navigation',
        'Test list announcements',
        'Verify link descriptions are meaningful'
      ]
    });
  }

  // Register new test
  registerTest(test: ScreenReaderTest): void {
    this.tests.set(test.id, test);
  }

  // Remove test
  removeTest(testId: string): void {
    this.tests.delete(testId);
  }

  // Get all tests
  getAllTests(): ScreenReaderTest[] {
    return Array.from(this.tests.values());
  }

  // Get tests by category
  getTestsByCategory(category: string): ScreenReaderTest[] {
    return Array.from(this.tests.values()).filter(test => test.category === category);
  }

  // Get tests by screen reader
  getTestsByScreenReader(screenReader: ScreenReaderType): ScreenReaderTest[] {
    return Array.from(this.tests.values()).filter(test => 
      test.screenReaders.includes(screenReader)
    );
  }

  // Run single test
  async runTest(testId: string): Promise<TestResult> {
    const test = this.tests.get(testId);
    if (!test) {
      throw new Error(`Test not found: ${testId}`);
    }

    this.currentTest = test;
    this.isRunning = true;

    try {
      // Start monitoring
      this.announcementCapture.start();
      this.focusTracker.start();
      this.performanceMonitor.start();

      // Run test function if available
      let result: TestResult;
      if (test.testFunction) {
        result = await test.testFunction();
      } else {
        result = await this.runGenericTest(test);
      }

      // Stop monitoring
      this.announcementCapture.stop();
      this.focusTracker.stop();
      this.performanceMonitor.stop();

      // Add monitoring data to result
      result.announcements = this.announcementCapture.getAnnouncements();
      result.focusOrder = this.focusTracker.getFocusOrder();
      result.performance = this.performanceMonitor.getMetrics();

      // Capture additional data if enabled
      if (this.config.screenshotCapture) {
        result.screenshot = await this.captureScreenshot();
      }

      if (this.config.htmlCapture) {
        result.html = document.documentElement.outerHTML;
      }

      // Store result
      this.results.set(testId, result);

      return result;

    } finally {
      this.isRunning = false;
      this.currentTest = null;
    }
  }

  // Run all tests
  async runAllTests(): Promise<Map<string, TestResult>> {
    const results = new Map<string, TestResult>();
    
    for (const [testId, test] of this.tests) {
      if (this.shouldRunTest(test)) {
        try {
          const result = await this.runTest(testId);
          results.set(testId, result);
        } catch (error) {
          console.error(`Test failed: ${testId}`, error);
          results.set(testId, {
            passed: false,
            score: 0,
            issues: [{
              severity: 'critical',
              type: 'content',
              description: `Test execution failed: ${error}`,
              recommendation: 'Check test configuration and environment'
            }],
            announcements: [],
            focusOrder: [],
            performance: { duration: 0, memoryUsage: 0 }
          });
        }
      }
    }

    return results;
  }

  // Check if test should run based on config
  private shouldRunTest(test: ScreenReaderTest): boolean {
    // Check category
    if (!this.config.testCategories.includes(test.category)) {
      return false;
    }

    // Check automated/manual
    if (test.automated && !this.config.automated) {
      return false;
    }

    if (test.manual && !this.config.manual) {
      return false;
    }

    return true;
  }

  // Run generic test for tests without specific function
  private async runGenericTest(test: ScreenReaderTest): Promise<TestResult> {
    const issues: TestIssue[] = [];
    let score = 100;

    // Basic accessibility checks
    const focusableElements = document.querySelectorAll(
      'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );

    // Check for proper labels
    focusableElements.forEach((element, index) => {
      const htmlElement = element as HTMLElement;
      const label = this.getElementLabel(htmlElement);
      
      if (!label) {
        issues.push({
          severity: 'major',
          type: 'content',
          description: `Focusable element ${index + 1} lacks proper label`,
          element: this.getElementSelector(htmlElement),
          recommendation: 'Add aria-label, aria-labelledby, or associated label element'
        });
        score -= 10;
      }
    });

    // Check heading structure
    const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
    let lastLevel = 0;
    
    headings.forEach((heading, index) => {
      const level = parseInt(heading.tagName.substring(1));
      
      if (level > lastLevel + 1) {
        issues.push({
          severity: 'minor',
          type: 'content',
          description: `Heading level skipped: h${lastLevel} to h${level}`,
          element: this.getElementSelector(heading as HTMLElement),
          recommendation: 'Use proper heading hierarchy without skipping levels'
        });
        score -= 5;
      }
      
      lastLevel = level;
    });

    // Check for landmarks
    const landmarks = document.querySelectorAll('main, nav, aside, header, footer, [role="main"], [role="navigation"], [role="complementary"], [role="banner"], [role="contentinfo"]');
    
    if (landmarks.length === 0) {
      issues.push({
        severity: 'major',
        type: 'content',
        description: 'No semantic landmarks found',
        recommendation: 'Add semantic HTML5 elements or ARIA landmarks'
      });
      score -= 15;
    }

    return {
      passed: score >= 80,
      score: Math.max(0, score),
      issues,
      announcements: [],
      focusOrder: [],
      performance: { duration: 0, memoryUsage: 0 }
    };
  }

  // Test specific functions
  private async testMainNavigation(): Promise<TestResult> {
    const issues: TestIssue[] = [];
    let score = 100;

    // Check for navigation landmark
    const nav = document.querySelector('nav, [role="navigation"]');
    if (!nav) {
      issues.push({
        severity: 'major',
        type: 'content',
        description: 'No navigation landmark found',
        recommendation: 'Add <nav> element or [role="navigation"]'
      });
      score -= 20;
    }

    // Check navigation links
    const navLinks = document.querySelectorAll('nav a, [role="navigation"] a');
    navLinks.forEach((link, index) => {
      const htmlLink = link as HTMLAnchorElement;
      const text = htmlLink.textContent?.trim();
      
      if (!text || text.length < 2) {
        issues.push({
          severity: 'major',
          type: 'content',
          description: `Navigation link ${index + 1} lacks descriptive text`,
          element: this.getElementSelector(htmlLink),
          recommendation: 'Add descriptive text to navigation links'
        });
        score -= 10;
      }
    });

    // Check for current page indication
    const currentLinks = document.querySelectorAll('nav a[aria-current="page"], [role="navigation"] a[aria-current="page"]');
    if (currentLinks.length === 0) {
      issues.push({
        severity: 'minor',
        type: 'content',
        description: 'No current page indication in navigation',
        recommendation: 'Add aria-current="page" to current page link'
      });
      score -= 5;
    }

    return {
      passed: score >= 80,
      score: Math.max(0, score),
      issues,
      announcements: [],
      focusOrder: [],
      performance: { duration: 0, memoryUsage: 0 }
    };
  }

  private async testVideoPlayer(): Promise<TestResult> {
    const issues: TestIssue[] = [];
    let score = 100;

    // Check for video player
    const video = document.querySelector('video');
    const videoContainer = document.querySelector('.video-player, [role="application"][aria-label*="video"]');
    
    if (!video && !videoContainer) {
      issues.push({
        severity: 'critical',
        type: 'content',
        description: 'No video player found',
        recommendation: 'Ensure video player is present in the page'
      });
      score -= 50;
    }

    // Check for video controls
    const controls = document.querySelectorAll('.video-controls button, .video-player button');
    if (controls.length === 0) {
      issues.push({
        severity: 'major',
        type: 'content',
        description: 'No video controls found',
        recommendation: 'Add accessible video controls'
      });
      score -= 30;
    }

    // Check control labels
    controls.forEach((control, index) => {
      const htmlControl = control as HTMLElement;
      const label = this.getElementLabel(htmlControl);
      
      if (!label) {
        issues.push({
          severity: 'major',
          type: 'content',
          description: `Video control ${index + 1} lacks proper label`,
          element: this.getElementSelector(htmlControl),
          recommendation: 'Add aria-label to video controls'
        });
        score -= 10;
      }
    });

    return {
      passed: score >= 80,
      score: Math.max(0, score),
      issues,
      announcements: [],
      focusOrder: [],
      performance: { duration: 0, memoryUsage: 0 }
    };
  }

  private async testFormFields(): Promise<TestResult> {
    const issues: TestIssue[] = [];
    let score = 100;

    // Check form fields
    const formFields = document.querySelectorAll('input, select, textarea');
    formFields.forEach((field, index) => {
      const htmlField = field as HTMLElement;
      const label = this.getElementLabel(htmlField);
      
      if (!label) {
        issues.push({
          severity: 'major',
          type: 'content',
          description: `Form field ${index + 1} lacks proper label`,
          element: this.getElementSelector(htmlField),
          recommendation: 'Add associated label element or aria-label'
        });
        score -= 10;
      }

      // Check required fields
      if (htmlField.hasAttribute('required') && !htmlField.hasAttribute('aria-required')) {
        issues.push({
          severity: 'minor',
          type: 'content',
          description: `Required field ${index + 1} lacks aria-required`,
          element: this.getElementSelector(htmlField),
          recommendation: 'Add aria-required="true" to required fields'
        });
        score -= 5;
      }
    });

    return {
      passed: score >= 80,
      score: Math.max(0, score),
      issues,
      announcements: [],
      focusOrder: [],
      performance: { duration: 0, memoryUsage: 0 }
    };
  }

  private async testKeyboardNavigation(): Promise<TestResult> {
    const issues: TestIssue[] = [];
    let score = 100;

    // Check focusable elements
    const focusableElements = document.querySelectorAll(
      'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );

    if (focusableElements.length === 0) {
      issues.push({
        severity: 'critical',
        type: 'navigation',
        description: 'No focusable elements found',
        recommendation: 'Ensure page has interactive elements'
      });
      score -= 50;
    }

    // Check for tabindex values
    focusableElements.forEach((element, index) => {
      const htmlElement = element as HTMLElement;
      const tabindex = htmlElement.getAttribute('tabindex');
      
      if (tabindex && parseInt(tabindex) > 0) {
        issues.push({
          severity: 'minor',
          type: 'navigation',
          description: `Element ${index + 1} has positive tabindex`,
          element: this.getElementSelector(htmlElement),
          recommendation: 'Use tabindex="0" or remove tabindex for natural tab order'
        });
        score -= 5;
      }
    });

    return {
      passed: score >= 80,
      score: Math.max(0, score),
      issues,
      announcements: [],
      focusOrder: [],
      performance: { duration: 0, memoryUsage: 0 }
    };
  }

  private async testContentStructure(): Promise<TestResult> {
    const issues: TestIssue[] = [];
    let score = 100;

    // Check page title
    if (!document.title || document.title.trim().length === 0) {
      issues.push({
        severity: 'critical',
        type: 'content',
        description: 'Page has no title',
        recommendation: 'Add descriptive page title'
      });
      score -= 30;
    }

    // Check for h1
    const h1 = document.querySelector('h1');
    if (!h1) {
      issues.push({
        severity: 'major',
        type: 'content',
        description: 'No h1 heading found',
        recommendation: 'Add h1 heading for page main topic'
      });
      score -= 20;
    }

    // Check for multiple h1s
    const h1s = document.querySelectorAll('h1');
    if (h1s.length > 1) {
      issues.push({
        severity: 'minor',
        type: 'content',
        description: 'Multiple h1 headings found',
        recommendation: 'Use only one h1 per page'
      });
      score -= 10;
    }

    return {
      passed: score >= 80,
      score: Math.max(0, score),
      issues,
      announcements: [],
      focusOrder: [],
      performance: { duration: 0, memoryUsage: 0 }
    };
  }

  // Utility methods
  private getElementLabel(element: HTMLElement): string | null {
    // Check for aria-label
    if (element.hasAttribute('aria-label')) {
      return element.getAttribute('aria-label');
    }

    // Check for aria-labelledby
    if (element.hasAttribute('aria-labelledby')) {
      const labelId = element.getAttribute('aria-labelledby');
      const labelElement = document.getElementById(labelId || '');
      if (labelElement) {
        return labelElement.textContent?.trim() || null;
      }
    }

    // Check for associated label (form elements)
    if (element.id) {
      const label = document.querySelector(`label[for="${element.id}"]`);
      if (label) {
        return label.textContent?.trim() || null;
      }
    }

    // Check for placeholder (inputs)
    if (element.hasAttribute('placeholder')) {
      return element.getAttribute('placeholder');
    }

    // Check for title attribute
    if (element.hasAttribute('title')) {
      return element.getAttribute('title');
    }

    // Use text content as fallback
    return element.textContent?.trim() || null;
  }

  private getElementSelector(element: HTMLElement): string {
    if (element.id) {
      return `#${element.id}`;
    }
    
    if (element.className) {
      return `.${element.className.split(' ').join('.')}`;
    }
    
    return element.tagName.toLowerCase();
  }

  private async captureScreenshot(): Promise<string> {
    // In a real implementation, this would use a screenshot library
    // For now, return a placeholder
    return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  }

  // Get test results
  getResults(): Map<string, TestResult> {
    return new Map(this.results);
  }

  // Get test result by ID
  getResult(testId: string): TestResult | undefined {
    return this.results.get(testId);
  }

  // Generate report
  generateReport(): ScreenReaderTestReport {
    const results = Array.from(this.results.entries());
    const totalTests = results.length;
    const passedTests = results.filter(([_, result]) => result.passed).length;
    const averageScore = results.reduce((sum, [_, result]) => sum + result.score, 0) / totalTests;
    
    const issuesByType = results.reduce((acc, [_, result]) => {
      result.issues.forEach(issue => {
        if (!acc[issue.type]) {
          acc[issue.type] = [];
        }
        acc[issue.type].push(issue);
      });
      return acc;
    }, {} as Record<string, TestIssue[]>);

    const issuesBySeverity = results.reduce((acc, [_, result]) => {
      result.issues.forEach(issue => {
        if (!acc[issue.severity]) {
          acc[issue.severity] = [];
        }
        acc[issue.severity].push(issue);
      });
      return acc;
    }, {} as Record<string, TestIssue[]>);

    return {
      summary: {
        totalTests,
        passedTests,
        failedTests: totalTests - passedTests,
        averageScore: Math.round(averageScore),
        passRate: Math.round((passedTests / totalTests) * 100)
      },
      issuesByType,
      issuesBySeverity,
      testResults: results,
      generatedAt: new Date().toISOString()
    };
  }

  // Export results
  exportResults(format: 'json' | 'csv' | 'html'): string {
    const report = this.generateReport();
    
    switch (format) {
      case 'json':
        return JSON.stringify(report, null, 2);
      case 'csv':
        return this.generateCSV(report);
      case 'html':
        return this.generateHTML(report);
      default:
        return JSON.stringify(report, null, 2);
    }
  }

  private generateCSV(report: ScreenReaderTestReport): string {
    const headers = ['Test ID', 'Test Name', 'Passed', 'Score', 'Issues', 'Critical Issues', 'Major Issues', 'Minor Issues'];
    const rows = report.testResults.map(([testId, result]) => [
      testId,
      this.tests.get(testId)?.name || testId,
      result.passed.toString(),
      result.score.toString(),
      result.issues.length.toString(),
      result.issues.filter(i => i.severity === 'critical').length.toString(),
      result.issues.filter(i => i.severity === 'major').length.toString(),
      result.issues.filter(i => i.severity === 'minor').length.toString()
    ]);

    return [headers, ...rows].map(row => row.join(',')).join('\n');
  }

  private generateHTML(report: ScreenReaderTestReport): string {
    return `
<!DOCTYPE html>
<html>
<head>
    <title>Screen Reader Test Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .summary { background: #f5f5f5; padding: 20px; border-radius: 5px; margin-bottom: 20px; }
        .pass { color: green; }
        .fail { color: red; }
        .critical { color: #d32f2f; }
        .major { color: #f57c00; }
        .minor { color: #fbc02d; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
    </style>
</head>
<body>
    <h1>Screen Reader Test Report</h1>
    
    <div class="summary">
        <h2>Summary</h2>
        <p>Total Tests: ${report.summary.totalTests}</p>
        <p>Passed: <span class="pass">${report.summary.passedTests}</span></p>
        <p>Failed: <span class="fail">${report.summary.failedTests}</span></p>
        <p>Pass Rate: ${report.summary.passRate}%</p>
        <p>Average Score: ${report.summary.averageScore}</p>
        <p>Generated: ${new Date(report.generatedAt).toLocaleString()}</p>
    </div>
    
    <h2>Test Results</h2>
    <table>
        <thead>
            <tr>
                <th>Test Name</th>
                <th>Passed</th>
                <th>Score</th>
                <th>Issues</th>
            </tr>
        </thead>
        <tbody>
            ${report.testResults.map(([testId, result]) => `
                <tr>
                    <td>${this.tests.get(testId)?.name || testId}</td>
                    <td class="${result.passed ? 'pass' : 'fail'}">${result.passed ? 'Yes' : 'No'}</td>
                    <td>${result.score}</td>
                    <td>${result.issues.length}</td>
                </tr>
            `).join('')}
        </tbody>
    </table>
</body>
</html>`;
  }

  // Clear results
  clearResults(): void {
    this.results.clear();
  }

  // Update configuration
  updateConfig(newConfig: Partial<ScreenReaderConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  // Get configuration
  getConfig(): ScreenReaderConfig {
    return { ...this.config };
  }
}

interface ScreenReaderTestReport {
  summary: {
    totalTests: number;
    passedTests: number;
    failedTests: number;
    averageScore: number;
    passRate: number;
  };
  issuesByType: Record<string, TestIssue[]>;
  issuesBySeverity: Record<string, TestIssue[]>;
  testResults: Array<[string, TestResult]>;
  generatedAt: string;
}

// Global instance
export const screenReaderTestManager = new ScreenReaderTestManager();
```

#### 1.2 Announcement Capture System
```typescript
// apps/web/src/lib/accessibility/announcement-capture.ts
interface Announcement {
  text: string;
  timestamp: number;
  priority: 'polite' | 'assertive';
  source: string;
  element?: string;
}

class AnnouncementCapture {
  private announcements: Announcement[] = [];
  private isCapturing = false;
  private observers: MutationObserver[] = [];
  private liveRegions: Set<HTMLElement> = new Set();

  constructor() {
    this.setupLiveRegionDetection();
  }

  // Start capturing announcements
  start(): void {
    if (this.isCapturing) return;
    
    this.isCapturing = true;
    this.announcements = [];
    this.setupObservers();
  }

  // Stop capturing announcements
  stop(): void {
    if (!this.isCapturing) return;
    
    this.isCapturing = false;
    this.cleanupObservers();
  }

  // Get captured announcements
  getAnnouncements(): Announcement[] {
    return [...this.announcements];
  }

  // Clear announcements
  clear(): void {
    this.announcements = [];
  }

  // Setup live region detection
  private setupLiveRegionDetection(): void {
    // Find existing live regions
    const liveRegions = document.querySelectorAll('[aria-live]');
    liveRegions.forEach(region => {
      this.liveRegions.add(region as HTMLElement);
    });

    // Observe for new live regions
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const element = node as HTMLElement;
            if (element.hasAttribute('aria-live')) {
              this.liveRegions.add(element);
            }
            
            // Check child elements
            const childLiveRegions = element.querySelectorAll('[aria-live]');
            childLiveRegions.forEach(child => {
              this.liveRegions.add(child as HTMLElement);
            });
          }
        });

        mutation.removedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const element = node as HTMLElement;
            this.liveRegions.delete(element);
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

  // Setup observers for announcement capture
  private setupObservers(): void {
    // Observe live regions for changes
    this.liveRegions.forEach(liveRegion => {
      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          if (mutation.type === 'childList' || mutation.type === 'characterData') {
            const text = liveRegion.textContent?.trim();
            if (text) {
              this.addAnnouncement({
                text,
                timestamp: Date.now(),
                priority: (liveRegion.getAttribute('aria-live') as 'polite' | 'assertive') || 'polite',
                source: 'live-region',
                element: this.getElementSelector(liveRegion)
              });
            }
          }
        });
      });

      observer.observe(liveRegion, {
        childList: true,
        characterData: true,
        subtree: true
      });

      this.observers.push(observer);
    });

    // Observe focus changes for screen reader announcements
    document.addEventListener('focusin', this.handleFocusIn.bind(this));
    document.addEventListener('focusout', this.handleFocusOut.bind(this));
  }

  // Cleanup observers
  private cleanupObservers(): void {
    this.observers.forEach(observer => observer.disconnect());
    this.observers = [];
    
    document.removeEventListener('focusin', this.handleFocusIn.bind(this));
    document.removeEventListener('focusout', this.handleFocusOut.bind(this));
  }

  // Handle focus in
  private handleFocusIn(event: FocusEvent): void {
    const element = event.target as HTMLElement;
    const label = this.getElementLabel(element);
    
    if (label) {
      this.addAnnouncement({
        text: `Focused on ${label}`,
        timestamp: Date.now(),
        priority: 'polite',
        source: 'focus',
        element: this.getElementSelector(element)
      });
    }
  }

  // Handle focus out
  private handleFocusOut(event: FocusEvent): void {
    const element = event.target as HTMLElement;
    const label = this.getElementLabel(element);
    
    if (label) {
      this.addAnnouncement({
        text: `Left ${label}`,
        timestamp: Date.now(),
        priority: 'polite',
        source: 'focus',
        element: this.getElementSelector(element)
      });
    }
  }

  // Add announcement
  private addAnnouncement(announcement: Announcement): void {
    if (!this.isCapturing) return;
    
    // Avoid duplicate announcements
    const lastAnnouncement = this.announcements[this.announcements.length - 1];
    if (lastAnnouncement && lastAnnouncement.text === announcement.text) {
      return;
    }
    
    this.announcements.push(announcement);
  }

  // Get element label
  private getElementLabel(element: HTMLElement): string | null {
    // Check for aria-label
    if (element.hasAttribute('aria-label')) {
      return element.getAttribute('aria-label');
    }

    // Check for aria-labelledby
    if (element.hasAttribute('aria-labelledby')) {
      const labelId = element.getAttribute('aria-labelledby');
      const labelElement = document.getElementById(labelId || '');
      if (labelElement) {
        return labelElement.textContent?.trim() || null;
      }
    }

    // Check for associated label
    if (element.id) {
      const label = document.querySelector(`label[for="${element.id}"]`);
      if (label) {
        return label.textContent?.trim() || null;
      }
    }

    // Check for placeholder
    if (element.hasAttribute('placeholder')) {
      return element.getAttribute('placeholder');
    }

    // Check for title
    if (element.hasAttribute('title')) {
      return element.getAttribute('title');
    }

    // Use text content
    return element.textContent?.trim() || null;
  }

  // Get element selector
  private getElementSelector(element: HTMLElement): string {
    if (element.id) {
      return `#${element.id}`;
    }
    
    if (element.className) {
      return `.${element.className.split(' ').join('.')}`;
    }
    
    return element.tagName.toLowerCase();
  }
}

export { AnnouncementCapture };
```

#### 1.3 Focus Tracker
```typescript
// apps/web/src/lib/accessibility/focus-tracker.ts
interface FocusEvent {
  element: string;
  timestamp: number;
  trigger: 'keyboard' | 'mouse' | 'touch' | 'programmatic';
  fromElement?: string;
}

class FocusTracker {
  private focusEvents: FocusEvent[] = [];
  private isTracking = false;
  private lastInteraction: 'keyboard' | 'mouse' | 'touch' = 'keyboard';

  constructor() {
    this.setupInteractionDetection();
  }

  // Start tracking focus
  start(): void {
    if (this.isTracking) return;
    
    this.isTracking = true;
    this.focusEvents = [];
    
    document.addEventListener('focusin', this.handleFocusIn.bind(this));
    document.addEventListener('focusout', this.handleFocusOut.bind(this));
  }

  // Stop tracking focus
  stop(): void {
    if (!this.isTracking) return;
    
    this.isTracking = false;
    
    document.removeEventListener('focusin', this.handleFocusIn.bind(this));
    document.removeEventListener('focusout', this.handleFocusOut.bind(this));
  }

  // Get focus order
  getFocusOrder(): string[] {
    return this.focusEvents.map(event => event.element);
  }

  // Get focus events
  getFocusEvents(): FocusEvent[] {
    return [...this.focusEvents];
  }

  // Clear focus events
  clear(): void {
    this.focusEvents = [];
  }

  // Setup interaction detection
  private setupInteractionDetection(): void {
    document.addEventListener('keydown', () => {
      this.lastInteraction = 'keyboard';
    });

    document.addEventListener('mousedown', () => {
      this.lastInteraction = 'mouse';
    });

    document.addEventListener('touchstart', () => {
      this.lastInteraction = 'touch';
    });
  }

  // Handle focus in
  private handleFocusIn(event: FocusEvent): void {
    if (!this.isTracking) return;
    
    const element = event.target as HTMLElement;
    const selector = this.getElementSelector(element);
    
    this.focusEvents.push({
      element: selector,
      timestamp: Date.now(),
      trigger: this.lastInteraction,
      fromElement: this.focusEvents.length > 0 ? this.focusEvents[this.focusEvents.length - 1].element : undefined
    });
  }

  // Handle focus out
  private handleFocusOut(event: FocusEvent): void {
    if (!this.isTracking) return;
    
    const element = event.target as HTMLElement;
    const selector = this.getElementSelector(element);
    
    // Update the last focus event with fromElement for the next focus
    // This helps track focus order
  }

  // Get element selector
  private getElementSelector(element: HTMLElement): string {
    if (element.id) {
      return `#${element.id}`;
    }
    
    if (element.className) {
      return `.${element.className.split(' ').join('.')}`;
    }
    
    return element.tagName.toLowerCase();
  }
}

export { FocusTracker };
```

#### 1.4 Performance Monitor
```typescript
// apps/web/src/lib/accessibility/performance-monitor.ts
interface PerformanceMetrics {
  duration: number;
  memoryUsage: number;
  domNodes: number;
  renderTime: number;
}

class PerformanceMonitor {
  private startTime = 0;
  private startMemory = 0;
  private isMonitoring = false;

  // Start monitoring
  start(): void {
    if (this.isMonitoring) return;
    
    this.isMonitoring = true;
    this.startTime = performance.now();
    this.startMemory = this.getMemoryUsage();
  }

  // Stop monitoring
  stop(): PerformanceMetrics {
    if (!this.isMonitoring) {
      return { duration: 0, memoryUsage: 0, domNodes: 0, renderTime: 0 };
    }
    
    const endTime = performance.now();
    const endMemory = this.getMemoryUsage();
    const duration = endTime - this.startTime;
    const memoryUsage = endMemory - this.startMemory;
    const domNodes = document.querySelectorAll('*').length;
    
    this.isMonitoring = false;
    
    return {
      duration,
      memoryUsage,
      domNodes,
      renderTime: duration // Simplified render time
    };
  }

  // Get memory usage
  private getMemoryUsage(): number {
    if ('memory' in performance) {
      return (performance as any).memory.usedJSHeapSize;
    }
    return 0;
  }
}

export { PerformanceMonitor };
```

### 2. React Components

#### 2.1 Screen Reader Test Dashboard
```typescript
// apps/web/src/components/accessibility/screen-reader-test-dashboard.tsx
import React, { useState, useEffect } from 'react';
import { screenReaderTestManager, ScreenReaderTestReport } from '@/lib/accessibility/screen-reader-test-manager';

interface ScreenReaderTestDashboardProps {
  onClose?: () => void;
}

export const ScreenReaderTestDashboard: React.FC<ScreenReaderTestDashboardProps> = ({ onClose }) => {
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState<Map<string, any>>(new Map());
  const [report, setReport] = useState<ScreenReaderTestReport | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedScreenReader, setSelectedScreenReader] = useState<string>('all');

  const categories = ['all', 'navigation', 'content', 'forms', 'media', 'keyboard'];
  const screenReaders = ['all', 'nvda', 'jaws', 'voiceover', 'talkback'];

  useEffect(() => {
    // Load existing results
    const existingResults = screenReaderTestManager.getResults();
    setResults(existingResults);
    
    if (existingResults.size > 0) {
      setReport(screenReaderTestManager.generateReport());
    }
  }, []);

  const runTests = async () => {
    setIsRunning(true);
    
    try {
      const testResults = await screenReaderTestManager.runAllTests();
      setResults(testResults);
      setReport(screenReaderTestManager.generateReport());
    } catch (error) {
      console.error('Test execution failed:', error);
    } finally {
      setIsRunning(false);
    }
  };

  const exportResults = (format: 'json' | 'csv' | 'html') => {
    const data = screenReaderTestManager.exportResults(format);
    const blob = new Blob([data], { 
      type: format === 'json' ? 'application/json' : 
            format === 'csv' ? 'text/csv' : 'text/html' 
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `screen-reader-test-report.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filteredTests = screenReaderTestManager.getAllTests().filter(test => {
    if (selectedCategory !== 'all' && test.category !== selectedCategory) {
      return false;
    }
    if (selectedScreenReader !== 'all' && !test.screenReaders.includes(selectedScreenReader as any)) {
      return false;
    }
    return true;
  });

  return (
    <div className="bg-white rounded-lg p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">Screen Reader Test Dashboard</h2>
        {onClose && (
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500"
          >
            Close
          </button>
        )}
      </div>

      {/* Controls */}
      <div className="bg-gray-50 p-4 rounded-lg mb-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div>
            <label htmlFor="category-filter" className="block text-sm font-medium mb-2">
              Category
            </label>
            <select
              id="category-filter"
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {categories.map(category => (
                <option key={category} value={category}>
                  {category.charAt(0).toUpperCase() + category.slice(1)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="screen-reader-filter" className="block text-sm font-medium mb-2">
              Screen Reader
            </label>
            <select
              id="screen-reader-filter"
              value={selectedScreenReader}
              onChange={(e) => setSelectedScreenReader(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {screenReaders.map(sr => (
                <option key={sr} value={sr}>
                  {sr.toUpperCase()}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-end">
            <button
              onClick={runTests}
              disabled={isRunning}
              className="w-full px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {isRunning ? 'Running Tests...' : 'Run Tests'}
            </button>
          </div>
        </div>

        {/* Export Options */}
        <div className="flex space-x-2">
          <button
            onClick={() => exportResults('json')}
            className="px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500"
          >
            Export JSON
          </button>
          <button
            onClick={() => exportResults('csv')}
            className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            Export CSV
          </button>
          <button
            onClick={() => exportResults('html')}
            className="px-3 py-1 bg-purple-600 text-white rounded hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500"
          >
            Export HTML
          </button>
        </div>
      </div>

      {/* Summary */}
      {report && (
        <div className="bg-blue-50 p-4 rounded-lg mb-6">
          <h3 className="text-lg font-semibold mb-3">Test Summary</h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">{report.summary.totalTests}</div>
              <div className="text-sm text-gray-600">Total Tests</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">{report.summary.passedTests}</div>
              <div className="text-sm text-gray-600">Passed</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-red-600">{report.summary.failedTests}</div>
              <div className="text-sm text-gray-600">Failed</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">{report.summary.passRate}%</div>
              <div className="text-sm text-gray-600">Pass Rate</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-600">{report.summary.averageScore}</div>
              <div className="text-sm text-gray-600">Avg Score</div>
            </div>
          </div>
        </div>
      )}

      {/* Test Results */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Test Results</h3>
        
        {filteredTests.map(test => {
          const result = results.get(test.id);
          const hasResult = result !== undefined;
          
          return (
            <div key={test.id} className="border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h4 className="font-semibold">{test.name}</h4>
                  <p className="text-sm text-gray-600">{test.description}</p>
                  <div className="flex items-center space-x-4 mt-1">
                    <span className="text-xs bg-gray-100 px-2 py-1 rounded">
                      {test.category}
                    </span>
                    <span className="text-xs bg-gray-100 px-2 py-1 rounded">
                      {test.priority}
                    </span>
                    <span className="text-xs bg-gray-100 px-2 py-1 rounded">
                      {test.screenReaders.join(', ')}
                    </span>
                  </div>
                </div>
                
                {hasResult && (
                  <div className="text-right">
                    <div className={`text-lg font-bold ${result.passed ? 'text-green-600' : 'text-red-600'}`}>
                      {result.passed ? 'PASS' : 'FAIL'}
                    </div>
                    <div className="text-sm text-gray-600">
                      Score: {result.score}
                    </div>
                  </div>
                )}
              </div>

              {hasResult && result.issues.length > 0 && (
                <div className="mt-3">
                  <h5 className="font-medium text-sm mb-2">Issues:</h5>
                  <div className="space-y-1">
                    {result.issues.map((issue, index) => (
                      <div key={index} className="text-sm p-2 bg-red-50 border border-red-200 rounded">
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{issue.description}</span>
                          <span className={`text-xs px-2 py-1 rounded ${
                            issue.severity === 'critical' ? 'bg-red-600 text-white' :
                            issue.severity === 'major' ? 'bg-orange-600 text-white' :
                            issue.severity === 'minor' ? 'bg-yellow-600 text-white' :
                            'bg-gray-600 text-white'
                          }`}>
                            {issue.severity}
                          </span>
                        </div>
                        {issue.recommendation && (
                          <div className="text-xs text-gray-600 mt-1">
                            Recommendation: {issue.recommendation}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!hasResult && (
                <div className="mt-3 text-sm text-gray-500">
                  No results available. Run tests to see results.
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
```

### 3. Testing Procedures

#### 3.1 Manual Testing Guide
```typescript
// apps/web/src/lib/accessibility/manual-testing-guide.ts
export const manualTestingProcedures = {
  nvda: {
    name: 'NVDA Testing Procedure',
    screenReader: 'NVDA',
    platform: 'Windows',
    browsers: ['Firefox', 'Chrome'],
    procedures: [
      {
        id: 'nvda-001',
        name: 'Basic Navigation',
        steps: [
          'Start NVDA (Ctrl+Alt+N)',
          'Open browser and navigate to test page',
          'Use arrow keys to read content',
          'Use Tab key to navigate interactive elements',
          'Use H key to navigate headings',
          'Use L key to navigate lists',
          'Use B key to navigate buttons',
          'Use I key to navigate form fields'
        ],
        expectedResults: [
          'All content is read clearly',
          'Interactive elements are announced properly',
          'Navigation landmarks are identified',
          'Form fields have proper labels'
        ]
      },
      {
        id: 'nvda-002',
        name: 'Video Player Testing',
        steps: [
          'Navigate to video player',
          'Test play/pause button',
          'Test progress bar interaction',
          'Test volume controls',
          'Test fullscreen button',
          'Test keyboard shortcuts'
        ],
        expectedResults: [
          'Video player announced as application',
          'Controls have proper labels',
          'Progress bar announces time position',
          'Volume changes are announced',
          'Keyboard shortcuts work with screen reader'
        ]
      }
    ]
  },

  jaws: {
    name: 'JAWS Testing Procedure',
    screenReader: 'JAWS',
    platform: 'Windows',
    browsers: ['Firefox', 'Chrome', 'Edge'],
    procedures: [
      {
        id: 'jaws-001',
        name: 'Basic Navigation',
        steps: [
          'Start JAWS',
          'Open browser and navigate to test page',
          'Use arrow keys to read content',
          'Use Tab key to navigate interactive elements',
          'Use 1-6 keys to navigate headings',
          'Use L key to navigate lists',
          'Use B key to navigate buttons',
          'Use F key to navigate form fields'
        ],
        expectedResults: [
          'All content is read clearly',
          'Interactive elements are announced properly',
          'Navigation landmarks are identified',
          'Form fields have proper labels'
        ]
      }
    ]
  },

  voiceover: {
    name: 'VoiceOver Testing Procedure',
    screenReader: 'VoiceOver',
    platform: 'macOS',
    browsers: ['Safari'],
    procedures: [
      {
        id: 'vo-001',
        name: 'Basic Navigation',
        steps: [
          'Start VoiceOver (Cmd+F5)',
          'Open Safari and navigate to test page',
          'Use arrow keys to read content',
          'Use Tab key to navigate interactive elements',
          'Use Ctrl+Opt+Cmd+H to navigate headings',
          'Use Ctrl+Opt+Cmd+L to navigate lists',
          'Use Ctrl+Opt+Space to activate elements'
        ],
        expectedResults: [
          'All content is read clearly',
          'Interactive elements are announced properly',
          'Navigation landmarks are identified',
          'Form fields have proper labels'
        ]
      }
    ]
  }
};
```

### 4. Testing Strategy

#### 4.1 Automated Tests
```typescript
// apps/web/src/__tests__/accessibility/screen-reader-test-manager.test.ts
import { ScreenReaderTestManager } from '@/lib/accessibility/screen-reader-test-manager';

describe('ScreenReaderTestManager', () => {
  let manager: ScreenReaderTestManager;

  beforeEach(() => {
    manager = new ScreenReaderTestManager();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    manager.clearResults();
  });

  describe('test registration', () => {
    it('should register a new test', () => {
      const test = {
        id: 'test-001',
        name: 'Test',
        description: 'Test description',
        category: 'navigation' as const,
        priority: 'high' as const,
        automated: true,
        manual: false,
        expectedResults: [],
        wcagCriteria: [],
        screenReaders: ['nvda' as const]
      };

      manager.registerTest(test);
      
      const tests = manager.getAllTests();
      expect(tests).toContainEqual(test);
    });

    it('should remove a test', () => {
      const test = {
        id: 'test-001',
        name: 'Test',
        description: 'Test description',
        category: 'navigation' as const,
        priority: 'high' as const,
        automated: true,
        manual: false,
        expectedResults: [],
        wcagCriteria: [],
        screenReaders: ['nvda' as const]
      };

      manager.registerTest(test);
      manager.removeTest('test-001');
      
      const tests = manager.getAllTests();
      expect(tests).not.toContainEqual(test);
    });
  });

  describe('test execution', () => {
    beforeEach(() => {
      document.body.innerHTML = `
        <nav>
          <a href="/">Home</a>
          <a href="/about">About</a>
        </nav>
        <main>
          <h1>Page Title</h1>
          <p>Page content</p>
        </main>
        <form>
          <label for="email">Email</label>
          <input type="email" id="email" required>
          <button type="submit">Submit</button>
        </form>
      `;
    });

    it('should run navigation test', async () => {
      const result = await manager.runTest('sr-nav-001');
      
      expect(result).toBeDefined();
      expect(typeof result.passed).toBe('boolean');
      expect(typeof result.score).toBe('number');
      expect(Array.isArray(result.issues)).toBe(true);
    });

    it('should run video player test', async () => {
      const result = await manager.runTest('sr-media-001');
      
      expect(result).toBeDefined();
      expect(typeof result.passed).toBe('boolean');
      expect(typeof result.score).toBe('number');
      expect(Array.isArray(result.issues)).toBe(true);
    });

    it('should run form test', async () => {
      const result = await manager.runTest('sr-forms-001');
      
      expect(result).toBeDefined();
      expect(typeof result.passed).toBe('boolean');
      expect(typeof result.score).toBe('number');
      expect(Array.isArray(result.issues)).toBe(true);
    });

    it('should run keyboard navigation test', async () => {
      const result = await manager.runTest('sr-keyboard-001');
      
      expect(result).toBeDefined();
      expect(typeof result.passed).toBe('boolean');
      expect(typeof result.score).toBe('number');
      expect(Array.isArray(result.issues)).toBe(true);
    });

    it('should run content structure test', async () => {
      const result = await manager.runTest('sr-content-001');
      
      expect(result).toBeDefined();
      expect(typeof result.passed).toBe('boolean');
      expect(typeof result.score).toBe('number');
      expect(Array.isArray(result.issues)).toBe(true);
    });
  });

  describe('report generation', () => {
    it('should generate report', () => {
      // Mock some results
      const mockResult = {
        passed: true,
        score: 85,
        issues: [],
        announcements: [],
        focusOrder: [],
        performance: { duration: 100, memoryUsage: 50 }
      };

      manager['results'].set('test-001', mockResult);
      
      const report = manager.generateReport();
      
      expect(report.summary.totalTests).toBe(1);
      expect(report.summary.passedTests).toBe(1);
      expect(report.summary.failedTests).toBe(0);
      expect(report.summary.averageScore).toBe(85);
      expect(report.summary.passRate).toBe(100);
    });
  });

  describe('export functionality', () => {
    it('should export results as JSON', () => {
      const mockResult = {
        passed: true,
        score: 85,
        issues: [],
        announcements: [],
        focusOrder: [],
        performance: { duration: 100, memoryUsage: 50 }
      };

      manager['results'].set('test-001', mockResult);
      
      const json = manager.exportResults('json');
      const parsed = JSON.parse(json);
      
      expect(parsed.summary).toBeDefined();
      expect(parsed.testResults).toBeDefined();
    });

    it('should export results as CSV', () => {
      const mockResult = {
        passed: true,
        score: 85,
        issues: [],
        announcements: [],
        focusOrder: [],
        performance: { duration: 100, memoryUsage: 50 }
      };

      manager['results'].set('test-001', mockResult);
      
      const csv = manager.exportResults('csv');
      
      expect(csv).toContain('Test ID');
      expect(csv).toContain('Test Name');
      expect(csv).toContain('Passed');
      expect(csv).toContain('Score');
    });

    it('should export results as HTML', () => {
      const mockResult = {
        passed: true,
        score: 85,
        issues: [],
        announcements: [],
        focusOrder: [],
        performance: { duration: 100, memoryUsage: 50 }
      };

      manager['results'].set('test-001', mockResult);
      
      const html = manager.exportResults('html');
      
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<title>Screen Reader Test Report</title>');
      expect(html).toContain('Test Results');
    });
  });
});
```

## Deliverables

### Phase 1: Core Testing Framework (Week 1)
- [ ] `ScreenReaderTestManager` class with comprehensive test management
- [ ] `AnnouncementCapture` system for screen reader announcement tracking
- [ ] `FocusTracker` for focus order validation
- [ ] `PerformanceMonitor` for test performance measurement
- [ ] Unit tests for core functionality (95% coverage)

### Phase 2: Test Implementation (Week 2)
- [ ] Navigation accessibility tests
- [ ] Video player screen reader tests
- [ ] Form field accessibility tests
- [ ] Keyboard navigation tests
- [ ] Content structure tests

### Phase 3: React Dashboard (Week 3)
- [ ] `ScreenReaderTestDashboard` component
- [ ] Test execution and result display
- [ ] Export functionality (JSON, CSV, HTML)
- [ ] Filtering and categorization
- [ ] Real-time test monitoring

### Phase 4: Manual Testing Procedures (Week 4)
- [ ] NVDA testing procedures and documentation
- [ ] JAWS testing procedures and documentation
- [ ] VoiceOver testing procedures and documentation
- [ ] TalkBack testing procedures and documentation
- [ ] Cross-browser compatibility testing

### Phase 5: Integration & CI/CD (Week 5)
- [ ] Continuous integration testing setup
- [ ] Automated regression testing
- [ ] Performance optimization
- [ ] Documentation and user guides
- [ ] Production deployment and monitoring

## Success Metrics

### Quantitative Metrics
- **95%** test coverage for screen reader compatibility
- **100%** of WCAG 2.1 criteria tested
- **<2s** test execution time for full suite
- **0** critical screen reader compatibility issues

### Qualitative Metrics
- Comprehensive test coverage for all major screen readers
- Clear, actionable test results and recommendations
- Seamless integration with development workflow
- Continuous monitoring for accessibility regressions

## Risks & Mitigations

### Technical Risks
- **Screen reader simulation limitations**: Complement automated tests with manual testing
- **Cross-browser compatibility**: Test across all supported browsers and screen readers
- **Performance impact**: Optimize test execution and use efficient monitoring

### Process Risks
- **Test maintenance**: Keep tests updated with changing requirements
- **False positives/negatives**: Validate automated tests with manual verification
- **Resource requirements**: Ensure adequate testing environment and tools

## Dependencies

### Internal Dependencies
- Focus management system (Story 1.4.2)
- ARIA management system (Story 1.4.3)
- Keyboard navigation system (Story 1.4.4-1.4.6)

### External Dependencies
- Screen reader software (NVDA, JAWS, VoiceOver, TalkBack)
- Browser testing environments
- Accessibility testing tools and libraries
- WCAG 2.1 guidelines and compliance frameworks

## Timeline

**Total Duration**: 5 weeks

**Week 1**: Core testing framework and monitoring systems
**Week 2**: Screen reader test implementation and validation
**Week 3**: React dashboard and user interface
**Week 4**: Manual testing procedures and documentation
**Week 5**: Integration, CI/CD setup, and deployment

## Conclusion

This implementation plan provides a comprehensive screen reader compatibility testing framework that ensures all keyboard navigation features work seamlessly with assistive technologies. The combination of automated testing, manual procedures, and continuous monitoring creates a robust accessibility testing ecosystem that maintains high standards for screen reader compatibility across all supported platforms and devices.

The framework prioritizes comprehensive coverage of WCAG 2.1 criteria while providing actionable insights and recommendations for improving screen reader accessibility, ensuring that Al Ummah Now remains accessible to all users regardless of their assistive technology needs.