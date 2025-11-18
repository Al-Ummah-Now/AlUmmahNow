# TCAUTH004: Password Reset Flow

## Test Overview
**Test Case ID:** TCAUTH004  
**Category:** Authentication  
**Subcategory:** Password Management  
**Test Type:** Functional + Security  
**Priority:** High  
**Estimated Duration:** 8 minutes  

## Description
Verify the complete password reset flow including request submission, email delivery, token validation, and password update functionality across both English and Arabic interfaces.

## Preconditions
- User has valid registered account
- Email service is configured and functional
- Password reset tokens are properly configured
- User is logged out
- Browser supports email link opening

## Test Data
```typescript
const testUsers = {
  validUser: {
    email: 'testuser@alummahnow.net',
    currentPassword: 'CurrentPassword123!',
    newPassword: 'NewPassword456!',
    resetToken: 'generated-reset-token'
  },
  invalidEmail: {
    email: 'nonexistent@alummahnow.net'
  },
  expiredToken: {
    email: 'testuser@alummahnow.net',
    expiredToken: 'expired-reset-token'
  }
};
```

## Test Steps

### Step 1: Navigate to Password Reset
1. Go to `/en/login` (English)
2. Click "Forgot Password?" link
3. Verify redirect to `/en/reset-password`
4. Check page title and instructions display correctly

### Step 2: Request Password Reset (Valid Email)
1. Enter valid email: `testuser@alummahnow.net`
2. Click "Send Reset Link" button
3. Verify success message: "Password reset link sent to your email"
4. Check that email is sent (mock email service)
5. Verify reset token is generated and stored

### Step 3: Request Password Reset (Invalid Email)
1. Go to `/en/reset-password`
2. Enter invalid email: `nonexistent@alummahnow.net`
3. Click "Send Reset Link" button
4. Verify error message: "Email not found in our system"
5. Verify no email is sent
6. Verify no token is generated

### Step 4: Reset Link Email Validation
1. Check email content (mock verification)
2. Verify email contains correct reset link with token
3. Verify email has proper branding and both languages
4. Verify email expiration time is mentioned
5. Verify email security warnings are present

### Step 5: Password Reset with Valid Token
1. Open reset link from email (navigate to `/en/reset-password?token=...`)
2. Verify token validation and form display
3. Enter new password: `NewPassword456!`
4. Confirm new password: `NewPassword456!`
5. Click "Reset Password" button
6. Verify success message: "Password reset successfully"
7. Verify redirect to login page

### Step 6: Password Reset with Invalid Token
1. Navigate to `/en/reset-password?token=invalid-token`
2. Verify error message: "Invalid or expired reset token"
3. Verify redirect to reset request page
4. Verify user can request new reset link

### Step 7: Password Reset with Expired Token
1. Navigate to `/en/reset-password?token=expired-token`
2. Verify error message: "Reset token has expired"
3. Verify option to request new reset link
4. Verify expired token is invalidated

### Step 8: Password Validation
1. Start valid reset flow with valid token
2. Test password requirements:
   - Too short: "Password must be at least 8 characters"
   - No uppercase: "Password must contain uppercase letter"
   - No lowercase: "Password must contain lowercase letter"
   - No number: "Password must contain number"
   - No special char: "Password must contain special character"
3. Verify password strength indicator
4. Verify matching password confirmation validation

### Step 9: Login with New Password
1. Go to `/en/login`
2. Enter email: `testuser@alummahnow.net`
3. Enter new password: `NewPassword456!`
4. Click "Sign In" button
5. Verify successful login and redirect to dashboard
6. Verify old password no longer works

### Step 10: Arabic Interface Testing
1. Repeat steps 1-9 on Arabic interface (`/ar/`)
2. Verify all text displays correctly in Arabic
3. Verify RTL layout for reset forms
4. Verify error messages in Arabic
5. Verify email content includes Arabic

## Expected Results
- Password reset flow works end-to-end
- Security tokens are properly validated
- Email notifications are sent correctly
- Password validation enforces security requirements
- Old passwords are invalidated after reset
- Both English and Arabic interfaces work correctly
- Error handling covers all failure scenarios

## Error Scenarios
- Email service unavailable
- Token generation failures
- Database connection issues during reset
- Rate limiting on reset requests
- Concurrent reset requests

## Cross-Browser Testing
- Chrome, Firefox, Safari, Edge
- Mobile browsers (iOS Safari, Android Chrome)
- Email client link opening

## Playwright Test Implementation

