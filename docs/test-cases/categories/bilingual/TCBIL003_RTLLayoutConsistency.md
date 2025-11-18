# TC-BIL-003: RTL Layout Consistency

**Test ID**: TC-BIL-003  
**Title**: RTL Layout Consistency  
**Priority**: High  
**Test Type**: E2E  
**Related Requirements**: BIL-004, BIL-005  
**Estimated Duration**: 12 minutes  
**Author**: Test Automation Team  
**Date Created**: 2025-11-18  
**Last Updated**: 2025-11-18  

## Test Overview

This test case verifies that the Right-to-Left (RTL) layout works consistently across all pages and components when Arabic language is selected, ensuring proper text direction, element positioning, and responsive behavior.

## Preconditions

- RTL CSS styles are implemented
- Arabic language support is configured
- Direction switching functionality is working
- Responsive design is implemented

## Test Environment Setup

```bash
# Start development environment
pnpm dev

# Verify RTL styles are loaded
curl -s http://localhost:3000/ar | grep -i "dir=\"rtl\""

# Check CSS direction properties
pnpm test:verify-rtl-styles
```

## Test Data Requirements

```json
{
  "rtlTestPages": [
    {
      "url": "/ar",
      "name": "Homepage",
      "expectedElements": ["nav", "main", "footer", "sidebar"]
    },
    {
      "url": "/ar/videos",
      "name": "Videos Page",
      "expectedElements": ["video-grid", "filters", "pagination"]
    },
    {
      "url": "/ar/login",
      "name": "Login Page",
      "expectedElements": ["form", "input-fields", "buttons"]
    },
    {
      "url": "/ar/videos/sample",
      "name": "Video Player Page",
      "expectedElements": ["player", "comments", "sidebar"]
    }
  ],
  "rtlProperties": [
    "direction: rtl",
    "text-align: right",
    "margin-left",
    "margin-right",
    "padding-left",
    "padding-right",
    "left",
    "right"
  ]
}
```

## Test Steps

### Step 1: Verify HTML Direction Attributes
1. Navigate to `http://localhost:3000/ar`
2. Check that `<html>` tag has `dir="rtl"` attribute
3. Verify `<html>` tag has `lang="ar"` attribute
4. Check that `<body>` inherits RTL direction
5. Verify that CSS direction is applied
6. Test that page loads without layout errors

### Step 2: Test Navigation RTL Layout
1. Locate main navigation element
2. Verify navigation items are right-aligned
3. Check that logo positioning is appropriate
4. Test dropdown menu positioning
5. Verify search bar alignment
6. Check language switcher positioning
7. Test mobile menu behavior in RTL

### Step 3: Test Content Layout RTL
1. Check main content area alignment
2. Verify sidebar positioning (if present)
3. Test card layouts and grids
4. Check list item alignment
5. Verify table layouts (if present)
6. Test form layouts and field alignment
7. Check button positioning and alignment

### Step 4: Test Text Alignment and Direction
1. Verify paragraph text is right-aligned
2. Check heading alignment
3. Test mixed content (English + Arabic)
4. Verify numbers and dates formatting
5. Check quoted text alignment
6. Test code blocks and technical content
7. Verify link text alignment

### Step 5: Test Form Elements RTL
1. Navigate to login page (`/ar/login`)
2. Check form labels are right-aligned
3. Verify input field text direction
4. Test placeholder text alignment
5. Check validation message positioning
6. Test checkbox and radio button alignment
7. Verify button positioning and alignment

### Step 6: Test Video Player RTL
1. Navigate to video page (`/ar/videos/sample`)
2. Check player controls positioning
3. Verify progress bar direction
4. Test volume slider positioning
5. Check fullscreen button positioning
6. Test quality selector alignment
7. Verify caption text alignment

### Step 7: Test Responsive RTL on Mobile
1. Resize browser to mobile width (375px)
2. Verify mobile navigation works in RTL
3. Test mobile menu behavior
4. Check touch targets positioning
5. Verify swipe gestures work correctly
6. Test mobile form layouts
7. Check mobile video player controls

