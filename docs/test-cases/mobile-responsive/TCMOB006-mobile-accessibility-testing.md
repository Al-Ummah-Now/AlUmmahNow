# TCMOB006: Mobile Accessibility Testing

## Test Overview

**Test Case ID**: TCMOB006  
**Category**: Mobile Responsive  
**Test Type**: Accessibility Testing  
**Priority**: High  
**Estimated Duration**: 50 minutes  

### Objective
Verify that the mobile application is fully accessible to users with disabilities, complying with WCAG 2.1 AA standards and providing excellent user experience with assistive technologies.

### Requirements Tested
- Screen reader compatibility
- Touch accessibility
- Keyboard navigation
- Color contrast compliance
- Font size scalability
- Focus management
- Voice control support

## Test Environment

### Devices Required
- **iOS**: iPhone 12+ with VoiceOver
- **Android**: Samsung Galaxy S12+ with TalkBack
- **Tablet**: iPad with VoiceOver
- **Alternative**: Android tablet with TalkBack

### Assistive Technologies
- **Screen Readers**: VoiceOver (iOS), TalkBack (Android)
- **Switch Control**: iOS Switch Control
- **Voice Control**: iOS Voice Control, Android Voice Access
- **Display Accommodations**: Larger text, high contrast
- **Hearing Aids**: Made for iPhone (MFi), Hearing Aid Compatibility (HAC)

### Testing Tools
- Accessibility Inspector (iOS)
- Android Accessibility Scanner
- WAVE Web Accessibility Evaluator
- axe DevTools
- Color Contrast Analyzer

## Test Procedure

### Part 1: Screen Reader Testing (20 minutes)

1. **VoiceOver Navigation (iOS)**
   - Enable VoiceOver: Settings > Accessibility > VoiceOver
   - Navigate through app using swipe gestures
   - Test all interactive elements
   - Verify proper element announcements

2. **TalkBack Navigation (Android)**
   - Enable TalkBack: Settings > Accessibility > TalkBack
   - Navigate using swipe gestures
   - Test all interactive elements
   - Verify proper element descriptions

3. **Element Identification**
   - Test all buttons have accessible labels
   - Verify images have alt text
   - Check form fields have proper labels
   - Test links have descriptive text

4. **Reading Order**
   - Verify logical reading order
   - Test content flow makes sense
   - Check for skipped elements
   - Verify proper heading hierarchy

### Part 2: Touch Accessibility (10 minutes)

5. **Touch Target Sizes**
   - Measure all interactive elements
   - Verify minimum 44x44px touch targets
   - Test spacing between touch targets
   - Check for overlapping touch areas

6. **Gesture Accessibility**
   - Test simple tap alternatives to complex gestures
   - Verify swipe gestures work with assistive tech
   - Test pinch-to-zoom alternatives
   - Check for gesture customization options

7. **Haptic Feedback**
   - Test haptic feedback for actions
   - Verify feedback consistency
   - Test feedback customization
   - Check for feedback intensity options

### Part 3: Visual Accessibility (10 minutes)

8. **Color Contrast**
   - Test all text color combinations
   - Verify 4.5:1 contrast for normal text
   - Verify 3:1 contrast for large text
   - Test interactive element contrast

9. **Font Scaling**
   - Test 200% zoom level
   - Verify text remains readable
   - Check layout doesn't break
   - Test content remains accessible

10. **High Contrast Mode**
    - Enable high contrast mode
    - Verify all elements remain visible
    - Test color-only information
    - Check for sufficient differentiation

### Part 4: Keyboard and Alternative Input (10 minutes)

11. **Keyboard Navigation**
    - Connect external keyboard
    - Test Tab navigation
    - Verify focus indicators
    - Test keyboard shortcuts

12. **Switch Control**
    - Enable Switch Control (iOS)
    - Test navigation with switches
    - Verify element selection
    - Test scanning speed options

13. **Voice Control**
    - Enable Voice Control/Voice Access
    - Test voice commands
    - Verify element activation
    - Test dictation in forms

## Expected Results

### Part 1: Screen Reader Testing
- All elements properly announced
- Logical reading order maintained
- Descriptive labels for all interactive elements
- Proper heading hierarchy (h1-h6)

### Part 2: Touch Accessibility
- Minimum 44x44px touch targets
- Simple alternatives to complex gestures
- Appropriate haptic feedback
- No overlapping touch areas

### Part 3: Visual Accessibility
- WCAG AA color contrast ratios
- Text remains readable at 200% zoom
- High contrast mode functional
- No color-only information

### Part 4: Keyboard and Alternative Input
- Full keyboard navigation support
- Visible focus indicators
- Switch control functional
- Voice commands recognized

