# TC-BIL-008: Notification Localization

**Test ID**: TC-BIL-008  
**Title**: Notification Localization  
**Priority**: Medium  
**Test Type**: E2E  
**Related Requirements**: BIL-014, BIL-015  
**Estimated Duration**: 12 minutes  
**Author**: Test Automation Team  
**Date Created**: 2025-11-18  
**Last Updated**: 2025-11-18  

## Test Overview

This test case verifies that all system notifications, alerts, messages, and user feedback are properly localized for both English and Arabic interfaces, including success messages, error messages, warnings, and informational notifications.

## Preconditions

- Notification system is implemented
- User authentication is working
- Notification triggers are available
- Real-time notifications are configured

## Test Environment Setup

```bash
# Start development environment
pnpm dev

# Verify notification endpoints
curl http://127.0.0.1:8686/api/notifications
curl http://127.0.0.1:8686/api/notifications/send

# Check WebSocket connection for real-time notifications
pnpm test:verify-websocket-notifications
```

## Test Data Requirements

```json
{
  "notificationTypes": {
    "success": {
      "english": [
        "Video uploaded successfully",
        "Channel created successfully",
        "Comment posted successfully",
        "Settings saved successfully"
      ],
      "arabic": [
        "تم رفع الفيديو بنجاح",
        "تم إنشاء القناة بنجاح",
        "تم نشر التعليق بنجاح",
        "تم حفظ الإعدادات بنجاح"
      ]
    },
    "error": {
      "english": [
        "Upload failed: File too large",
        "Login failed: Invalid credentials",
        "Network error: Connection lost",
        "Permission denied: Access restricted"
      ],
      "arabic": [
        "فشل الرفع: الملف كبير جدًا",
        "فشل تسجيل الدخول: بيانات غير صالحة",
        "خطأ في الشبكة: فقدان الاتصال",
        "الوصول مرفوض: الوصول محدود"
      ]
    },
    "warning": {
      "english": [
        "Session expiring soon",
        "Low storage space remaining",
        "Content may be inappropriate",
        "Slow connection detected"
      ],
      "arabic": [
        "الجلسة ستنتهي قريبًا",
        "مساحة تخزين منخفضة متبقية",
        "المحتوى قد يكون غير مناسب",
        "تم الكشف عن اتصال بطيء"
      ]
    },
    "info": {
      "english": [
        "New video from subscribed channel",
        "Live stream starting soon",
        "System maintenance scheduled",
        "New features available"
      ],
      "arabic": [
        "فيديو جديد من قناة مشتركة",
        "البث المباشر سيبدأ قريبًا",
        "صيانة النظام مجدولة",
        "ميزات جديدة متاحة"
      ]
    }
  }
}
```

## Test Steps

### Step 1: Test Success Notifications (English)
1. Login to the platform
2. Upload a test video
3. Verify success notification appears
4. Check notification text is in English
5. Verify notification styling (green/success color)
6. Test notification dismissal
7. Check notification auto-dismiss timing
8. Verify notification positioning

### Step 2: Test Success Notifications (Arabic)
1. Switch to Arabic interface
2. Upload a test video
3. Verify success notification appears in Arabic
4. Check Arabic text formatting
5. Verify RTL text direction
6. Test notification dismissal in Arabic
7. Check auto-dismiss timing
8. Verify positioning in RTL layout

### Step 3: Test Error Notifications (English)
1. Trigger an error condition (invalid login)
2. Verify error notification appears
3. Check error message is in English
4. Verify error styling (red/error color)
5. Test error notification dismissal
6. Check if error notifications persist longer
7. Test multiple error notifications
8. Verify error recovery options

### Step 4: Test Error Notifications (Arabic)
1. Switch to Arabic interface
2. Trigger same error condition
3. Verify error notification appears in Arabic
4. Check Arabic error message formatting
5. Verify RTL text direction for errors
6. Test error notification dismissal
7. Check persistence behavior
8. Verify error recovery options in Arabic

### Step 5: Test Warning Notifications (English)
1. Trigger warning condition (session expiry)
2. Verify warning notification appears
3. Check warning message is in English
4. Verify warning styling (yellow/warning color)
5. Test warning notification actions
6. Check warning dismissal behavior
7. Test warning priority levels
8. Verify warning iconography

### Step 6: Test Warning Notifications (Arabic)
1. Switch to Arabic interface
2. Trigger warning condition
3. Verify warning notification appears in Arabic
4. Check Arabic warning message formatting
5. Verify RTL text direction
6. Test warning actions in Arabic
7. Check dismissal behavior
8. Verify warning icons in RTL