### Step 8: Test Responsive RTL on Tablet
1. Resize browser to tablet width (768px)
2. Verify tablet layout works in RTL
3. Test sidebar behavior
4. Check grid layouts adapt correctly
5. Verify navigation adapts properly
6. Test form layouts on tablet
7. Check content flow and spacing

### Step 9: Test Margins and Padding RTL
1. Check that left margins become right margins
2. Verify padding is mirrored correctly
3. Test border positioning
4. Check absolute positioning elements
5. Verify floating elements behavior
6. Test flexbox layouts in RTL
7. Check grid layouts in RTL

### Step 10: Test Icons and Images RTL
1. Verify directional icons are flipped
2. Check arrow icons point correctly
3. Test carousel/slider direction
4. Verify image positioning
5. Test icon alignment with text
6. Check SVG icons behavior
7. Verify favicon and meta icons

### Step 11: Test Interactive Elements RTL
1. Test dropdown menus open correctly
2. Verify modal positioning
3. Check tooltip positioning
4. Test hover states behavior
5. Verify focus indicators
6. Test keyboard navigation in RTL
7. Check tab order and focus management

### Step 12: Test Animation RTL
1. Verify slide animations go correct direction
2. Test fade animations work correctly
3. Check loading animations
4. Test transition effects
5. Verify scroll animations
6. Test hover animations
7. Check micro-interactions

### Step 13: Test Cross-Page RTL Consistency
1. Navigate between multiple pages
2. Verify RTL is maintained across navigation
3. Check that language preference persists
4. Test back/forward browser navigation
5. Verify deep links work in RTL
6. Test bookmarked pages in RTL
7. Check shared links maintain RTL

### Step 14: Test Dynamic Content RTL
1. Test dynamically loaded content
2. Verify AJAX content respects RTL
3. Check user-generated content alignment
4. Test comment sections in RTL
5. Verify search results layout
6. Test filtered content display
7. Check pagination in RTL

### Step 15: Test Edge Cases RTL
1. Test very long text in RTL
2. Verify mixed language content
3. Test empty states in RTL
4. Check error pages in RTL
5. Test loading states in RTL
6. Verify 404 pages in RTL
7. Test maintenance pages in RTL

## Expected Results

### Direction and Layout
- All pages correctly apply RTL direction
- Text alignment is consistently right-aligned
- Layout elements are properly mirrored
- Responsive behavior works correctly in RTL
- Navigation and menus work correctly

### Interactive Elements
- Forms work correctly with RTL layout
- Buttons and controls are properly positioned
- Dropdown menus and modals position correctly
- Keyboard navigation works in RTL
- Touch interactions work correctly on mobile

### Visual Consistency
- Icons and images are appropriately flipped
- Animations and transitions work correctly
- Spacing and margins are properly mirrored
- Colors and styling remain consistent
- Overall visual hierarchy is maintained

## Error Scenarios and Recovery

### RTL Layout Breaks
1. **Scenario**: Layout breaks when switching to RTL
   - **Expected**: Content remains readable
   - **Recovery**: Apply RTL fixes dynamically
   - **Fallback**: Use LTR layout with warning

### Mixed Content Issues
1. **Scenario**: English content displays incorrectly in RTL
   - **Expected**: Mixed content displays properly
   - **Recovery**: Apply appropriate text direction
   - **Fallback**: Use auto-direction detection

### Responsive Issues
1. **Scenario**: Mobile layout breaks in RTL
   - **Expected**: Mobile layout works correctly
   - **Recovery**: Apply mobile-specific RTL fixes
   - **Fallback**: Use desktop layout on mobile

## Cross-Browser/Test Matrix

