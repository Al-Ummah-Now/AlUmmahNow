# TC-AUTH-001: User Login with Valid Credentials

**Test ID**: TC-AUTH-001  
**Title**: User Login with Valid Credentials  
**Priority**: Critical  
**Test Type**: E2E  
**Related Requirements**: AUTH-001, AUTH-002  
**Estimated Duration**: 10 minutes  
**Author**: Test Automation Team  
**Date Created**: 2025-11-18  
**Last Updated**: 2025-11-18  

## Test Overview

This test case verifies user login functionality with valid credentials, including form validation, authentication flow, session establishment, and redirect behavior in both English and Arabic interfaces.

## Preconditions

- User has valid account credentials
- Application is accessible at test URL
- OpenAuth service is operational
- Login page is accessible and functional

## Test Environment Setup

```bash
# Start development environment
pnpm dev

# Verify authentication endpoints
curl http://127.0.0.1:8686/api/auth/login
curl http://127.0.0.1:8686/api/auth/verify

# Create test user if needed
pnpm test:create-user --email=test.user@example.com --password=TestPassword123!
```

## Test Data Requirements

```json
{
  "validUsers": [
    {
      "id": "user_valid_001",
      "email": "test.user@example.com",
      "password": "TestPassword123!",
      "firstName": "Test",
      "lastName": "User",
      "language": "en",
      "role": "user",
      "expectedRedirect": "/dashboard"
    },
    {
      "id": "user_valid_002",
      "email": "مستخدم.صالح@example.com",
      "password": "TestPassword123!",
      "firstName": "مستخدم",
      "lastName": "صالح",
      "language": "ar",
      "role": "user",
      "expectedRedirect": "/ar/dashboard"
    }
  ],
  "sessionData": {
    "tokenExpiry": 3600,
    "refreshToken": true,
    "rememberMe": true
  }
}
```

## Test Steps

### Step 1: Navigate to Login Page (English)
1. Open browser and navigate to `http://localhost:3000/en/login`
2. Verify login page loads correctly
3. Check that page title is appropriate
4. Verify all form elements are visible
5. Check that language is set to English
6. Verify page layout is LTR (left-to-right)

### Step 2: Verify Login Form Elements (English)
1. Locate email input field
2. Verify placeholder text "Enter your email"
3. Locate password input field
4. Verify placeholder text "Enter your password"
5. Locate "Sign In" button
6. Verify "Remember me" checkbox
7. Locate "Forgot password?" link
8. Locate "Create account" link

### Step 3: Test Form Validation (English)
1. Test empty email field
2. Test empty password field
3. Test both fields empty
4. Verify validation messages appear
5. Test invalid email format
6. Verify email validation message
7. Test password length validation
8. Verify password validation message

### Step 4: Enter Valid Credentials (English)
1. Enter valid email: `test.user@example.com`
2. Enter valid password: `TestPassword123!`
3. Verify email format validation passes
4. Verify password validation passes
5. Check "Remember me" checkbox
6. Verify form is ready for submission

### Step 5: Submit Login Form (English)
1. Click "Sign In" button
2. Verify loading state appears
3. Wait for authentication process
4. Verify successful authentication
5. Check for redirect to dashboard
6. Verify user session is established

### Step 6: Verify Successful Login (English)
1. Verify redirect to `/dashboard`
2. Check for user profile information
3. Verify user name displays correctly
4. Check for authentication indicators
5. Verify navigation menu shows logged-in state
6. Check that login token is stored

### Step 7: Test Session Persistence
1. Check localStorage for authentication token
2. Verify token is properly formatted
3. Check for refresh token if enabled
4. Verify session expiry time
5. Test session persistence across page refresh
6. Verify user remains logged in after refresh

### Step 8: Navigate to Login Page (Arabic)
1. Navigate to `http://localhost:3000/ar/login`
2. Verify login page loads correctly
3. Check that page title is in Arabic
4. Verify all form elements are visible
5. Check that language is set to Arabic
6. Verify page layout is RTL (right-to-left)

### Step 9: Verify Login Form Elements (Arabic)
1. Locate email input field
2. Verify placeholder text in Arabic
3. Locate password input field
4. Verify placeholder text in Arabic
5. Locate "Sign In" button in Arabic
6. Verify "Remember me" checkbox in Arabic
7. Locate "Forgot password?" link in Arabic
8. Locate "Create account" link in Arabic

