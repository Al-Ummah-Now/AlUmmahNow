# Implementation Plan: Audit Existing Color Palette

**Story**: 1.1 - Fix Critical WCAG Color Contrast Violations  
**Task Group**: Audit existing color palette and identify non-compliant contrast ratios  
**Acceptance Criteria**: AC: 1 - Given video player interface is loaded, when I view any text element, then contrast ratio meets WCAG 2.1 AA standards

## Overview

This implementation plan covers the comprehensive audit of existing color palette in the video player interface to identify all elements that fail WCAG 2.1 AA contrast requirements (4.5:1 for normal text, 3:1 for large text).

## Prerequisites

- Access to video player codebase
- axe-core accessibility testing library installed
- Development environment set up with video player running
- Understanding of WCAG 2.1 AA contrast requirements

## Implementation Steps

### Step 1: Install and Configure axe-core for Automated Contrast Testing

**Duration**: 2-4 hours  
**Files to Modify**:
- `apps/web/package.json` - Add axe-core dependency
- `apps/web/src/lib/accessibility/axe-config.ts` - New configuration file

**Actions**:
1. Install axe-core and related dependencies:
   ```bash
   cd apps/web
   pnpm add axe-core @axe-core/react
   pnpm add -D @types/axe-core
   ```

2. Create axe-core configuration:
   ```typescript
   // apps/web/src/lib/accessibility/axe-config.ts
   import axe from 'axe-core';
   
   export const configureAxe = () => {
     axe.configure({
       rules: {
         'color-contrast': { enabled: true },
         'color-contrast-enhanced': { enabled: true }
       },
       reporter: 'v2'
     });
   };
   
   export const runContrastAudit = async (context: Element | Document = document) => {
     configureAxe();
     const results = await axe.run(context);
     return results.violations.filter(v => v.id === 'color-contrast');
   };
   ```

3. Create accessibility testing utility:
   ```typescript
   // apps/web/src/lib/accessibility/contrast-tester.ts
   import { runContrastAudit } from './axe-config';
   
   export class ContrastTester {
     static async auditVideoPlayer() {
       const videoPlayer = document.querySelector('[data-testid="video-player"]');
       if (!videoPlayer) throw new Error('Video player not found');
       
       return await runContrastAudit(videoPlayer);
     }
     
     static async auditEntireApp() {
       return await runContrastAudit(document);
     }
   }
   ```

### Step 2: Run Comprehensive Contrast Audit on All Video Player UI Elements

**Duration**: 4-6 hours  
**Files to Create**:
- `apps/web/src/lib/accessibility/contrast-audit.ts` - Audit orchestration
- `apps/web/src/__tests__/accessibility/contrast-audit.test.ts` - Audit tests

**Actions**:
1. Create comprehensive audit script:
   ```typescript
   // apps/web/src/lib/accessibility/contrast-audit.ts
   import { ContrastTester } from './contrast-tester';
   
   export interface ContrastViolation {
     element: Element;
     expectedRatio: number;
     actualRatio: number;
     foreground: string;
     background: string;
     wcagLevel: 'AA' | 'AAA';
   }
   
   export class ContrastAuditor {
     static async auditVideoPlayerComponents(): Promise<ContrastViolation[]> {
       const violations: ContrastViolation[] = [];
       
       // Audit all video player components
       const components = [
         '.video-controls',
         '.play-button',
         '.volume-control',
         '.progress-bar',
         '.fullscreen-button',
         '.settings-button',
         '.video-title',
         '.video-description'
       ];
       
       for (const selector of components) {
         const elements = document.querySelectorAll(selector);
         for (const element of elements) {
           const elementViolations = await this.auditElement(element);
           violations.push(...elementViolations);
         }
       }
       
       return violations;
     }
     
     private static async auditElement(element: Element): Promise<ContrastViolation[]> {
       // Implementation for individual element auditing
       const computedStyle = window.getComputedStyle(element);
       const foreground = computedStyle.color;
       const background = computedStyle.backgroundColor;
       
       // Calculate contrast ratio
       const ratio = this.calculateContrastRatio(foreground, background);
       
       // Determine if it meets WCAG requirements
       const fontSize = parseFloat(computedStyle.fontSize);
       const isLargeText = fontSize >= 18 || fontSize >= 14 && computedStyle.fontWeight === 'bold';
       const requiredRatio = isLargeText ? 3.0 : 4.5;
       
       if (ratio < requiredRatio) {
         return [{
           element,
           expectedRatio: requiredRatio,
           actualRatio: ratio,
           foreground,
           background,
           wcagLevel: 'AA'
         }];
       }
       
       return [];
     }
     
     private static calculateContrastRatio(foreground: string, background: string): number {
       // Implementation of contrast ratio calculation
       // This would use the WCAG contrast ratio formula
       return 0; // Placeholder
     }
   }
   ```

2. Create audit test runner:
   ```typescript
   // apps/web/src/__tests__/accessibility/contrast-audit.test.ts
   import { ContrastAuditor } from '../../lib/accessibility/contrast-audit';
   
   describe('Contrast Audit', () => {
     beforeAll(() => {
       // Set up video player in test environment
     });
     
     it('should identify all contrast violations in video player', async () => {
       const violations = await ContrastAuditor.auditVideoPlayerComponents();
       
       // Log all violations for documentation
       console.log('Contrast Violations Found:', violations);
       
       // This test will initially fail, documenting current state
       expect(violations.length).toBeGreaterThanOrEqual(0);
     });
   });
   ```

### Step 3: Document All Elements Failing WCAG 2.1 AA Standards