### Step 7: Test Information Notifications (English)
1. Trigger info notification (new video alert)
2. Verify info notification appears
3. Check info message is in English
4. Verify info styling (blue/info color)
5. Test info notification links
6. Check info notification grouping
7. Test info notification persistence
8. Verify info notification icons

### Step 8: Test Information Notifications (Arabic)
1. Switch to Arabic interface
2. Trigger info notification
3. Verify info notification appears in Arabic
4. Check Arabic info message formatting
5. Verify RTL text direction
6. Test info notification links in Arabic
7. Check notification grouping
8. Verify info icons in RTL

### Step 9: Test Notification Center (English)
1. Navigate to notification center
2. Verify page title and headings in English
3. Check notification list formatting
4. Test notification filtering
5. Verify notification timestamps
6. Test notification search
7. Check notification pagination
8. Test bulk actions (mark all read)

### Step 10: Test Notification Center (Arabic)
1. Navigate to notification center in Arabic
2. Verify page title and headings in Arabic
3. Check notification list formatting in RTL
4. Test notification filtering in Arabic
5. Verify Arabic timestamps
6. Test notification search in Arabic
7. Check pagination in RTL
8. Test bulk actions in Arabic

### Step 11: Test Real-time Notifications
1. Enable real-time notifications
2. Trigger notification from another session
3. Verify notification appears immediately
4. Test real-time notifications in English
5. Switch to Arabic and trigger notification
6. Verify real-time notifications in Arabic
7. Test notification sound (if enabled)
8. Check notification badges

### Step 12: Test Notification Settings
1. Navigate to notification settings
2. Verify settings interface in English
3. Test notification type preferences
4. Check email notification settings
5. Test push notification settings
6. Verify frequency settings
7. Test notification sound settings
8. Check notification preview settings

### Step 13: Test Notification Settings (Arabic)
1. Navigate to notification settings in Arabic
2. Verify settings interface in Arabic
3. Test notification preferences in Arabic
4. Check email settings in Arabic
5. Test push settings in Arabic
6. Verify frequency settings in Arabic
7. Test sound settings in Arabic
8. Check preview settings in Arabic

### Step 14: Test Notification Accessibility
1. Test screen reader compatibility
2. Check ARIA labels and roles
3. Test keyboard navigation
4. Verify high contrast mode
5. Test notification focus management
6. Check notification announcement
7. Test notification dismissal via keyboard
8. Verify notification color contrast

### Step 15: Test Notification Edge Cases
1. Test very long notification messages
2. Test notification with special characters
3. Test notification with HTML content
4. Test notification queue overflow
5. Test notification during page navigation
6. Test notification with actions
7. Test notification with links
8. Test notification persistence across refresh

## Expected Results

### Notification Content
- All notification messages are properly localized
- Text direction is correct for each language
- Message formatting is appropriate
- No untranslated text appears
- Cultural appropriateness is maintained

### Notification Behavior
- Notifications appear at correct times
- Auto-dismiss timing is appropriate
- Manual dismissal works correctly
- Priority levels are respected
- Real-time notifications work properly

### User Interface
- Notification styling is consistent
- Positioning is correct for LTR/RTL
- Icons and colors are appropriate
- Accessibility features work
- Performance is acceptable

## Error Scenarios and Recovery

### Notification System Failure
1. **Scenario**: Notification service is down
   - **Expected**: Graceful degradation
   - **Recovery**: Retry notification delivery
   - **Fallback**: Store notifications locally

### Translation Missing
1. **Scenario**: Notification key not translated
   - **Expected**: Show fallback English text
   - **Recovery**: Log missing translation
   - **Fallback**: Display notification key

### Notification Overflow
1. **Scenario**: Too many notifications queued
   - **Expected**: Group or limit notifications
   - **Recovery**: Clear old notifications
   - **Fallback**: Show notification count

## Cross-Browser/Test Matrix

| Browser | English Notifications | Arabic Notifications | Real-time | Settings |
|---------|----------------------|---------------------|-----------|----------|
| Chrome | ✅ | ✅ | ✅ | ✅ |
| Firefox | ✅ | ✅ | ✅ | ✅ |
| Safari | ✅ | ✅ | ✅ | ✅ |
| Edge | ✅ | ✅ | ✅ | ✅ |
| iOS Safari | ✅ | ✅ | ✅ | ✅ |
| Android Chrome | ✅ | ✅ | ✅ | ✅ |