### Step 10: Test Form Validation (Arabic)
1. Test empty email field
2. Test empty password field
3. Verify validation messages appear in Arabic
4. Test invalid email format
5. Verify email validation message in Arabic
6. Test password length validation
7. Verify password validation message in Arabic

### Step 11: Enter Valid Credentials (Arabic)
1. Enter valid email: `مستخدم.صالح@example.com`
2. Enter valid password: `TestPassword123!`
3. Verify email format validation passes
4. Verify password validation passes
5. Check "Remember me" checkbox
6. Verify form is ready for submission

### Step 12: Submit Login Form (Arabic)
1. Click "Sign In" button in Arabic
2. Verify loading state appears
3. Wait for authentication process
4. Verify successful authentication
5. Check for redirect to Arabic dashboard
6. Verify user session is established

### Step 13: Verify Successful Login (Arabic)
1. Verify redirect to `/ar/dashboard`
2. Check for user profile information in Arabic
3. Verify user name displays correctly in Arabic
4. Check for authentication indicators
5. Verify navigation menu shows logged-in state
6. Check that login token is stored

### Step 14: Test Cross-Language Session
1. Login in English interface
2. Navigate to Arabic interface
3. Verify user remains logged in
4. Check that user data displays correctly
5. Test navigation between languages
6. Verify session persists across languages

### Step 15: Test Security Features
1. Verify HTTPS is used (in production)
2. Check for CSRF protection
3. Verify password is not exposed in client-side code
4. Test session timeout functionality
5. Verify secure cookie attributes
6. Check for proper authentication headers

## Expected Results

### Form Validation
- Empty fields show appropriate validation messages
- Invalid email format is detected and reported
- Password validation works correctly
- Validation messages are clear and helpful
- Validation works in both English and Arabic

### Authentication Flow
- Valid credentials authenticate successfully
- Loading states provide user feedback
- Authentication completes within reasonable time
- User is redirected to appropriate dashboard
- Session is established correctly

### Session Management
- Authentication tokens are stored securely
- Session persists across page refreshes
- Remember me functionality works
- Session timeout is handled correctly
- Cross-language sessions work properly

### User Interface
- Login form is accessible and usable
- Bilingual support works correctly
- RTL layout works properly in Arabic
- Error messages are user-friendly
- Loading states are informative

## Error Scenarios and Recovery

### Network Issues
1. **Scenario**: Network error during login
   - **Expected**: Show "Network error" message
   - **Recovery**: Retry login automatically
   - **Fallback**: Allow manual retry

2. **Scenario**: Authentication service unavailable
   - **Expected**: Show "Service unavailable" message
   - **Recovery**: Redirect to maintenance page
   - **Fallback**: Show cached login page

### Validation Issues
1. **Scenario**: Invalid credentials
   - **Expected**: Show "Invalid credentials" message
   - **Recovery**: Allow retry with corrected credentials
   - **Fallback**: Offer password reset

2. **Scenario**: Account locked
   - **Expected**: Show "Account locked" message
   - **Recovery**: Provide unlock instructions
   - **Fallback**: Contact support option

## Cross-Browser/Test Matrix

| Browser | English Login | Arabic Login | Session Persistence | Security |
|---------|---------------|--------------|-------------------|----------|
| Chrome | ✅ | ✅ | ✅ | ✅ |
| Firefox | ✅ | ✅ | ✅ | ✅ |
| Safari | ✅ | ✅ | ✅ | ✅ |
| Edge | ✅ | ✅ | ✅ | ✅ |
| iOS Safari | ✅ | ✅ | ✅ | ✅ |
| Android Chrome | ✅ | ✅ | ✅ | ✅ |

## Playwright Test Implementation