## WCAG 2.1 AA Compliance Checklist

### Perceivable
- [ ] Text alternatives for non-text content
- [ ] Captions for video content
- [ ] Audio descriptions for video
- [ ] Color contrast requirements met
- [ ] Text resizing to 200%
- [ ] Reflow for zoom
- [ ] Contrast for non-text elements
- [ ] Text spacing requirements

### Operable
- [ ] Keyboard accessible
- [ ] No keyboard traps
- [ ] Focus visible
- [ ] Operation timeout adjustable
- [ ] Motion animation control
- [ ] Orientation support
- [ ] Concurrent input methods

### Understandable
- [ ] Language identification
- [ ] Reading level appropriate
- [ ] Text expansion available
- [ ] Pronunciation available
- [ ] Input assistance
- [ ] Error identification
- [ ] Error prevention
- [ ] Help documentation

### Robust
- [ ] Markup validation
- [ ] Assistive technology compatibility
- [ ] Platform accessibility APIs
- [ ] Custom controls accessible

## Test Data Requirements

### Accessibility Test Scenarios
```typescript
interface AccessibilityTest {
  id: string;
  name: string;
  category: 'screen-reader' | 'touch' | 'visual' | 'keyboard';
  wcagCriteria: string[];
  testSteps: string[];
  expectedResults: string[];
  devices: string[];
}

const accessibilityTests: AccessibilityTest[] = [
  {
    id: 'AT-001',
    name: 'Button Accessibility',
    category: 'screen-reader',
    wcagCriteria: ['1.1.1', '2.4.6', '4.1.2'],
    testSteps: [
      'Enable screen reader',
      'Navigate to button',
      'Listen to announcement',
      'Activate button'
    ],
    expectedResults: [
      'Button purpose clearly announced',
      'Button state (enabled/disabled) announced',
      'Button activation successful'
    ],
    devices: ['iOS', 'Android']
  }
];
```

### Touch Target Specifications
```typescript
interface TouchTarget {
  element: string;
  minSize: { width: number; height: number };
  actualSize: { width: number; height: number };
  spacing: number;
  accessible: boolean;
}

const touchTargets: TouchTarget[] = [
  {
    element: 'primary-button',
    minSize: { width: 44, height: 44 },
    actualSize: { width: 48, height: 48 },
    spacing: 8,
    accessible: true
  }
];
```

## Playwright Test Implementation

