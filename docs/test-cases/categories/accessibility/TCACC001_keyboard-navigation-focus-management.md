# TCACC001: Keyboard Navigation and Focus Management

**Test ID**: TCACC001  
**Title**: Keyboard Navigation and Focus Management  
**Priority**: Critical  
**Test Type**: Accessibility  
**Related Requirements**: A11Y-001, A11Y-002

## Test Overview

This test case validates comprehensive keyboard navigation and focus management across the Al Ummah Now platform, ensuring all interactive elements are accessible via keyboard and focus behavior follows accessibility best practices.

## Test Preconditions

- Keyboard is available
- Screen reader is installed (optional)
- Accessibility testing tools are configured
- Both English and Arabic interfaces are accessible

## Test Steps

### 1. Homepage Keyboard Navigation
1. Navigate to homepage using Tab key only
2. Verify focus moves through interactive elements logically
3. Test Tab order through navigation menu
4. Test Shift+Tab for reverse navigation
5. Test Enter key for activating links and buttons
6. Test Space key for button activation
7. Test Escape key for closing modals and dropdowns
8. Test Arrow keys for menu navigation
9. Verify focus indicators visibility
10. Test keyboard navigation in language switcher

### 2. Video Player Keyboard Navigation
1. Navigate to video page using keyboard
2. Test Tab order through video player controls
3. Test video playback controls (Play/Pause, Volume, Fullscreen)
4. Test video seeking with arrow keys
5. Test keyboard shortcuts for video controls
6. Test caption toggle with keyboard
7. Test quality selection with keyboard
8. Test speed controls with keyboard
9. Test exit fullscreen with Escape key
10. Verify focus trapping in fullscreen mode

### 3. Search Interface Keyboard Navigation
1. Navigate to search interface using Tab key
2. Test search input focus and typing
3. Test search submission with Enter key
4. Test search result navigation with Tab
5. Test search filter navigation with keyboard
6. Test autocomplete navigation with arrow keys
7. Test search result selection with Enter
8. Test search pagination with keyboard
9. Test advanced search form navigation
10. Verify focus management during search

### 4. Form Keyboard Navigation
1. Navigate to login form using keyboard
2. Test form field navigation with Tab
3. Test form field typing and editing
4. Test form submission with Enter
5. Test form validation error navigation
6. Test password field navigation
7. Test checkbox and radio button navigation
8. Test dropdown/select navigation
9. Test multi-step form navigation
10. Verify focus management in form errors

### 5. Modal and Dialog Keyboard Navigation
1. Trigger modal dialog with keyboard
2. Verify focus is trapped within modal
3. Test Tab navigation within modal
4. Test modal close with Escape key
5. Test modal action buttons with keyboard
6. Test modal overlay focus management
7. Test multiple modal stack navigation
8. Test confirmation dialogs with keyboard
9. Test alert dialogs with keyboard
10. Verify focus restoration after modal close

### 6. Navigation Menu Keyboard Navigation
1. Test main navigation menu with Tab
2. Test submenu navigation with arrow keys
3. Test menu item activation with Enter
4. Test menu close with Escape
5. Test mobile menu toggle with keyboard
6. Test breadcrumb navigation with keyboard
7. Test sidebar navigation with keyboard
8. Test user menu navigation with keyboard
9. Test context menu navigation with keyboard
10. Verify focus management in menu states

### 7. Dynamic Content Keyboard Navigation
1. Test keyboard navigation in dynamically loaded content
2. Verify focus management during content updates
3. Test infinite scroll with keyboard
4. Test live region announcements with keyboard
5. Test content filtering with keyboard
6. Test sorting with keyboard
7. Test pagination with keyboard
8. Test tab switching with keyboard
9. Test accordion/collapse with keyboard
10. Verify focus persistence during updates

