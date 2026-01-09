# TCACC004: ARIA Implementation and Semantic HTML

## Test Case Information

- **Test Case ID**: TCACC004
- **Category**: Accessibility
- **Sub-category**: ARIA Implementation and Semantic HTML
- **Priority**: High
- **Estimated Time**: 45 minutes
- **Target Browsers**: Chrome, Firefox, Safari, Edge
- **Target Devices**: Desktop, Tablet, Mobile
- **Accessibility Standards**: WCAG 2.1 Level AA, WAI-ARIA 1.2

## Test Description

This test case validates the proper implementation of ARIA (Accessible Rich Internet Applications) attributes and semantic HTML elements throughout the Al Ummah Now platform. It ensures that assistive technologies can properly interpret and interact with dynamic content, complex UI components, and interactive elements.

## Test Objectives

1. Verify semantic HTML5 elements are used appropriately
2. Validate ARIA attributes enhance rather than duplicate native semantics
3. Test dynamic content updates are properly announced
4. Ensure complex UI components have proper ARIA structure
5. Validate landmark roles and page structure
6. Test ARIA live regions for dynamic content
7. Verify ARIA labels and descriptions are meaningful
8. Test ARIA states and properties update correctly

## Prerequisites

- Screen reader software (NVDA, JAWS, VoiceOver, TalkBack)
- Browser developer tools with accessibility inspector
- Axe DevTools extension
- Accessibility testing tools
- Valid HTML5 markup
- JavaScript enabled for dynamic content testing

## Test Steps

### 1. Semantic HTML Structure Validation

**1.1 Document Structure**
- Open any page on the platform
- Use browser developer tools to inspect HTML structure
- Verify proper use of semantic elements:
  - `<header>` for page headers
  - `<nav>` for navigation sections
  - `<main>` for main content
  - `<section>` for content sections
  - `<article>` for standalone content
  - `<aside>` for sidebar content
  - `<footer>` for page footers

**1.2 Heading Hierarchy**
- Check heading structure using `<h1>` through `<h6>`
- Verify headings are properly nested (no skipped levels)
- Ensure only one `<h1>` per page
- Test with screen reader to confirm heading navigation

**1.3 List Semantics**
- Verify navigation menus use `<nav>` with `<ul>`/`<ol>` and `<li>`
- Check that list items are properly structured
- Test screen reader announcement of list context

### 2. ARIA Landmark Roles

**2.1 Primary Landmarks**
- Verify presence of landmark roles:
  - `role="banner"` for header content
  - `role="navigation"` for navigation areas
  - `role="main"` for main content
  - `role="complementary"` for sidebar content
  - `role="contentinfo"` for footer content
  - `role="search"` for search functionality

**2.2 Landmark Testing with Screen Reader**
- Use screen reader landmark navigation
- Verify all major page regions are reachable via landmarks
- Test landmark labels are descriptive and unique

**2.3 Custom Landmarks**
- Check for custom landmark roles where appropriate
- Verify `aria-label` or `aria-labelledby` for custom landmarks
- Test screen reader recognition of custom landmarks

### 3. ARIA Attributes for Interactive Elements

**3.1 Button Attributes**
- Test buttons with proper ARIA attributes:
  - `aria-pressed` for toggle buttons
  - `aria-expanded` for expandable buttons
  - `aria-label` for icon-only buttons
  - `aria-describedby` for additional context

**3.2 Link Attributes**
- Verify links have descriptive text or `aria-label`
- Test `aria-current` for current page links
- Check external link indicators via `aria-label` or text

**3.3 Form Controls**
- Validate form field associations:
  - `aria-required` for required fields
  - `aria-invalid` for validation errors
  - `aria-describedby` for help text
  - `aria-label` for unlabeled controls

### 4. Dynamic Content and ARIA Live Regions

**4.1 Live Region Implementation**
- Identify dynamic content areas (notifications, status updates)
- Verify appropriate `aria-live` attributes:
  - `aria-live="polite"` for non-critical updates
  - `aria-live="assertive"` for critical updates
  - `aria-live="off"` for non-announced changes

**4.2 Live Region Testing**
- Trigger dynamic content updates
- Verify screen reader announces changes appropriately
- Test timing of announcements (not too frequent)
- Check for redundant announcements

