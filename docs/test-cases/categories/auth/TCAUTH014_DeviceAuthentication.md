# TCAUTH014: Device Authentication

## Test Overview
**Test Case ID:** TCAUTH014  
**Category:** Authentication  
**Subcategory:** Device Security  
**Test Type:** Functional + Security  
**Priority:** Medium  
**Estimated Duration:** 10 minutes  

## Description
Verify comprehensive device authentication features including device registration, device fingerprinting, trusted device management, device-based authentication, device revocation, and cross-device security across both English and Arabic interfaces.

## Preconditions
- Device authentication system is configured
- Device fingerprinting is enabled
- Trusted device management is available
- Device security policies are in place
- Cross-device synchronization works

## Test Data
```typescript
const deviceAuthTestData = {
  devices: {
    desktop: {
      id: 'device_desktop_001',
      name: 'Work Desktop',
      type: 'desktop',
      platform: 'Windows',
      browser: 'Chrome',
      fingerprint: 'fp_desktop_abc123',
      trusted: true,
      lastUsed: new Date()
    },
    mobile: {
      id: 'device_mobile_002',
      name: 'Personal iPhone',
      type: 'mobile',
      platform: 'iOS',
      browser: 'Safari',
      fingerprint: 'fp_mobile_def456',
      trusted: false,
      lastUsed: new Date()
    },
    tablet: {
      id: 'device_tablet_003',
      name: 'iPad Pro',
      type: 'tablet',
      platform: 'iPadOS',
      browser: 'Safari',
      fingerprint: 'fp_tablet_ghi789',
      trusted: true,
      lastUsed: new Date()
    }
  },
  fingerprints: {
    canvas: 'canvas_signature_123',
    webgl: 'webgl_signature_456',
    fonts: 'fonts_signature_789',
    screen: 'screen_signature_012',
    timezone: 'timezone_signature_345',
    language: 'language_signature_678'
  },
  security: {
    maxDevices: 5,
    deviceExpiration: 90, // days
    requireVerification: true,
    geoRestrictions: true
  }
};
```

## Test Steps

### Step 1: Device Registration
1. Login with valid credentials
2. Navigate to `/en/settings/devices`
3. Click "Register New Device"
4. Enter device name: "Test Device"
5. Select device type
6. Verify device fingerprint generation
7. Complete device registration
8. Verify device appears in list
9. Check device details
10. Test device trust settings

### Step 2: Device Fingerprinting
1. Navigate to device registration
2. Verify canvas fingerprinting
3. Check WebGL fingerprinting
4. Test font detection
5. Verify screen resolution detection
6. Check timezone detection
7. Test language detection
8. Verify browser fingerprinting
9. Check platform detection
10. Verify fingerprint uniqueness

### Step 3: Trusted Device Management
1. Navigate to device settings
2. View registered devices
3. Test device trust toggle
4. Set device as trusted
5. Verify trusted device benefits
6. Test device untrust
7. Check device expiration settings
8. Test device naming
9. Verify device grouping
10. Check device search/filter

### Step 4: Device-Based Authentication
1. Login from trusted device
2. Verify simplified authentication
3. Test device recognition
4. Login from untrusted device
5. Verify additional verification required
6. Test device authentication flow
7. Check device session management
8. Test device auto-login
9. Verify device logout
10. Check device session isolation

### Step 5: Device Revocation
1. Navigate to device management
2. Select device to revoke
3. Click "Revoke Device"
4. Confirm revocation
5. Verify device is removed
6. Test authentication from revoked device
7. Verify access is denied
8. Check revocation notification
9. Test bulk device revocation
10. Verify revocation audit log

### Step 6: Cross-Device Security
1. Login from multiple devices
2. Verify concurrent sessions
3. Test device session limits
4. Check device conflict resolution
5. Test device handoff
6. Verify device synchronization
7. Test device isolation
8. Check device security policies
9. Test device geo-restrictions
10. Verify device compliance

### Step 7: Device Security Policies
1. Navigate to security settings
2. Configure device limits
3. Set device expiration
4. Test device enforcement
5. Verify policy compliance
6. Test policy violations
7. Check policy notifications
8. Test policy updates
9. Verify policy inheritance
10. Check policy exceptions