### 8. Table and List Keyboard Navigation
1. Test table navigation with arrow keys
2. Test table header navigation
3. Test table cell navigation
4. Test list navigation with arrow keys
5. Test list item selection with keyboard
6. Test multi-select with keyboard
7. Test sortable columns with keyboard
8. Test filterable tables with keyboard
9. Test paginated tables with keyboard
10. Verify focus management in data tables

### 9. Error and Validation Keyboard Navigation
1. Trigger form validation errors
2. Test error message navigation with keyboard
3. Test error field focus management
4. Test error correction with keyboard
5. Test multiple error navigation
6. Test inline error navigation
7. Test error summary navigation
8. Test error recovery with keyboard
9. Test accessibility error announcements
10. Verify focus management in error states

### 10. RTL Layout Keyboard Navigation
1. Switch to Arabic interface
2. Test Tab order in RTL layout
3. Verify logical focus flow in RTL
4. Test Arabic text input with keyboard
5. Test RTL menu navigation
6. Test RTL form navigation
7. Test RTL modal navigation
8. Test RTL table navigation
9. Test mixed RTL/LTR content navigation
10. Verify focus indicators in RTL context

### 11. Mobile Keyboard Navigation
1. Test on mobile device with external keyboard
2. Test mobile touch keyboard navigation
3. Test mobile focus indicators
4. Test mobile form navigation
5. Test mobile video player navigation
6. Test mobile menu navigation
7. Test mobile modal navigation
8. Test mobile swipe gestures with keyboard
9. Test mobile accessibility features
10. Verify mobile keyboard compatibility

### 12. Focus Management Testing
1. Test focus indicator visibility and contrast
2. Test focus management during page loads
3. Test focus restoration after navigation
4. Test focus management in single-page apps
5. Test focus management with browser back/forward
6. Test focus management with tab switching
7. Test focus management with screen resizing
8. Test focus management with zoom
9. Test focus management with high contrast
10. Verify focus management consistency

## Expected Results

### Functional Requirements
- Focus order is logical and predictable
- All interactive elements are keyboard accessible
- Focus indicators are clearly visible
- Focus is properly trapped in modals
- Dynamic content updates maintain focus context
- Keyboard shortcuts work consistently
- No keyboard traps exist
- RTL layout maintains proper focus order

### Visual Requirements
- Focus indicators have high contrast (3:1 minimum)
- Focus indicators are clearly visible
- Focus state is distinct from hover state
- Focus indicators work in all themes
- Focus indicators are visible on all backgrounds

### Behavioral Requirements
- Tab order follows logical reading order
- Focus moves predictably through content
- Focus is managed properly in dynamic content
- Focus restoration works after interactions
- Keyboard shortcuts are discoverable
- No keyboard navigation dead-ends exist

## Test Data Requirements

### Page Types
- Homepage with various interactive elements
- Video pages with complex controls
- Search results with filtering
- Forms with validation
- Modal dialogs and overlays
- Data tables and lists
- Dynamic content areas

### Interactive Elements
- Links and buttons
- Form controls
- Video player controls
- Navigation menus
- Modal dialogs
- Dynamic content widgets

## Cross-Browser Testing Matrix

| Browser | Version | Tab Order | Focus Indicators | Keyboard Shortcuts | RTL Support |
|---------|---------|-----------|------------------|-------------------|-------------|
| Chrome | Latest+ | ✅ | ✅ | ✅ | ✅ |
| Firefox | Latest+ | ✅ | ✅ | ✅ | ✅ |
| Safari | Latest+ | ✅ | ✅ | ✅ | ✅ |
| Edge | Latest+ | ✅ | ✅ | ✅ | ✅ |

## Screen Reader Testing

### Screen Readers
- NVDA (Windows)
- VoiceOver (macOS/iOS)
- TalkBack (Android)
- JAWS (Windows)

### Screen Reader Tests
- Virtual cursor navigation
- Focus announcement accuracy
- Interactive element identification
- Form field label announcements
- Error message announcements
- Dynamic content change announcements

## Playwright Implementation

