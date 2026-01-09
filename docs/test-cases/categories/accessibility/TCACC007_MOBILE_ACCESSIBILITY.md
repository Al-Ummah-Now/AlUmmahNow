# TCACC007: Mobile Accessibility

## Test Case Information

- **Test Case ID**: TCACC007
- **Category**: Accessibility
- **Sub-category**: Mobile Accessibility
- **Priority**: High
- **Estimated Time**: 90 minutes
- **Target Browsers**: Chrome Mobile, Safari Mobile, Firefox Mobile
- **Target Devices**: iOS Devices, Android Devices, Tablets
- **Accessibility Standards**: WCAG 2.1 Level AA, Mobile Accessibility Guidelines

## Test Description

This test case validates the accessibility of the Al Ummah Now platform on mobile devices, ensuring that users with disabilities can effectively use all features on smartphones and tablets. It covers touch interactions, mobile-specific UI patterns, responsive design, and mobile assistive technology compatibility.

## Test Objectives

1. Verify touch target sizes and spacing meet accessibility guidelines
2. Test mobile screen reader compatibility (VoiceOver, TalkBack)
3. Validate mobile keyboard accessibility and alternative input methods
4. Ensure responsive design maintains accessibility across viewports
5. Test mobile-specific gestures and interactions
6. Verify mobile navigation and content accessibility
7. Test mobile video and media accessibility
8. Validate mobile form accessibility and input methods

## Prerequisites

- Mobile devices (iOS and Android) or mobile emulators
- Screen readers: VoiceOver (iOS), TalkBack (Android)
- Mobile browsers: Safari (iOS), Chrome (Android)
- Accessibility testing tools for mobile
- Various mobile device sizes and orientations
- Alternative input devices (switch, voice control)

## Test Steps

### 1. Touch Target Accessibility

**1.1 Touch Target Size Validation**
- Navigate to various pages on mobile devices
- Measure touch target sizes for all interactive elements:
  - Buttons, links, form controls
  - Navigation items
  - Video player controls
  - Social sharing buttons
- Verify minimum touch target size of 44x44px (9mm)
- Check spacing between adjacent touch targets

**1.2 Touch Target Spacing**
- Verify adequate spacing between touch targets
- Test for accidental activation prevention
- Check that targets are not too close together
- Verify touch targets don't overlap in any orientation

**1.3 Touch Target Feedback**
- Test visual feedback for touch interactions:
  - Hover states on touch devices
  - Active/pressed states
  - Focus indicators for keyboard navigation
- Verify feedback is clearly visible and accessible

### 2. Mobile Screen Reader Testing

**2.1 VoiceOver Testing (iOS)**
- Enable VoiceOver on iOS device
- Test navigation through all pages:
  - Swipe right/left to navigate elements
  - Double-tap to activate elements
  - Two-finger scroll for page scrolling
  - Rotor for element type navigation
- Verify all content is properly announced
- Test form field accessibility with VoiceOver

**2.2 TalkBack Testing (Android)**
- Enable TalkBack on Android device
- Test navigation through all pages:
  - Swipe right/left to navigate elements
  - Double-tap to activate elements
  - Two-finger scroll for page scrolling
  - Local context menu for element actions
- Verify all content is properly announced
- Test form field accessibility with TalkBack

**2.3 Screen Reader Compatibility**
- Test screen reader announcements for:
  - Page titles and headings
  - Navigation landmarks
  - Form labels and descriptions
  - Error messages and validation
  - Dynamic content updates
- Verify proper reading order and context

### 3. Mobile Keyboard Accessibility

**3.1 On-Screen Keyboard**
- Test keyboard accessibility on mobile devices:
  - Focus management with on-screen keyboard
  - Tab navigation through interactive elements
  - Enter key activation
  - Keyboard dismissal behavior
- Verify content remains visible with keyboard open

**3.2 External Keyboard Support**
- Test with external Bluetooth keyboards:
  - Full keyboard navigation
  - Shortcut keys functionality
  - Tab order and focus management
  - Escape key behavior
- Verify consistent behavior with desktop

**3.3 Alternative Input Methods**
- Test alternative input methods:
  - Voice control commands
  - Switch navigation
  - Head pointer/joystick control
  - Eye tracking compatibility
- Verify all functionality is accessible

### 4. Responsive Design Accessibility

**4.1 Viewport Testing**
- Test across different viewport sizes:
  - Small phones (320px width)
  - Large phones (414px width)
  - Tablets (768px+ width)
  - Various aspect ratios
- Verify accessibility features work at all sizes

**4.2 Orientation Testing**
- Test portrait and landscape orientations:
  - Content reflow and readability
  - Navigation accessibility
  - Form usability
  - Video player functionality