### Step 8: Device Analytics and Monitoring
1. Navigate to device analytics
2. View device usage statistics
3. Check device login patterns
4. Verify device security metrics
5. Test device anomaly detection
6. Check device health monitoring
7. Test device performance metrics
8. Verify device compliance reports
9. Check device audit trails
10. Test device alerts

### Step 9: Mobile Device Features
1. Test mobile device registration
2. Verify push notification support
3. Test biometric device authentication
4. Check mobile device management
5. Test mobile device security
6. Verify mobile device sync
7. Test mobile device backup
8. Check mobile device recovery
9. Test mobile device wipe
10. Verify mobile device compliance

### Step 10: Arabic Interface Device Authentication
1. Repeat key device tests in Arabic
2. Verify Arabic device registration
3. Test Arabic device management
4. Check Arabic device security
5. Verify Arabic device analytics
6. Test Arabic device notifications
7. Check Arabic device policies
8. Verify Arabic device compliance
9. Test Arabic device recovery
10. Check Arabic device help

## Expected Results
- Device registration works correctly
- Device fingerprinting is accurate
- Trusted device management functions properly
- Device-based authentication is secure
- Device revocation works effectively
- Cross-device security is maintained
- Security policies are enforced
- Analytics provide useful insights
- Mobile features work correctly
- Both language interfaces support device authentication

## Error Scenarios
- Device fingerprinting failures
- Device registration errors
- Device authentication failures
- Cross-device synchronization issues
- Security policy violations

## Cross-Browser Testing
- Chrome, Firefox, Safari, Edge
- Mobile browsers for device testing
- Different device types and platforms

## Playwright Test Implementation

