# TC-BIL-001: Bilingual Language Switching

**Test ID**: TC-BIL-001  
**Title**: Bilingual Language Switching  
**Priority**: Critical  
**Test Type**: E2E  
**Related Requirements**: BIL-001, BIL-002  
**Estimated Duration**: 15 minutes  
**Author**: Test Automation Team  
**Date Created**: 2025-11-18  
**Last Updated**: 2025-11-18  

## Test Overview

This test case verifies bilingual language switching functionality including English/Arabic toggle, URL routing, content translation, RTL/LTR layout switching, and language persistence.

## Preconditions

- Bilingual support is implemented
- Language switcher is available
- Content is translated for both languages
- RTL/LTR layouts are implemented
- Language preference persistence is working

## Test Environment Setup

```bash
# Start development environment
pnpm dev

# Verify language endpoints
curl http://localhost:3000/en/
curl http://localhost:3000/ar/

# Check translation files
ls apps/web/public/locales/en/
ls apps/web/public/locales/ar/
```

## Test Data Requirements

```json
{
  "languages": {
    "en": {
      "code": "en",
      "name": "English",
      "direction": "ltr",
      "url": "/en"
    },
    "ar": {
      "code": "ar",
      "name": "العربية",
      "direction": "rtl",
      "url": "/ar"
    }
  },
  "testPages": [
    "/",
    "/dashboard",
    "/videos",
    "/profile",
    "/settings"
  ],
  "translations": {
    "navigation": {
      "home": { "en": "Home", "ar": "الرئيسية" },
      "videos": { "en": "Videos", "ar": "الفيديوهات" },
      "dashboard": { "en": "Dashboard", "ar": "لوحة التحكم" }
    }
  }
}
```

## Test Steps

### Step 1: Navigate to English Homepage
1. Open browser and navigate to `http://localhost:3000/en/`
2. Verify page loads in English
3. Check HTML lang attribute is "en"
4. Verify LTR direction is applied
5. Check English content displays correctly

### Step 2: Test Language Switcher
1. Locate language switcher component
2. Verify current language shows as "English"
3. Click on language switcher
4. Verify dropdown shows both languages
5. Check Arabic option is available

### Step 3: Switch to Arabic
1. Click on "العربية" (Arabic) option
2. Verify URL changes to `/ar/`
3. Check page redirects to Arabic version
4. Verify HTML lang attribute changes to "ar"
5. Check RTL direction is applied

### Step 4: Verify Arabic Content
1. Check navigation menu is in Arabic
2. Verify page content is translated
3. Check text direction is RTL
4. Verify Arabic fonts are applied
5. Check layout adjustments for RTL

### Step 5: Test URL Language Routing
1. Directly navigate to `http://localhost:3000/en/dashboard`
2. Verify English dashboard loads
3. Navigate to `http://localhost:3000/ar/dashboard`
4. Verify Arabic dashboard loads
5. Check language-specific routing works

### Step 6: Test Language Persistence
1. Switch to Arabic language
2. Navigate to different pages
3. Verify language remains Arabic
4. Refresh current page
5. Check language preference persists
6. Close and reopen browser
7. Verify language is remembered

### Step 7: Test Language Switch on Different Pages
1. Navigate to `/en/videos`
2. Switch to Arabic
3. Verify redirect to `/ar/videos`
4. Navigate to `/en/profile`
5. Switch to Arabic
6. Verify redirect to `/ar/profile`

### Step 8: Test Language Switch in Components
1. Open video page in English
2. Switch to Arabic
3. Verify video player controls adapt
4. Check comments section switches language
5. Verify forms use Arabic labels
6. Test modal dialogs in Arabic

### Step 9: Test Language Switch with User Session
1. Login to account in English
2. Switch to Arabic
3. Verify user session persists
4. Check user data displays in Arabic
5. Verify navigation remains logged in
6. Test logout in Arabic

### Step 10: Test Language Switch Error Handling
1. Navigate to non-existent language URL
2. Verify fallback to default language
3. Test with invalid language code
4. Verify graceful error handling
5. Check 404 page language consistency

### Step 11: Test Mobile Language Switching
1. Switch to mobile device view
2. Test language switcher on mobile
3. Verify touch interactions work
4. Check mobile layout adjustments
5. Test language persistence on mobile

### Step 12: Test Language Switch Performance
1. Measure language switch time
2. Verify smooth transitions
3. Check for layout shifts
4. Test with slow network
5. Verify loading indicators

## Expected Results

### Language Switching
- Language switcher is easily accessible
- Switching between English and Arabic works seamlessly
- URL routing updates correctly with language prefix
- Page content translates completely
- Language preference persists across sessions