- Verify orientation changes maintain accessibility

**4.3 Zoom and Scaling**
- Test zoom functionality:
  - Pinch-to-zoom up to 200%
  - Browser zoom settings
  - Text-only zoom
  - System accessibility zoom
- Verify content remains usable when zoomed

### 5. Mobile Navigation and Content

**5.1 Mobile Navigation**
- Test mobile navigation patterns:
  - Hamburger menu accessibility
  - Tab bar navigation
  - Breadcrumb navigation
  - Back button functionality
- Verify navigation is fully accessible

**5.2 Content Accessibility**
- Test content readability on mobile:
  - Text size and readability
  - Line height and spacing
  - Color contrast on small screens
  - Image alt text on mobile
- Verify content is accessible in all orientations

**5.3 Mobile-Specific Features**
- Test mobile-specific accessibility features:
  - Pull-to-refresh accessibility
  - Infinite scroll announcements
  - Swipe gestures with screen readers
  - Mobile-specific ARIA patterns
- Verify features work with assistive technology

### 6. Mobile Video and Media

**6.1 Mobile Video Player**
- Test video player accessibility on mobile:
  - Touch target sizes for controls
  - Gesture-based controls
  - Fullscreen accessibility
  - Caption display on mobile
- Verify video controls are accessible

**6.2 Mobile Media Controls**
- Test media control accessibility:
  - Volume control alternatives
  - Playback speed controls
  - Progress bar accessibility
  - Mobile-specific gestures
- Verify all media features are accessible

**6.3 Mobile Content Consumption**
- Test content consumption patterns:
  - Audio-only content accessibility
  - Image gallery navigation
  - Document viewing accessibility
  - Interactive content on mobile
- Verify content is accessible on mobile devices

### 7. Mobile Form Accessibility

**7.1 Mobile Form Inputs**
- Test form input accessibility on mobile:
  - Appropriate mobile keyboard types
  - Input mode attributes
  - Autocomplete functionality
  - Form validation on mobile
- Verify forms are fully accessible

**7.2 Mobile Form Navigation**
- Test form navigation patterns:
  - Field navigation with screen readers
  - Error handling and announcements
  - Progress indicators for multi-step forms
  - Mobile-specific input methods
- Verify form completion is accessible

**7.3 Mobile Form Validation**
- Test mobile-specific validation:
  - Touch-friendly error messages
  - Mobile keyboard validation
  - Input format hints
  - Accessibility of validation feedback
- Verify validation is accessible on mobile

### 8. Mobile Performance and Battery

**8.1 Performance Impact**
- Test accessibility impact on performance:
  - Screen reader performance
  - Voice control responsiveness
  - Alternative input lag
  - Battery consumption with accessibility features
- Verify acceptable performance levels

**8.2 Low-Light Mode**
- Test accessibility in different lighting:
  - Dark mode accessibility
  - High contrast mode
  - Color blind accessibility
  - Low vision accommodations
- Verify accessibility in all modes

## Expected Results

### 1. Touch Targets
- All interactive elements meet 44x44px minimum size
- Adequate spacing between touch targets
- Clear visual and haptic feedback
- No accidental activation issues

### 2. Screen Reader Support
- VoiceOver and TalkBack work correctly
- All content is properly announced
- Navigation is intuitive and efficient
- Dynamic content updates are announced

### 3. Keyboard Accessibility
- On-screen keyboard works properly
- External keyboard support is complete
- Alternative input methods are supported
- Focus management is correct

### 4. Responsive Design
- Accessibility maintained across all viewports
- Orientation changes work correctly
- Zoom functionality is supported
- Content remains readable and accessible

### 5. Mobile Navigation
- All navigation patterns are accessible
- Mobile-specific features work with screen readers
- Content is accessible in all orientations
- Navigation is intuitive and predictable

### 6. Mobile Media
- Video controls are accessible on mobile
- Media features work with assistive technology
- Content consumption is fully accessible
- Mobile-specific gestures are accessible

### 7. Mobile Forms
- Forms are fully accessible on mobile
- Input methods are appropriate for mobile
- Validation is accessible and clear
- Form completion is possible for all users

### 8. Performance
- Accessibility features don't significantly impact performance
- Battery consumption is reasonable
- Response times are acceptable
- Features work in all modes and conditions

## Test Data