```typescript
import { test, expect, BrowserContext } from '@playwright/test';
import { DeviceAuthUtils } from '../utils/DeviceAuthUtils';
import { DeviceFingerprinter } from '../utils/DeviceFingerprinter';

test.describe('Device Authentication', () => {
  let deviceAuthUtils: DeviceAuthUtils;
  let deviceFingerprinter: DeviceFingerprinter;
  let context: BrowserContext;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    deviceAuthUtils = new DeviceAuthUtils(context);
    deviceFingerprinter = new DeviceFingerprinter();
  });

  test.afterAll(async () => {
    await context.close();
  });

  test('TCAUTH014_001: Device registration', async ({ page }) => {
    // Step 1: Device registration
    await page.goto('/en/login');
    await page.fill('input[type="email"]', 'deviceuser@alummahnow.net');
    await page.fill('input[type="password"]', 'DevicePass123!');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL('/en/dashboard');
    
    // Navigate to device settings
    await page.goto('/en/settings/devices');
    await expect(page).toHaveURL('/en/settings/devices');
    
    // Register new device
    await page.click('button:has-text("Register New Device")');
    
    // Enter device details
    await page.fill('input[name="deviceName"]', 'Test Device');
    await page.selectOption('select[name="deviceType"]', 'desktop');
    await page.click('button:has-text("Register Device")');
    
    // Verify device fingerprint generation
    await expect(page.locator('[data-testid="fingerprint-generated"]')).toBeVisible();
    
    // Complete registration
    await page.click('button:has-text("Complete Registration")');
    
    // Verify device appears in list
    await expect(page.locator('text=Test Device')).toBeVisible();
    await expect(page.locator('[data-testid="device-type"]')).toContainText('desktop');
    
    // Check device details
    await page.click('button:has-text("View Details")');
    await expect(page.locator('[data-testid="device-id"]')).toBeVisible();
    await expect(page.locator('[data-testid="device-fingerprint"]')).toBeVisible();
    await expect(page.locator('[data-testid="registration-date"]')).toBeVisible();
  });

  test('TCAUTH014_002: Device fingerprinting', async ({ page }) => {
    // Step 2: Device fingerprinting
    await page.goto('/en/login');
    await page.fill('input[type="email"]', 'deviceuser@alummahnow.net');
    await page.fill('input[type="password"]', 'DevicePass123!');
    await page.click('button[type="submit"]');
    
    // Navigate to device registration to test fingerprinting
    await page.goto('/en/settings/devices');
    await page.click('button:has-text("Register New Device")');
    
    // Test canvas fingerprinting
    const canvasFingerprint = await deviceFingerprinter.getCanvasFingerprint(page);
    expect(canvasFingerprint).toBeTruthy();
    expect(canvasFingerprint.length).toBeGreaterThan(20);
    
    // Test WebGL fingerprinting
    const webglFingerprint = await deviceFingerprinter.getWebGLFingerprint(page);
    expect(webglFingerprint).toBeTruthy();
    
    // Test font detection
    const fontFingerprint = await deviceFingerprinter.getFontFingerprint(page);
    expect(fontFingerprint).toBeTruthy();
    
    // Test screen resolution detection
    const screenFingerprint = await deviceFingerprinter.getScreenFingerprint(page);
    expect(screenFingerprint).toBeTruthy();
    expect(screenFingerprint).toContain('x');
    
    // Test timezone detection
    const timezoneFingerprint = await deviceFingerprinter.getTimezoneFingerprint(page);
    expect(timezoneFingerprint).toBeTruthy();
    
    // Test language detection
    const languageFingerprint = await deviceFingerprinter.getLanguageFingerprint(page);
    expect(languageFingerprint).toBeTruthy();
    
    // Verify fingerprint uniqueness
    const combinedFingerprint = await deviceFingerprinter.getCombinedFingerprint(page);
    expect(combinedFingerprint).toBeTruthy();
    expect(combinedFingerprint.length).toBeGreaterThan(100);
  });

  test('TCAUTH014_003: Trusted device management', async ({ page }) => {
    // Step 3: Trusted device management
    await deviceAuthUtils.login('deviceuser@alummahnow.net', 'DevicePass123!');
    await page.goto('/en/settings/devices');
    
    // View registered devices
    await expect(page.locator('[data-testid="device-list"]')).toBeVisible();
    
    // Test device trust toggle
    const deviceRow = page.locator('tr:has-text("Test Device")');
    await deviceRow.locator('button:has-text("Trust Device")').click();
    await page.click('button:has-text("Confirm")');
    
    // Verify device is now trusted
    await expect(deviceRow.locator('[data-testid="trust-status"]')).toContainText('Trusted');
    
    // Test device untrust
    await deviceRow.locator('button:has-text("Untrust Device")').click();
    await page.click('button:has-text("Confirm")');
    
    // Verify device is untrusted
    await expect(deviceRow.locator('[data-testid="trust-status"]')).toContainText('Not Trusted');
    
    // Test device naming
    await deviceRow.locator('button:has-text("Edit")').click();
    await page.fill('input[name="deviceName"]', 'Updated Device Name');
    await page.click('button:has-text("Save")');
    
    // Verify name change
    await expect(page.locator('text=Updated Device Name')).toBeVisible();
    
    // Test device search/filter
    await page.fill('input[placeholder*="search"]', 'Updated');
    await expect(page.locator('text=Updated Device Name')).toBeVisible();
  });

  test('TCAUTH014_004: Device-based authentication', async ({ page }) => {
    // Step 4: Device-based authentication
    // First, register and trust a device
    await deviceAuthUtils.loginAndTrustDevice('deviceuser@alummahnow.net', 'DevicePass123!', 'Trusted Device');
    
    // Logout
    await page.goto('/en/logout');
    
    // Login from trusted device (should be simplified)
    await page.goto('/en/login');
    await page.fill('input[type="email"]', 'deviceuser@alummahnow.net');
    
    // Should show device recognition
    await expect(page.locator('[data-testid="device-recognized"]')).toBeVisible();
    await expect(page.locator('text=Trusted Device')).toBeVisible();
    
    // Should not require password for trusted device
    await page.click('button:has-text("Login from Trusted Device")');
    await expect(page).toHaveURL('/en/dashboard');
    
    // Logout and test untrusted device
    await page.goto('/en/logout');
    
    // Simulate untrusted device (clear device fingerprint)
    await page.evaluate(() => {
      localStorage.removeItem('device_fingerprint');
    });
    
    await page.goto('/en/login');
    await page.fill('input[type="email"]', 'deviceuser@alummahnow.net');
    await page.fill('input[type="password"]', 'DevicePass123!');
    await page.click('button[type="submit"]');
    
    // Should require additional verification for untrusted device
    await expect(page.locator('[data-testid="additional-verification"]')).toBeVisible();
  });

  test('TCAUTH014_005: Device revocation', async ({ page }) => {
    // Step 5: Device revocation
    await deviceAuthUtils.login('deviceuser@alummahnow.net', 'DevicePass123!');
    await page.goto('/en/settings/devices');
    
    // Select device to revoke
    const deviceRow = page.locator('tr:has-text("Test Device")');
    await deviceRow.locator('button:has-text("Revoke")').click();
    
    // Confirm revocation
    await page.click('button:has-text("Confirm Revoke")');
    
    // Verify device is removed
    await expect(page.locator('text=Test Device')).not.toBeVisible();
    await expect(page.locator('.success-message')).toContainText('device revoked');
    
    // Test authentication from revoked device
    await page.goto('/en/logout');
    await page.goto('/en/login');
    await page.fill('input[type="email"]', 'deviceuser@alummahnow.net');
    await page.fill('input[type="password"]', 'DevicePass123!');
    await page.click('button[type="submit"]');
    
    // Should show device not recognized
    await expect(page.locator('[data-testid="device-not-recognized"]')).toBeVisible();
    
    // Check revocation notification
    await page.goto('/en/settings/notifications');
    await expect(page.locator('text=device revoked')).toBeVisible();
  });

  test('TCAUTH014_006: Cross-device security', async ({ page }) => {
    // Step 6: Cross-device security
    // Login from desktop
    await deviceAuthUtils.login('deviceuser@alummahnow.net', 'DevicePass123!');
    
    // Create mobile context
    const mobileContext = await page.context().browser().newContext({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)'
    });
    const mobilePage = await mobileContext.newPage();
    
    // Login from mobile (second device)
    await mobilePage.goto('/en/login');
    await mobilePage.fill('input[type="email"]', 'deviceuser@alummahnow.net');
    await mobilePage.fill('input[type="password"]', 'DevicePass123!');
    await mobilePage.click('button[type="submit"]');
    
    // Should show concurrent session warning
    await expect(mobilePage.locator('[data-testid="concurrent-session"]')).toBeVisible();
    
    // Verify both sessions are active
    await expect(page.locator('[data-testid="session-active"]')).toBeVisible();
    await expect(mobilePage.locator('[data-testid="session-active"]')).toBeVisible();
    
    // Test device session limits
    // Create tablet context (third device)
    const tabletContext = await page.context().browser().newContext({
      userAgent: 'Mozilla/5.0 (iPad; CPU OS 14_0 like Mac OS X)'
    });
    const tabletPage = await tabletContext.newPage();
    
    await tabletPage.goto('/en/login');
    await tabletPage.fill('input[type="email"]', 'deviceuser@alummahnow.net');
    await tabletPage.fill('input[type="password"]', 'DevicePass123!');
    await tabletPage.click('button[type="submit"]');
    
    // Should enforce session limit
    await expect(tabletPage.locator('[data-testid="session-limit"]')).toBeVisible();
    
    await mobileContext.close();
    await tabletContext.close();
  });

  test('TCAUTH014_007: Device security policies', async ({ page }) => {
    // Step 7: Device security policies
    await deviceAuthUtils.loginAsAdmin();
    await page.goto('/en/admin/device-policies');
    
    // Configure device limits
    await page.fill('input[name="maxDevices"]', '5');
    await page.fill('input[name="deviceExpiration"]', '90');
    await page.check('input[name="requireVerification"]');
    await page.check('input[name="geoRestrictions"]');
    
    // Save policies
    await page.click('button:has-text("Save Policies")');
    await expect(page.locator('.success-message')).toContainText('policies saved');
    
    // Test policy enforcement
    await page.goto('/en/logout');
    await deviceAuthUtils.login('deviceuser@alummahnow.net', 'DevicePass123!');
    await page.goto('/en/settings/devices');
    
    // Try to register 6th device (should be blocked)
    for (let i = 1; i <= 6; i++) {
      await page.click('button:has-text("Register New Device")');
      await page.fill('input[name="deviceName"]', `Device ${i}`);
      await page.click('button:has-text("Register Device")');
      
      if (i <= 5) {
        await expect(page.locator('.success-message')).toContainText('device registered');
      } else {
        await expect(page.locator('.error-message')).toContainText('device limit exceeded');
      }
    }
  });

  test('TCAUTH014_008: Device analytics and monitoring', async ({ page }) => {
    // Step 8: Device analytics
    await deviceAuthUtils.loginAsAdmin();
    await page.goto('/en/admin/device-analytics');
    
    // View device usage statistics
    await expect(page.locator('[data-testid="device-stats"]')).toBeVisible();
    await expect(page.locator('[data-testid="total-devices"]')).toBeVisible();
    await expect(page.locator('[data-testid="active-devices"]')).toBeVisible();
    await expect(page.locator('[data-testid="trusted-devices"]')).toBeVisible();
    
    // Check device login patterns
    await expect(page.locator('[data-testid="login-patterns"]')).toBeVisible();
    await expect(page.locator('[data-testid="login-chart"]')).toBeVisible();
    
    // Verify device security metrics
    await expect(page.locator('[data-testid="security-metrics"]')).toBeVisible();
    await expect(page.locator('[data-testid="suspicious-activity"]')).toBeVisible();
    
    // Test device anomaly detection
    await page.click('button:has-text("View Anomalies")');
    await expect(page.locator('[data-testid="anomaly-list"]')).toBeVisible();
    
    // Check device health monitoring
    await page.click('button:has-text("Device Health")');
    await expect(page.locator('[data-testid="health-status"]')).toBeVisible();
    
    // Verify device compliance reports
    await page.click('button:has-text("Compliance Report")');
    await expect(page.locator('[data-testid="compliance-metrics"]')).toBeVisible();
  });

  test('TCAUTH014_009: Mobile device features', async ({ page }) => {
    // Step 9: Mobile device features
    // Simulate mobile device
    const mobileContext = await page.context().browser().newContext({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)'
    });
    const mobilePage = await mobileContext.newPage();
    
    // Test mobile device registration
    await mobilePage.goto('/en/login');
    await mobilePage.fill('input[type="email"]', 'deviceuser@alummahnow.net');
    await mobilePage.fill('input[type="password"]', 'DevicePass123!');
    await mobilePage.click('button[type="submit"]');
    
    await mobilePage.goto('/en/settings/devices');
    await mobilePage.click('button:has-text("Register New Device")');
    
    // Should detect mobile device type
    await expect(mobilePage.locator('select[name="deviceType"]')).toHaveValue('mobile');
    
    await mobilePage.fill('input[name="deviceName"]', 'Mobile Test Device');
    await mobilePage.click('button:has-text("Register Device")');
    
    // Test push notification support
    await expect(mobilePage.locator('[data-testid="push-notification-option"]')).toBeVisible();
    await mobilePage.check('input[name="enablePushNotifications"]');
    
    // Test biometric device authentication
    await expect(mobilePage.locator('[data-testid="biometric-option"]')).toBeVisible();
    await mobilePage.check('input[name="enableBiometric"]');
    
    await mobileContext.close();
  });

  test('TCAUTH014_010: Arabic interface device authentication', async ({ page }) => {
    // Step 10: Arabic interface testing
    await page.goto('/ar/login');
    await page.fill('input[type="email"]', 'deviceuser@alummahnow.net');
    await page.fill('input[type="password"]', 'DevicePass123!');
    await page.click('button[type="submit"]');
    
    // Navigate to Arabic device settings
    await page.goto('/ar/settings/devices');
    await expect(page.locator('h1')).toContainText('الأجهزة');
    
    // Test Arabic device registration
    await page.click('button:has-text("تسجيل جهاز جديد")');
    await page.fill('input[name="deviceName"]', 'جهاز اختبار');
    await page.selectOption('select[name="deviceType"]', 'desktop');
    await page.click('button:has-text("تسجيل الجهاز")');
    
    // Verify Arabic success message
    await expect(page.locator('.success-message')).toContainText('تم تسجيل الجهاز');
    
    // Test Arabic device management
    await expect(page.locator('text=جهاز اختبار')).toBeVisible();
    await page.click('button:has-text("تفاصيل")');
    
    // Verify Arabic device details
    await expect(page.locator('[data-testid="device-id-label"]')).toContainText('معرف الجهاز');
    await expect(page.locator('[data-testid="device-type-label"]')).toContainText('نوع الجهاز');
    
    // Test Arabic device revocation
    await page.click('button:has-text("إلغاء")');
    await page.click('button:has-text("تأكيد")');
    await expect(page.locator('.success-message')).toContainText('تم إلغاء الجهاز');
  });
});

// Utility Classes
export class DeviceAuthUtils {
  constructor(private context: BrowserContext) {}

  async login(email: string, password: string) {
    const page = await this.context.newPage();
    await page.goto('/en/login');
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForURL('/en/dashboard');
    return page;
  }

  async loginAsAdmin() {
    return await this.login('admin@alummahnow.net', 'AdminPass123!');
  }

  async loginAndTrustDevice(email: string, password: string, deviceName: string) {
    const page = await this.login(email, password);
    await page.goto('/en/settings/devices');
    await page.click('button:has-text("Register New Device")');
    await page.fill('input[name="deviceName"]', deviceName);
    await page.click('button:has-text("Register Device")');
    await page.click('button:has-text("Complete Registration")');
    
    // Trust the device
    const deviceRow = page.locator(`tr:has-text("${deviceName}")`);
    await deviceRow.locator('button:has-text("Trust Device")').click();
    await page.click('button:has-text("Confirm")');
    
    return page;
  }

  async getDeviceFingerprint(page: Page): Promise<string> {
    return await page.evaluate(() => {
      // Mock device fingerprint generation
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.textBaseline = 'top';
        ctx.font = '14px Arial';
        ctx.fillText('Device fingerprint', 2, 2);
        return canvas.toDataURL();
      }
      return '';
    });
  }
}

export class DeviceFingerprinter {
  async getCanvasFingerprint(page: Page): Promise<string> {
    return await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.textBaseline = 'top';
        ctx.font = '14px Arial';
        ctx.fillText('Canvas fingerprint', 2, 2);
        return canvas.toDataURL().slice(-50); // Return last 50 chars
      }
      return '';
    });
  }

  async getWebGLFingerprint(page: Page): Promise<string> {
    return await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl');
      if (gl) {
        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        if (debugInfo) {
          return gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) + 
                 gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
        }
      }
      return '';
    });
  }

  async getFontFingerprint(page: Page): Promise<string> {
    return await page.evaluate(() => {
      const testFonts = ['Arial', 'Helvetica', 'Times New Roman', 'Courier New'];
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const availableFonts = testFonts.filter(font => {
          ctx.font = `20px ${font}`;
          return ctx.measureText('test').width > 0;
        });
        return availableFonts.join(',');
      }
      return '';
    });
  }

  async getScreenFingerprint(page: Page): Promise<string> {
    return await page.evaluate(() => {
      return `${screen.width}x${screen.height}x${screen.colorDepth}`;
    });
  }

  async getTimezoneFingerprint(page: Page): Promise<string> {
    return await page.evaluate(() => {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    });
  }

  async getLanguageFingerprint(page: Page): Promise<string> {
    return await page.evaluate(() => {
      return navigator.language + ',' + navigator.languages.join(',');
    });
  }

  async getCombinedFingerprint(page: Page): Promise<string> {
    const canvas = await this.getCanvasFingerprint(page);
    const webgl = await this.getWebGLFingerprint(page);
    const fonts = await this.getFontFingerprint(page);
    const screen = await this.getScreenFingerprint(page);
    const timezone = await this.getTimezoneFingerprint(page);
    const language = await this.getLanguageFingerprint(page);
    
    return btoa([canvas, webgl, fonts, screen, timezone, language].join('|'));
  }
}
```

## Test Data Management
- Device registration templates
- Device fingerprinting utilities
- Device security policy configurations
- Mobile device simulation

## Cleanup Requirements
- Remove test devices after tests
- Clear device fingerprints
- Reset device security policies
- Clean up device analytics

## Success Criteria
- Device registration works correctly
- Device fingerprinting is accurate
- Trusted device management functions properly
- Device-based authentication is secure
- Device revocation works effectively
- Cross-device security is maintained
- Security policies are enforced
- Analytics provide useful insights
- Mobile features work correctly
- Both language interfaces support device authentication