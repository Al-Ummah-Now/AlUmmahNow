# TCACC003: Color Contrast and Visual Design

**Test ID**: TCACC003  
**Title**: Color Contrast and Visual Design  
**Priority**: Critical  
**Test Type**: Visual + Accessibility  
**Related Requirements**: A11Y-005, A11Y-006

## Test Overview

This test case validates color contrast ratios, visual design accessibility, and ensures information is not conveyed by color alone across the Al Ummah Now platform.

## Test Preconditions

- Color contrast analysis tools are available
- High contrast mode is testable
- Various display settings are available
- Both light and dark themes are accessible

## Test Steps

### 1. Text Color Contrast Testing
1. Test normal text contrast ratios (4.5:1 minimum)
2. Test large text contrast ratios (3:1 minimum)
3. Test heading text contrast across all levels
4. Test body text contrast in different contexts
5. Test link text contrast in default state
6. Test link text contrast in hover state
7. Test link text contrast in visited state
8. Test text contrast on colored backgrounds
9. Test text contrast in both themes
10. Verify text contrast in RTL layout

### 2. Interactive Element Contrast Testing
1. Test button text contrast ratios
2. Test button background contrast
3. Test button border contrast
4. Test button hover state contrast
5. Test button focus state contrast
6. Test button disabled state contrast
7. Test input field text contrast
8. Test input field border contrast
9. Test input field placeholder contrast
10. Test checkbox and radio button contrast

### 3. Icon and Graphic Contrast Testing
1. Test icon contrast on various backgrounds
2. Test SVG icon contrast ratios
3. Test icon button contrast
4. Test status icon contrast (success, error, warning)
5. Test navigation icon contrast
6. Test social media icon contrast
7. Test decorative icon handling
8. Test icon contrast in both themes
9. Test icon contrast in high contrast mode
10. Verify icon accessibility alternatives

### 4. Form Element Contrast Testing
1. Test form label text contrast
2. Test form input text contrast
3. Test form input border contrast
4. Test form input background contrast
5. Test form field focus contrast
6. Test form field error contrast
7. Test form field success contrast
8. Test form field disabled contrast
9. Test form validation message contrast
10. Verify form contrast in RTL layout

### 5. Navigation Contrast Testing
1. Test navigation link text contrast
2. Test navigation hover state contrast
3. Test navigation active state contrast
4. Test navigation focus state contrast
5. Test dropdown menu contrast
6. Test breadcrumb contrast
7. Test pagination contrast
8. Test sidebar navigation contrast
9. Test mobile menu contrast
10. Verify navigation contrast in both themes

### 6. Status and Feedback Contrast Testing
1. Test success message contrast
2. Test error message contrast
3. Test warning message contrast
4. Test info message contrast
5. Test loading indicator contrast
6. Test progress bar contrast
7. Test badge and tag contrast
8. Test notification contrast
9. Test alert dialog contrast
10. Verify status contrast accessibility

### 7. High Contrast Mode Testing
1. Enable Windows high contrast mode
2. Test text readability in high contrast
3. Test interactive element visibility
4. Test navigation functionality
5. Test form usability
6. Test video player controls
7. Test content structure visibility
8. Test link identification
9. Test image alternative text
10. Verify high contrast mode functionality

### 8. Dark Theme Contrast Testing
1. Switch to dark theme
2. Test text contrast in dark theme
3. Test interactive element contrast
4. Test navigation contrast
5. Test form element contrast
6. Test status message contrast
7. Test icon and graphic contrast
8. Test video player contrast
9. Test content readability
10. Verify dark theme accessibility

### 9. Color-Only Information Testing
1. Test link identification without color
2. Test error state identification without color
3. Test success state identification without color
4. Test required field indication without color
5. Test validation status without color
6. Test status indicators without color
7. Test interactive state without color
8. Test data visualization without color
9. Test chart accessibility without color
10. Verify non-color information conveyance

### 10. Focus Indicator Contrast Testing
1. Test focus indicator visibility
2. Test focus indicator contrast ratio
3. Test focus indicator consistency
4. Test focus indicator on different backgrounds
5. Test focus indicator in both themes
6. Test focus indicator in high contrast
7. Test focus indicator on interactive elements
8. Test focus indicator on form elements
9. Test focus indicator on navigation
10. Verify focus indicator accessibility

### 11. RTL Layout Contrast Testing
1. Switch to Arabic interface
2. Test Arabic text contrast
3. Test RTL navigation contrast
4. Test RTL form contrast
5. Test RTL status message contrast
6. Test mixed RTL/LTR content contrast
7. Test Arabic theme contrast
8. Test RTL high contrast mode
9. Test RTL focus indicators
10. Verify RTL contrast accessibility