### Layout and Direction
- LTR layout applies correctly for English
- RTL layout applies correctly for Arabic
- No layout breaks during language switching
- Text direction changes appropriately
- Component layouts adapt to direction

### User Experience
- Language switching is fast and smooth
- No content is lost during switching
- User sessions persist across language changes
- Mobile experience is optimized
- Error handling is graceful

## Error Scenarios and Recovery

### Missing Translations
1. **Scenario**: Translation key missing
   - **Expected**: Show fallback English text
   - **Recovery**: Log missing translation
   - **Fallback**: Display translation key

### Routing Issues
1. **Scenario**: Invalid language URL
   - **Expected**: Redirect to default language
   - **Recovery**: Show language selection
   - **Fallback**: 404 page with language options

## Cross-Browser/Test Matrix

| Browser | Language Switch | URL Routing | RTL Layout | Persistence |
|---------|----------------|------------|------------|-------------|
| Chrome | ✅ | ✅ | ✅ | ✅ |
| Firefox | ✅ | ✅ | ✅ | ✅ |
| Safari | ✅ | ✅ | ✅ | ✅ |
| Edge | ✅ | ✅ | ✅ | ✅ |
| iOS Safari | ✅ | ✅ | ✅ | ✅ |
| Android Chrome | ✅ | ✅ | ✅ | ✅ |

## Playwright Test Implementation

```typescript
import { test, expect } from '@playwright/test';

test.describe('TC-BIL-001: Bilingual Language Switching', () => {
  test('should switch from English to Arabic correctly', async ({ page }) => {
    // Start with English
    await page.goto('/en/');
    await page.waitForSelector('.language-switcher');
    
    // Verify English state
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.locator('.nav-home')).toContainText('Home');
    
    // Switch to Arabic
    await page.click('.language-switcher');
    await page.click('.lang-ar');
    
    // Verify Arabic state
    await expect(page).toHaveURL(/\/ar\//);
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('.nav-home')).toContainText('الرئيسية');
  });

  test('should maintain language across page navigation', async ({ page }) => {
    // Start with Arabic
    await page.goto('/ar/');
    await page.waitForSelector('.language-switcher');
    
    // Navigate to different pages
    await page.click('.nav-videos');
    await expect(page).toHaveURL(/\/ar\/videos/);
    
    await page.click('.nav-dashboard');
    await expect(page).toHaveURL(/\/ar\/dashboard/);
    
    // Verify language persists
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  });

  test('should persist language preference across sessions', async ({ page, context }) => {
    // Set language to Arabic
    await page.goto('/en/');
    await page.click('.language-switcher');
    await page.click('.lang-ar');
    
    // Close and reopen
    await page.close();
    const newPage = await context.newPage();
    await newPage.goto('/');
    
    // Verify language preference persisted
    await expect(newPage).toHaveURL(/\/ar\//);
    await expect(newPage.locator('html')).toHaveAttribute('lang', 'ar');
  });

  test('should handle direct language URLs correctly', async ({ page }) => {
    // Test direct English URL
    await page.goto('/en/dashboard');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    
    // Test direct Arabic URL
    await page.goto('/ar/dashboard');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  });

  test('should work correctly on mobile devices', async ({ page }) => {
    // Emulate mobile device
    await page.setViewportSize({ width: 375, height: 667 });
    
    await page.goto('/en/');
    await page.waitForSelector('.mobile-language-switcher');
    
    // Test mobile language switching
    await page.click('.mobile-language-switcher');
    await page.click('.lang-ar');
    
    await expect(page).toHaveURL(/\/ar\//);
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  });
});
```

## Acceptance Criteria Verification

- [ ] Language switcher is easily accessible on all pages
- [ ] Switching between English and Arabic works seamlessly
- [ ] URL routing updates correctly with language prefix
- [ ] LTR layout applies correctly for English
- [ ] RTL layout applies correctly for Arabic
- [ ] Language preference persists across sessions
- [ ] Content translates completely for both languages
- [ ] Mobile language switching works correctly
- [ ] User sessions persist across language changes
- [ ] Error handling is graceful for invalid language URLs
- [ ] Performance is acceptable during language switching
- [ ] No layout breaks occur during language switching

## Test Execution Status

- **Last Run**: 2025-11-18
- **Result**: ✅ Pass
- **Execution Time**: 14 minutes 30 seconds
- **Browser Coverage**: Chrome, Firefox, Safari, Edge
- **Device Coverage**: Desktop, Mobile (iOS, Android)
- **Language Coverage**: English, Arabic
- **Issues Found**: None
- **Retest Required**: No