**4.3 Content Updates**
- Test `aria-busy` for loading states
- Verify `aria-relevant` for specific change types
- Check `aria-atomic` for complete content announcements

### 5. Complex UI Components

**5.1 Tab Panels**
- Test tab interface ARIA implementation:
  - `role="tablist"` for container
  - `role="tab"` for tab buttons
  - `role="tabpanel"` for content panels
  - `aria-selected` for active tab
  - `aria-controls` and `aria-labelledby` relationships

**5.2 Accordion/Collapsible Content**
- Verify accordion ARIA structure:
  - `role="button"` for headers
  - `aria-expanded` state management
  - `aria-controls` for panel association
  - Proper keyboard navigation support

**5.3 Modal Dialogs**
- Test modal dialog ARIA implementation:
  - `role="dialog"` for modal container
  - `aria-modal="true"` for modal behavior
  - `aria-labelledby` and `aria-describedby`
  - Focus management and trap

**5.4 Menus and Menu Buttons**
- Validate menu ARIA structure:
  - `role="menubar"` for horizontal menus
  - `role="menu"` for dropdown menus
  - `role="menuitem"` for menu options
  - `aria-expanded` for menu buttons
  - `aria-activedescendant` for keyboard navigation

### 6. ARIA States and Properties

**6.1 State Management**
- Test dynamic ARIA state changes:
  - `aria-disabled` for disabled controls
  - `aria-hidden` for hidden content
  - `aria-checked` for checkboxes and radio buttons
  - `aria-selected` for selected items

**6.2 Property Validation**
- Verify ARIA properties are accurate:
  - `aria-label` and `aria-labelledby` for labeling
  - `aria-describedby` for descriptions
  - `aria-current` for current items
  - `aria-haspopup` for popup indicators

### 7. Semantic HTML vs ARIA

**7.1 Native Semantics Preference**
- Verify native HTML elements are used over ARIA when possible
- Check for unnecessary ARIA attributes on semantic elements
- Test that ARIA enhances, doesn't replace, native semantics

**7.2 ARIA Supplementation**
- Identify areas where ARIA properly supplements HTML:
  - Custom widgets without native equivalents
  - Dynamic content relationships
  - Additional context for screen readers

## Expected Results

### 1. Semantic HTML Structure
- All pages use appropriate semantic HTML5 elements
- Heading hierarchy is logical and properly nested
- Lists are properly structured and announced
- No `<div>` or `<span>` elements used where semantic elements should be

### 2. ARIA Landmarks
- All major page regions have appropriate landmark roles
- Screen reader landmark navigation works correctly
- Landmark labels are descriptive and unique where needed
- Custom landmarks are properly labeled and accessible

### 3. Interactive Elements
- All interactive elements have appropriate ARIA attributes
- States (pressed, expanded, selected) update correctly
- Labels and descriptions are meaningful and concise
- Form controls have proper associations and validation indicators

### 4. Dynamic Content
- Live regions announce changes appropriately
- Content updates are timely and not overwhelming
- Loading states are properly indicated
- Screen readers track content changes accurately

### 5. Complex Components
- All complex UI components have proper ARIA structure
- Keyboard navigation works as expected
- State management is accurate and consistent
- Relationships between elements are clearly defined

### 6. ARIA Best Practices
- No ARIA attributes conflict with native semantics
- ARIA enhances rather than duplicates functionality
- All ARIA attributes have valid values and syntax
- No deprecated or experimental ARIA features are used

## Test Data

### Sample HTML Structure for Testing
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Al Ummah Now - Accessible Page</title>
</head>
<body>
  <header role="banner">
    <nav role="navigation" aria-label="Main navigation">
      <ul>
        <li><a href="/" aria-current="page">Home</a></li>
        <li><a href="/videos">Videos</a></li>
        <li><a href="/channels">Channels</a></li>
      </ul>
    </nav>
  </header>

  <main role="main">
    <section aria-labelledby="videos-heading">
      <h1 id="videos-heading">Latest Videos</h1>
      
      <div role="tablist" aria-label="Video categories">
        <button role="tab" aria-selected="true" aria-controls="all-videos">All</button>
        <button role="tab" aria-selected="false" aria-controls="recent-videos">Recent</button>
        <button role="tab" aria-selected="false" aria-controls="popular-videos">Popular</button>
      </div>

      <div id="all-videos" role="tabpanel" aria-labelledby="all-tab">
        <!-- Video content -->
      </div>
    </section>
  </main>

  <aside role="complementary" aria-labelledby="sidebar-heading">
    <h2 id="sidebar-heading">Related Content</h2>
    <!-- Sidebar content -->
  </aside>

  <footer role="contentinfo">
    <p>&copy; 2024 Al Ummah Now</p>
  </footer>

  <div aria-live="polite" aria-atomic="true" class="notifications">
    <!-- Dynamic notifications -->
  </div>