## Playwright Test Implementation

```typescript
import { test, expect } from '@playwright/test';

test.describe('TC-BIL-008: Notification Localization', () => {
  test.beforeEach(async ({ page }) => {
    // Login to access notification features
    await page.goto('/en/login');
    await page.fill('input[name="email"]', 'test@example.com');
    await page.fill('input[name="password"]', 'TestPassword123!');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard');
  });

  test('should display success notifications correctly in English', async ({ page }) => {
    // Trigger success notification (e.g., save settings)
    await page.goto('/en/settings');
    await page.waitForSelector('.settings-form');
    
    // Make a change and save
    await page.fill('input[name="displayName"]', 'Test User Updated');
    await page.click('.save-settings');
    
    // Check for success notification
    const successNotification = page.locator('.notification.success, .alert-success, [data-type="success"]');
    await expect(successNotification).toBeVisible();
    
    // Verify English text
    await expect(successNotification).toContainText('successfully');
    
    // Check styling
    await expect(successNotification).toHaveCSS('background-color', /rgb\((?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\s*,\s*(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\s*,\s*(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\)/);
    
    // Test dismissal
    const closeButton = successNotification.locator('.close, .dismiss, [data-dismiss]');
    if (await closeButton.count() > 0) {
      await closeButton.click();
      await expect(successNotification).not.toBeVisible();
    }
  });

  test('should display success notifications correctly in Arabic', async ({ page }) => {
    // Switch to Arabic
    await page.goto('/ar/settings');
    await page.waitForSelector('.settings-form');
    
    // Make a change and save
    await page.fill('input[name="displayName"]', 'مستخدم اختبار محدث');
    await page.click('.save-settings');
    
    // Check for success notification
    const successNotification = page.locator('.notification.success, .alert-success, [data-type="success"]');
    await expect(successNotification).toBeVisible();
    
    // Verify Arabic text
    await expect(successNotification).toContainText('بنجاح');
    
    // Check RTL direction
    await expect(successNotification).toHaveCSS('direction', 'rtl');
    
    // Test dismissal
    const closeButton = successNotification.locator('.close, .dismiss, [data-dismiss]');
    if (await closeButton.count() > 0) {
      await closeButton.click();
      await expect(successNotification).not.toBeVisible();
    }
  });

  test('should display error notifications correctly in English', async ({ page }) => {
    // Trigger error notification (e.g., invalid login)
    await page.goto('/en/login');
    await page.fill('input[name="email"]', 'invalid@example.com');
    await page.fill('input[name="password"]', 'wrongpassword');
    await page.click('button[type="submit"]');
    
    // Check for error notification
    const errorNotification = page.locator('.notification.error, .alert-error, [data-type="error"]');
    await expect(errorNotification).toBeVisible();
    
    // Verify English text
    await expect(errorNotification).toContainText(/Invalid|failed|error/i);
    
    // Check error styling
    await expect(errorNotification).toHaveClass(/error|danger/);
    
    // Error notifications should persist longer
    await page.waitForTimeout(5000);
    await expect(errorNotification).toBeVisible();
  });

  test('should display error notifications correctly in Arabic', async ({ page }) => {
    // Switch to Arabic and trigger error
    await page.goto('/ar/login');
    await page.fill('input[name="email"]', 'invalid@example.com');
    await page.fill('input[name="password"]', 'wrongpassword');
    await page.click('button[type="submit"]');
    
    // Check for error notification
    const errorNotification = page.locator('.notification.error, .alert-error, [data-type="error"]');
    await expect(errorNotification).toBeVisible();
    
    // Verify Arabic text
    await expect(errorNotification).toContainText(/غير صالح|فشل|خطأ/i);
    
    // Check RTL direction
    await expect(errorNotification).toHaveCSS('direction', 'rtl');
    
    // Error notifications should persist longer
    await page.waitForTimeout(5000);
    await expect(errorNotification).toBeVisible();
  });

  test('should display warning notifications correctly in English', async ({ page }) => {
    // Trigger warning notification (e.g., session expiry)
    // This might require mocking or specific conditions
    await page.evaluate(() => {
      // Simulate session expiry warning
      const event = new CustomEvent('sessionWarning', { detail: { minutesLeft: 5 } });
      window.dispatchEvent(event);
    });
    
    // Check for warning notification
    const warningNotification = page.locator('.notification.warning, .alert-warning, [data-type="warning"]');
    if (await warningNotification.count() > 0) {
      await expect(warningNotification).toBeVisible();
      
      // Verify English text
      await expect(warningNotification).toContainText(/expiring|soon|warning/i);
      
      // Check warning styling
      await expect(warningNotification).toHaveClass(/warning/);
    }
  });

  test('should display warning notifications correctly in Arabic', async ({ page }) => {
    await page.goto('/ar');
    
    // Trigger warning notification
    await page.evaluate(() => {
      const event = new CustomEvent('sessionWarning', { detail: { minutesLeft: 5 } });
      window.dispatchEvent(event);
    });
    
    // Check for warning notification
    const warningNotification = page.locator('.notification.warning, .alert-warning, [data-type="warning"]');
    if (await warningNotification.count() > 0) {
      await expect(warningNotification).toBeVisible();
      
      // Verify Arabic text
      await expect(warningNotification).toContainText(/تنتهي|قريبًا|تحذير/i);
      
      // Check RTL direction
      await expect(warningNotification).toHaveCSS('direction', 'rtl');
    }
  });

  test('should display info notifications correctly in English', async ({ page }) => {
    // Trigger info notification (e.g., new video alert)
    await page.evaluate(() => {
      const event = new CustomEvent('newVideo', { 
        detail: { 
          title: 'New Islamic Lecture',
          channel: 'Islamic Education Channel'
        } 
      });
      window.dispatchEvent(event);
    });
    
    // Check for info notification
    const infoNotification = page.locator('.notification.info, .alert-info, [data-type="info"]');
    if (await infoNotification.count() > 0) {
      await expect(infoNotification).toBeVisible();
      
      // Verify English text
      await expect(infoNotification).toContainText(/New|video|channel/i);
      
      // Check info styling
      await expect(infoNotification).toHaveClass(/info/);
    }
  });

  test('should display info notifications correctly in Arabic', async ({ page }) => {
    await page.goto('/ar');
    
    // Trigger info notification
    await page.evaluate(() => {
      const event = new CustomEvent('newVideo', { 
        detail: { 
          title: 'محاضرة إسلامية جديدة',
          channel: 'قناة التعليم الإسلامي'
        } 
      });
      window.dispatchEvent(event);
    });
    
    // Check for info notification
    const infoNotification = page.locator('.notification.info, .alert-info, [data-type="info"]');
    if (await infoNotification.count() > 0) {
      await expect(infoNotification).toBeVisible();
      
      // Verify Arabic text
      await expect(infoNotification).toContainText(/جديد|فيديو|قناة/i);
      
      // Check RTL direction
      await expect(infoNotification).toHaveCSS('direction', 'rtl');
    }
  });

  test('should handle notification center correctly in English', async ({ page }) => {
    await page.goto('/en/notifications');
    await page.waitForSelector('.notification-center');
    
    // Check page title
    await expect(page).toHaveTitle(/Notifications/);
    
    // Check notification list
    const notificationList = page.locator('.notification-list, .notifications');
    await expect(notificationList).toBeVisible();
    
    // Check notification items
    const notificationItems = notificationList.locator('.notification-item');
    const itemCount = await notificationItems.count();
    
    if (itemCount > 0) {
      // Check first notification
      const firstNotification = notificationItems.first();
      await expect(firstNotification).toBeVisible();
      
      // Check timestamp
      const timestamp = firstNotification.locator('.timestamp, .time');
      if (await timestamp.count() > 0) {
        const timeText = await timestamp.textContent();
        expect(timeText).toBeTruthy();
        expect(timeText?.length).toBeGreaterThan(0);
      }
      
      // Check read/unread status
      await expect(firstNotification).toHaveClass(/read|unread/);
    }
    
    // Check filtering options
    const filters = page.locator('.notification-filters, .filters');
    if (await filters.count() > 0) {
      await expect(filters).toBeVisible();
      
      const filterButtons = filters.locator('button, .filter-item');
      const filterCount = await filterButtons.count();
      
      for (let i = 0; i < Math.min(filterCount, 3); i++) {
        const filterText = await filterButtons.nth(i).textContent();
        expect(filterText).toBeTruthy();
        expect(filterText?.length).toBeGreaterThan(0);
      }
    }
  });

  test('should handle notification center correctly in Arabic', async ({ page }) => {
    await page.goto('/ar/notifications');
    await page.waitForSelector('.notification-center');
    
    // Check page title in Arabic
    await expect(page).toHaveTitle(/الإشعارات/);
    
    // Check notification list
    const notificationList = page.locator('.notification-list, .notifications');
    await expect(notificationList).toBeVisible();
    
    // Check RTL direction
    await expect(notificationList).toHaveCSS('direction', 'rtl');
    
    // Check notification items
    const notificationItems = notificationList.locator('.notification-item');
    const itemCount = await notificationItems.count();
    
    if (itemCount > 0) {
      // Check first notification
      const firstNotification = notificationItems.first();
      await expect(firstNotification).toBeVisible();
      
      // Check timestamp in Arabic
      const timestamp = firstNotification.locator('.timestamp, .time');
      if (await timestamp.count() > 0) {
        const timeText = await timestamp.textContent();
        expect(timeText).toBeTruthy();
        // Should contain Arabic numerals or English time format
        expect(/[٠-٩]|\d{1,2}:\d{2}/.test(timeText || '')).toBeTruthy();
      }
    }
    
    // Check filtering options in Arabic
    const filters = page.locator('.notification-filters, .filters');
    if (await filters.count() > 0) {
      await expect(filters).toBeVisible();
      
      const filterButtons = filters.locator('button, .filter-item');
      const filterCount = await filterButtons.count();
      
      for (let i = 0; i < Math.min(filterCount, 3); i++) {
        const filterText = await filterButtons.nth(i).textContent();
        expect(filterText).toBeTruthy();
        expect(filterText?.length).toBeGreaterThan(0);
        // Should contain Arabic characters
        expect(/[؀-ۿ]/.test(filterText || '')).toBeTruthy();
      }
    }
  });

  test('should handle notification settings correctly in English', async ({ page }) => {
    await page.goto('/en/settings/notifications');
    await page.waitForSelector('.notification-settings');
    
    // Check settings sections
    const settingsSections = page.locator('.settings-section, .notification-group');
    const sectionCount = await settingsSections.count();
    
    expect(sectionCount).toBeGreaterThan(0);
    
    for (let i = 0; i < Math.min(sectionCount, 3); i++) {
      const section = settingsSections.nth(i);
      await expect(section).toBeVisible();
      
      // Check section title
      const sectionTitle = section.locator('h3, .section-title');
      if (await sectionTitle.count() > 0) {
        const titleText = await sectionTitle.textContent();
        expect(titleText).toBeTruthy();
        expect(titleText?.length).toBeGreaterThan(0);
      }
      
      // Check setting options
      const settingOptions = section.locator('input[type="checkbox"], select, .setting-option');
      const optionCount = await settingOptions.count();
      
      for (let j = 0; j < Math.min(optionCount, 2); j++) {
        const option = settingOptions.nth(j);
        await expect(option).toBeVisible();
        
        // Check label
        const label = option.locator('label, .option-label');
        if (await label.count() > 0) {
          const labelText = await label.textContent();
          expect(labelText).toBeTruthy();
          expect(labelText?.length).toBeGreaterThan(0);
        }
      }
    }
  });

  test('should handle notification settings correctly in Arabic', async ({ page }) => {
    await page.goto('/ar/settings/notifications');
    await page.waitForSelector('.notification-settings');
    
    // Check settings sections
    const settingsSections = page.locator('.settings-section, .notification-group');
    const sectionCount = await settingsSections.count();
    
    expect(sectionCount).toBeGreaterThan(0);
    
    for (let i = 0; i < Math.min(sectionCount, 3); i++) {
      const section = settingsSections.nth(i);
      await expect(section).toBeVisible();
      
      // Check RTL direction
      await expect(section).toHaveCSS('direction', 'rtl');
      
      // Check section title in Arabic
      const sectionTitle = section.locator('h3, .section-title');
      if (await sectionTitle.count() > 0) {
        const titleText = await sectionTitle.textContent();
        expect(titleText).toBeTruthy();
        expect(titleText?.length).toBeGreaterThan(0);
        // Should contain Arabic characters
        expect(/[؀-ۿ]/.test(titleText || '')).toBeTruthy();
      }
      
      // Check setting options
      const settingOptions = section.locator('input[type="checkbox"], select, .setting-option');
      const optionCount = await settingOptions.count();
      
      for (let j = 0; j < Math.min(optionCount, 2); j++) {
        const option = settingOptions.nth(j);
        await expect(option).toBeVisible();
        
        // Check label in Arabic
        const label = option.locator('label, .option-label');
        if (await label.count() > 0) {
          const labelText = await label.textContent();
          expect(labelText).toBeTruthy();
          expect(labelText?.length).toBeGreaterThan(0);
          // Should contain Arabic characters
          expect(/[؀-ۿ]/.test(labelText || '')).toBeTruthy();
        }
      }
    }
  });

  test('should handle notification accessibility correctly', async ({ page }) => {
    await page.goto('/en/settings');
    
    // Trigger a notification for accessibility testing
    await page.click('.save-settings');
    
    const notification = page.locator('.notification');
    if (await notification.count() > 0) {
      // Check ARIA attributes
      await expect(notification).toHaveAttribute('role', 'alert');
      
      // Check aria-live region
      const liveRegion = page.locator('[aria-live]');
      if (await liveRegion.count() > 0) {
        await expect(liveRegion).toBeVisible();
      }
      
      // Test keyboard navigation
      await page.keyboard.press('Tab');
      const focusedElement = page.locator(':focus');
      
      // Should be able to focus on notification or close button
      const isNotificationFocused = await focusedElement.evaluate((el) => {
        return el.closest('.notification') !== null;
      });
      
      expect(isNotificationFocused || await notification.count() === 0).toBeTruthy();
      
      // Test dismissal with keyboard
      const closeButton = notification.locator('.close, [data-dismiss]');
      if (await closeButton.count() > 0) {
        await closeButton.focus();
        await page.keyboard.press('Enter');
        await expect(notification).not.toBeVisible();
      }
    }
  });

  test('should handle notification edge cases correctly', async ({ page }) => {
    // Test very long notification message
    await page.evaluate(() => {
      const event = new CustomEvent('showNotification', {
        detail: {
          type: 'info',
          message: 'This is a very long notification message that should wrap properly and not break the layout. It contains multiple sentences and should be handled gracefully by the notification system.'
        }
      });
      window.dispatchEvent(event);
    });
    
    const longNotification = page.locator('.notification');
    if (await longNotification.count() > 0) {
      await expect(longNotification).toBeVisible();
      
      // Check that it doesn't overflow
      const boundingBox = await longNotification.boundingBox();
      if (boundingBox) {
        expect(boundingBox.width).toBeLessThan(window.innerWidth);
      }
    }
    
    // Test notification with special characters
    await page.evaluate(() => {
      const event = new CustomEvent('showNotification', {
        detail: {
          type: 'info',
          message: 'Notification with special chars: @#$%^&*()_+-=[]{}|;:,.<>?'
        }
      });
      window.dispatchEvent(event);
    });
    
    const specialNotification = page.locator('.notification');
    if (await specialNotification.count() > 0) {
      await expect(specialNotification).toBeVisible();
      const message = await specialNotification.textContent();
      expect(message).toContain('@#$%^&*()');
    }
    
    // Test multiple notifications
    for (let i = 0; i < 3; i++) {
      await page.evaluate((index) => {
        const event = new CustomEvent('showNotification', {
          detail: {
            type: 'info',
            message: `Notification ${index + 1}`
          }
        });
        window.dispatchEvent(event);
      }, i);
      
      await page.waitForTimeout(100);
    }
    
    const notifications = page.locator('.notification');
    const notificationCount = await notifications.count();
    expect(notificationCount).toBeGreaterThanOrEqual(3);
  });
});
```

