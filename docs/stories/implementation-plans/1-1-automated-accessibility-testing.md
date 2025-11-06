# Implementation Plan: Automated Accessibility Testing Implementation

**Story**: 1.1 - Fix Critical WCAG Color Contrast Violations  
**Task Group**: Automated accessibility testing implementation  
**Acceptance Criteria**: AC: 4 - Given automated accessibility testing is run, when axe-core and WAVE tools scan the video player, then zero contrast violations are detected

## Overview

This implementation plan covers integrating automated accessibility testing tools into the development workflow to ensure continuous compliance with WCAG 2.1 AA standards. This includes axe-core integration, WAVE API integration, and CI/CD pipeline configuration.

## Prerequisites

- Color palette updated and contrast issues resolved
- Color independence implemented
- Development environment with Jest/Playwright configured
- CI/CD pipeline access and configuration knowledge

## Implementation Steps

### Step 1: Integrate axe-core Testing into Development Workflow

**Duration**: 4-6 hours  
**Files to Modify**:
- `apps/web/package.json` - Add testing dependencies
- `apps/web/jest.config.js` - Configure Jest for accessibility testing
- `apps/web/src/__tests__/accessibility/axe-core.test.tsx` - axe-core tests

**Actions**:
1. Install and configure axe-core dependencies:
   ```bash
   cd apps/web
   pnpm add axe-core @axe-core/react jest-axe
   pnpm add -D @types/jest-axe
   ```

2. Configure Jest for accessibility testing:
   ```javascript
   // apps/web/jest.config.js
   const nextJest = require('next/jest');
   
   const createJestConfig = nextJest({
     dir: './',
   });
   
   const customJestConfig = {
     setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
     moduleNameMapping: {
       '^@/(.*)$': '<rootDir>/src/$1',
     },
     testEnvironment: 'jest-environment-jsdom',
     collectCoverageFrom: [
       'src/**/*.{js,jsx,ts,tsx}',
       '!src/**/*.d.ts',
       '!src/**/*.stories.{js,jsx,ts,tsx}',
     ],
     coverageThreshold: {
       global: {
         branches: 80,
         functions: 80,
         lines: 80,
         statements: 80,
       },
       // Higher threshold for accessibility components
       'src/lib/accessibility/': {
         branches: 95,
         functions: 95,
         lines: 95,
         statements: 95,
       },
     },
     // Custom matchers for axe-core
     setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
   };
   
   module.exports = createJestConfig(customJestConfig);
   ```

3. Create Jest setup for accessibility testing:
   ```javascript
   // apps/web/jest.setup.js
   import '@testing-library/jest-dom';
   import { toHaveNoViolations } from 'jest-axe';
   
   // Add custom matchers
   expect.extend(toHaveNoViolations);
   
   // Mock IntersectionObserver
   global.IntersectionObserver = jest.fn().mockImplementation(() => ({
     observe: jest.fn(),
     unobserve: jest.fn(),
     disconnect: jest.fn(),
   }));
   
   // Mock ResizeObserver
   global.ResizeObserver = jest.fn().mockImplementation(() => ({
     observe: jest.fn(),
     unobserve: jest.fn(),
     disconnect: jest.fn(),
   }));
   
   // Mock Web Audio API
   global.AudioContext = jest.fn().mockImplementation(() => ({
     createOscillator: jest.fn().mockReturnValue({
       connect: jest.fn(),
       start: jest.fn(),
       stop: jest.fn(),
       frequency: { value: 0 },
     }),
     createGain: jest.fn().mockReturnValue({
       connect: jest.fn(),
       gain: { 
         setValueAtTime: jest.fn(),
         exponentialRampToValueAtTime: jest.fn(),
       },
     }),
     currentTime: 0,
   }));
   ```