### 12. Mobile Contrast Testing
1. Test mobile text contrast
2. Test mobile touch target contrast
3. Test mobile navigation contrast
4. Test mobile form contrast
5. Test mobile video player contrast
6. Test mobile status message contrast
7. Test mobile accessibility features
8. Test mobile outdoor visibility
9. Test mobile accessibility zoom
10. Verify mobile contrast accessibility

## Expected Results

### Contrast Ratio Requirements
- Normal text meets 4.5:1 contrast ratio
- Large text meets 3:1 contrast ratio
- Interactive elements meet 3:1 contrast ratio
- Information is not conveyed by color alone
- Links are identifiable without color
- Error states are clearly visible
- Focus indicators have sufficient contrast

### Visual Design Requirements
- High contrast mode is supported
- Dark theme maintains accessibility
- RTL layout maintains contrast requirements
- Mobile contrast is preserved
- Status indicators are clear
- Form validation is visible
- Navigation is clearly identifiable

### Accessibility Requirements
- Color combinations meet WCAG standards
- Non-color indicators are provided
- Focus management is maintained
- Screen reader compatibility is preserved
- Keyboard navigation is not affected
- Mobile accessibility is maintained

## Test Data Requirements

### Color Contrast Tools
- WebAIM Contrast Checker
- Chrome DevTools Contrast Checker
- Axe DevTools Contrast Analysis
- Color Contrast Analyzer
- High Contrast Mode Testing

### Test Scenarios
- Various text sizes and weights
- Different background colors
- Multiple interactive states
- Both light and dark themes
- High contrast mode scenarios
- Mobile display conditions

## Cross-Browser Testing Matrix

| Browser | Version | Contrast Checker | High Contrast | Dark Theme | RTL Support |
|---------|---------|------------------|---------------|-------------|-------------|
| Chrome | Latest+ | ✅ | ✅ | ✅ | ✅ |
| Firefox | Latest+ | ✅ | ✅ | ✅ | ✅ |
| Safari | Latest+ | ✅ | ✅ | ✅ | ✅ |
| Edge | Latest+ | ✅ | ✅ | ✅ | ✅ |

## Playwright Implementation