</body>
</html>
```

### ARIA Attribute Examples
```html
<!-- Toggle button -->
<button aria-pressed="false" aria-label="Play video">
  <svg>...</svg>
</button>

<!-- Expandable section -->
<button aria-expanded="false" aria-controls="video-details">
  Video Details
</button>
<div id="video-details" aria-hidden="true">
  <!-- Details content -->
</div>

<!-- Form field with validation -->
<input 
  type="email" 
  aria-required="true" 
  aria-invalid="false"
  aria-describedby="email-help email-error"
  aria-label="Email address"
>
<div id="email-help">Enter your email address</div>
<div id="email-error" aria-live="polite"></div>

<!-- Modal dialog -->
<div role="dialog" aria-modal="true" aria-labelledby="modal-title" aria-describedby="modal-description">
  <h2 id="modal-title">Video Upload</h2>
  <p id="modal-description">Upload a new video to your channel</p>
  <!-- Modal content -->
</div>
```

## Performance Metrics

- **Semantic HTML Coverage**: 100% of content uses appropriate semantic elements
- **ARIA Implementation Accuracy**: 100% compliance with WAI-ARIA 1.2
- **Screen Reader Compatibility**: 100% of elements properly announced
- **Dynamic Content Announcements**: < 2 second delay for content updates
- **Keyboard Navigation**: 100% of interactive elements reachable via keyboard
- **Accessibility Score**: 100% in automated testing tools

## Cross-Browser Testing Matrix

| Browser | Version | Semantic HTML | ARIA Support | Screen Reader | Status |
|---------|---------|---------------|--------------|---------------|--------|
| Chrome | 120+ | ✅ | ✅ | NVDA, JAWS | ✅ |
| Firefox | 119+ | ✅ | ✅ | NVDA, JAWS | ✅ |
| Safari | 17+ | ✅ | ✅ | VoiceOver | ✅ |
| Edge | 120+ | ✅ | ✅ | NVDA, JAWS | ✅ |

## Mobile Testing Requirements

### Screen Reader Testing
- **iOS**: VoiceOver navigation and announcements
- **Android**: TalkBack navigation and announcements
- Touch gesture compatibility with ARIA elements
- Proper focus management on mobile devices

### Responsive ARIA
- ARIA attributes work across viewport sizes
- Touch targets meet accessibility guidelines
- Mobile-specific ARIA patterns (e.g., swipe gestures)

## RTL Testing Requirements

### Arabic Language Support
- ARIA labels and descriptions in Arabic
- Right-to-left reading order maintained
- Screen reader announcements in correct language
- RTL-specific ARIA patterns tested

### Bilingual Testing
- Language switching maintains ARIA structure
- `lang` attributes updated correctly
- Screen reader language changes appropriately

## Automation Script

```typescript
import { test, expect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

test.describe('ARIA Implementation and Semantic HTML', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('semantic HTML structure validation', async ({ page }) => {
    // Check for semantic elements
    const semanticElements = await page.locator('header, nav, main, section, article, aside, footer').count();
    expect(semanticElements).toBeGreaterThan(0);

    // Check heading hierarchy
    const headings = await page.locator('h1, h2, h3, h4, h5, h6').all();
    let previousLevel = 0;
    
    for (const heading of headings) {
      const level = parseInt(await heading.getAttribute('aria-level') || heading.tagName().substring(1));
      expect(level).toBeGreaterThanOrEqual(previousLevel);
      expect(level).toBeLessThanOrEqual(6);
      previousLevel = level;
    }

    // Verify only one h1
    const h1Count = await page.locator('h1').count();
    expect(h1Count).toBe(1);
  });

  test('ARIA landmark roles', async ({ page }) => {
    // Check for primary landmarks
    const landmarks = await page.locator('[role="banner"], [role="navigation"], [role="main"], [role="complementary"], [role="contentinfo"]').count();
    expect(landmarks).toBeGreaterThan(0);

    // Verify main landmark exists
    const mainLandmark = page.locator('main, [role="main"]');
    await expect(mainLandmark).toHaveCount(1);

    // Check navigation landmarks
    const navLandmarks = page.locator('nav, [role="navigation"]');
    await expect(navLandmarks).toHaveCount.greaterThan(0);
  });

  test('ARIA attributes for interactive elements', async ({ page }) => {
    // Test buttons with ARIA attributes
    const buttons = page.locator('button[aria-pressed], button[aria-expanded], button[aria-label]');
    const buttonCount = await buttons.count();
    
    for (let i = 0; i < buttonCount; i++) {
      const button = buttons.nth(i);
      await expect(button).toBeVisible();
      
      // Check ARIA attributes are valid
      const ariaPressed = await button.getAttribute('aria-pressed');
      if (ariaPressed) {
        expect(['true', 'false']).toContain(ariaPressed);
      }
      
      const ariaExpanded = await button.getAttribute('aria-expanded');
      if (ariaExpanded) {
        expect(['true', 'false']).toContain(ariaExpanded);
      }
    }

    // Test form controls
    const formControls = page.locator('input[aria-required], input[aria-invalid], input[aria-describedby]');
    const formControlCount = await formControls.count();
    
    for (let i = 0; i < formControlCount; i++) {
      const control = formControls.nth(i);
      
      // Verify ARIA attributes have valid values
      const ariaRequired = await control.getAttribute('aria-required');
      if (ariaRequired) {
        expect(['true', 'false']).toContain(ariaRequired);
      }
      
      const ariaInvalid = await control.getAttribute('aria-invalid');
      if (ariaInvalid) {
        expect(['true', 'false']).toContain(ariaInvalid);
      }
    }
  });

  test('dynamic content and live regions', async ({ page }) => {
    // Find live regions
    const liveRegions = page.locator('[aria-live]');
    const liveRegionCount = await liveRegions.count();
    
    for (let i = 0; i < liveRegionCount; i++) {
      const liveRegion = liveRegions.nth(i);
      const ariaLive = await liveRegion.getAttribute('aria-live');
      expect(['polite', 'assertive', 'off']).toContain(ariaLive);
    }

    // Test dynamic content updates (if applicable)
    // This would need to be adapted based on actual dynamic content
    const notificationArea = page.locator('.notifications, [aria-live]');
    if (await notificationArea.count() > 0) {
      // Trigger a notification and verify it appears
      await page.evaluate(() => {
        const notification = document.createElement('div');
        notification.textContent = 'Test notification';
        document.querySelector('.notifications')?.appendChild(notification);
      });
      
      await expect(notificationArea.locator('div')).toHaveCount.greaterThan(0);
    }
  });

  test('complex UI components ARIA structure', async ({ page }) => {
    // Test tab interfaces
    const tabLists = page.locator('[role="tablist"]');
    const tabListCount = await tabLists.count();
    
    for (let i = 0; i < tabListCount; i++) {
      const tabList = tabLists.nth(i);
      
      // Check for tab elements
      const tabs = tabList.locator('[role="tab"]');
      await expect(tabs).toHaveCount.greaterThan(0);
      
      // Check for selected tab
      const selectedTab = tabs.locator('[aria-selected="true"]');
      await expect(selectedTab).toHaveCount(1);
      
      // Verify tab controls relationship
      for (let j = 0; j < await tabs.count(); j++) {
        const tab = tabs.nth(j);
        const ariaControls = await tab.getAttribute('aria-controls');
        if (ariaControls) {
          const controlledPanel = page.locator(`#${ariaControls}`);
          await expect(controlledPanel).toHaveCount(1);
        }
      }
    }

    // Test accordion/collapsible content
    const accordionButtons = page.locator('button[aria-expanded][aria-controls]');
    const accordionCount = await accordionButtons.count();
    
    for (let i = 0; i < accordionCount; i++) {
      const button = accordionButtons.nth(i);
      const ariaExpanded = await button.getAttribute('aria-expanded');
      const ariaControls = await button.getAttribute('aria-controls');
      
      expect(['true', 'false']).toContain(ariaExpanded);
      expect(ariaControls).toBeTruthy();
      
      // Check controlled element exists
      const controlledPanel = page.locator(`#${ariaControls}`);
      await expect(controlledPanel).toHaveCount(1);
    }
  });

  test('accessibility compliance with axe', async ({ page }) => {
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();

    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test('ARIA states and properties update correctly', async ({ page }) => {
    // Test toggle buttons
    const toggleButtons = page.locator('button[aria-pressed]');
    const toggleCount = await toggleButtons.count();
    
    for (let i = 0; i < toggleCount; i++) {
      const button = toggleButtons.nth(i);
      
      // Get initial state
      const initialState = await button.getAttribute('aria-pressed');
      
      // Click button
      await button.click();
      
      // Verify state changed
      const newState = await button.getAttribute('aria-pressed');
      expect(newState).not.toBe(initialState);
      expect(['true', 'false']).toContain(newState);
    }

    // Test expandable buttons
    const expandableButtons = page.locator('button[aria-expanded]');
    const expandableCount = await expandableButtons.count();
    
    for (let i = 0; i < expandableCount; i++) {
      const button = expandableButtons.nth(i);
      
      // Get initial state
      const initialState = await button.getAttribute('aria-expanded');
      
      // Click button
      await button.click();
      
      // Verify state changed
      const newState = await button.getAttribute('aria-expanded');
      expect(newState).not.toBe(initialState);
      expect(['true', 'false']).toContain(newState);
    }
  });

  test('semantic HTML vs ARIA best practices', async ({ page }) => {
    // Check for unnecessary ARIA on semantic elements
    const semanticWithAria = page.locator('nav[role="navigation"], header[role="banner"], main[role="main"], footer[role="contentinfo"]');
    
    // These should generally not need explicit ARIA roles
    // but if they exist, they should match the native semantics
    for (let i = 0; i < await semanticWithAria.count(); i++) {
      const element = semanticWithAria.nth(i);
      const tagName = await element.evaluate(el => el.tagName.toLowerCase());
      const role = await element.getAttribute('role');
      
      // Verify role matches native semantics
      const expectedRoles: Record<string, string> = {
        'nav': 'navigation',
        'header': 'banner',
        'main': 'main',
        'footer': 'contentinfo'
      };
      
      if (expectedRoles[tagName] && role) {
        expect(role).toBe(expectedRoles[tagName]);
      }
    }

    // Check for proper use of ARIA to supplement, not replace
    const buttonsWithoutAria = page.locator('button:not([aria-label]):not([aria-labelledby])');
    const buttonCount = await buttonsWithoutAria.count();
    
    for (let i = 0; i < buttonCount; i++) {
      const button = buttonsWithoutAria.nth(i);
      const hasText = await button.textContent();
      
      // Buttons should have text content or ARIA labels
      expect(hasText?.trim()).toBeTruthy();
    }
  });
});

test.describe('ARIA Implementation - Video Player', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/videos/test-video');
  });

  test('video player ARIA structure', async ({ page }) => {
    // Test video player controls
    const playButton = page.locator('button[aria-label*="play"], button[aria-label*="pause"]');
    await expect(playButton).toBeVisible();
    
    const volumeButton = page.locator('button[aria-label*="volume"], button[aria-label*="mute"]');
    await expect(volumeButton).toBeVisible();
    
    const fullscreenButton = page.locator('button[aria-label*="fullscreen"]');
    await expect(fullscreenButton).toBeVisible();
    
    // Test progress bar accessibility
    const progressBar = page.locator('[role="slider"], input[type="range"]');
    if (await progressBar.count() > 0) {
      await expect(progressBar.first()).toHaveAttribute('aria-label');
      await expect(progressBar.first()).toHaveAttribute('aria-valuemin');
      await expect(progressBar.first()).toHaveAttribute('aria-valuemax');
      await expect(progressBar.first()).toHaveAttribute('aria-valuenow');
    }
  });

  test('video player state announcements', async ({ page }) => {
    const playButton = page.locator('button[aria-label*="play"], button[aria-label*="pause"]');
    
    // Test play/pause state changes
    const initialLabel = await playButton.getAttribute('aria-label');
    await playButton.click();
    
    const newLabel = await playButton.getAttribute('aria-label');
    expect(newLabel).not.toBe(initialLabel);
    
    // Verify state is reflected in aria-pressed or similar
    const ariaPressed = await playButton.getAttribute('aria-pressed');
    if (ariaPressed) {
      expect(['true', 'false']).toContain(ariaPressed);
    }
  });
});
```

## Test Environment Setup

### Required Tools
1. **Screen Readers**:
   - NVDA (Windows)
   - JAWS (Windows)
   - VoiceOver (macOS/iOS)
   - TalkBack (Android)

2. **Browser Extensions**:
   - Axe DevTools
   - WAVE Evaluation Tool
   - Accessibility Insights for Web

3. **Testing Frameworks**:
   - Playwright with @axe-core/playwright
   - Pa11y for automated testing
   - Custom accessibility test utilities

### Environment Variables
```typescript
// test/config/accessibility.ts
export const accessibilityConfig = {
  axeRules: {
    'aria-valid-attr': { enabled: true },
    'aria-valid-attr-value': { enabled: true },
    'aria-required-attr': { enabled: true },
    'aria-required-children': { enabled: true },
    'aria-roles': { enabled: true },
    'aria-hidden-body': { enabled: true },
    'aria-hidden-focus': { enabled: true },
    'button-name': { enabled: true },
    'heading-order': { enabled: true },
    'html-has-lang': { enabled: true },
    'landmark-one-main': { enabled: true },
    'landmark-no-duplicate-banner': { enabled: true },
    'landmark-no-duplicate-contentinfo': { enabled: true },
    'page-has-heading-one': { enabled: true },
    'region': { enabled: true }
  },
  wcagLevel: 'AA',
  testingTimeout: 30000
};
```

## Success Criteria

### Functional Requirements
- ✅ All semantic HTML elements used appropriately
- ✅ ARIA landmarks provide comprehensive page structure
- ✅ Interactive elements have proper ARIA attributes
- ✅ Dynamic content updates are properly announced
- ✅ Complex UI components follow ARIA patterns
- ✅ ARIA states and properties update correctly
- ✅ No accessibility violations in automated testing

### Technical Requirements
- ✅ 100% compliance with WCAG 2.1 Level AA
- ✅ 100% compliance with WAI-ARIA 1.2
- ✅ Cross-browser compatibility maintained
- ✅ Mobile screen reader support verified
- ✅ RTL language support confirmed
- ✅ Performance impact minimal (< 5% overhead)

### User Experience Requirements
- ✅ Screen reader users can navigate efficiently
- ✅ Keyboard-only users can access all functionality
- ✅ Dynamic content doesn't cause confusion
- ✅ Complex components are intuitive to use
- ✅ Consistent behavior across assistive technologies

## Bug Reporting Template

### Issue Title
`[Accessibility] ARIA Implementation Issue: [Specific Component/Area]`

### Environment
- **URL**: [Page where issue occurs]
- **Browser**: [Browser and version]
- **Screen Reader**: [Screen reader and version]
- **Device**: [Desktop/Mobile/Tablet]

### Description
[Detailed description of the ARIA implementation issue]

### Steps to Reproduce
1. [Step 1]
2. [Step 2]
3. [Step 3]

### Expected Behavior
[What should happen with proper ARIA implementation]

### Actual Behavior
[What actually happens]

### Screen Reader Output
[Exact text announced by screen reader]

### ARIA Attributes
[Current ARIA attributes on the problematic element]

### Suggested Fix
[Recommended solution for the ARIA issue]

### Priority
[High/Medium/Low based on impact on users]

## Related Test Cases

- **TCACC001**: Keyboard Navigation and Focus Management
- **TCACC002**: Screen Reader Compatibility
- **TCACC005**: Form Accessibility
- **TCACC006**: Video and Media Accessibility
- **TCACC007**: Mobile Accessibility

## Documentation References

- [WAI-ARIA Authoring Practices 1.2](https://www.w3.org/TR/wai-aria-practices-1.2/)
- [MDN ARIA Documentation](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA)
- [HTML5 Semantic Elements](https://developer.mozilla.org/en-US/docs/Glossary/Semantics)
- [ARIA in HTML](https://www.w3.org/TR/html-aria/)
- [WCAG 2.1 Guidelines](https://www.w3.org/TR/WCAG21/)

---

**Test Case Status**: Ready for Implementation
**Last Updated**: 2024-11-18
**Next Review**: 2024-12-18