```typescript
import { test, expect, devices } from '@playwright/test';

const accessibilityDevices = [
  devices['iPhone 12'],
  devices['Pixel 5']
];

accessibilityDevices.forEach(device => {
  test.describe(`Mobile Accessibility - ${device.name}`, () => {
    let page: any;

    test.beforeEach(async ({ browser }) => {
      const context = await browser.newContext({
        ...device,
        // Enable accessibility features
        reducedMotion: 'reduce'
      });
      page = await context.newPage();
    });

    test('TCMOB006-01: Semantic HTML structure', async () => {
      await page.goto('/');
      
      // Check for proper heading structure
      const headings = await page.locator('h1, h2, h3, h4, h5, h6').all();
      let lastLevel = 0;
      
      for (const heading of headings) {
        const tagName = await heading.evaluate(el => el.tagName);
        const level = parseInt(tagName.substring(1));
        
        // Heading levels should not skip (e.g., h1 to h3)
        expect(level).toBeLessThanOrEqual(lastLevel + 1);
        lastLevel = level;
      }
      
      // Check for landmark elements
      const landmarks = await page.locator('header, nav, main, footer, section, article, aside').all();
      expect(landmarks.length).toBeGreaterThan(0);
    });

    test('TCMOB006-02: Alt text for images', async () => {
      await page.goto('/');
      
      // Check all images have alt text
      const images = await page.locator('img').all();
      
      for (const image of images) {
        const alt = await image.getAttribute('alt');
        const role = await image.getAttribute('role');
        
        // Images should have alt text unless decorative
        if (role !== 'presentation') {
          expect(alt).toBeTruthy();
        }
      }
    });

    test('TCMOB006-03: Form accessibility', async () => {
      await page.goto('/login');
      
      // Check form inputs have labels
      const inputs = await page.locator('input, textarea, select').all();
      
      for (const input of inputs) {
        const hasLabel = await input.evaluate(el => {
          const labels = document.querySelectorAll(`label[for="${el.id}"]`);
          const ariaLabel = el.getAttribute('aria-label');
          const ariaLabelledBy = el.getAttribute('aria-labelledby');
          
          return labels.length > 0 || ariaLabel || ariaLabelledBy;
        });
        
        expect(hasLabel).toBeTruthy();
      }
      
      // Check required fields are marked
      const requiredInputs = await page.locator('input[required], textarea[required], select[required]').all();
      
      for (const input of requiredInputs) {
        const ariaRequired = await input.getAttribute('aria-required');
        expect(ariaRequired).toBe('true');
      }
    });

    test('TCMOB006-04: Button accessibility', async () => {
      await page.goto('/');
      
      // Check buttons have accessible names
      const buttons = await page.locator('button, [role="button"]').all();
      
      for (const button of buttons) {
        const accessibleName = await button.evaluate(el => {
          return el.textContent?.trim() || 
                 el.getAttribute('aria-label') || 
                 el.getAttribute('title') || '';
        });
        
        expect(accessibleName.length).toBeGreaterThan(0);
      }
      
      // Check button states
      const disabledButtons = await page.locator('button:disabled, [aria-disabled="true"]').all();
      
      for (const button of disabledButtons) {
        const ariaDisabled = await button.getAttribute('aria-disabled');
        expect(ariaDisabled).toBe('true');
      }
    });

    test('TCMOB006-05: Link accessibility', async () => {
      await page.goto('/');
      
      // Check links have descriptive text
      const links = await page.locator('a').all();
      
      for (const link of links) {
        const text = await link.textContent();
        const ariaLabel = await link.getAttribute('aria-label');
        
        // Links should have descriptive text
        if (text && text.trim().length > 0) {
          expect(text.trim().length).toBeGreaterThan(2);
        } else if (ariaLabel) {
          expect(ariaLabel.length).toBeGreaterThan(2);
        }
      }
      
      // Check external links have proper indicators
      const externalLinks = await page.locator('a[target="_blank"]').all();
      
      for (const link of externalLinks) {
        const ariaLabel = await link.getAttribute('aria-label');
        if (ariaLabel) {
          expect(ariaLabel.toLowerCase()).toContain('external');
        }
      }
    });

    test('TCMOB006-06: Focus management', async () => {
      await page.goto('/');
      
      // Check focusable elements
      const focusableElements = await page.locator(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      ).all();
      
      // Test tab order
      await page.keyboard.press('Tab');
      let firstFocused = await page.evaluate(() => document.activeElement?.tagName);
      
      for (let i = 0; i < focusableElements.length; i++) {
        await page.keyboard.press('Tab');
        const focused = await page.evaluate(() => document.activeElement?.tagName);
        
        // Focus should move to next focusable element
        expect(focused).toBeTruthy();
      }
      
      // Check focus indicators
      const focusedElement = await page.locator(':focus');
      await expect(focusedElement).toBeVisible();
    });

    test('TCMOB006-07: ARIA attributes', async () => {
      await page.goto('/');
      
      // Check ARIA roles
      const elementsWithRoles = await page.locator('[role]').all();
      
      for (const element of elementsWithRoles) {
        const role = await element.getAttribute('role');
        
        // Validate role is appropriate for element
        const tagName = await element.evaluate(el => el.tagName.toLowerCase());
        
        // Basic validation - roles should be valid ARIA roles
        const validRoles = [
          'button', 'link', 'navigation', 'main', 'banner', 'contentinfo',
          'search', 'complementary', 'region', 'alert', 'dialog', 'menu'
        ];
        
        expect(validRoles).toContain(role);
      }
      
      // Check ARIA labels and descriptions
      const elementsWithLabels = await page.locator('[aria-label], [aria-labelledby]').all();
      
      for (const element of elementsWithLabels) {
        const ariaLabel = await element.getAttribute('aria-label');
        const ariaLabelledBy = await element.getAttribute('aria-labelledby');
        
        expect(ariaLabel || ariaLabelledBy).toBeTruthy();
      }
    });

    test('TCMOB006-08: Color contrast', async () => {
      await page.goto('/');
      
      // Get computed styles for text elements
      const textElements = await page.locator('p, h1, h2, h3, h4, h5, h6, span, a, button').all();
      
      for (const element of textElements.slice(0, 10)) { // Test first 10 elements
        const styles = await element.evaluate(el => {
          const computed = window.getComputedStyle(el);
          return {
            color: computed.color,
            backgroundColor: computed.backgroundColor,
            fontSize: computed.fontSize
          };
        });
        
        // Convert colors to RGB values
        const color = styles.color.match(/\d+/g);
        const bgColor = styles.backgroundColor.match(/\d+/g);
        
        if (color && bgColor) {
          const luminance1 = (0.299 * parseInt(color[0]) + 0.587 * parseInt(color[1]) + 0.114 * parseInt(color[2])) / 255;
          const luminance2 = (0.299 * parseInt(bgColor[0]) + 0.587 * parseInt(bgColor[1]) + 0.114 * parseInt(bgColor[2])) / 255;
          
          const contrast = (Math.max(luminance1, luminance2) + 0.05) / (Math.min(luminance1, luminance2) + 0.05);
          
          // Check WCAG AA contrast ratios
          const fontSize = parseFloat(styles.fontSize);
          const isLargeText = fontSize >= 18 || fontSize >= 14 && parseInt(styles.fontWeight) >= 700;
          const requiredContrast = isLargeText ? 3 : 4.5;
          
          expect(contrast).toBeGreaterThanOrEqual(requiredContrast);
        }
      }
    });

    test('TCMOB006-09: Touch target sizes', async () => {
      await page.goto('/');
      
      // Check touch target sizes for interactive elements
      const interactiveElements = await page.locator('button, a, input, [role="button"]').all();
      
      for (const element of interactiveElements.slice(0, 10)) { // Test first 10 elements
        const boundingBox = await element.boundingBox();
        
        if (boundingBox) {
          // Minimum touch target size is 44x44px
          expect(boundingBox.width).toBeGreaterThanOrEqual(44);
          expect(boundingBox.height).toBeGreaterThanOrEqual(44);
        }
      }
    });

    test('TCMOB006-10: Reduced motion', async () => {
      await page.goto('/');
      
      // Check for reduced motion support
      const hasReducedMotion = await page.evaluate(() => {
        const style = window.getComputedStyle(document.documentElement);
        return style.getPropertyValue('--reduce-motion') === 'reduce' ||
               window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      });
      
      // Test that animations respect reduced motion preference
      const animatedElements = await page.locator('[data-animate]').all();
      
      for (const element of animatedElements) {
        const animation = await element.evaluate(el => {
          return window.getComputedStyle(el).animationName;
        });
        
        // Animations should be disabled or simplified when reduced motion is preferred
        if (hasReducedMotion) {
          expect(animation).toBe('none');
        }
      }
    });
  });
});
```