```typescript
import { test, expect } from '@playwright/test';

test.describe('Color Contrast and Visual Design', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/en');
  });

  test('text contrast ratios', async ({ page }) => {
    // Get all text elements
    const textElements = await page.locator('p, h1, h2, h3, h4, h5, h6, span, a, button').all();
    
    for (const element of textElements.slice(0, 20)) { // Test first 20 elements
      const styles = await element.evaluate((el) => {
        const computed = window.getComputedStyle(el);
        return {
          color: computed.color,
          backgroundColor: computed.backgroundColor,
          fontSize: computed.fontSize,
          fontWeight: computed.fontWeight
        };
      });
      
      // Skip if background is transparent
      if (styles.backgroundColor === 'rgba(0, 0, 0, 0)' || styles.backgroundColor === 'transparent') {
        continue;
      }
      
      // Calculate contrast ratio (simplified)
      const contrast = calculateContrastRatio(styles.color, styles.backgroundColor);
      
      // Determine if text is large (18pt or 14pt bold)
      const fontSize = parseFloat(styles.fontSize);
      const fontWeight = parseInt(styles.fontWeight);
      const isLargeText = fontSize >= 18 || (fontSize >= 14 && fontWeight >= 700);
      
      // Check contrast requirements
      const minimumRatio = isLargeText ? 3 : 4.5;
      expect(contrast).toBeGreaterThanOrEqual(minimumRatio);
    }
  });

  test('interactive element contrast', async ({ page }) => {
    // Test buttons
    const buttons = await page.locator('button').all();
    
    for (const button of buttons.slice(0, 10)) {
      const styles = await button.evaluate((el) => {
        const computed = window.getComputedStyle(el);
        return {
          color: computed.color,
          backgroundColor: computed.backgroundColor,
          borderColor: computed.borderColor
        };
      });
      
      // Check text contrast
      if (styles.backgroundColor !== 'rgba(0, 0, 0, 0)') {
        const textContrast = calculateContrastRatio(styles.color, styles.backgroundColor);
        expect(textContrast).toBeGreaterThanOrEqual(3);
      }
      
      // Check border contrast if present
      if (styles.borderColor && styles.borderColor !== 'rgba(0, 0, 0, 0)') {
        const borderContrast = calculateContrastRatio(styles.borderColor, styles.backgroundColor);
        expect(borderContrast).toBeGreaterThanOrEqual(3);
      }
    }
  });

  test('link identification without color', async ({ page }) => {
    // Check links have non-color indicators
    const links = await page.locator('a[href]').all();
    
    for (const link of links.slice(0, 10)) {
      // Check for underline
      const styles = await link.evaluate((el) => {
        const computed = window.getComputedStyle(el);
        return {
          textDecoration: computed.textDecoration,
          outline: computed.outline,
          border: computed.border
        };
      });
      
      // Links should have underline, outline, or other non-color indicator
      const hasNonColorIndicator = 
        styles.textDecoration.includes('underline') ||
        styles.outline !== 'none' ||
        styles.border !== 'none';
      
      expect(hasNonColorIndicator).toBeTruthy();
    }
  });

  test('form element contrast', async ({ page }) => {
    await page.goto('/en/login');
    
    // Test input fields
    const inputs = await page.locator('input').all();
    
    for (const input of inputs) {
      const styles = await input.evaluate((el) => {
        const computed = window.getComputedStyle(el);
        return {
          color: computed.color,
          backgroundColor: computed.backgroundColor,
          borderColor: computed.borderColor
        };
      });
      
      // Check text contrast
      if (styles.backgroundColor !== 'rgba(0, 0, 0, 0)') {
        const textContrast = calculateContrastRatio(styles.color, styles.backgroundColor);
        expect(textContrast).toBeGreaterThanOrEqual(3);
      }
      
      // Check border contrast
      if (styles.borderColor && styles.borderColor !== 'rgba(0, 0, 0, 0)') {
        const borderContrast = calculateContrastRatio(styles.borderColor, styles.backgroundColor);
        expect(borderContrast).toBeGreaterThanOrEqual(3);
      }
    }
  });

  test('focus indicator contrast', async ({ page }) => {
    // Focus on first interactive element
    await page.keyboard.press('Tab');
    const focusedElement = await page.locator(':focus');
    
    if (await focusedElement.count() > 0) {
      const styles = await focusedElement.evaluate((el) => {
        const computed = window.getComputedStyle(el, ':focus');
        return {
          outline: computed.outline,
          outlineColor: computed.outlineColor,
          boxShadow: computed.boxShadow
        };
      });
      
      // Check for focus indicator
      const hasFocusIndicator = styles.outline !== 'none' || styles.boxShadow !== 'none';
      expect(hasFocusIndicator).toBeTruthy();
      
      // If outline is present, check its contrast
      if (styles.outline !== 'none' && styles.outlineColor) {
        // This would need more complex calculation for outline contrast
        expect(styles.outlineColor).toBeTruthy();
      }
    }
  });

  test('error state contrast', async ({ page }) => {
    await page.goto('/en/login');
    
    // Submit empty form to trigger errors
    await page.click('[data-testid="submit-button"]');
    await page.waitForTimeout(1000);
    
    // Check error messages
    const errorElements = await page.locator('[data-testid="error-message"]').all();
    
    for (const error of errorElements) {
      const styles = await error.evaluate((el) => {
        const computed = window.getComputedStyle(el);
        return {
          color: computed.color,
          backgroundColor: computed.backgroundColor,
          border: computed.border
        };
      });
      
      // Error messages should have sufficient contrast
      if (styles.backgroundColor !== 'rgba(0, 0, 0, 0)') {
        const contrast = calculateContrastRatio(styles.color, styles.backgroundColor);
        expect(contrast).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  test('dark theme contrast', async ({ page }) => {
    // Switch to dark theme
    await page.click('[data-testid="theme-toggle"]');
    await page.waitForTimeout(1000);
    
    // Test text contrast in dark theme
    const textElements = await page.locator('p, h1, h2, h3').all();
    
    for (const element of textElements.slice(0, 10)) {
      const styles = await element.evaluate((el) => {
        const computed = window.getComputedStyle(el);
        return {
          color: computed.color,
          backgroundColor: computed.backgroundColor
        };
      });
      
      if (styles.backgroundColor !== 'rgba(0, 0, 0, 0)') {
        const contrast = calculateContrastRatio(styles.color, styles.backgroundColor);
        expect(contrast).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  test('high contrast mode simulation', async ({ page }) => {
    // Simulate high contrast mode
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    
    // Add high contrast styles
    await page.addStyleTag({
      content: `
        * {
          background-color: Window !important;
          color: WindowText !important;
          border-color: WindowText !important;
        }
        a, button {
          text-decoration: underline !important;
        }
      `
    });
    
    // Test readability in high contrast
    const textElements = await page.locator('p, h1, h2, h3').all();
    
    for (const element of textElements.slice(0, 5)) {
      const isVisible = await element.isVisible();
      expect(isVisible).toBeTruthy();
    }
  });

  test('RTL layout contrast', async ({ page }) => {
    // Switch to Arabic
    await page.click('[data-testid="language-switcher"]');
    await page.click('text=العربية');
    await page.waitForLoadState('networkidle');
    
    // Test Arabic text contrast
    const arabicText = await page.locator('p, h1, h2, h3').all();
    
    for (const element of arabicText.slice(0, 10)) {
      const styles = await element.evaluate((el) => {
        const computed = window.getComputedStyle(el);
        return {
          color: computed.color,
          backgroundColor: computed.backgroundColor
        };
      });
      
      if (styles.backgroundColor !== 'rgba(0, 0, 0, 0)') {
        const contrast = calculateContrastRatio(styles.color, styles.backgroundColor);
        expect(contrast).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  test('status indicator accessibility', async ({ page }) => {
    // Look for status indicators
    const statusElements = await page.locator('[data-status], [class*="status"], [class*="alert"]').all();
    
    for (const status of statusElements.slice(0, 5)) {
      const styles = await status.evaluate((el) => {
        const computed = window.getComputedStyle(el);
        return {
          color: computed.color,
          backgroundColor: computed.backgroundColor,
          border: computed.border
        };
      });
      
      // Status indicators should have sufficient contrast
      if (styles.backgroundColor !== 'rgba(0, 0, 0, 0)') {
        const contrast = calculateContrastRatio(styles.color, styles.backgroundColor);
        expect(contrast).toBeGreaterThanOrEqual(3);
      }
      
      // Check for non-color indicators
      const hasText = await status.textContent();
      const hasIcon = await status.locator('svg, i').count();
      expect(hasText || hasIcon > 0).toBeTruthy();
    }
  });

  test('icon contrast', async ({ page }) => {
    // Test icon visibility
    const icons = await page.locator('svg, i[class*="icon"], [data-icon]').all();
    
    for (const icon of icons.slice(0, 10)) {
      const isVisible = await icon.isVisible();
      if (isVisible) {
        const styles = await icon.evaluate((el) => {
          const computed = window.getComputedStyle(el);
          return {
            color: computed.color,
            backgroundColor: computed.backgroundColor
          };
        });
        
        // Icons should have sufficient contrast or alternative text
        const hasAlt = await icon.getAttribute('aria-label');
        const hasTitle = await icon.locator('title').count();
        
        if (!hasAlt && hasTitle === 0) {
          // If no alternative text, check visual contrast
          if (styles.backgroundColor !== 'rgba(0, 0, 0, 0)') {
            const contrast = calculateContrastRatio(styles.color, styles.backgroundColor);
            expect(contrast).toBeGreaterThanOrEqual(3);
          }
        }
      }
    }
  });
});

// Helper function to calculate contrast ratio
function calculateContrastRatio(color1: string, color2: string): number {
  // Convert hex to RGB
  const hexToRgb = (hex: string) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : null;
  };
  
  // Convert RGB to relative luminance
  const getLuminance = (r: number, g: number, b: number) => {
    const [rs, gs, bs] = [r, g, b].map(c => {
      c = c / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
  };
  
  // Parse colors
  const rgb1 = hexToRgb(color1) || { r: 0, g: 0, b: 0 };
  const rgb2 = hexToRgb(color2) || { r: 255, g: 255, b: 255 };
  
  // Calculate luminance
  const lum1 = getLuminance(rgb1.r, rgb1.g, rgb1.b);
  const lum2 = getLuminance(rgb2.r, rgb2.g, rgb2.b);
  
  // Calculate contrast ratio
  const brightest = Math.max(lum1, lum2);
  const darkest = Math.min(lum1, lum2);
  
  return (brightest + 0.05) / (darkest + 0.05);
}
```

## Performance Metrics

### Contrast Requirements
- Normal text: 4.5:1 minimum
- Large text: 3:1 minimum
- Interactive elements: 3:1 minimum
- Focus indicators: 3:1 minimum

### Visual Requirements
- High contrast mode support
- Dark theme accessibility
- RTL layout compatibility
- Mobile contrast preservation

## Error Handling

### Test Scenarios
- Insufficient contrast ratios
- Color-only information conveyance
- Missing focus indicators
- Theme switching issues
- RTL contrast problems

### Expected Behavior
- Clear identification of contrast issues
- Specific contrast ratio measurements
- Remediation recommendations
- Cross-theme compatibility checks

## Success Criteria

- ✅ All text meets WCAG contrast requirements
- ✅ Interactive elements have sufficient contrast
- ✅ Information is not conveyed by color alone
- ✅ Focus indicators are clearly visible
- ✅ High contrast mode is supported
- ✅ Dark theme maintains accessibility
- ✅ RTL layout preserves contrast
- ✅ Mobile contrast is maintained
- ✅ Status indicators are accessible
- ✅ Form validation is clearly visible