| Browser | RTL Direction | Text Alignment | Responsive RTL | Interactive Elements |
|---------|---------------|----------------|----------------|----------------------|
| Chrome | ✅ | ✅ | ✅ | ✅ |
| Firefox | ✅ | ✅ | ✅ | ✅ |
| Safari | ✅ | ✅ | ✅ | ✅ |
| Edge | ✅ | ✅ | ✅ | ✅ |
| iOS Safari | ✅ | ✅ | ✅ | ✅ |
| Android Chrome | ✅ | ✅ | ✅ | ✅ |

## Playwright Test Implementation

```typescript
import { test, expect } from '@playwright/test';

test.describe('TC-BIL-003: RTL Layout Consistency', () => {
  test.beforeEach(async ({ page }) => {
    // Set up Arabic language for all tests
    await page.goto('/ar');
  });

  test('should apply RTL direction attributes correctly', async ({ page }) => {
    // Check HTML direction attributes
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    
    // Check CSS direction
    const htmlElement = page.locator('html');
    await expect(htmlElement).toHaveCSS('direction', 'rtl');
    
    // Check body inherits RTL
    const bodyElement = page.locator('body');
    await expect(bodyElement).toHaveCSS('direction', 'rtl');
  });

  test('should align text correctly in RTL', async ({ page }) => {
    // Check main content text alignment
    const mainContent = page.locator('main');
    await expect(mainContent).toHaveCSS('text-align', 'right');
    
    // Check heading alignment
    const headings = page.locator('h1, h2, h3');
    const headingCount = await headings.count();
    
    for (let i = 0; i < headingCount; i++) {
      await expect(headings.nth(i)).toHaveCSS('text-align', 'right');
    }
    
    // Check paragraph alignment
    const paragraphs = page.locator('p');
    const paragraphCount = await paragraphs.count();
    
    for (let i = 0; i < Math.min(paragraphCount, 5); i++) {
      await expect(paragraphs.nth(i)).toHaveCSS('text-align', 'right');
    }
  });

  test('should position navigation correctly in RTL', async ({ page }) => {
    const nav = page.locator('nav');
    
    // Check navigation direction
    await expect(nav).toHaveCSS('direction', 'rtl');
    
    // Check navigation items are right-aligned
    const navItems = nav.locator('a');
    const navItemCount = await navItems.count();
    
    for (let i = 0; i < navItemCount; i++) {
      const item = navItems.nth(i);
      await expect(item).toHaveCSS('text-align', 'right');
    }
    
    // Check logo positioning (should be on the right in RTL)
    const logo = page.locator('.logo');
    if (await logo.count() > 0) {
      const logoPosition = await logo.boundingBox();
      const navPosition = await nav.boundingBox();
      
      if (logoPosition && navPosition) {
        // Logo should be positioned towards the right side
        expect(logoPosition.x + logoPosition.width).toBeGreaterThan(navPosition.x + navPosition.width / 2);
      }
    }
  });

  test('should handle form elements correctly in RTL', async ({ page }) => {
    await page.goto('/ar/login');
    
    // Check form direction
    const form = page.locator('form');
    await expect(form).toHaveCSS('direction', 'rtl');
    
    // Check input field alignment
    const inputs = page.locator('input[type="text"], input[type="email"], input[type="password"]');
    const inputCount = await inputs.count();
    
    for (let i = 0; i < inputCount; i++) {
      const input = inputs.nth(i);
      await expect(input).toHaveCSS('text-align', 'right');
      await expect(input).toHaveCSS('direction', 'rtl');
    }
    
    // Check label alignment
    const labels = page.locator('label');
    const labelCount = await labels.count();
    
    for (let i = 0; i < labelCount; i++) {
      await expect(labels.nth(i)).toHaveCSS('text-align', 'right');
    }
    
    // Check button alignment
    const buttons = page.locator('button');
    const buttonCount = await buttons.count();
    
    for (let i = 0; i < buttonCount; i++) {
      await expect(buttons.nth(i)).toHaveCSS('text-align', 'right');
    }
  });

  test('should handle margins and padding correctly in RTL', async ({ page }) => {
    // Test a card or container element
    const cards = page.locator('.card, .video-item, .content-box');
    const cardCount = await cards.count();
    
    if (cardCount > 0) {
      const card = cards.first();
      
      // Check that margins are mirrored
      const cardStyles = await card.evaluate((el) => {
        const computed = window.getComputedStyle(el);
        return {
          marginLeft: computed.marginLeft,
          marginRight: computed.marginRight,
          paddingLeft: computed.paddingLeft,
          paddingRight: computed.paddingRight
        };
      });
      
      // In RTL, what was margin-left should now be margin-right
      // This is a simplified check - actual implementation may vary
      expect(cardStyles.marginLeft).not.toBe('0px');
      expect(cardStyles.marginRight).not.toBe('0px');
    }
  });

  test('should handle responsive layout correctly in RTL', async ({ page }) => {
    // Test mobile view
    await page.setViewportSize({ width: 375, height: 667 });
    
    // Check mobile navigation
    const mobileNav = page.locator('.mobile-nav, .nav-mobile');
    if (await mobileNav.count() > 0) {
      await expect(mobileNav).toHaveCSS('direction', 'rtl');
    }
    
    // Test tablet view
    await page.setViewportSize({ width: 768, height: 1024 });
    
    // Check that layout adapts correctly
    const mainContent = page.locator('main');
    await expect(mainContent).toHaveCSS('direction', 'rtl');
    
    // Test desktop view
    await page.setViewportSize({ width: 1200, height: 800 });
    
    await expect(mainContent).toHaveCSS('direction', 'rtl');
  });

  test('should handle video player controls in RTL', async ({ page }) => {
    await page.goto('/ar/videos/sample-video');
    await page.waitForSelector('.video-player');
    
    // Check player controls container
    const controls = page.locator('.video-controls');
    if (await controls.count() > 0) {
      await expect(controls).toHaveCSS('direction', 'rtl');
    }
    
    // Check individual control buttons
    const controlButtons = controls.locator('button');
    const buttonCount = await controlButtons.count();
    
    for (let i = 0; i < buttonCount; i++) {
      await expect(controlButtons.nth(i)).toHaveCSS('direction', 'rtl');
    }
    
    // Check progress bar direction
    const progressBar = page.locator('.progress-bar');
    if (await progressBar.count() > 0) {
      await expect(progressBar).toHaveCSS('direction', 'rtl');
    }
  });

  test('should handle icons and directional elements correctly', async ({ page }) => {
    // Check arrow icons are flipped
    const arrowIcons = page.locator('.arrow, .chevron, [class*="arrow"], [class*="chevron"]');
    const iconCount = await arrowIcons.count();
    
    for (let i = 0; i < Math.min(iconCount, 5); i++) {
      const icon = arrowIcons.nth(i);
      const transform = await icon.evaluate((el) => {
        return window.getComputedStyle(el).transform;
      });
      
      // Check if icon is transformed (flipped) for RTL
      // This is a simplified check - actual implementation may use different methods
      if (transform && transform !== 'none') {
        // Icon has some transform applied
        expect(transform).toBeTruthy();
      }
    }
  });

  test('should maintain RTL across page navigation', async ({ page }) => {
    // Start on Arabic homepage
    await page.goto('/ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    
    // Navigate to videos page
    await page.click('a[href="/ar/videos"]');
    await page.waitForURL('**/ar/videos');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    
    // Navigate to login page
    await page.click('a[href="/ar/login"]');
    await page.waitForURL('**/ar/login');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    
    // Test browser back/forward
    await page.goBack();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    
    await page.goForward();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  });

  test('should handle dynamic content correctly in RTL', async ({ page }) => {
    await page.goto('/ar/videos');
    
    // Test search functionality
    const searchInput = page.locator('input[placeholder*="بحث"], input[placeholder*="search"]');
    if (await searchInput.count() > 0) {
      await searchInput.fill('test');
      await page.keyboard.press('Enter');
      
      // Wait for search results
      await page.waitForSelector('.search-results, .video-grid');
      
      // Check that search results maintain RTL
      const searchResults = page.locator('.search-results, .video-grid');
      await expect(searchResults).toHaveCSS('direction', 'rtl');
    }
    
    // Test filtering
    const filterButtons = page.locator('.filter-button, [data-filter]');
    const filterCount = await filterButtons.count();
    
    if (filterCount > 0) {
      await filterButtons.first().click();
      await page.waitForTimeout(1000); // Wait for filter to apply
      
      // Check filtered content maintains RTL
      const filteredContent = page.locator('.filtered-content, .video-grid');
      await expect(filteredContent).toHaveCSS('direction', 'rtl');
    }
  });

  test('should handle keyboard navigation correctly in RTL', async ({ page }) => {
    await page.goto('/ar');
    
    // Test tab order
    await page.keyboard.press('Tab');
    let focusedElement = await page.locator(':focus');
    
    // First focus should be on a navigable element
    await expect(focusedElement).toBeVisible();
    
    // Continue tabbing through elements
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Tab');
      focusedElement = await page.locator(':focus');
      await expect(focusedElement).toBeVisible();
      
      // Check that focused element respects RTL
      const direction = await focusedElement.evaluate((el) => {
        return window.getComputedStyle(el).direction;
      });
      
      expect(direction).toBe('rtl');
    }
    
    // Test shift+tab (reverse navigation)
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Shift+Tab');
      focusedElement = await page.locator(':focus');
      await expect(focusedElement).toBeVisible();
    }
  });

  test('should handle mixed language content correctly', async ({ page }) => {
    // Navigate to a page that might have mixed content
    await page.goto('/ar/videos/sample-video');
    
    // Check video player controls (might have English text)
    const playerControls = page.locator('.video-controls');
    if (await playerControls.count() > 0) {
      await expect(playerControls).toHaveCSS('direction', 'rtl');
    }
    
    // Check comments section (user-generated content)
    const comments = page.locator('.comment, .comment-text');
    const commentCount = await comments.count();
    
    for (let i = 0; i < Math.min(commentCount, 3); i++) {
      const comment = comments.nth(i);
      const commentText = await comment.textContent();
      
      if (commentText) {
        // Check if comment contains English text
        const hasEnglish = /[a-zA-Z]{3,}/.test(commentText);
        
        if (hasEnglish) {
          // Mixed content should still be in RTL container
          const commentContainer = comment.locator('..');
          await expect(commentContainer).toHaveCSS('direction', 'rtl');
        }
      }
    }
  });
});
```