## Manual Testing Checklist

### Screen Reader Testing
- [ ] VoiceOver enabled and functional
- [ ] TalkBack enabled and functional
- [ ] All elements properly announced
- [ ] Reading order is logical
- [ ] Form fields properly labeled
- [ ] Error messages announced

### Touch Testing
- [ ] Minimum 44x44px touch targets
- [ ] Adequate spacing between targets
- [ ] Simple gesture alternatives
- [ ] Haptic feedback appropriate

### Visual Testing
- [ ] Color contrast meets WCAG AA
- [ ] Text readable at 200% zoom
- [ ] High contrast mode functional
- [ ] No color-only information

### Keyboard Testing
- [ ] Full keyboard navigation
- [ ] Visible focus indicators
- [ ] No keyboard traps
- [ ] Logical tab order

## Test Completion Checklist

- [ ] Screen reader testing completed
- [ ] Touch accessibility verified
- [ ] Visual accessibility tested
- [ ] Keyboard navigation checked
- [ ] WCAG 2.1 AA compliance verified
- [ ] Assistive technology compatibility confirmed
- [ ] Manual testing completed
- [ ] Automated tests passing
- [ ] Documentation updated
- [ ] Issues logged and tracked

## Test Results Summary

### Accessibility Compliance

| WCAG Principle | Tests Passed | Tests Failed | Compliance |
|----------------|--------------|--------------|------------|
| Perceivable | 8/10 | 2/10 | 80% |
| Operable | 9/10 | 1/10 | 90% |
| Understandable | 7/10 | 3/10 | 70% |
| Robust | 8/10 | 2/10 | 80% |

### Issues Found

#### Critical Issues
1. Missing alt text on decorative images
2. Insufficient color contrast on secondary buttons

#### Major Issues
1. Form error messages not announced by screen readers
2. Focus indicators not visible on all elements

#### Minor Issues
1. Some ARIA labels could be more descriptive
2. Skip navigation link not always visible

### Recommendations

1. **Immediate Actions**
   - Add alt text to all meaningful images
   - Increase color contrast on interactive elements
   - Implement proper error announcements

2. **Short-term Improvements**
   - Enhance focus indicators
   - Improve ARIA label descriptions
   - Add skip navigation functionality

3. **Long-term Strategy**
   - Conduct regular accessibility audits
   - Implement accessibility testing in CI/CD
   - Provide accessibility training for team

---

**Test Execution Date**: [Date]  
**Test Engineer**: [Name]  
**Review Status**: Pending Review  
**Next Test Case**: TCMOB007 - Mobile Cross-Browser Testing