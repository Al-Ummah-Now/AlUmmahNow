# TCAUTH006: Two-Factor Authentication

## Test Overview
**Test Case ID:** TCAUTH006  
**Category:** Authentication  
**Subcategory:** Multi-Factor Authentication  
**Test Type:** Functional + Security  
**Priority:** High  
**Estimated Duration:** 12 minutes  

## Description
Verify comprehensive two-factor authentication (2FA) functionality including setup, backup codes, recovery options, TOTP authenticator apps, SMS verification, and fallback mechanisms across both English and Arabic interfaces.

## Preconditions
- User has valid account
- 2FA system is configured and enabled
- SMS service is available (for SMS 2FA)
- Email service is functional
- Authenticator app available for testing
- Time synchronization for TOTP

## Test Data
```typescript
const twoFactorTestData = {
  user: {
    email: 'twofactor@alummahnow.net',
    password: 'TwoFactor123!',
    phone: '+1234567890',
    userId: 'user-2fa-001'
  },
  totp: {
    secret: 'JBSWY3DPEHPK3PXP', // Base32 encoded secret
    currentCode: '123456', // Current TOTP code
    backupCodes: [
      '12345678', '23456789', '34567890', '45678901',
      '56789012', '67890123', '78901234', '89012345'
    ]
  },
  sms: {
    verificationCode: '654321',
    expiredCode: '111111'
  },
  recovery: {
    recoveryEmail: 'recovery@alummahnow.net',
    recoveryCode: 'RECOVERY123'
  }
};
```

## Test Steps

### Step 1: 2FA Setup - TOTP Authenticator
1. Login to user account
2. Navigate to `/en/settings/security`
3. Click "Enable Two-Factor Authentication"
4. Select "Authenticator App" option
5. Verify QR code is displayed
6. Verify secret key is shown as backup
7. Scan QR code with authenticator app
8. Enter current 6-digit code from app
9. Click "Verify and Enable"
10. Verify success message and backup codes display

### Step 2: 2FA Setup - SMS Verification
1. Navigate to `/en/settings/security`
2. Click "Add SMS Authentication"
3. Enter phone number: `+1234567890`
4. Click "Send Verification Code"
5. Verify SMS is sent (mock service)
6. Enter received verification code
7. Click "Verify Phone Number"
8. Verify SMS 2FA is enabled

### Step 3: Login with 2FA Enabled - TOTP
1. Logout from current session
2. Navigate to `/en/login`
3. Enter valid credentials
4. Click "Sign In"
5. Verify 2FA prompt appears
6. Enter current TOTP code
7. Click "Verify"
8. Verify successful login to dashboard

### Step 4: Login with 2FA Enabled - SMS
1. Logout from current session
2. Navigate to `/en/login`
3. Enter valid credentials
4. Click "Sign In"
5. Click "Send SMS Code" option
6. Verify SMS is sent
7. Enter SMS verification code
8. Click "Verify"
9. Verify successful login

### Step 5: 2FA Code Validation
1. Attempt login with invalid TOTP code
2. Verify error message: "Invalid verification code"
3. Attempt login with expired TOTP code
4. Verify error message: "Code has expired"
5. Test rate limiting on failed attempts
6. Verify account lockout after multiple failures

### Step 6: Backup Codes Usage
1. Login with credentials
2. At 2FA prompt, click "Use Backup Code"
3. Enter valid backup code
4. Verify successful login
5. Verify backup code is marked as used
6. Test with already used backup code
7. Verify error message: "Backup code already used"

### Step 7: 2FA Management
1. Navigate to `/en/settings/security`
2. View active 2FA methods
3. Test disabling TOTP 2FA
4. Verify confirmation prompt
5. Test disabling SMS 2FA
6. Verify re-authentication requirement
7. Test regenerating backup codes

### Step 8: Recovery Options
1. Lose access to authenticator app
2. Click "Can't access your authenticator?"
3. Select recovery method (email/SMS)
4. Verify recovery code is sent
5. Enter recovery code
6. Set up new 2FA method
7. Verify successful recovery

### Step 9: 2FA Enforcement
1. Test admin-enforced 2FA for specific roles
2. Verify users cannot disable enforced 2FA
3. Test grace period for new users
4. Verify 2FA requirement for sensitive actions
5. Test 2FA prompts for account changes

### Step 10: Arabic Interface 2FA
1. Repeat key 2FA tests on Arabic interface
2. Verify all 2FA prompts in Arabic
3. Test TOTP setup in Arabic
4. Verify SMS verification in Arabic
5. Test backup codes in Arabic

