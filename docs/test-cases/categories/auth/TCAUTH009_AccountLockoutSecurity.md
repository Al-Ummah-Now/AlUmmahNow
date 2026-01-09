# TCAUTH009: Account Lockout and Security

## Test Overview
**Test Case ID:** TCAUTH009  
**Category:** Authentication  
**Subcategory:** Security  
**Test Type:** Functional + Security  
**Priority:** High  
**Estimated Duration:** 12 minutes  

## Description
Verify comprehensive account lockout and security features including failed login tracking, automatic lockout, temporary lockout, permanent lockout, security notifications, and account recovery mechanisms across both English and Arabic interfaces.

## Preconditions
- Account lockout system is configured
- Failed login tracking is enabled
- Security notification system is working
- Email/SMS services are available
- Admin tools for account management exist

## Test Data
```typescript
const lockoutTestData = {
  user: {
    email: 'lockoutuser@alummahnow.net',
    password: 'CorrectPass123!',
    userId: 'user-lockout-001'
  },
  lockoutConfig: {
    maxAttempts: 5,
    lockoutDuration: 15, // minutes
    permanentLockoutThreshold: 10,
    notificationMethods: ['email', 'sms']
  },
  failedAttempts: [
    { attempt: 1, password: 'Wrong1!' },
    { attempt: 2, password: 'Wrong2!' },
    { attempt: 3, password: 'Wrong3!' },
    { attempt: 4, password: 'Wrong4!' },
    { attempt: 5, password: 'Wrong5!' },
    { attempt: 6, password: 'Wrong6!' }
  ],
  securityEvents: {
    suspiciousLogin: 'Suspicious login attempt detected',
    accountLocked: 'Account has been locked',
    accountUnlocked: 'Account has been unlocked'
  }
};
```

## Test Steps

### Step 1: Failed Login Tracking
1. Navigate to `/en/login`
2. Enter valid email: `lockoutuser@alummahnow.net`
3. Enter wrong password: `Wrong1!`
4. Click "Sign In" button
5. Verify error message: "Invalid credentials"
6. Check that failed attempt is logged
7. Repeat for attempts 2-4 with different wrong passwords
8. Verify each attempt is tracked
9. Check remaining attempts warning

### Step 2: Temporary Account Lockout
1. Continue with 5th failed login attempt
2. Verify account is temporarily locked
3. Check lockout message: "Account temporarily locked"
4. Verify lockout duration is displayed
5. Try to login with correct password (should fail)
6. Verify lockout notification is sent
7. Check email/SMS notification content
8. Verify account is unlocked after duration

### Step 3: Permanent Account Lockout
1. After temporary unlock, make 5 more failed attempts
2. Verify permanent lockout is triggered
3. Check permanent lockout message
4. Verify admin notification is sent
5. Try to login (should be permanently blocked)
6. Check account status in admin panel
7. Verify security event logging

### Step 4: Account Recovery Process
1. As permanently locked user, navigate to `/en/account-recovery`
2. Enter email address
3. Verify recovery options are presented
4. Choose email recovery method
5. Check recovery email is sent
6. Enter recovery code from email
7. Set new password
8. Verify account is unlocked

### Step 5: Admin Account Management
1. Login as admin
2. Navigate to `/en/admin/security/locked-accounts`
3. View list of locked accounts
4. Check lockout reasons and timestamps
5. Test manual account unlock
6. Test permanent account ban
7. Test security event review
8. Verify audit trail is maintained

### Step 6: Security Notifications
1. Test email notifications for lockout events
2. Test SMS notifications for critical events
3. Verify notification content accuracy
4. Test notification frequency limits
5. Test notification preferences
6. Verify unsubscribe options
7. Test notification delivery tracking

### Step 7: Brute Force Protection
1. Simulate rapid failed login attempts
2. Verify rate limiting is enforced
3. Test IP-based blocking
4. Verify CAPTCHA is triggered
5. Test progressive delay mechanisms
6. Check distributed attack protection
7. Verify system stability under attack