### Mobile Viewport Test Sizes
```typescript
const mobileViewports = {
  // Small phones
  'iPhone SE': { width: 375, height: 667, deviceScaleFactor: 2 },
  'Android Small': { width: 360, height: 640, deviceScaleFactor: 2 },
  
  // Large phones
  'iPhone 14': { width: 390, height: 844, deviceScaleFactor: 3 },
  'Android Large': { width: 414, height: 896, deviceScaleFactor: 3 },
  
  // Tablets
  'iPad': { width: 768, height: 1024, deviceScaleFactor: 2 },
  'iPad Pro': { width: 1024, height: 1366, deviceScaleFactor: 2 },
  'Android Tablet': { width: 800, height: 1280, deviceScaleFactor: 2 },
  
  // Foldable devices
  'Foldable Closed': { width: 280, height: 653, deviceScaleFactor: 3 },
  'Foldable Open': { width: 765, height: 775, deviceScaleFactor: 2 }
};
```

### Touch Target Size Validation
```css
/* Mobile touch target requirements */
.mobile-touch-target {
  min-width: 44px;
  min-height: 44px;
  min-touch-target-size: 44px;
}

/* Spacing between targets */
.mobile-touch-target + .mobile-touch-target {
  margin-top: 8px;
  margin-left: 8px;
}

/* High contrast mode support */
@media (prefers-contrast: high) {
  .mobile-touch-target {
    border: 2px solid ButtonText;
    background: ButtonFace;
    color: ButtonText;
  }
}

/* Reduced motion support */
@media (prefers-reduced-motion: reduce) {
  .mobile-touch-target {
    transition: none;
  }
}
```