```typescript
import { test, expect } from '@playwright/test';
import { PasswordResetPage } from '../pages/PasswordResetPage';
import { LoginPage } from '../pages/LoginPage';
import { EmailService } from '../utils/EmailService';

test.describe('Password Reset Flow', () => {
  let passwordResetPage: PasswordResetPage;
  let loginPage: LoginPage;
  let emailService: EmailService;

  test.beforeEach(async ({ page }) => {
    passwordResetPage = new PasswordResetPage(page);
    loginPage = new LoginPage(page);
    emailService = new EmailService();
  });

  test('TCAUTH004_001: Complete password reset flow with valid email', async ({ page }) => {
    // Step 1: Navigate to password reset
    await page.goto('/en/login');
    await loginPage.clickForgotPassword();
    await expect(page).toHaveURL('/en/reset-password');
    
    // Step 2: Request password reset
    await passwordResetPage.enterEmail('testuser@alummahnow.net');
    await passwordResetPage.clickSendResetLink();
    
    // Verify success message
    await expect(passwordResetPage.successMessage).toBeVisible();
    await expect(passwordResetPage.successMessage).toContainText('Password reset link sent');
    
    // Verify email was sent
    const email = await emailService.getLastEmail();
    expect(email.to).toBe('testuser@alummahnow.net');
    expect(email.subject).toContain('Password Reset');
    expect(email.body).toContain('reset link');
    
    // Extract reset token from email
    const resetToken = emailService.extractResetToken(email.body);
    expect(resetToken).toBeTruthy();
    
    // Step 5: Reset password with valid token
    await page.goto(`/en/reset-password?token=${resetToken}`);
    await passwordResetPage.enterNewPassword('NewPassword456!');
    await passwordResetPage.confirmNewPassword('NewPassword456!');
    await passwordResetPage.clickResetPassword();
    
    // Verify success
    await expect(passwordResetPage.successMessage).toBeVisible();
    await expect(page).toHaveURL('/en/login');
    
    // Step 9: Login with new password
    await loginPage.enterEmail('testuser@alummahnow.net');
    await loginPage.enterPassword('NewPassword456!');
    await loginPage.clickSignIn();
    
    // Verify successful login
    await expect(page).toHaveURL('/en/dashboard');
  });

  test('TCAUTH004_002: Password reset with invalid email', async ({ page }) => {
    await page.goto('/en/reset-password');
    
    await passwordResetPage.enterEmail('nonexistent@alummahnow.net');
    await passwordResetPage.clickSendResetLink();
    
    // Verify error message
    await expect(passwordResetPage.errorMessage).toBeVisible();
    await expect(passwordResetPage.errorMessage).toContainText('Email not found');
    
    // Verify no email was sent
    const emails = await emailService.getEmails();
    expect(emails.filter(e => e.to === 'nonexistent@alummahnow.net')).toHaveLength(0);
  });

  test('TCAUTH004_003: Password reset with invalid token', async ({ page }) => {
    await page.goto('/en/reset-password?token=invalid-token');
    
    // Verify error message and redirect
    await expect(passwordResetPage.errorMessage).toBeVisible();
    await expect(passwordResetPage.errorMessage).toContainText('Invalid or expired');
    await expect(page).toHaveURL('/en/reset-password');
  });

  test('TCAUTH004_004: Password validation requirements', async ({ page }) => {
    // Start valid reset flow
    const resetToken = await emailService.generateResetToken('testuser@alummahnow.net');
    await page.goto(`/en/reset-password?token=${resetToken}`);
    
    // Test password requirements
    const testCases = [
      { password: 'short', expectedError: 'at least 8 characters' },
      { password: 'nouppercase1!', expectedError: 'uppercase letter' },
      { password: 'NOLOWERCASE1!', expectedError: 'lowercase letter' },
      { password: 'NoNumberPass!', expectedError: 'contain number' },
      { password: 'NoSpecialChar1', expectedError: 'special character' }
    ];
    
    for (const testCase of testCases) {
      await passwordResetPage.enterNewPassword(testCase.password);
      await passwordResetPage.confirmNewPassword(testCase.password);
      await passwordResetPage.clickResetPassword();
      
      await expect(passwordResetPage.errorMessage).toBeVisible();
      await expect(passwordResetPage.errorMessage).toContainText(testCase.expectedError);
    }
  });

  test('TCAUTH004_005: Arabic interface password reset', async ({ page }) => {
    // Test Arabic interface
    await page.goto('/ar/login');
    await loginPage.clickForgotPassword();
    await expect(page).toHaveURL('/ar/reset-password');
    
    // Verify Arabic text
    await expect(passwordResetPage.pageTitle).toContainText('نسيت كلمة المرور');
    
    // Request reset in Arabic
    await passwordResetPage.enterEmail('testuser@alummahnow.net');
    await passwordResetPage.clickSendResetLink();
    
    // Verify Arabic success message
    await expect(passwordResetPage.successMessage).toContainText('تم إرسال رابط');
  });

  test('TCAUTH004_006: Rate limiting on reset requests', async ({ page }) => {
    await page.goto('/en/reset-password');
    
    // Make multiple rapid requests
    for (let i = 0; i < 5; i++) {
      await passwordResetPage.enterEmail('testuser@alummahnow.net');
      await passwordResetPage.clickSendResetLink();
      await page.waitForTimeout(100);
    }
    
    // Verify rate limiting message
    await expect(passwordResetPage.errorMessage).toBeVisible();
    await expect(passwordResetPage.errorMessage).toContainText('too many requests');
  });

  test('TCAUTH004_007: Password confirmation mismatch', async ({ page }) => {
    const resetToken = await emailService.generateResetToken('testuser@alummahnow.net');
    await page.goto(`/en/reset-password?token=${resetToken}`);
    
    await passwordResetPage.enterNewPassword('NewPassword456!');
    await passwordResetPage.confirmNewPassword('DifferentPassword123!');
    await passwordResetPage.clickResetPassword();
    
    // Verify mismatch error
    await expect(passwordResetPage.errorMessage).toBeVisible();
    await expect(passwordResetPage.errorMessage).toContainText('passwords do not match');
  });

  test('TCAUTH004_008: Token expiration handling', async ({ page }) => {
    // Generate expired token
    const expiredToken = await emailService.generateExpiredToken('testuser@alummahnow.net');
    await page.goto(`/en/reset-password?token=${expiredToken}`);
    
    // Verify expiration message
    await expect(passwordResetPage.errorMessage).toBeVisible();
    await expect(passwordResetPage.errorMessage).toContainText('expired');
    
    // Verify option to request new token
    await expect(passwordResetPage.requestNewLinkButton).toBeVisible();
  });
});

// Page Object Model
export class PasswordResetPage {
  constructor(public page: Page) {}

  // Locators
  get pageTitle() { return this.page.locator('h1, .page-title'); }
  get emailInput() { return this.page.locator('input[type="email"], input[name="email"]'); }
  get newPasswordInput() { return this.page.locator('input[type="password"][name*="new"], input[name="password"]'); }
  get confirmPasswordInput() { return this.page.locator('input[type="password"][name*="confirm"], input[name="confirmPassword"]'); }
  get sendResetLinkButton() { return this.page.locator('button:has-text("Send Reset Link"), button[type="submit"]:has-text("Send")'); }
  get resetPasswordButton() { return this.page.locator('button:has-text("Reset Password"), button[type="submit"]:has-text("Reset")'); }
  get successMessage() { return this.page.locator('.success-message, .alert-success, [role="alert"]:has-text("success")'); }
  get errorMessage() { return this.page.locator('.error-message, .alert-error, [role="alert"]:has-text("error")'); }
  get requestNewLinkButton() { return this.page.locator('a:has-text("Request new"), button:has-text("Request new")'); }
  get passwordStrengthIndicator() { return this.page.locator('.password-strength, [data-testid="password-strength"]'); }

  // Actions
  async enterEmail(email: string) {
    await this.emailInput.fill(email);
  }

  async enterNewPassword(password: string) {
    await this.newPasswordInput.fill(password);
  }

  async confirmNewPassword(password: string) {
    await this.confirmPasswordInput.fill(password);
  }

  async clickSendResetLink() {
    await this.sendResetLinkButton.click();
  }

  async clickResetPassword() {
    await this.resetPasswordButton.click();
  }

  async clickRequestNewLink() {
    await this.requestNewLinkButton.click();
  }

  // Utilities
  async getPasswordStrength() {
    const strengthElement = await this.passwordStrengthIndicator;
    if (await strengthElement.isVisible()) {
      return await strengthElement.getAttribute('data-strength') || 
             await strengthElement.textContent();
    }
    return null;
  }
}

// Email Service Mock
export class EmailService {
  private emails: any[] = [];

  async getLastEmail() {
    return this.emails[this.emails.length - 1];
  }

  async getEmails() {
    return this.emails;
  }

  async generateResetToken(email: string): Promise<string> {
    const token = `reset-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.emails.push({
      to: email,
      subject: 'Password Reset Request',
      body: `Click here to reset your password: https://alummahnow.net/reset-password?token=${token}`,
      timestamp: new Date()
    });
    return token;
  }

  async generateExpiredToken(email: string): Promise<string> {
    const token = `expired-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.emails.push({
      to: email,
      subject: 'Password Reset Request',
      body: `Click here to reset your password: https://alummahnow.net/reset-password?token=${token}`,
      timestamp: new Date(Date.now() - 25 * 60 * 60 * 1000) // 25 hours ago
    });
    return token;
  }

  extractResetToken(emailBody: string): string {
    const match = emailBody.match(/token=([^&\s]+)/);
    return match ? match[1] : '';
  }
}
```

## Test Data Management
- Mock email service for testing
- Test user accounts with known passwords
- Token generation and validation utilities
- Rate limiting configuration

## Cleanup Requirements
- Delete test emails after each test
- Invalidate test tokens
- Reset user passwords to original state
- Clear rate limiting counters

## Success Criteria
- Password reset flow completes successfully
- All security validations work correctly
- Email notifications are sent properly
- Both language interfaces function correctly
- Error scenarios are handled gracefully
- Rate limiting prevents abuse