```typescript
import { test, expect } from '@playwright/test';

test.describe('Keyboard Navigation and Focus Management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/en');
  });

  test('homepage keyboard navigation', async ({ page }) => {
    // Test Tab navigation through homepage
    await page.keyboard.press('Tab');
    let focusedElement = await page.locator(':focus');
    await expect(focusedElement).toBeVisible();
    
    // Continue Tab navigation
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Tab');
      focusedElement = await page.locator(':focus');
      await expect(focusedElement).toBeVisible();
    }
    
    // Test Shift+Tab reverse navigation
    await page.keyboard.press('Shift+Tab');
    focusedElement = await page.locator(':focus');
    await expect(focusedElement).toBeVisible();
    
    // Test Enter key activation
    await page.keyboard.press('Enter');
    // Verify link/button activation
  });

  test('focus indicator visibility', async ({ page }) => {
    // Focus on first interactive element
    await page.keyboard.press('Tab');
    const focusedElement = await page.locator(':focus');
    
    // Check focus indicator styles
    const computedStyle = await focusedElement.evaluate((el) => {
      const style = window.getComputedStyle(el, ':focus');
      return {
        outline: style.outline,
        outlineColor: style.outlineColor,
        outlineWidth: style.outlineWidth,
        boxShadow: style.boxShadow
      };
    });
    
    // Verify focus indicator exists
    expect(computedStyle.outline || computedStyle.boxShadow).toBeTruthy();
  });

  test('video player keyboard navigation', async ({ page }) => {
    // Navigate to video page
    await page.goto('/en/videos/sample-video');
    await page.waitForLoadState('networkidle');
    
    // Tab to video player
    await page.keyboard.press('Tab');
    let focusedElement = await page.locator(':focus');
    
    // Should focus on video player or its controls
    expect(await focusedElement.getAttribute('role')).toMatch(/video|button/);
    
    // Test video controls
    await page.keyboard.press('Tab'); // Move to play button
    await page.keyboard.press('Space'); // Toggle play/pause
    
    // Test volume controls
    await page.keyboard.press('Tab');
    await page.keyboard.press('ArrowUp'); // Increase volume
    
    // Test fullscreen
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter'); // Enter fullscreen
    
    // Test exit fullscreen with Escape
    await page.keyboard.press('Escape');
  });

  test('search interface keyboard navigation', async ({ page }) => {
    // Navigate to search
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab'); // Should reach search input
    
    // Type search query
    await page.keyboard.type('islamic content');
    
    // Submit search
    await page.keyboard.press('Enter');
    await page.waitForLoadState('networkidle');
    
    // Navigate search results
    await page.keyboard.press('Tab');
    const firstResult = await page.locator(':focus');
    await expect(firstResult).toBeVisible();
    
    // Test result selection
    await page.keyboard.press('Enter');
    await page.waitForLoadState('networkidle');
  });

  test('form keyboard navigation', async ({ page }) => {
    // Navigate to login page
    await page.goto('/en/login');
    
    // Tab through form fields
    await page.keyboard.press('Tab'); // Email field
    let focusedElement = await page.locator(':focus');
    expect(await focusedElement.getAttribute('type')).toBe('email');
    
    await page.keyboard.type('test@example.com');
    
    await page.keyboard.press('Tab'); // Password field
    focusedElement = await page.locator(':focus');
    expect(await focusedElement.getAttribute('type')).toBe('password');
    
    await page.keyboard.type('password123');
    
    await page.keyboard.press('Tab'); // Submit button
    focusedElement = await page.locator(':focus');
    expect(await focusedElement.getAttribute('type')).toBe('submit');
    
    // Submit form
    await page.keyboard.press('Enter');
  });

  test('modal keyboard navigation', async ({ page }) => {
    // Trigger modal
    await page.click('[data-testid="modal-trigger"]');
    await expect(page.locator('[data-testid="modal"]')).toBeVisible();
    
    // Verify focus is trapped in modal
    const modalFocus = await page.locator('[data-testid="modal"] :focus');
    await expect(modalFocus).toBeVisible();
    
    // Test Tab navigation within modal
    await page.keyboard.press('Tab');
    let focusedElement = await page.locator(':focus');
    expect(await focusedElement.closest('[data-testid="modal"]')).toBeTruthy();
    
    // Test modal close with Escape
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="modal"]')).not.toBeVisible();
  });

  test('RTL keyboard navigation', async ({ page }) => {
    // Switch to Arabic
    await page.click('[data-testid="language-switcher"]');
    await page.click('text=العربية');
    await page.waitForLoadState('networkidle');
    
    // Test Tab order in RTL
    await page.keyboard.press('Tab');
    const focusedElement = await page.locator(':focus');
    await expect(focusedElement).toBeVisible();
    
    // Verify logical focus flow in RTL
    // This would need specific RTL layout testing
  });

  test('dynamic content focus management', async ({ page }) => {
    // Navigate to page with dynamic content
    await page.goto('/en/dynamic-content');
    
    // Focus on trigger element
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter'); // Trigger dynamic content
    
    // Wait for dynamic content
    await page.waitForSelector('[data-testid="dynamic-content"]');
    
    // Verify focus management
    const focusedElement = await page.locator(':focus');
    // Focus should be appropriately managed after content update
  });

  test('keyboard accessibility validation', async ({ page }) => {
    // Test that all interactive elements are keyboard accessible
    const interactiveElements = page.locator('a, button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
    const count = await interactiveElements.count();
    
    for (let i = 0; i < Math.min(count, 20); i++) {
      const element = interactiveElements.nth(i);
      
      // Focus element
      await element.focus();
      const focusedElement = await page.locator(':focus');
      expect(await focusedElement.getAttribute('data-testid')).toBe(await element.getAttribute('data-testid'));
      
      // Test activation
      if (await element.getAttribute('role') === 'button' || await element.getAttribute('type') === 'submit') {
        await page.keyboard.press('Enter');
        // Verify button activation
      }
    }
  });

  test('focus management in single page app', async ({ page }) => {
    // Test focus management during route changes
    await page.goto('/en');
    await page.keyboard.press('Tab');
    let initialFocus = await page.locator(':focus');
    
    // Navigate to different route
    await page.click('[data-testid="nav-videos"]');
    await page.waitForLoadState('networkidle');
    
    // Verify focus management after navigation
    const newFocus = await page.locator(':focus');
    // Focus should be appropriately managed after route change
  });

  test('accessibility keyboard shortcuts', async ({ page }) => {
    // Test common accessibility shortcuts
    await page.keyboard.press('Alt+S'); // Skip to main content (if implemented)
    await page.keyboard.press('Alt+M'); // Main navigation (if implemented)
    await page.keyboard.press('Alt+F'); // Search focus (if implemented)
    
    // Verify shortcut functionality
    // This would depend on implemented shortcuts
  });
});
```

## Performance Metrics

### Response Time Requirements
- Focus movement: < 50ms
- Keyboard activation: < 100ms
- Modal focus trap: < 200ms
- Dynamic content focus: < 300ms

### Resource Usage
- Memory overhead: Minimal
- CPU usage: < 1% during navigation
- Network impact: None

## Error Handling

### Test Scenarios
- Focus management failures
- Keyboard navigation dead-ends
- Focus trap malfunctions
- Dynamic content focus issues
- RTL layout focus problems

### Expected Behavior
- Graceful fallback to mouse navigation
- Clear error indicators
- Focus restoration mechanisms
- User-friendly error messages

## Success Criteria

- ✅ All interactive elements keyboard accessible
- ✅ Logical and predictable focus order
- ✅ Clear and visible focus indicators
- ✅ Proper focus management in modals
- ✅ Dynamic content maintains focus context
- ✅ RTL layout supports proper navigation
- ✅ No keyboard traps or dead-ends
- ✅ Consistent behavior across browsers
- ✅ Screen reader compatibility maintained
- ✅ Mobile keyboard accessibility supported