### Mobile Accessibility JavaScript
```javascript
class MobileAccessibility {
  constructor() {
    this.setupMobileAccessibility();
    this.setupTouchOptimizations();
    this.setupScreenReaderSupport();
  }

  setupMobileAccessibility() {
    // Detect mobile device
    this.isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    
    if (this.isMobile) {
      this.enhanceMobileAccessibility();
    }
  }

  setupTouchOptimizations() {
    // Ensure adequate touch target sizes
    this.enhanceTouchTargets();
    
    // Add touch feedback
    this.addTouchFeedback();
    
    // Prevent accidental activation
    this.preventAccidentalActivation();
  }

  setupScreenReaderSupport() {
    // Detect screen reader
    this.detectScreenReader();
    
    // Enhance announcements
    this.enhanceAnnouncements();
    
    // Setup mobile-specific ARIA patterns
    this.setupMobileARIA();
  }

  enhanceTouchTargets() {
    const touchTargets = document.querySelectorAll('button, a, input, select, textarea, [role="button"]');
    
    touchTargets.forEach(target => {
      const computedStyle = window.getComputedStyle(target);
      const width = parseInt(computedStyle.width);
      const height = parseInt(computedStyle.height);
      
      // Enlarge small touch targets
      if (width < 44 || height < 44) {
        target.style.minWidth = '44px';
        target.style.minHeight = '44px';
        target.style.minTouchTargetSize = '44px';
      }
    });
  }

  addTouchFeedback() {
    const touchTargets = document.querySelectorAll('button, a, [role="button"]');
    
    touchTargets.forEach(target => {
      target.addEventListener('touchstart', (e) => {
        target.classList.add('touch-active');
      }, { passive: true });
      
      target.addEventListener('touchend', (e) => {
        setTimeout(() => {
          target.classList.remove('touch-active');
        }, 150);
      }, { passive: true });
      
      target.addEventListener('touchcancel', (e) => {
        target.classList.remove('touch-active');
      }, { passive: true });
    });
  }

  preventAccidentalActivation() {
    let touchStartTime;
    let touchStartX;
    let touchStartY;
    
    document.addEventListener('touchstart', (e) => {
      touchStartTime = Date.now();
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    }, { passive: true });
    
    document.addEventListener('touchend', (e) => {
      const touchEndTime = Date.now();
      const touchEndX = e.changedTouches[0].clientX;
      const touchEndY = e.changedTouches[0].clientY;
      
      const touchDuration = touchEndTime - touchStartTime;
      const touchDistance = Math.sqrt(
        Math.pow(touchEndX - touchStartX, 2) + 
        Math.pow(touchEndY - touchStartY, 2)
      );
      
      // Prevent activation for very quick touches or significant movement
      if (touchDuration < 50 || touchDistance > 10) {
        e.preventDefault();
      }
    });
  }

  detectScreenReader() {
    // Common screen reader detection methods
    this.hasScreenReader = false;
    
    // Check for VoiceOver
    if (window.speechSynthesis) {
      this.hasScreenReader = true;
    }
    
    // Check for TalkBack
    if ('accessibility' in window && window.accessibility) {
      this.hasScreenReader = true;
    }
    
    // Check for reduced motion preference (often indicates accessibility needs)
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.hasScreenReader = true;
    }
  }

  enhanceAnnouncements() {
    // Create mobile-specific live region
    if (!document.getElementById('mobile-announcements')) {
      const liveRegion = document.createElement('div');
      liveRegion.id = 'mobile-announcements';
      liveRegion.setAttribute('aria-live', 'polite');
      liveRegion.setAttribute('aria-atomic', 'true');
      liveRegion.className = 'sr-only';
      document.body.appendChild(liveRegion);
    }
    
    this.announcer = document.getElementById('mobile-announcements');
  }

  setupMobileARIA() {
    // Enhance mobile navigation patterns
    this.enhanceMobileNavigation();
    
    // Setup mobile-specific ARIA patterns
    this.setupMobilePatterns();
    
    // Add mobile-specific landmarks
    this.addMobileLandmarks();
  }

  enhanceMobileNavigation() {
    // Enhance hamburger menus
    const hamburgerButtons = document.querySelectorAll('[aria-label*="menu"], [aria-label*="navigation"]');
    
    hamburgerButtons.forEach(button => {
      button.setAttribute('aria-expanded', 'false');
      button.setAttribute('aria-controls', 'mobile-navigation');
    });
    
    // Enhance tab bars
    const tabBars = document.querySelectorAll('[role="tablist"]');
    
    tabBars.forEach(tabBar => {
      tabBar.setAttribute('aria-orientation', 'horizontal');
      
      const tabs = tabBar.querySelectorAll('[role="tab"]');
      tabs.forEach((tab, index) => {
        tab.setAttribute('aria-posinset', String(index + 1));
        tab.setAttribute('aria-setsize', String(tabs.length));
      });
    });
  }

  setupMobilePatterns() {
    // Setup swipeable carousels
    const carousels = document.querySelectorAll('.carousel, .swiper');
    
    carousels.forEach(carousel => {
      carousel.setAttribute('role', 'region');
      carousel.setAttribute('aria-roledescription', 'carousel');
      
      const slides = carousel.querySelectorAll('.slide, .swiper-slide');
      slides.forEach((slide, index) => {
        slide.setAttribute('role', 'group');
        slide.setAttribute('aria-roledescription', 'slide');
        slide.setAttribute('aria-label', `Slide ${index + 1} of ${slides.length}`);
      });
    });
    
    // Setup pull-to-refresh areas
    const pullToRefresh = document.querySelector('[data-pull-to-refresh]');
    if (pullToRefresh) {
      pullToRefresh.setAttribute('aria-live', 'polite');
      pullToRefresh.setAttribute('aria-busy', 'false');
    }
  }

  addMobileLandmarks() {
    // Add mobile-specific landmarks
    const mobileNav = document.querySelector('.mobile-navigation, nav.mobile');
    if (mobileNav && !mobileNav.hasAttribute('role')) {
      mobileNav.setAttribute('role', 'navigation');
      mobileNav.setAttribute('aria-label', 'Mobile navigation');
    }
    
    const mobileContent = document.querySelector('main.mobile, .mobile-content');
    if (mobileContent && !mobileContent.hasAttribute('role')) {
      mobileContent.setAttribute('role', 'main');
    }
  }

  announce(message) {
    if (this.announcer && this.hasScreenReader) {
      this.announcer.textContent = message;
      
      // Clear after announcement
      setTimeout(() => {
        this.announcer.textContent = '';
      }, 1000);
    }
  }

  // Mobile-specific gesture handling
  setupGestures() {
    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartTime = 0;
    
    document.addEventListener('touchstart', (e) => {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      touchStartTime = Date.now();
    }, { passive: true });
    
    document.addEventListener('touchend', (e) => {
      const touchEndX = e.changedTouches[0].clientX;
      const touchEndY = e.changedTouches[0].clientY;
      const touchEndTime = Date.now();
      
      const deltaX = touchEndX - touchStartX;
      const deltaY = touchEndY - touchStartY;
      const deltaTime = touchEndTime - touchStartTime;
      
      // Detect swipe gestures
      if (Math.abs(deltaX) > 50 && Math.abs(deltaY) < 50 && deltaTime < 300) {
        if (deltaX > 0) {
          this.handleSwipeRight(e.target);
        } else {
          this.handleSwipeLeft(e.target);
        }
      }
    }, { passive: true });
  }

  handleSwipeRight(element) {
    // Handle right swipe (e.g., go back, next slide)
    this.announce('Swiped right');
    
    // Trigger appropriate action based on context
    if (element.closest('.carousel')) {
      // Next slide
      this.nextSlide(element.closest('.carousel'));
    } else if (element.closest('.mobile-navigation')) {
      // Close navigation
      this.closeMobileNavigation();
    }
  }

  handleSwipeLeft(element) {
    // Handle left swipe (e.g., next, previous slide)
    this.announce('Swiped left');
    
    // Trigger appropriate action based on context
    if (element.closest('.carousel')) {
      // Previous slide
      this.previousSlide(element.closest('.carousel'));
    } else if (element.closest('.mobile-navigation')) {
      // Open navigation
      this.openMobileNavigation();
    }
  }

  nextSlide(carousel) {
    // Implement next slide logic
    const slides = carousel.querySelectorAll('.slide');
    const currentSlide = carousel.querySelector('.slide.active');
    const currentIndex = Array.from(slides).indexOf(currentSlide);
    const nextIndex = (currentIndex + 1) % slides.length;
    
    // Update slides
    currentSlide.classList.remove('active');
    slides[nextIndex].classList.add('active');
    
    // Announce slide change
    this.announce(`Slide ${nextIndex + 1} of ${slides.length}`);
  }

  previousSlide(carousel) {
    // Implement previous slide logic
    const slides = carousel.querySelectorAll('.slide');
    const currentSlide = carousel.querySelector('.slide.active');
    const currentIndex = Array.from(slides).indexOf(currentSlide);
    const prevIndex = (currentIndex - 1 + slides.length) % slides.length;
    
    // Update slides
    currentSlide.classList.remove('active');
    slides[prevIndex].classList.add('active');
    
    // Announce slide change
    this.announce(`Slide ${prevIndex + 1} of ${slides.length}`);
  }

  openMobileNavigation() {
    const nav = document.querySelector('.mobile-navigation');
    const button = document.querySelector('[aria-controls="mobile-navigation"]');
    
    if (nav && button) {
      nav.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      this.announce('Navigation opened');
    }
  }

  closeMobileNavigation() {
    const nav = document.querySelector('.mobile-navigation');
    const button = document.querySelector('[aria-controls="mobile-navigation"]');
    
    if (nav && button) {
      nav.hidden = true;
      button.setAttribute('aria-expanded', 'false');
      this.announce('Navigation closed');
    }
  }
}

// Initialize mobile accessibility
document.addEventListener('DOMContentLoaded', () => {
  new MobileAccessibility();
});
```