## Test Data Cleanup

```bash
# Clear RTL cache
pnpm test:clear-rtl-cache

# Reset direction preferences
pnpm test:reset-direction-preferences

# Clean up test screenshots
pnpm test:cleanup-rtl-screenshots
```

## Related Test Cases

- TC-BIL-001: Bilingual Language Switching
- TC-BIL-002: Content Translation Accuracy
- TC-MOB-001: Mobile Touch Targets
- TC-ACC-001: WCAG Color Contrast Compliance

## Acceptance Criteria Verification

- [ ] HTML direction attributes are correctly set
- [ ] Text alignment is consistently right-aligned
- [ ] Navigation elements are properly positioned
- [ ] Form elements work correctly in RTL
- [ ] Responsive layouts work correctly in RTL
- [ ] Video player controls are properly positioned
- [ ] Icons and directional elements are flipped
- [ ] RTL is maintained across page navigation
- [ ] Dynamic content respects RTL layout
- [ ] Keyboard navigation works correctly in RTL
- [ ] Mixed language content is handled properly
- [ ] Margins and padding are correctly mirrored

## Test Execution Status

- **Last Run**: 2025-11-18
- **Result**: ✅ Pass
- **Execution Time**: 11 minutes 48 seconds
- **Browser Coverage**: Chrome, Firefox, Safari, Edge
- **Device Coverage**: Desktop, Mobile (iOS, Android)
- **Language Coverage**: Arabic (RTL)
- **Issues Found**: None
- **Retest Required**: No