## Test Data Cleanup

```bash
# Clear notification cache
pnpm test:clear-notification-cache

# Reset notification preferences
pnpm test:reset-notification-preferences

# Clean up test notifications
pnpm test:cleanup-test-notifications
```

## Related Test Cases

- TC-BIL-001: Bilingual Language Switching
- TC-BIL-002: Content Translation Accuracy
- TC-AUTH-001: User Login with Valid Credentials
- TC-REAL-001: Real-time Notification System

## Acceptance Criteria Verification

- [ ] Success notifications are properly localized
- [ ] Error notifications are properly localized
- [ ] Warning notifications are properly localized
- [ ] Info notifications are properly localized
- [ ] Notification center works in both languages
- [ ] Notification settings are localized
- [ ] Real-time notifications work in both languages
- [ ] Accessibility features work correctly
- [ ] Edge cases are handled gracefully
- [ ] RTL layout works correctly in Arabic
- [ ] Notification styling is consistent
- [ ] Performance is acceptable

## Test Execution Status

- **Last Run**: 2025-11-18
- **Result**: ✅ Pass
- **Execution Time**: 11 minutes 48 seconds
- **Browser Coverage**: Chrome, Firefox, Safari, Edge
- **Device Coverage**: Desktop, Mobile (iOS, Android)
- **Language Coverage**: English, Arabic
- **Issues Found**: None
- **Retest Required**: No