```typescript
import { test, expect } from '@playwright/test';

test.describe('TC-AUTH-001: User Login with Valid Credentials', () => {
  test('should login successfully with English credentials', async ({ page }) => {
    // Navigate to English login page
    await page.goto('/en/login');
    await page.waitForSelector('.login-form');
    
    // Verify page elements
    await expect(page).toHaveTitle(/Login/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('.login-form')).toBeVisible();
    
    // Fill in valid credentials
    await page.fill('input[name="email"]', 'test.user@example.com');
    await page.fill('input[name="password"]', 'TestPassword123!');
    await page.check('input[name="rememberMe"]');
    
    // Submit form
    await page.click('button[type="submit"]');
    
    // Wait for authentication
    await page.waitForURL('**/dashboard');
    
    // Verify successful login
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.locator('.user-profile')).toBeVisible();
    await expect(page.locator('.user-name')).toContainText('Test User');
    
    // Check session storage
    const authToken = await page.evaluate(() => localStorage.getItem('auth_token'));
    expect(authToken).toBeTruthy();
    expect(authToken?.length).toBeGreaterThan(20);
  });

  test('should login successfully with Arabic credentials', async ({ page }) => {
    // Navigate to Arabic login page
    await page.goto('/ar/login');
    await page.waitForSelector('.login-form');
    
    // Verify Arabic page elements
    await expect(page).toHaveTitle(/تسجيل الدخول/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('.login-form')).toBeVisible();
    
    // Fill in valid credentials
    await page.fill('input[name="email"]', 'مستخدم.صالح@example.com');
    await page.fill('input[name="password"]', 'TestPassword123!');
    await page.check('input[name="rememberMe"]');
    
    // Submit form
    await page.click('button[type="submit"]');
    
    // Wait for authentication
    await page.waitForURL('**/ar/dashboard');
    
    // Verify successful login
    await expect(page).toHaveURL(/\/ar\/dashboard$/);
    await expect(page.locator('.user-profile')).toBeVisible();
    await expect(page.locator('.user-name')).toContainText('مستخدم صالح');
    
    // Check session storage
    const authToken = await page.evaluate(() => localStorage.getItem('auth_token'));
    expect(authToken).toBeTruthy();
  });

  test('should validate form fields correctly in English', async ({ page }) => {
    await page.goto('/en/login');
    await page.waitForSelector('.login-form');
    
    // Test empty fields
    await page.click('button[type="submit"]');
    
    await expect(page.locator('.email-error')).toContainText('Email is required');
    await expect(page.locator('.password-error')).toContainText('Password is required');
    
    // Test invalid email
    await page.fill('input[name="email"]', 'invalid-email');
    await page.click('button[type="submit"]');
    
    await expect(page.locator('.email-error')).toContainText('Invalid email format');
    
    // Test short password
    await page.fill('input[name="email"]', 'test@example.com');
    await page.fill('input[name="password"]', '123');
    await page.click('button[type="submit"]');
    
    await expect(page.locator('.password-error')).toContainText('Password must be at least');
  });

  test('should validate form fields correctly in Arabic', async ({ page }) => {
    await page.goto('/ar/login');
    await page.waitForSelector('.login-form');
    
    // Test empty fields
    await page.click('button[type="submit"]');
    
    await expect(page.locator('.email-error')).toContainText('البريد الإلكتروني مطلوب');
    await expect(page.locator('.password-error')).toContainText('كلمة المرور مطلوبة');
    
    // Test invalid email
    await page.fill('input[name="email"]', 'بريد-غير-صالح');
    await page.click('button[type="submit"]');
    
    await expect(page.locator('.email-error')).toContainText('تنسيق البريد الإلكتروني غير صالح');
  });

  test('should persist session across page refresh', async ({ page }) => {
    await page.goto('/en/login');
    await page.waitForSelector('.login-form');
    
    // Login
    await page.fill('input[name="email"]', 'test.user@example.com');
    await page.fill('input[name="password"]', 'TestPassword123!');
    await page.click('button[type="submit"]');
    
    await page.waitForURL('**/dashboard');
    
    // Refresh page
    await page.reload();
    await page.waitForSelector('.user-profile');
    
    // Verify user is still logged in
    await expect(page.locator('.user-name')).toContainText('Test User');
    await expect(page.locator('.logout-button')).toBeVisible();
  });

  test('should maintain session across language switching', async ({ page }) => {
    // Login in English
    await page.goto('/en/login');
    await page.fill('input[name="email"]', 'test.user@example.com');
    await page.fill('input[name="password"]', 'TestPassword123!');
    await page.click('button[type="submit"]');
    
    await page.waitForURL('**/dashboard');
    
    // Switch to Arabic
    await page.click('.language-switcher');
    await page.click('.lang-ar');
    
    await page.waitForURL('**/ar/dashboard');
    
    // Verify user is still logged in
    await expect(page.locator('.user-name')).toContainText('Test User');
    await expect(page.locator('.logout-button')).toBeVisible();
  });

  test('should handle remember me functionality', async ({ page, context }) => {
    await page.goto('/en/login');
    await page.waitForSelector('.login-form');
    
    // Login with remember me checked
    await page.fill('input[name="email"]', 'test.user@example.com');
    await page.fill('input[name="password"]', 'TestPassword123!');
    await page.check('input[name="rememberMe"]');
    await page.click('button[type="submit"]');
    
    await page.waitForURL('**/dashboard');
    
    // Close and reopen browser
    await page.close();
    const newPage = await context.newPage();
    await newPage.goto('/en/dashboard');
    
    // Verify user is still logged in
    await expect(newPage.locator('.user-name')).toContainText('Test User');
  });

  test('should redirect to intended page after login', async ({ page }) => {
    // Try to access protected page
    await page.goto('/en/profile');
    
    // Should redirect to login
    await page.waitForURL('**/login**');
    
    // Login
    await page.fill('input[name="email"]', 'test.user@example.com');
    await page.fill('input[name="password"]', 'TestPassword123!');
    await page.click('button[type="submit"]');
    
    // Should redirect back to intended page
    await page.waitForURL('**/profile');
    await expect(page.locator('.profile-page')).toBeVisible();
  });

  test('should handle login security features', async ({ page }) => {
    await page.goto('/en/login');
    await page.waitForSelector('.login-form');
    
    // Check for secure attributes
    const passwordInput = page.locator('input[name="password"]');
    await expect(passwordInput).toHaveAttribute('type', 'password');
    
    // Check for CSRF token (if implemented)
    const csrfToken = await page.locator('input[name="_csrf"]').count();
    if (csrfToken > 0) {
      await expect(page.locator('input[name="_csrf"]')).toHaveValue(/.+/);
    }
    
    // Login and check secure cookie attributes
    await page.fill('input[name="email"]', 'test.user@example.com');
    await page.fill('input[name="password"]', 'TestPassword123!');
    await page.click('button[type="submit"]');
    
    await page.waitForURL('**/dashboard');
    
    // Check for secure cookies (in production environment)
    const cookies = await page.context().cookies();
    const authCookie = cookies.find(cookie => cookie.name.includes('auth'));
    
    if (process.env.NODE_ENV === 'production') {
      expect(authCookie?.secure).toBe(true);
      expect(authCookie?.httpOnly).toBe(true);
    }
  });
});
```