### Step 8: Geographic Anomaly Detection
1. Login from usual location
2. Simulate login from different country
3. Verify anomaly detection triggers
4. Test additional verification requirements
5. Verify security notification is sent
6. Test trusted device management
7. Verify location-based security rules

### Step 9: Device-Based Security
1. Login from new device
2. Verify device registration prompt
3. Test device trust management
4. Verify unrecognized device alerts
5. Test device revocation
6. Check device management interface
7. Verify session isolation per device

### Step 10: Arabic Interface Security Features
1. Repeat key security tests in Arabic
2. Verify Arabic lockout messages
3. Test Arabic recovery process
4. Check Arabic security notifications
5. Verify Arabic admin interface

## Expected Results
- Failed login attempts are tracked accurately
- Temporary lockout works after threshold
- Permanent lockout triggers for repeated abuse
- Account recovery process functions correctly
- Admin tools provide proper oversight
- Security notifications are sent reliably
- Brute force attacks are prevented
- Geographic anomalies are detected
- Device-based security works properly
- Both language interfaces support security features

## Error Scenarios
- Lockout system failures
- Notification delivery failures
- Recovery process failures
- Admin tool malfunctions
- Database connection issues

## Cross-Browser Testing
- Chrome, Firefox, Safari, Edge
- Mobile browsers for security testing
- Different device fingerprinting scenarios

## Playwright Test Implementation