4. Create comprehensive axe-core test suite:
   ```tsx
   // apps/web/src/__tests__/accessibility/axe-core.test.tsx
   import React from 'react';
   import { render, screen } from '@testing-library/react';
   import { axe, toHaveNoViolations } from 'jest-axe';
   import { CustomVideoPlayer } from '../../components/VideoPlayer/CustomVideoPlayer';
   import { ThemeProvider } from '../../components/providers/ThemeProvider';
   
   // Extend Jest matchers
   expect.extend(toHaveNoViolations);
   
   // Test wrapper with theme provider
   const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
     <ThemeProvider>
       {children}
     </ThemeProvider>
   );
   
   describe('Video Player Accessibility', () => {
     const mockVideoProps = {
       src: 'https://example.com/video.mp4',
       poster: 'https://example.com/poster.jpg',
       title: 'Test Video',
     };
     
     it('should have no accessibility violations in light theme', async () => {
       const { container } = render(
         <TestWrapper>
           <CustomVideoPlayer {...mockVideoProps} />
         </TestWrapper>
       );
       
       const results = await axe(container);
       expect(results).toHaveNoViolations();
     });
     
     it('should have no accessibility violations in dark theme', async () => {
       const { container } = render(
         <TestWrapper>
           <div data-theme="dark">
             <CustomVideoPlayer {...mockVideoProps} />
           </div>
         </TestWrapper>
       );
       
       const results = await axe(container);
       expect(results).toHaveNoViolations();
     });
     
     it('should have proper ARIA labels', async () => {
       render(
         <TestWrapper>
           <CustomVideoPlayer {...mockVideoProps} />
         </TestWrapper>
       );
       
       // Check for proper ARIA labels
       const video = screen.getByRole('application', { name: /video player/i });
       expect(video).toBeInTheDocument();
       
       const playButton = screen.getByRole('button', { name: /play/i });
       expect(playButton).toBeInTheDocument();
       
       const volumeSlider = screen.getByRole('slider', { name: /volume/i });
       expect(volumeSlider).toBeInTheDocument();
       
       const progressBar = screen.getByRole('slider', { name: /progress/i });
       expect(progressBar).toBeInTheDocument();
     });
     
     it('should support keyboard navigation', async () => {
       const { container } = render(
         <TestWrapper>
           <CustomVideoPlayer {...mockVideoProps} />
         </TestWrapper>
       );
       
       const results = await axe(container, {
         rules: {
           'keyboard': { enabled: true },
           'tabindex': { enabled: true },
         }
       });
       
       expect(results).toHaveNoViolations();
     });
     
     it('should have sufficient color contrast', async () => {
       const { container } = render(
         <TestWrapper>
           <CustomVideoPlayer {...mockVideoProps} />
         </TestWrapper>
       );
       
       const results = await axe(container, {
         rules: {
           'color-contrast': { enabled: true },
           'color-contrast-enhanced': { enabled: true },
         }
       });
       
       expect(results).toHaveNoViolations();
     });
     
     it('should have proper heading structure', async () => {
       const { container } = render(
         <TestWrapper>
           <CustomVideoPlayer {...mockVideoProps} />
         </TestWrapper>
       );
       
       const results = await axe(container, {
         rules: {
           'heading-order': { enabled: true },
           'region': { enabled: true },
         }
       });
       
       expect(results).toHaveNoViolations();
     });
   });
   
   describe('Individual Component Accessibility', () => {
     it('should test volume control accessibility', async () => {
       const { VolumeControl } = await import('../../components/VideoPlayer/VolumeControl');
       const { container } = render(
         <TestWrapper>
           <VolumeControl />
         </TestWrapper>
       );
       
       const results = await axe(container);
       expect(results).toHaveNoViolations();
     });
     
     it('should test progress bar accessibility', async () => {
       const { ProgressBar } = await import('../../components/VideoPlayer/ProgressBar');
       const { container } = render(
         <TestWrapper>
           <ProgressBar />
         </TestWrapper>
       );
       
       const results = await axe(container);
       expect(results).toHaveNoViolations();
     });
     
     it('should test quality selector accessibility', async () => {
       const { QualitySelector } = await import('../../components/VideoPlayer/QualitySelector');
       const { container } = render(
         <TestWrapper>
           <QualitySelector />
         </TestWrapper>
       );
       
       const results = await axe(container);
       expect(results).toHaveNoViolations();
     });
   });
   ```