## Performance Metrics

- **Touch Target Compliance**: 100% meet 44x44px minimum
- **Screen Reader Performance**: < 200ms response time
- **Mobile Load Time**: < 3 seconds on 3G
- **Gesture Response**: < 100ms for touch interactions
- **Zoom Functionality**: 200% zoom maintained
- **Battery Impact**: < 10% additional consumption

## Cross-Device Testing Matrix

| Device | OS | Screen Reader | Browser | Touch Targets | Status |
|--------|----|---------------|---------|---------------|--------|
| iPhone 14 | iOS 16+ | VoiceOver | Safari | ✅ | ✅ |
| iPad Pro | iPadOS 16+ | VoiceOver | Safari | ✅ | ✅ |
| Samsung Galaxy | Android 13+ | TalkBack | Chrome | ✅ | ✅ |
| Google Pixel | Android 13+ | TalkBack | Chrome | ✅ | ✅ |
| Surface Duo | Android 12+ | TalkBack | Chrome | ✅ | ✅ |

## Mobile Testing Requirements

### Device Testing
- **Small Phones**: 320-375px width
- **Large Phones**: 390-414px width
- **Tablets**: 768-1024px width
- **Foldable Devices**: Both folded and unfolded states

### Orientation Testing
- Portrait mode accessibility
- Landscape mode accessibility
- Orientation change handling
- Dynamic layout adaptation

### Input Method Testing
- Touch interactions
- External keyboard support
- Voice control
- Switch navigation
- Eye tracking (if available)

## Automation Script