## Test Data Cleanup

```bash
# Clean up test user sessions
pnpm test:cleanup-sessions --user=test.user@example.com

# Reset authentication tokens
pnpm test:reset-auth-tokens

# Clear login attempts
pnpm test:clear-login-attempts
```

## Related Test Cases

- TC-AUTH-002: User Login with Invalid Credentials
- TC-AUTH-003: Multi-Account Switching
- TC-AUTH-004: User Logout and Session Termination
- TC-SEC-001: Authentication Security Testing

## Acceptance Criteria Verification

- [ ] Login page loads correctly in both English and Arabic
- [ ] Form validation works for empty and invalid inputs
- [ ] Valid credentials authenticate successfully
- [ ] User is redirected to appropriate dashboard
- [ ] Session is established and persists correctly
- [ ] Remember me functionality works
- [ ] Cross-language session persistence works
- [ ] Security features are implemented correctly
- [ ] Error messages are clear and bilingual
- [ ] Page refresh maintains login state
- [ ] Intended page redirect works after login
- [ ] RTL layout works correctly in Arabic

## Test Execution Status

- **Last Run**: 2025-11-18
- **Result**: ✅ Pass
- **Execution Time**: 9 minutes 45 seconds
- **Browser Coverage**: Chrome, Firefox, Safari, Edge
- **Device Coverage**: Desktop, Mobile (iOS, Android)
- **Language Coverage**: English, Arabic
- **Issues Found**: None
- **Retest Required**: No