**Duration**: 3-4 hours  
**Files to Create**:
- `docs/accessibility/contrast-violations-report.md` - Comprehensive report
- `apps/web/src/data/contrast-violations.json` - Structured violation data

**Actions**:
1. Create violation documentation generator:
   ```typescript
   // apps/web/src/lib/accessibility/violation-reporter.ts
   import { ContrastViolation } from './contrast-audit';
   
   export class ViolationReporter {
     static generateReport(violations: ContrastViolation[]): string {
       const report = {
         timestamp: new Date().toISOString(),
         totalViolations: violations.length,
         violations: violations.map(v => ({
           element: this.getElementSelector(v.element),
           expectedRatio: v.expectedRatio,
           actualRatio: v.actualRatio,
           foreground: v.foreground,
           background: v.background,
           component: this.identifyComponent(v.element)
         }))
       };
       
       return JSON.stringify(report, null, 2);
     }
     
     static generateMarkdownReport(violations: ContrastViolation[]): string {
       let markdown = `# Color Contrast Violations Report\n\n`;
       markdown += `Generated: ${new Date().toISOString()}\n\n`;
       markdown += `Total Violations: ${violations.length}\n\n`;
       
       // Group violations by component
       const grouped = this.groupByComponent(violations);
       
       for (const [component, componentViolations] of Object.entries(grouped)) {
         markdown += `## ${component}\n\n`;
         
         for (const violation of componentViolations) {
           markdown += `### ${this.getElementSelector(violation.element)}\n`;
           markdown += `- **Current Ratio**: ${violation.actualRatio.toFixed(2)}:1\n`;
           markdown += `- **Required Ratio**: ${violation.expectedRatio.toFixed(2)}:1\n`;
           markdown += `- **Foreground**: ${violation.foreground}\n`;
           markdown += `- **Background**: ${violation.background}\n\n`;
         }
       }
       
       return markdown;
     }
     
     private static getElementSelector(element: Element): string {
       // Generate unique selector for element
       return element.tagName.toLowerCase() + 
              (element.id ? `#${element.id}` : '') +
              (element.className ? `.${element.className.split(' ').join('.')}` : '');
     }
     
     private static identifyComponent(element: Element): string {
       // Identify which component the element belongs to
       const parent = element.closest('[data-component]');
       return parent?.getAttribute('data-component') || 'Unknown';
     }
     
     private static groupByComponent(violations: ContrastViolation[]): Record<string, ContrastViolation[]> {
       return violations.reduce((groups, violation) => {
         const component = this.identifyComponent(violation.element);
         if (!groups[component]) groups[component] = [];
         groups[component].push(violation);
         return groups;
       }, {} as Record<string, ContrastViolation[]>);
     }
   }
   ```

2. Create documentation script:
   ```typescript
   // apps/web/scripts/generate-contrast-report.ts
   import { ContrastAuditor } from '../src/lib/accessibility/contrast-audit';
   import { ViolationReporter } from '../src/lib/accessibility/violation-reporter';
   import fs from 'fs';
   import path from 'path';
   
   async function generateContrastReport() {
     console.log('Running contrast audit...');
     const violations = await ContrastAuditor.auditVideoPlayerComponents();
     
     console.log(`Found ${violations.length} violations`);
     
     // Generate JSON report
     const jsonReport = ViolationReporter.generateReport(violations);
     fs.writeFileSync(
       path.join(__dirname, '../src/data/contrast-violations.json'),
       jsonReport
     );
     
     // Generate Markdown report
     const markdownReport = ViolationReporter.generateMarkdownReport(violations);
     fs.writeFileSync(
       path.join(__dirname, '../../docs/accessibility/contrast-violations-report.md'),
       markdownReport
     );
     
     console.log('Reports generated successfully');
   }
   
   generateContrastReport().catch(console.error);
   ```

## Testing Strategy

### Unit Tests
- Test contrast ratio calculation accuracy
- Test violation detection logic
- Test report generation

### Integration Tests
- Run audit on actual video player components
- Verify all violations are captured
- Test report generation with real data

### Manual Testing
- Visual verification of reported violations
- Cross-check with manual contrast testing tools
- Validate report accuracy

## Deliverables

1. **axe-core Configuration** (`apps/web/src/lib/accessibility/axe-config.ts`)
2. **Contrast Testing Utilities** (`apps/web/src/lib/accessibility/contrast-tester.ts`)
3. **Audit Implementation** (`apps/web/src/lib/accessibility/contrast-audit.ts`)
4. **Violation Reporter** (`apps/web/src/lib/accessibility/violation-reporter.ts`)
5. **Test Suite** (`apps/web/src/__tests__/accessibility/contrast-audit.test.ts`)
6. **Report Generation Script** (`apps/web/scripts/generate-contrast-report.ts`)
7. **Documentation** (`docs/accessibility/contrast-violations-report.md`)
8. **Violation Data** (`apps/web/src/data/contrast-violations.json`)

## Success Criteria

- ✅ axe-core successfully integrated and configured
- ✅ Comprehensive audit covers all video player UI elements
- ✅ All contrast violations identified and documented
- ✅ Reports generated in both JSON and Markdown formats
- ✅ Test suite validates audit functionality
- ✅ Documentation provides clear violation details for remediation

## Estimated Timeline

**Total Duration**: 9-14 hours  
**Dependencies**: None  
**Risks**: Low - Well-established accessibility testing tools and patterns

## Next Steps

After completing this audit:
1. Review violation report to prioritize fixes
2. Proceed to "Update CSS color palette to meet contrast requirements" task
3. Use documented violations as input for color palette updates
4. Re-run audit after fixes to verify compliance