```typescript
import { test, devices, expect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

// Mobile devices to test
const mobileDevices = [
  devices['iPhone 14'],
  devices['iPad Pro'],
  devices['Pixel 5'],
  devices['Galaxy S9+']
];

test.describe('Mobile Accessibility', () => {
  mobileDevices.forEach(device => {
    test.describe(`Device: ${device.name}`, () => {
      test.use({ ...device });

      test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');
      });

      test('touch target size validation', async ({ page }) => {
        // Get all interactive elements
        const interactiveElements = await page.locator('button, a, input, select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])').all();
        
        for (const element of interactiveElements) {
          const boundingBox = await element.boundingBox();
          
          if (boundingBox) {
            // Check minimum touch target size (44x44px accounting for device pixel ratio)
            const devicePixelRatio = await page.evaluate(() => window.devicePixelRatio);
            const minSize = 44 * devicePixelRatio;
            
            expect(boundingBox.width).toBeGreaterThanOrEqual(minSize);
            expect(boundingBox.height).toBeGreaterThanOrEqual(minSize);
          }
        }
      });

      test('mobile navigation accessibility', async ({ page }) => {
        // Test hamburger menu
        const hamburgerBtn = page.locator('[aria-label*="menu"], [aria-label*="navigation"], .hamburger, .menu-toggle');
        
        if (await hamburgerBtn.count() > 0) {
          await expect(hamburgerBtn.first()).toBeVisible();
          await expect(hamburgerBtn.first()).toHaveAttribute('aria-expanded');
          
          // Test menu toggle
          const initialState = await hamburgerBtn.first().getAttribute('aria-expanded');
          await hamburgerBtn.first().click();
          
          const newState = await hamburgerBtn.first().getAttribute('aria-expanded');
          expect(newState).not.toBe(initialState);
          
          // Check navigation panel
          const navPanel = page.locator('#mobile-navigation, .mobile-navigation, [role="navigation"]');
          if (await navPanel.count() > 0) {
            await expect(navPanel.first()).toBeVisible();
          }
        }

        // Test tab bar navigation
        const tabBar = page.locator('[role="tablist"]');
        if (await tabBar.count() > 0) {
          await expect(tabBar.first()).toHaveAttribute('aria-orientation', 'horizontal');
          
          const tabs = tabBar.first().locator('[role="tab"]');
          const tabCount = await tabs.count();
          
          for (let i = 0; i < tabCount; i++) {
            const tab = tabs.nth(i);
            await expect(tab).toHaveAttribute('aria-posinset');
            await expect(tab).toHaveAttribute('aria-setsize');
          }
        }
      });

      test('mobile form accessibility', async ({ page }) => {
        // Navigate to a page with forms
        await page.goto('/login');
        
        // Test form inputs
        const inputs = page.locator('input, select, textarea');
        const inputCount = await inputs.count();
        
        for (let i = 0; i < inputCount; i++) {
          const input = inputs.nth(i);
          
          // Check for appropriate input types
          const inputType = await input.getAttribute('type');
          const inputName = await input.getAttribute('name') || '';
          
          if (inputName.includes('email')) {
            expect(inputType).toBe('email');
          } else if (inputName.includes('tel') || inputName.includes('phone')) {
            expect(inputType).toBe('tel');
          } else if (inputName.includes('password')) {
            expect(inputType).toBe('password');
          }
          
          // Check for inputmode attribute
          const inputMode = await input.getAttribute('inputmode');
          if (inputType === 'tel' && !inputMode) {
            // Should have inputmode for better mobile keyboard
            console.warn(`Tel input should have inputmode attribute: ${inputName}`);
          }
        }

        // Test form validation on mobile
        const submitBtn = page.locator('button[type="submit"]');
        if (await submitBtn.count() > 0) {
          await submitBtn.first().click();
          
          // Check for error messages
          const errorMessages = page.locator('[role="alert"], .error-message, [aria-invalid="true"]');
          if (await errorMessages.count() > 0) {
            await expect(errorMessages.first()).toBeVisible();
          }
        }
      });

      test('mobile video player accessibility', async ({ page }) => {
        await page.goto('/videos/test-video');
        
        // Test video player controls
        const videoControls = page.locator('.video-controls button, [data-action]');
        const controlCount = await videoControls.count();
        
        for (let i = 0; i < controlCount; i++) {
          const control = videoControls.nth(i);
          const boundingBox = await control.boundingBox();
          
          if (boundingBox) {
            // Check touch target size for video controls
            expect(boundingBox.width).toBeGreaterThanOrEqual(44);
            expect(boundingBox.height).toBeGreaterThanOrEqual(44);
          }
        }

        // Test mobile-specific gestures
        const video = page.locator('video');
        if (await video.count() > 0) {
          // Test tap to play/pause
          await video.first().click();
          await page.waitForTimeout(500);
          
          // Test fullscreen on mobile
          const fullscreenBtn = page.locator('[data-action="fullscreen"], button[aria-label*="fullscreen"]');
          if (await fullscreenBtn.count() > 0) {
            await fullscreenBtn.first().click();
            await page.waitForTimeout(1000);
          }
        }
      });

      test('mobile screen reader compatibility', async ({ page }) => {
        // Test ARIA landmarks
        const landmarks = page.locator('[role="banner"], [role="navigation"], [role="main"], [role="contentinfo"], [role="complementary"]');
        const landmarkCount = await landmarks.count();
        expect(landmarkCount).toBeGreaterThan(0);

        // Test heading structure
        const headings = page.locator('h1, h2, h3, h4, h5, h6');
        const headingCount = await headings.count();
        expect(headingCount).toBeGreaterThan(0);

        // Check for proper heading hierarchy
        let previousLevel = 0;
        for (let i = 0; i < Math.min(headingCount, 10); i++) {
          const heading = headings.nth(i);
          const level = parseInt(await heading.evaluate(el => el.tagName.substring(1)));
          
          if (i > 0) {
            expect(level).toBeLessThanOrEqual(previousLevel + 1);
          }
          previousLevel = level;
        }

        // Test live regions for dynamic content
        const liveRegions = page.locator('[aria-live]');
        const liveRegionCount = await liveRegions.count();
        
        for (let i = 0; i < liveRegionCount; i++) {
          const liveRegion = liveRegions.nth(i);
          const ariaLive = await liveRegion.getAttribute('aria-live');
          expect(['polite', 'assertive', 'off']).toContain(ariaLive);
        }
      });

      test('mobile responsive design', async ({ page }) => {
        // Test different orientations
        const viewport = page.viewportSize();
        
        if (viewport) {
          // Test portrait
          await page.setViewportSize({ width: viewport.width, height: viewport.height * 1.5 });
          await page.waitForTimeout(500);
          
          // Verify content is still accessible
          const mainContent = page.locator('main, [role="main"]');
          await expect(mainContent).toBeVisible();
          
          // Test landscape
          await page.setViewportSize({ width: viewport.height, height: viewport.width });
          await page.waitForTimeout(500);
          
          // Verify content is still accessible
          await expect(mainContent).toBeVisible();
        }

        // Test zoom functionality
        await page.evaluate(() => {
          document.body.style.zoom = '2';
        });
        await page.waitForTimeout(500);
        
        // Verify content remains usable when zoomed
        const navigation = page.locator('nav, [role="navigation"]');
        if (await navigation.count() > 0) {
          await expect(navigation.first()).toBeVisible();
        }
      });

      test('mobile accessibility compliance with axe', async ({ page }) => {
        const accessibilityScanResults = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
          .withRules(['touch-target-size', 'target-size'])
          .analyze();

        expect(accessibilityScanResults.violations).toEqual([]);
      });

      test('mobile gesture accessibility', async ({ page }) => {
        // Test swipe gestures on carousels or swipeable content
        const carousels = page.locator('.carousel, .swiper, [data-swipeable]');
        
        if (await carousels.count() > 0) {
          const carousel = carousels.first();
          
          // Test swipe right
          await carousel.evaluate((el) => {
            const touchStart = new TouchEvent('touchstart', {
              touches: [{ clientX: 100, clientY: 100 }]
            });
            const touchEnd = new TouchEvent('touchend', {
              changedTouches: [{ clientX: 200, clientY: 100 }]
            });
            
            el.dispatchEvent(touchStart);
            el.dispatchEvent(touchEnd);
          });
          
          await page.waitForTimeout(500);
          
          // Test swipe left
          await carousel.evaluate((el) => {
            const touchStart = new TouchEvent('touchstart', {
              touches: [{ clientX: 200, clientY: 100 }]
            });
            const touchEnd = new TouchEvent('touchend', {
              changedTouches: [{ clientX: 100, clientY: 100 }]
            });
            
            el.dispatchEvent(touchStart);
            el.dispatchEvent(touchEnd);
          });
          
          await page.waitForTimeout(500);
        }

        // Test pull-to-refresh if available
        const pullToRefresh = page.locator('[data-pull-to-refresh]');
        if (await pullToRefresh.count() > 0) {
          await pullToRefresh.first().evaluate((el) => {
            // Simulate pull down gesture
            const touchStart = new TouchEvent('touchstart', {
              touches: [{ clientX: 200, clientY: 50 }]
            });
            const touchMove = new TouchEvent('touchmove', {
              touches: [{ clientX: 200, clientY: 200 }]
            });
            const touchEnd = new TouchEvent('touchend', {
              changedTouches: [{ clientX: 200, clientY: 200 }]
            });
            
            el.dispatchEvent(touchStart);
            el.dispatchEvent(touchMove);
            el.dispatchEvent(touchEnd);
          });
          
          await page.waitForTimeout(1000);
        }
      });
    });
  });

  test.describe('Mobile Accessibility - Cross-Device Consistency', () => {
    test('consistent accessibility across devices', async ({ page }) => {
      const devices = ['iPhone 14', 'Pixel 5', 'iPad Pro'];
      const accessibilityResults = [];
      
      for (const deviceName of devices) {
        const device = devices[deviceName as keyof typeof devices];
        
        await page.goto('/');
        await page.waitForLoadState('networkidle');
        
        // Run accessibility scan
        const scanResults = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
          .analyze();
        
        accessibilityResults.push({
          device: deviceName,
          violations: scanResults.violations.length,
          passes: scanResults.passes.length
        });
      }
      
      // Verify consistent accessibility across devices
      const violationCounts = accessibilityResults.map(r => r.violations);
      const maxViolations = Math.max(...violationCounts);
      const minViolations = Math.min(...violationCounts);
      
      // Should have no violations on any device
      expect(maxViolations).toBe(0);
      expect(minViolations).toBe(0);
    });
  });
});
```