## Expected Results
- 2FA can be set up with multiple methods
- Login requires 2FA verification when enabled
- Backup codes work as fallback
- Recovery options function correctly
- 2FA can be managed and disabled
- Both language interfaces support 2FA
- Security measures prevent bypass attempts

## Error Scenarios
- Authenticator app time sync issues
- SMS delivery failures
- Invalid backup codes
- Recovery method failures
- 2FA service unavailability

## Cross-Browser Testing
- Chrome, Firefox, Safari, Edge
- Mobile browsers for SMS testing
- Authenticator app compatibility

## Playwright Test Implementation

```typescript
import { test, expect } from '@playwright/test';
import { TwoFactorUtils } from '../utils/TwoFactorUtils';
import { SMSService } from '../utils/SMSService';
import { AuthenticatorApp } from '../utils/AuthenticatorApp';

test.describe('Two-Factor Authentication', () => {
  let twoFactorUtils: TwoFactorUtils;
  let smsService: SMSService;
  let authenticatorApp: AuthenticatorApp;

  test.beforeEach(async ({ page }) => {
    twoFactorUtils = new TwoFactorUtils(page);
    smsService = new SMSService();
    authenticatorApp = new AuthenticatorApp();
  });

  test('TCAUTH006_001: TOTP 2FA setup and verification', async ({ page }) => {
    // Step 1: Login first
    await page.goto('/en/login');
    await page.fill('input[type="email"]', 'twofactor@alummahnow.net');
    await page.fill('input[type="password"]', 'TwoFactor123!');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL('/en/dashboard');

    // Step 1: Setup TOTP 2FA
    await page.goto('/en/settings/security');
    await page.click('button:has-text("Enable Two-Factor Authentication")');
    
    // Select authenticator app
    await page.click('input[value="totp"], button:has-text("Authenticator App")');
    
    // Verify QR code and secret are displayed
    await expect(page.locator('[data-testid="qr-code"]')).toBeVisible();
    await expect(page.locator('[data-testid="secret-key"]')).toBeVisible();
    
    // Get secret key for testing
    const secretKey = await page.locator('[data-testid="secret-key"]').inputValue();
    
    // Generate TOTP code
    const totpCode = authenticatorApp.generateCode(secretKey);
    
    // Enter verification code
    await page.fill('input[name="code"], input[placeholder*="code"]', totpCode);
    await page.click('button:has-text("Verify and Enable")');
    
    // Verify success
    await expect(page.locator('.success-message')).toContainText('2FA enabled successfully');
    await expect(page.locator('[data-testid="backup-codes"]')).toBeVisible();
    
    // Save backup codes
    const backupCodes = await page.locator('[data-testid="backup-codes"] li').allTextContents();
    expect(backupCodes).toHaveLength(8);
  });

  test('TCAUTH006_002: SMS 2FA setup and verification', async ({ page }) => {
    // Login first
    await twoFactorUtils.login('twofactor@alummahnow.net', 'TwoFactor123!');
    
    // Setup SMS 2FA
    await page.goto('/en/settings/security');
    await page.click('button:has-text("Add SMS Authentication")');
    
    // Enter phone number
    await page.fill('input[type="tel"], input[name="phone"]', '+1234567890');
    await page.click('button:has-text("Send Verification Code")');
    
    // Verify SMS was sent
    const smsCode = await smsService.getLastVerificationCode();
    expect(smsCode).toBeTruthy();
    
    // Enter verification code
    await page.fill('input[name="sms-code"], input[placeholder*="SMS"]', smsCode);
    await page.click('button:has-text("Verify Phone Number")');
    
    // Verify success
    await expect(page.locator('.success-message')).toContainText('SMS authentication enabled');
  });

  test('TCAUTH006_003: Login with TOTP 2FA', async ({ page }) => {
    // Logout
    await page.goto('/en/logout');
    
    // Step 3: Login with 2FA
    await page.goto('/en/login');
    await page.fill('input[type="email"]', 'twofactor@alummahnow.net');
    await page.fill('input[type="password"]', 'TwoFactor123!');
    await page.click('button[type="submit"]');
    
    // Should show 2FA prompt
    await expect(page.locator('[data-testid="2fa-prompt"]')).toBeVisible();
    await expect(page.locator('h2')).toContainText('Two-Factor Authentication');
    
    // Generate TOTP code
    const secretKey = 'JBSWY3DPEHPK3PXP'; // Use known test secret
    const totpCode = authenticatorApp.generateCode(secretKey);
    
    // Enter code
    await page.fill('input[name="code"], input[placeholder*="code"]', totpCode);
    await page.click('button:has-text("Verify")');
    
    // Verify successful login
    await expect(page).toHaveURL('/en/dashboard');
  });

  test('TCAUTH006_004: Login with SMS 2FA', async ({ page }) => {
    // Logout
    await page.goto('/en/logout');
    
    // Login with credentials
    await page.goto('/en/login');
    await page.fill('input[type="email"]', 'twofactor@alummahnow.net');
    await page.fill('input[type="password"]', 'TwoFactor123!');
    await page.click('button[type="submit"]');
    
    // Click SMS option
    await page.click('button:has-text("Send SMS Code")');
    
    // Get SMS code
    const smsCode = await smsService.getLastVerificationCode();
    
    // Enter SMS code
    await page.fill('input[name="sms-code"], input[placeholder*="SMS"]', smsCode);
    await page.click('button:has-text("Verify")');
    
    // Verify successful login
    await expect(page).toHaveURL('/en/dashboard');
  });

  test('TCAUTH006_005: 2FA code validation and error handling', async ({ page }) => {
    // Logout and start login
    await page.goto('/en/logout');
    await page.goto('/en/login');
    await page.fill('input[type="email"]', 'twofactor@alummahnow.net');
    await page.fill('input[type="password"]', 'TwoFactor123!');
    await page.click('button[type="submit"]');
    
    // Test invalid TOTP code
    await page.fill('input[name="code"], input[placeholder*="code"]', '000000');
    await page.click('button:has-text("Verify")');
    
    // Verify error message
    await expect(page.locator('.error-message')).toContainText('Invalid verification code');
    
    // Test rate limiting
    for (let i = 0; i < 5; i++) {
      await page.fill('input[name="code"], input[placeholder*="code"]', '111111');
      await page.click('button:has-text("Verify")');
      await page.waitForTimeout(100);
    }
    
    // Verify rate limiting message
    await expect(page.locator('.error-message')).toContainText('too many attempts');
  });

  test('TCAUTH006_006: Backup codes usage', async ({ page }) => {
    // Logout and start login
    await page.goto('/en/logout');
    await page.goto('/en/login');
    await page.fill('input[type="email"]', 'twofactor@alummahnow.net');
    await page.fill('input[type="password"]', 'TwoFactor123!');
    await page.click('button[type="submit"]');
    
    // Click backup code option
    await page.click('button:has-text("Use Backup Code")');
    
    // Enter backup code
    await page.fill('input[name="backup-code"], input[placeholder*="backup"]', '12345678');
    await page.click('button:has-text("Verify")');
    
    // Verify successful login
    await expect(page).toHaveURL('/en/dashboard');
    
    // Verify backup code is marked as used
    await page.goto('/en/settings/security');
    await page.click('button:has-text("View Backup Codes")');
    
    const usedCode = await page.locator('text=12345678');
    await expect(usedCode).toHaveClass(/used/);
  });

  test('TCAUTH006_007: 2FA management and disabling', async ({ page }) => {
    // Login and go to security settings
    await twoFactorUtils.login('twofactor@alummahnow.net', 'TwoFactor123!');
    await page.goto('/en/settings/security');
    
    // View active 2FA methods
    await expect(page.locator('[data-testid="totp-status"]')).toContainText('Enabled');
    await expect(page.locator('[data-testid="sms-status"]')).toContainText('Enabled');
    
    // Disable TOTP 2FA
    await page.click('button:has-text("Disable Authenticator App")');
    
    // Should require password confirmation
    await page.fill('input[type="password"]', 'TwoFactor123!');
    await page.click('button:has-text("Confirm Disable")');
    
    // Verify TOTP is disabled
    await expect(page.locator('[data-testid="totp-status"]')).toContainText('Disabled');
  });

  test('TCAUTH006_008: Recovery options', async ({ page }) => {
    // Logout and start login without access to 2FA
    await page.goto('/en/logout');
    await page.goto('/en/login');
    await page.fill('input[type="email"]', 'twofactor@alummahnow.net');
    await page.fill('input[type="password"]', 'TwoFactor123!');
    await page.click('button[type="submit"]');
    
    // Click recovery option
    await page.click('a:has-text("Can\'t access your authenticator?")');
    
    // Select email recovery
    await page.click('input[value="email"], button:has-text("Email Recovery")');
    await page.click('button:has-text("Send Recovery Code")');
    
    // Get recovery code (mock)
    const recoveryCode = 'RECOVERY123';
    
    // Enter recovery code
    await page.fill('input[name="recovery-code"], input[placeholder*="recovery"]', recoveryCode);
    await page.click('button:has-text("Verify Recovery")');
    
    // Should prompt to set up new 2FA
    await expect(page.locator('h2')).toContainText('Set Up New 2FA Method');
  });

  test('TCAUTH006_009: 2FA enforcement for sensitive actions', async ({ page }) => {
    // Login with 2FA enabled
    await twoFactorUtils.loginWith2FA('twofactor@alummahnow.net', 'TwoFactor123!');
    
    // Try to change password
    await page.goto('/en/settings/security');
    await page.click('button:has-text("Change Password")');
    
    // Should require 2FA verification
    await expect(page.locator('[data-testid="2fa-verification"]')).toBeVisible();
    
    // Enter TOTP code
    const totpCode = authenticatorApp.generateCode('JBSWY3DPEHPK3PXP');
    await page.fill('input[name="code"], input[placeholder*="code"]', totpCode);
    await page.click('button:has-text("Verify")');
    
    // Should proceed to password change
    await expect(page.locator('input[name="new-password"]')).toBeVisible();
  });

  test('TCAUTH006_010: Arabic interface 2FA', async ({ page }) => {
    // Test 2FA setup in Arabic
    await page.goto('/ar/login');
    await page.fill('input[type="email"]', 'twofactor@alummahnow.net');
    await page.fill('input[type="password"]', 'TwoFactor123!');
    await page.click('button[type="submit"]');
    
    // Verify Arabic 2FA prompt
    await expect(page.locator('[data-testid="2fa-prompt"] h2')).toContainText('المصادقة الثنائية');
    
    // Test TOTP verification in Arabic
    const totpCode = authenticatorApp.generateCode('JBSWY3DPEHPK3PXP');
    await page.fill('input[name="code"], input[placeholder*="code"]', totpCode);
    await page.click('button:has-text("تحقق")');
    
    // Verify successful login to Arabic dashboard
    await expect(page).toHaveURL('/ar/dashboard');
    await expect(page.locator('h1')).toContainText('لوحة التحكم');
  });
});

// Utility Classes
export class TwoFactorUtils {
  constructor(private page: Page) {}

  async login(email: string, password: string) {
    await this.page.goto('/en/login');
    await this.page.fill('input[type="email"]', email);
    await this.page.fill('input[type="password"]', password);
    await this.page.click('button[type="submit"]');
    await this.page.waitForURL('/en/dashboard');
  }

  async loginWith2FA(email: string, password: string) {
    await this.page.goto('/en/login');
    await this.page.fill('input[type="email"]', email);
    await this.page.fill('input[type="password"]', password);
    await this.page.click('button[type="submit"]');
    
    // Wait for 2FA prompt
    await this.page.waitForSelector('[data-testid="2fa-prompt"]');
    
    // Auto-fill TOTP code for testing
    const authenticatorApp = new AuthenticatorApp();
    const totpCode = authenticatorApp.generateCode('JBSWY3DPEHPK3PXP');
    
    await this.page.fill('input[name="code"], input[placeholder*="code"]', totpCode);
    await this.page.click('button:has-text("Verify")');
    
    await this.page.waitForURL('/en/dashboard');
  }
}

export class SMSService {
  private verificationCodes: string[] = [];

  async getLastVerificationCode(): Promise<string> {
    return this.verificationCodes[this.verificationCodes.length - 1] || '654321';
  }

  async sendVerificationCode(phoneNumber: string): Promise<string> {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    this.verificationCodes.push(code);
    console.log(`SMS sent to ${phoneNumber}: ${code}`);
    return code;
  }

  clearCodes() {
    this.verificationCodes = [];
  }
}

export class AuthenticatorApp {
  generateCode(secret: string): string {
    // Mock TOTP generation for testing
    // In real implementation, this would use the actual TOTP algorithm
    const timeStep = Math.floor(Date.now() / 30000); // 30-second intervals
    const hash = this.mockHOTP(secret, timeStep);
    return hash.toString().padStart(6, '0').slice(-6);
  }

  private mockHOTP(secret: string, counter: number): number {
    // Mock HOTP algorithm for testing
    // In real implementation, this would use HMAC-SHA1
    const seed = secret + counter;
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = ((hash << 5) - hash) + seed.charCodeAt(i);
      hash = hash & hash;
    }
    return Math.abs(hash) % 1000000;
  }

  verifyCode(secret: string, code: string): boolean {
    const expectedCode = this.generateCode(secret);
    return code === expectedCode;
  }
}
```

## Test Data Management
- Mock TOTP authenticator app
- SMS service simulation
- Backup code generation
- Recovery code management

## Cleanup Requirements
- Disable 2FA for test users
- Clear SMS verification codes
- Reset authenticator app state
- Remove backup codes

## Success Criteria
- 2FA can be set up with multiple methods
- Login requires 2FA verification when enabled
- Backup codes provide reliable fallback
- Recovery options work when 2FA is lost
- 2FA can be managed and disabled securely
- Both language interfaces support 2FA completely
- Security measures prevent bypass attempts