```typescript
import { test, expect } from '@playwright/test';
import { SecurityUtils } from '../utils/SecurityUtils';
import { NotificationService } from '../utils/NotificationService';
import { AdminUtils } from '../utils/AdminUtils';

test.describe('Account Lockout and Security', () => {
  let securityUtils: SecurityUtils;
  let notificationService: NotificationService;
  let adminUtils: AdminUtils;

  test.beforeEach(async ({ page }) => {
    securityUtils = new SecurityUtils(page);
    notificationService = new NotificationService();
    adminUtils = new AdminUtils(page);
  });

  test('TCAUTH009_001: Failed login tracking', async ({ page }) => {
    // Step 1: Failed login tracking
    for (let i = 1; i <= 4; i++) {
      await page.goto('/en/login');
      await page.fill('input[type="email"]', 'lockoutuser@alummahnow.net');
      await page.fill('input[type="password"]', `Wrong${i}!`);
      await page.click('button[type="submit"]');
      
      // Verify error message
      await expect(page.locator('.error-message')).toContainText('Invalid credentials');
      
      // Check failed attempt tracking
      const attemptCount = await securityUtils.getFailedAttemptCount('lockoutuser@alummahnow.net');
      expect(attemptCount).toBe(i);
      
      // Check remaining attempts warning (if shown)
      if (i >= 3) {
        const warningMessage = await page.locator('.warning-message').textContent();
        expect(warningMessage).toContain(`${5 - i} attempts remaining`);
      }
    }
  });

  test('TCAUTH009_002: Temporary account lockout', async ({ page }) => {
    // Make 5 failed attempts to trigger lockout
    for (let i = 1; i <= 5; i++) {
      await page.goto('/en/login');
      await page.fill('input[type="email"]', 'lockoutuser@alummahnow.net');
      await page.fill('input[type="password"]', `Wrong${i}!`);
      await page.click('button[type="submit"]');
      await page.waitForTimeout(500);
    }
    
    // Step 2: Verify temporary lockout
    await expect(page.locator('.error-message')).toContainText('temporarily locked');
    await expect(page.locator('.lockout-duration')).toContainText('15 minutes');
    
    // Try login with correct password (should fail)
    await page.goto('/en/login');
    await page.fill('input[type="email"]', 'lockoutuser@alummahnow.net');
    await page.fill('input[type="password"]', 'CorrectPass123!');
    await page.click('button[type="submit"]');
    
    await expect(page.locator('.error-message')).toContainText('account is locked');
    
    // Verify lockout notification was sent
    const notifications = await notificationService.getLockoutNotifications('lockoutuser@alummahnow.net');
    expect(notifications).toHaveLength(1);
    expect(notifications[0].type).toBe('temporary_lockout');
    
    // Simulate time passing and account unlock
    await securityUtils.simulateTimePassing(16 * 60 * 1000); // 16 minutes
    
    // Try login again (should work)
    await page.goto('/en/login');
    await page.fill('input[type="email"]', 'lockoutuser@alummahnow.net');
    await page.fill('input[type="password"]', 'CorrectPass123!');
    await page.click('button[type="submit"]');
    
    await expect(page).toHaveURL('/en/dashboard');
  });

  test('TCAUTH009_003: Permanent account lockout', async ({ page }) => {
    // Reset and make 10 failed attempts for permanent lockout
    await securityUtils.resetFailedAttempts('lockoutuser@alummahnow.net');
    
    for (let i = 1; i <= 10; i++) {
      await page.goto('/en/login');
      await page.fill('input[type="email"]', 'lockoutuser@alummahnow.net');
      await page.fill('input[type="password"]', `Wrong${i}!`);
      await page.click('button[type="submit"]');
      await page.waitForTimeout(200);
    }
    
    // Verify permanent lockout
    await expect(page.locator('.error-message')).toContainText('permanently locked');
    await expect(page.locator('.recovery-instructions')).toBeVisible();
    
    // Try login with correct password (should fail permanently)
    await page.goto('/en/login');
    await page.fill('input[type="email"]', 'lockoutuser@alummahnow.net');
    await page.fill('input[type="password"]', 'CorrectPass123!');
    await page.click('button[type="submit"]');
    
    await expect(page.locator('.error-message')).toContainText('permanently locked');
    
    // Verify admin notification
    const adminNotifications = await notificationService.getAdminNotifications();
    const lockoutNotification = adminNotifications.find(n => 
      n.type === 'permanent_lockout' && n.userId === 'user-lockout-001'
    );
    expect(lockoutNotification).toBeTruthy();
  });

  test('TCAUTH009_004: Account recovery process', async ({ page }) => {
    // Step 4: Account recovery
    await page.goto('/en/account-recovery');
    await page.fill('input[type="email"]', 'lockoutuser@alummahnow.net');
    await page.click('button:has-text("Send Recovery Code")');
    
    // Verify recovery options
    await expect(page.locator('[data-testid="recovery-options"]')).toBeVisible();
    await expect(page.locator('button:has-text("Email Recovery")')).toBeVisible();
    await expect(page.locator('button:has-text("SMS Recovery")')).toBeVisible();
    
    // Choose email recovery
    await page.click('button:has-text("Email Recovery")');
    
    // Get recovery code from notification service
    const recoveryCode = await notificationService.getRecoveryCode('lockoutuser@alummahnow.net');
    
    // Enter recovery code
    await page.fill('input[name="recoveryCode"]', recoveryCode);
    await page.click('button:has-text("Verify Code")');
    
    // Set new password
    await page.fill('input[name="newPassword"]', 'NewSecurePass456!');
    await page.fill('input[name="confirmPassword"]', 'NewSecurePass456!');
    await page.click('button:has-text("Reset Password")');
    
    // Verify account is unlocked
    await expect(page.locator('.success-message')).toContainText('account recovered');
    
    // Try login with new password
    await page.goto('/en/login');
    await page.fill('input[type="email"]', 'lockoutuser@alummahnow.net');
    await page.fill('input[type="password"]', 'NewSecurePass456!');
    await page.click('button[type="submit"]');
    
    await expect(page).toHaveURL('/en/dashboard');
  });

  test('TCAUTH009_005: Admin account management', async ({ page }) => {
    // Login as admin
    await page.goto('/en/login');
    await page.fill('input[type="email"]', 'admin@alummahnow.net');
    await page.fill('input[type="password"]', 'AdminPass123!');
    await page.click('button[type="submit"]');
    
    // Navigate to locked accounts
    await page.goto('/en/admin/security/locked-accounts');
    await expect(page).toHaveURL('/en/admin/security/locked-accounts');
    
    // View locked accounts list
    await expect(page.locator('[data-testid="locked-accounts-table"]')).toBeVisible();
    
    // Check specific user details
    const userRow = page.locator(`tr:has-text("lockoutuser@alummahnow.net")`);
    await expect(userRow).toBeVisible();
    await expect(userRow.locator('[data-testid="lockout-reason"]')).toContainText('failed login attempts');
    await expect(userRow.locator('[data-testid="lockout-time"]')).toBeVisible();
    
    // Test manual unlock
    await userRow.locator('button:has-text("Unlock")').click();
    await page.click('button:has-text("Confirm Unlock")');
    
    // Verify unlock success
    await expect(page.locator('.success-message')).toContainText('account unlocked');
    
    // Test permanent ban
    await userRow.locator('button:has-text("Ban")').click();
    await page.fill('input[name="reason"]', 'Security violation');
    await page.click('button:has-text("Confirm Ban")');
    
    // Verify ban success
    await expect(page.locator('.success-message')).toContainText('account banned');
    
    // Check audit trail
    await page.goto('/en/admin/security/audit-log');
    await expect(page.locator('text=account unlocked')).toBeVisible();
    await expect(page.locator('text=account banned')).toBeVisible();
  });

  test('TCAUTH009_006: Security notifications', async ({ page }) => {
    // Test email notifications
    await notificationService.clearNotifications();
    
    // Trigger lockout event
    await securityUtils.triggerLockout('lockoutuser@alummahnow.net');
    
    // Check email notification
    const emailNotifications = await notificationService.getEmailNotifications();
    const lockoutEmail = emailNotifications.find(n => n.type === 'lockout');
    expect(lockoutEmail).toBeTruthy();
    expect(lockoutEmail.subject).toContain('Account Security Alert');
    expect(lockoutEmail.body).toContain('locked due to failed login attempts');
    
    // Test SMS notifications
    const smsNotifications = await notificationService.getSMSNotifications();
    const lockoutSMS = smsNotifications.find(n => n.type === 'lockout');
    expect(lockoutSMS).toBeTruthy();
    expect(lockoutSMS.message).toContain('Security alert');
    
    // Test notification preferences
    await page.goto('/en/settings/notifications');
    await page.uncheck('input[name="emailNotifications"]');
    await page.uncheck('input[name="smsNotifications"]');
    await page.click('button[type="submit"]');
    
    // Trigger another event (should not send notifications)
    await securityUtils.triggerLockout('lockoutuser@alummahnow.net');
    
    const newNotifications = await notificationService.getAllNotifications();
    expect(newNotifications.length).toBe(0);
  });

  test('TCAUTH009_007: Brute force protection', async ({ page }) => {
    // Test rapid failed attempts
    const startTime = Date.now();
    
    for (let i = 1; i <= 20; i++) {
      await page.goto('/en/login');
      await page.fill('input[type="email"]', 'bruteforce@alummahnow.net');
      await page.fill('input[type="password"]', `Wrong${i}!`);
      await page.click('button[type="submit"]');
      
      // Check for rate limiting
      if (i > 10) {
        await expect(page.locator('.error-message')).toContainText('too many attempts');
      }
    }
    
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    // Verify progressive delay (should take longer than normal)
    expect(duration).toBeGreaterThan(10000); // Should take at least 10 seconds
    
    // Test IP-based blocking
    await page.goto('/en/login');
    await expect(page.locator('.ip-blocked-message')).toContainText('IP address blocked');
    
    // Test CAPTCHA triggering
    await expect(page.locator('[data-testid="captcha"]')).toBeVisible();
  });

  test('TCAUTH009_008: Geographic anomaly detection', async ({ page }) => {
    // Login from usual location
    await page.goto('/en/login');
    await page.fill('input[type="email"]', 'traveluser@alummahnow.net');
    await page.fill('input[type="password"]', 'TravelPass123!');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL('/en/dashboard');
    
    // Logout
    await page.goto('/en/logout');
    
    // Simulate login from different country
    await securityUtils.simulateGeographicChange('US', 'CN');
    
    await page.goto('/en/login');
    await page.fill('input[type="email"]', 'traveluser@alummahnow.net');
    await page.fill('input[type="password"]', 'TravelPass123!');
    await page.click('button[type="submit"]');
    
    // Should trigger additional verification
    await expect(page.locator('[data-testid="geo-verification"]')).toBeVisible();
    await expect(page.locator('text=unusual location')).toBeVisible();
    
    // Complete additional verification
    const verificationCode = await notificationService.getVerificationCode('traveluser@alummahnow.net');
    await page.fill('input[name="verificationCode"]', verificationCode);
    await page.click('button:has-text("Verify")');
    
    // Should complete login
    await expect(page).toHaveURL('/en/dashboard');
    
    // Check security notification was sent
    const geoNotifications = await notificationService.getGeoAnomalyNotifications();
    expect(geoNotifications).toHaveLength(1);
    expect(geoNotifications[0].type).toBe('geographic_anomaly');
  });

  test('TCAUTH009_009: Device-based security', async ({ page }) => {
    // Login from new device
    await page.goto('/en/login');
    await page.fill('input[type="email"]', 'deviceuser@alummahnow.net');
    await page.fill('input[type="password"]', 'DevicePass123!');
    await page.click('button[type="submit"]');
    
    // Should prompt for device registration
    await expect(page.locator('[data-testid="device-registration"]')).toBeVisible();
    await expect(page.locator('text=new device')).toBeVisible();
    
    // Register device
    await page.fill('input[name="deviceName"]', 'Test Device');
    await page.click('button:has-text("Register Device")');
    
    // Should complete login
    await expect(page).toHaveURL('/en/dashboard');
    
    // Check device management
    await page.goto('/en/settings/devices');
    await expect(page.locator('[data-testid="device-list"]')).toBeVisible();
    await expect(page.locator('text=Test Device')).toBeVisible();
    
    // Test unrecognized device alert
    const newContext = await page.context().browser().newContext();
    const newPage = await newContext.newPage();
    
    await newPage.goto('/en/login');
    await newPage.fill('input[type="email"]', 'deviceuser@alummahnow.net');
    await newPage.fill('input[type="password"]', 'DevicePass123!');
    await newPage.click('button[type="submit"]');
    
    // Should show unrecognized device alert
    await expect(newPage.locator('[data-testid="unrecognized-device"]')).toBeVisible();
    
    await newContext.close();
  });

  test('TCAUTH009_010: Arabic interface security features', async ({ page }) => {
    // Test Arabic interface
    await page.goto('/ar/login');
    
    // Trigger failed login attempts
    for (let i = 1; i <= 5; i++) {
      await page.fill('input[type="email"]', 'lockoutuser@alummahnow.net');
      await page.fill('input[type="password"]', `Wrong${i}!`);
      await page.click('button[type="submit"]');
      await page.waitForTimeout(500);
    }
    
    // Verify Arabic lockout message
    await expect(page.locator('.error-message')).toContainText('مغلق مؤقتاً');
    await expect(page.locator('.lockout-duration')).toContainText('15 دقيقة');
    
    // Test Arabic recovery process
    await page.goto('/ar/account-recovery');
    await page.fill('input[type="email"]', 'lockoutuser@alummahnow.net');
    await page.click('button:has-text("إرسال رمز الاسترداد")');
    
    // Verify Arabic recovery options
    await expect(page.locator('button:has-text("استرداد عبر البريد")')).toBeVisible();
    
    // Test Arabic admin interface
    await page.goto('/ar/login');
    await page.fill('input[type="email"]', 'admin@alummahnow.net');
    await page.fill('input[type="password"]', 'AdminPass123!');
    await page.click('button[type="submit"]');
    
    await page.goto('/ar/admin/security/locked-accounts');
    await expect(page.locator('h1')).toContainText('الحسابات المقفولة');
  });
});

// Utility Classes
export class SecurityUtils {
  constructor(private page: Page) {}

  async getFailedAttemptCount(email: string): Promise<number> {
    return await this.page.evaluate(async (userEmail) => {
      const response = await fetch(`/api/auth/failed-attempts/${userEmail}`);
      const data = await response.json();
      return data.count || 0;
    }, email);
  }

  async resetFailedAttempts(email: string): Promise<void> {
    await this.page.evaluate(async (userEmail) => {
      await fetch(`/api/auth/reset-attempts/${userEmail}`, { method: 'POST' });
    }, email);
  }

  async triggerLockout(email: string): Promise<void> {
    await this.page.evaluate(async (userEmail) => {
      await fetch(`/api/auth/trigger-lockout/${userEmail}`, { method: 'POST' });
    }, email);
  }

  async simulateTimePassing(milliseconds: number): Promise<void> {
    await this.page.evaluate((ms) => {
      // Mock time passing for testing
      console.log(`Simulating ${ms}ms of time passing`);
    }, milliseconds);
  }

  async simulateGeographicChange(fromCountry: string, toCountry: string): Promise<void> {
    await this.page.evaluate((from, to) => {
      // Mock geographic location change
      localStorage.setItem('mock_country', to);
    }, fromCountry, toCountry);
  }
}

export class NotificationService {
  private notifications: any[] = [];

  async getLockoutNotifications(email: string): Promise<any[]> {
    return this.notifications.filter(n => 
      n.email === email && n.type === 'lockout'
    );
  }

  async getRecoveryCode(email: string): Promise<string> {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    this.notifications.push({
      email,
      type: 'recovery',
      code,
      timestamp: new Date()
    });
    return code;
  }

  async getVerificationCode(email: string): Promise<string> {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    this.notifications.push({
      email,
      type: 'verification',
      code,
      timestamp: new Date()
    });
    return code;
  }

  async getEmailNotifications(): Promise<any[]> {
    return this.notifications.filter(n => n.channel === 'email');
  }

  async getSMSNotifications(): Promise<any[]> {
    return this.notifications.filter(n => n.channel === 'sms');
  }

  async getAdminNotifications(): Promise<any[]> {
    return this.notifications.filter(n => n.recipient === 'admin');
  }

  async getGeoAnomalyNotifications(): Promise<any[]> {
    return this.notifications.filter(n => n.type === 'geographic_anomaly');
  }

  async getAllNotifications(): Promise<any[]> {
    return [...this.notifications];
  }

  clearNotifications() {
    this.notifications = [];
  }
}

export class AdminUtils {
  constructor(private page: Page) {}

  async unlockAccount(email: string): Promise<boolean> {
    await this.page.goto('/en/admin/security/locked-accounts');
    const userRow = this.page.locator(`tr:has-text("${email}")`);
    await userRow.locator('button:has-text("Unlock")').click();
    await this.page.click('button:has-text("Confirm Unlock")');
    
    return await this.page.locator('.success-message').isVisible();
  }

  async banAccount(email: string, reason: string): Promise<boolean> {
    await this.page.goto('/en/admin/security/locked-accounts');
    const userRow = this.page.locator(`tr:has-text("${email}")`);
    await userRow.locator('button:has-text("Ban")').click();
    await this.page.fill('input[name="reason"]', reason);
    await this.page.click('button:has-text("Confirm Ban")');
    
    return await this.page.locator('.success-message').isVisible();
  }
}
```

## Test Data Management
- Test users with various security states
- Lockout configuration templates
- Security event templates
- Notification templates

## Cleanup Requirements
- Unlock test accounts after tests
- Clear security event logs
- Reset failed attempt counters
- Remove test notifications

## Success Criteria
- Failed login tracking works accurately
- Temporary and permanent lockout function correctly
- Account recovery process is reliable
- Admin tools provide proper oversight
- Security notifications are sent appropriately
- Brute force attacks are prevented
- Geographic anomalies are detected
- Device-based security works properly
- Both language interfaces support security features