## Test Environment Setup

### Required Tools
1. **Mobile Devices**:
   - iOS devices (iPhone, iPad)
   - Android devices (various manufacturers)
   - Tablets and foldable devices

2. **Screen Readers**:
   - VoiceOver (iOS)
   - TalkBack (Android)
   - Switch Control (iOS)
   - Select to Speak (Android)

3. **Testing Tools**:
   - Browser DevTools mobile emulation
   - Playwright mobile device testing
   - Axe DevTools for mobile
   - Mobile accessibility testing tools

### Environment Variables
```typescript
// test/config/mobile.ts
export const mobileTestConfig = {
  devices: {
    'iPhone 14': { width: 390, height: 844, deviceScaleFactor: 3 },
    'iPad Pro': { width: 1024, height: 1366, deviceScaleFactor: 2 },
    'Pixel 5': { width: 393, height: 851, deviceScaleFactor: 2.625 },
    'Galaxy S9+': { width: 360, height: 740, deviceScaleFactor: 3 }
  },
  touchTargetRequirements: {
    minSize: 44,
    spacing: 8,
    maxDensity: 10 // targets per square inch
  },
  performanceThresholds: {
    loadTime: 3000,
    touchResponse: 100,
    screenReaderResponse: 200,
    batteryImpact: 10
  },
  accessibilityFeatures: {
    voiceOver: true,
    talkBack: true,
    switchControl: true,
    voiceControl: true,
    zoomText: true,
    highContrast: true,
    reducedMotion: true
  }
};
```