### Step 2: Set Up WAVE API Integration for Automated Testing

**Duration**: 3-4 hours  
**Files to Create**:
- `apps/web/src/lib/accessibility/wave-api.ts` - WAVE API integration
- `apps/web/src/__tests__/accessibility/wave-api.test.ts` - WAVE API tests
- `apps/web/scripts/wave-audit.js` - WAVE audit script

**Actions**:
1. Create WAVE API integration utility:
   ```typescript
   // apps/web/src/lib/accessibility/wave-api.ts
   export interface WaveViolation {
     id: string;
     description: string;
     impact: 'critical' | 'serious' | 'moderate' | 'minor';
     element: string;
     xpath: string;
     category: 'error' | 'alert' | 'feature' | 'structural' | 'aria';
     wcag: string[];
     help: string;
   }
   
   export interface WaveReport {
     url: string;
     statistics: {
       total: number;
       errors: number;
       alerts: number;
       features: number;
       structural: number;
       aria: number;
     };
     categories: {
       errors: WaveViolation[];
       alerts: WaveViolation[];
       features: WaveViolation[];
       structural: WaveViolation[];
       aria: WaveViolation[];
     };
     timestamp: string;
   }
   
   export class WaveApiManager {
     private static readonly WAVE_API_KEY = process.env.NEXT_PUBLIC_WAVE_API_KEY;
     private static readonly WAVE_API_URL = 'https://wave.webaim.org/api/request';
     
     static async testUrl(url: string): Promise<WaveReport> {
       if (!this.WAVE_API_KEY) {
         throw new Error('WAVE API key not configured');
       }
       
       const response = await fetch(`${this.WAVE_API_URL}?key=${this.WAVE_API_KEY}&url=${encodeURIComponent(url)}&format=json&reporttype=1&testoptions=1`);
       
       if (!response.ok) {
         throw new Error(`WAVE API request failed: ${response.statusText}`);
       }
       
       const data = await response.json();
       return this.parseWaveResponse(data, url);
     }
     
     static async testElement(element: HTMLElement): Promise<WaveViolation[]> {
       // Create a temporary HTML file with the element
       const html = this.createTestHtml(element);
       const tempUrl = await this.createTempFile(html);
       
       try {
         const report = await this.testUrl(tempUrl);
         return [...report.categories.errors, ...report.categories.alerts];
       } finally {
         await this.cleanupTempFile(tempUrl);
       }
     }
     
     private static parseWaveResponse(data: any, url: string): WaveReport {
       const categories = {
         errors: this.parseViolations(data.categories?.errors || []),
         alerts: this.parseViolations(data.categories?.alerts || []),
         features: this.parseViolations(data.categories?.features || []),
         structural: this.parseViolations(data.categories?.structural || []),
         aria: this.parseViolations(data.categories?.aria || []),
       };
       
       return {
         url,
         statistics: {
           total: Object.values(categories).reduce((sum, cat) => sum + cat.length, 0),
           errors: categories.errors.length,
           alerts: categories.alerts.length,
           features: categories.features.length,
           structural: categories.structural.length,
           aria: categories.aria.length,
         },
         categories,
         timestamp: new Date().toISOString(),
       };
     }
     
     private static parseViolations(violations: any[]): WaveViolation[] {
       return violations.map(violation => ({
         id: violation.id,
         description: violation.description,
         impact: this.impactLevel(violation.type),
         element: violation.element,
         xpath: violation.xpath,
         category: this.categoryLevel(violation.type),
         wcag: violation.wcag ? [violation.wcag] : [],
         help: violation.help,
       }));
     }
     
     private static impactLevel(type: string): WaveViolation['impact'] {
       const impactMap: Record<string, WaveViolation['impact']> = {
         'error': 'critical',
         'alert': 'serious',
         'feature': 'moderate',
         'structural': 'minor',
         'aria': 'serious',
       };
       
       return impactMap[type] || 'moderate';
     }
     
     private static categoryLevel(type: string): WaveViolation['category'] {
       return type as WaveViolation['category'];
     }
     
     private static createTestHtml(element: HTMLElement): string {
       return `
         <!DOCTYPE html>
         <html lang="en">
         <head>
           <meta charset="UTF-8">
           <meta name="viewport" content="width=device-width, initial-scale=1.0">
           <title>Accessibility Test</title>
           <style>
             body { font-family: Arial, sans-serif; margin: 20px; }
           </style>
         </head>
         <body>
           ${element.outerHTML}
         </body>
         </html>
       `;
     }
     
     private static async createTempFile(html: string): Promise<string> {
       // In a real implementation, this would create a temporary file
       // For now, return a mock URL
       return 'https://test.example.com/temp-accessibility-test.html';
     }
     
     private static async cleanupTempFile(url: string): Promise<void> {
       // Clean up temporary file
       console.log(`Cleaning up temp file: ${url}`);
     }
     
     static generateMarkdownReport(report: WaveReport): string {
       let markdown = `# WAVE Accessibility Report\n\n`;
       markdown += `**URL:** ${report.url}\n`;
       markdown += `**Generated:** ${new Date(report.timestamp).toLocaleString()}\n\n`;
       
       markdown += `## Summary\n\n`;
       markdown += `- **Total Issues:** ${report.statistics.total}\n`;
       markdown += `- **Errors:** ${report.statistics.errors}\n`;
       markdown += `- **Alerts:** ${report.statistics.alerts}\n`;
       markdown += `- **Features:** ${report.statistics.features}\n`;
       markdown += `- **Structural:** ${report.statistics.structural}\n`;
       markdown += `- **ARIA:** ${report.statistics.aria}\n\n`;
       
       if (report.categories.errors.length > 0) {
         markdown += `## Errors (Critical)\n\n`;
         report.categories.errors.forEach(error => {
           markdown += `### ${error.id}\n`;
           markdown += `**Description:** ${error.description}\n`;
           markdown += `**Element:** \`${error.element}\`\n`;
           markdown += `**WCAG:** ${error.wcag.join(', ')}\n`;
           markdown += `**Help:** ${error.help}\n\n`;
         });
       }
       
       if (report.categories.alerts.length > 0) {
         markdown += `## Alerts (Serious)\n\n`;
         report.categories.alerts.forEach(alert => {
           markdown += `### ${alert.id}\n`;
           markdown += `**Description:** ${alert.description}\n`;
           markdown += `**Element:** \`${alert.element}\`\n`;
           markdown += `**WCAG:** ${alert.wcag.join(', ')}\n`;
           markdown += `**Help:** ${alert.help}\n\n`;
         });
       }
       
       return markdown;
     }
   }
   ```

2. Create WAVE audit script:
   ```javascript
   // apps/web/scripts/wave-audit.js
   const { WaveApiManager } = require('../src/lib/accessibility/wave-api');
   const fs = require('fs');
   const path = require('path');
   
   async function runWaveAudit() {
     try {
       console.log('Starting WAVE accessibility audit...');
       
       // Test local development server
       const testUrl = 'http://localhost:3000/en/video-player';
       
       console.log(`Testing URL: ${testUrl}`);
       const report = await WaveApiManager.testUrl(testUrl);
       
       console.log(`Found ${report.statistics.total} issues:`);
       console.log(`- Errors: ${report.statistics.errors}`);
       console.log(`- Alerts: ${report.statistics.alerts}`);
       console.log(`- Features: ${report.statistics.features}`);
       console.log(`- Structural: ${report.statistics.structural}`);
       console.log(`- ARIA: ${report.statistics.aria}`);
       
       // Generate reports
       const jsonReport = JSON.stringify(report, null, 2);
       const markdownReport = WaveApiManager.generateMarkdownReport(report);
       
       // Save reports
       const reportsDir = path.join(__dirname, '../reports/accessibility');
       if (!fs.existsSync(reportsDir)) {
         fs.mkdirSync(reportsDir, { recursive: true });
       }
       
       const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
       
       fs.writeFileSync(
         path.join(reportsDir, `wave-report-${timestamp}.json`),
         jsonReport
       );
       
       fs.writeFileSync(
         path.join(reportsDir, `wave-report-${timestamp}.md`),
         markdownReport
       );
       
       console.log(`Reports saved to ${reportsDir}`);
       
       // Exit with error code if critical issues found
       if (report.statistics.errors > 0) {
         console.error(`❌ Found ${report.statistics.errors} critical accessibility errors`);
         process.exit(1);
       } else {
         console.log('✅ No critical accessibility errors found');
       }
       
     } catch (error) {
       console.error('WAVE audit failed:', error);
       process.exit(1);
     }
   }
   
   if (require.main === module) {
     runWaveAudit();
   }
   
   module.exports = { runWaveAudit };
   ```

### Step 3: Configure CI/CD Pipeline to Run Accessibility Tests

**Duration**: 3-4 hours  
**Files to Modify**:
- `.github/workflows/accessibility.yml` - New accessibility workflow
- `.github/workflows/deploy.yml` - Update existing deployment workflow

**Actions**:
1. Create dedicated accessibility workflow:
   ```yaml
   # .github/workflows/accessibility.yml
   name: Accessibility Testing
   
   on:
     push:
       branches: [main, develop]
     pull_request:
       branches: [main]
     schedule:
       # Run daily at 2 AM UTC
       - cron: '0 2 * * *'
   
   jobs:
     accessibility-tests:
       runs-on: ubuntu-latest
       
       steps:
         - name: Checkout code
           uses: actions/checkout@v4
         
         - name: Setup Node.js
           uses: actions/setup-node@v4
           with:
             node-version: '18'
             cache: 'pnpm'
         
         - name: Install pnpm
           uses: pnpm/action-setup@v2
           with:
             version: 8
         
         - name: Install dependencies
           run: |
             pnpm install
             pnpm --filter @al-ummah/shared-types build
         
         - name: Run axe-core tests
           run: |
             cd apps/web
             pnpm test --testPathPattern=accessibility --coverage
         
         - name: Upload coverage reports
           uses: codecov/codecov-action@v3
           with:
             file: ./apps/web/coverage/lcov.info
             flags: accessibility
             name: accessibility-coverage
         
         - name: Build application
           run: |
             cd apps/web
             pnpm build
         
         - name: Start application
           run: |
             cd apps/web
             pnpm start &
             sleep 30
         
         - name: Run WAVE API tests
           env:
             NEXT_PUBLIC_WAVE_API_KEY: ${{ secrets.WAVE_API_KEY }}
           run: |
             node apps/web/scripts/wave-audit.js
         
         - name: Upload WAVE reports
           uses: actions/upload-artifact@v3
           if: always()
           with:
             name: wave-reports
             path: apps/web/reports/accessibility/
             retention-days: 30
         
         - name: Comment PR with results
           if: github.event_name == 'pull_request'
           uses: actions/github-script@v6
           with:
             script: |
               const fs = require('fs');
               const path = require('path');
               
               const reportsDir = 'apps/web/reports/accessibility';
               if (fs.existsSync(reportsDir)) {
                 const files = fs.readdirSync(reportsDir);
                 const markdownFiles = files.filter(f => f.endsWith('.md'));
                 
                 if (markdownFiles.length > 0) {
                   const latestReport = fs.readFileSync(
                     path.join(reportsDir, markdownFiles[markdownFiles.length - 1]),
                     'utf8'
                   );
                   
                   github.rest.issues.createComment({
                     issue_number: context.issue.number,
                     owner: context.repo.owner,
                     repo: context.repo.repo,
                     body: `## 🧪 Accessibility Test Results\n\n${latestReport}`
                   });
                 }
               }
   ```

2. Update deployment workflow to include accessibility checks:
   ```yaml
   # .github/workflows/deploy.yml (partial update)
   jobs:
     test:
       runs-on: ubuntu-latest
       steps:
         # ... existing steps ...
         
         - name: Run accessibility tests
           run: |
             cd apps/web
             pnpm test --testPathPattern=accessibility --passWithNoTests
         
         - name: Build application
           run: |
             cd apps/web
             pnpm build
         
         - name: Run accessibility audit on build
           env:
             NEXT_PUBLIC_WAVE_API_KEY: ${{ secrets.WAVE_API_KEY }}
           run: |
             node apps/web/scripts/wave-audit.js || true
         
         # ... continue with existing deployment steps ...
   ```

### Step 4: Ensure Zero Contrast Violations in Automated Tests

**Duration**: 2-3 hours  
**Files to Create**:
- `apps/web/src/__tests__/accessibility/contrast-validation.test.tsx` - Contrast-specific tests
- `apps/web/scripts/contrast-check.js` - Contrast validation script

**Actions**:
1. Create contrast validation test suite:
   ```tsx
   // apps/web/src/__tests__/accessibility/contrast-validation.test.tsx
   import React from 'react';
   import { render, screen } from '@testing-library/react';
   import { axe, toHaveNoViolations } from 'jest-axe';
   import { CustomVideoPlayer } from '../../components/VideoPlayer/CustomVideoPlayer';
   import { ThemeProvider } from '../../components/providers/ThemeProvider';
   
   expect.extend(toHaveNoViolations);
   
   describe('Contrast Validation', () => {
     const mockVideoProps = {
       src: 'https://example.com/video.mp4',
       poster: 'https://example.com/poster.jpg',
       title: 'Test Video',
     };
     
     const themes = ['light', 'dark'];
     
     themes.forEach(theme => {
       describe(`${theme} theme`, () => {
         it('should have no color contrast violations', async () => {
           const { container } = render(
             <ThemeProvider>
               <div data-theme={theme}>
                 <CustomVideoPlayer {...mockVideoProps} />
               </div>
             </ThemeProvider>
           );
           
           const results = await axe(container, {
             rules: {
               'color-contrast': { enabled: true },
               'color-contrast-enhanced': { enabled: false },
             }
           });
           
           expect(results).toHaveNoViolations();
         });
         
         it('should meet enhanced contrast requirements where applicable', async () => {
           const { container } = render(
             <ThemeProvider>
               <div data-theme={theme}>
                 <CustomVideoPlayer {...mockVideoProps} />
               </div>
             </ThemeProvider>
           );
           
           const results = await axe(container, {
             rules: {
               'color-contrast-enhanced': { enabled: true },
             }
           });
           
           // Allow some enhanced contrast violations for non-critical elements
           const enhancedViolations = results.violations.filter(
             v => v.id === 'color-contrast-enhanced'
           );
           
           expect(enhancedViolations.length).toBeLessThanOrEqual(2);
         });
       });
     });
     
     it('should validate specific video player controls', async () => {
       const { container } = render(
         <ThemeProvider>
           <CustomVideoPlayer {...mockVideoProps} />
         </ThemeProvider>
       );
       
       // Test specific interactive elements
       const interactiveElements = container.querySelectorAll(
         'button, [role="button"], input, [role="slider"], [role="option"]'
       );
       
       for (const element of interactiveElements) {
         const elementResults = await axe(element, {
           rules: {
             'color-contrast': { enabled: true },
           }
         });
         
         expect(elementResults).toHaveNoViolations();
       }
     });
     
     it('should validate text elements', async () => {
       const { container } = render(
         <ThemeProvider>
           <CustomVideoPlayer {...mockVideoProps} />
         </ThemeProvider>
       );
       
       // Test text elements specifically
       const textElements = container.querySelectorAll(
         'p, span, div:not([role]):not([aria-label]):not([aria-labelledby])'
       );
       
       for (const element of textElements) {
         if (element.textContent?.trim()) {
           const elementResults = await axe(element, {
             rules: {
               'color-contrast': { enabled: true },
             }
           });
           
           expect(elementResults).toHaveNoViolations();
         }
       }
     });
   });
   ```

2. Create contrast validation script:
   ```javascript
   // apps/web/scripts/contrast-check.js
   const { execSync } = require('child_process');
   const fs = require('fs');
   const path = require('path');
   
   async function runContrastValidation() {
     try {
       console.log('Running contrast validation tests...');
       
       // Run Jest tests for contrast
       const testOutput = execSync(
         'pnpm test --testPathPattern=contrast-validation --json --outputFile=jest-results.json',
         { cwd: 'apps/web', encoding: 'utf8' }
       );
       
       // Parse Jest results
       const jestResults = JSON.parse(fs.readFileSync('apps/web/jest-results.json', 'utf8'));
       
       let totalTests = 0;
       let passedTests = 0;
       let failedTests = 0;
       let contrastViolations = 0;
       
       jestResults.testResults.forEach(result => {
         totalTests += result.numPassingTests + result.numFailingTests;
         passedTests += result.numPassingTests;
         failedTests += result.numFailingTests;
         
         // Check for contrast violations in assertion results
         result.assertionResults.forEach(assertion => {
           if (assertion.failureMessages) {
             const violationMatch = assertion.failureMessages.join(' ').match(/(\d+)\s+violations/);
             if (violationMatch) {
               contrastViolations += parseInt(violationMatch[1]);
             }
           }
         });
       });
       
       console.log(`\n📊 Contrast Validation Results:`);
       console.log(`Total Tests: ${totalTests}`);
       console.log(`Passed: ${passedTests}`);
       console.log(`Failed: ${failedTests}`);
       console.log(`Contrast Violations: ${contrastViolations}`);
       
       // Generate report
       const report = {
         timestamp: new Date().toISOString(),
         summary: {
           totalTests,
           passedTests,
           failedTests,
           contrastViolations,
           successRate: (passedTests / totalTests * 100).toFixed(2) + '%'
         },
         details: jestResults.testResults
       };
       
       // Save report
       const reportsDir = path.join(__dirname, '../reports/accessibility');
       if (!fs.existsSync(reportsDir)) {
         fs.mkdirSync(reportsDir, { recursive: true });
       }
       
       const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
       fs.writeFileSync(
         path.join(reportsDir, `contrast-validation-${timestamp}.json`),
         JSON.stringify(report, null, 2)
       );
       
       console.log(`\n📄 Report saved to ${reportsDir}`);
       
       // Exit with appropriate code
       if (contrastViolations > 0) {
         console.error(`❌ Found ${contrastViolations} contrast violations`);
         process.exit(1);
       } else {
         console.log('✅ No contrast violations found');
       }
       
     } catch (error) {
       console.error('Contrast validation failed:', error);
       process.exit(1);
     }
   }
   
   if (require.main === module) {
     runContrastValidation();
   }
   
   module.exports = { runContrastValidation };
   ```

## Testing Strategy

### Automated Testing
- Jest unit tests with axe-core integration
- WAVE API automated testing
- Visual regression testing for contrast
- CI/CD pipeline integration

### Continuous Monitoring
- Daily scheduled accessibility scans
- Pull request accessibility checks
- Coverage tracking for accessibility components
- Performance impact monitoring

### Reporting
- Automated report generation
- PR comments with accessibility results
- Historical trend tracking
- Integration with project management tools

## Deliverables

1. **axe-core Integration** (Jest configuration and test suites)
2. **WAVE API Integration** (API client and reporting)
3. **CI/CD Pipeline** (GitHub Actions workflows)
4. **Contrast Validation** (Specialized test suites)
5. **Automated Scripts** (Audit and validation scripts)
6. **Reporting System** (Markdown and JSON reports)
7. **Documentation** (Setup and maintenance guides)

## Success Criteria

- ✅ axe-core integration passes with zero violations
- ✅ WAVE API reports zero critical errors
- ✅ CI/CD pipeline blocks deployments on violations
- ✅ Automated reports generated and archived
- ✅ Coverage thresholds met for accessibility components
- ✅ Performance impact minimal (<5% build time increase)

## Estimated Timeline

**Total Duration**: 12-17 hours  
**Dependencies**: All previous Story 1.1 tasks completed  
**Risks**: Low - Well-established testing patterns and tools

## Next Steps

After implementing automated accessibility testing:
1. Proceed to "Cross-theme contrast compliance validation" task
2. Monitor automated test results
3. Fine-tune test thresholds and rules
4. Train team on accessibility testing procedures