## Success Criteria

### Functional Requirements
- ✅ All touch targets meet 44x44px minimum size
- ✅ Mobile screen readers work correctly
- ✅ Keyboard navigation is fully functional
- ✅ Responsive design maintains accessibility
- ✅ Mobile-specific features are accessible
- ✅ Forms work correctly on mobile devices
- ✅ No accessibility violations in automated testing

### Technical Requirements
- ✅ 100% compliance with WCAG 2.1 Level AA
- ✅ Cross-device consistency maintained
- ✅ Performance impact is minimal
- ✅ Battery consumption is reasonable
- ✅ Touch response times are acceptable
- ✅ Gesture accessibility is implemented

### User Experience Requirements
- ✅ Mobile navigation is intuitive and accessible
- ✅ Content consumption is fully accessible
- ✅ Form completion is possible for all users
- ✅ Video and media are accessible on mobile
- ✅ Screen reader users can navigate efficiently
- ✅ Alternative input methods are supported

## Bug Reporting Template

### Issue Title
`[Mobile Accessibility] Issue: [Specific Feature/Device]`

### Environment
- **Device**: [Device model and OS version]
- **Browser**: [Mobile browser and version]
- **Screen Reader**: [Screen reader and version]
- **Orientation**: [Portrait/Landscape]
- **Viewport**: [Width x Height]

### Description
[Detailed description of the mobile accessibility issue]

### Steps to Reproduce
1. Open [URL] on [device]
2. Attempt to [specific mobile action]
3. Observe [accessibility barrier]

### Expected Behavior
[What should happen with proper mobile accessibility]

### Actual Behavior
[What actually happens]

### Screen Reader Output
[Exact text announced by mobile screen reader]

### Touch Target Details
- **Element**: [button/link/input]
- **Current Size**: [width x height]
- **Required Size**: [44x44px minimum]
- **Spacing**: [distance to nearest target]

### Suggested Fix
[Recommended solution for the mobile accessibility issue]

### Priority
[High/Medium/Low based on impact on mobile users]

## Related Test Cases

- **TCACC001**: Keyboard Navigation and Focus Management
- **TCACC002**: Screen Reader Compatibility
- **TCACC005**: Form Accessibility
- **TCACC006**: Video and Media Accessibility
- **TCACC008**: Cognitive Accessibility

## Documentation References

- [WCAG 2.1 Mobile Accessibility](https://www.w3.org/WAI/WCAG21/techniques/mobile/)
- [Apple VoiceOver Guidelines](https://developer.apple.com/accessibility/ios/)
- [Android TalkBack Guidelines](https://developer.android.com/guide/topics/ui/accessibility)
- [Mobile Accessibility Testing Guide](https://www.w3.org/WAI/mobile/)
- [Touch Target Size Guidelines](https://www.w3.org/WAI/WCAG21/Understanding/target-size.html)

---

**Test Case Status**: Ready for Implementation
**Last Updated**: 2024-11-18
**Next Review**: 2024-12-18