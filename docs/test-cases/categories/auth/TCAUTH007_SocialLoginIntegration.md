# TCAUTH007: Social Login Integration

## Test Overview
**Test Case ID:** TCAUTH007  
**Category:** Authentication  
**Subcategory:** Social Authentication  
**Test Type:** Functional + Integration  
**Priority:** Medium  
**Estimated Duration:** 10 minutes  

## Description
Verify social login integration with Google, Facebook, Twitter, and other OAuth providers including account linking, profile synchronization, permission handling, and error scenarios across both English and Arabic interfaces.

## Preconditions
- Social login providers are configured
- OAuth applications are set up
- Test social media accounts available
- Redirect URLs are configured
- User consent flows are working

## Test Data
```typescript
const socialLoginTestData = {
  providers: {
    google: {
      clientId: 'google-client-id',
      testEmail: 'testuser@gmail.com',
      testName: 'Test User',
      testAvatar: 'https://lh3.googleusercontent.com/test-avatar.jpg'
    },
    facebook: {
      appId: 'facebook-app-id',
      testEmail: 'testuser@facebook.com',
      testName: 'Test User',
      testId: '123456789'
    },
    twitter: {
      apiKey: 'twitter-api-key',
      testHandle: '@testuser',
      testName: 'Test User',
      testId: '987654321'
    }
  },
  user: {
    email: 'socialuser@alummahnow.net',
    password: 'SocialLogin123!'
  }
};
```

## Test Steps

### Step 1: Google OAuth Integration
1. Navigate to `/en/login`
2. Click "Continue with Google" button
3. Verify redirect to Google OAuth consent screen
4. Login with Google test account
5. Grant required permissions
6. Verify redirect back to Al Ummah Now
7. Check user profile creation/import
8. Verify successful login to dashboard

### Step 2: Facebook OAuth Integration
1. Logout from current session
2. Navigate to `/en/login`
3. Click "Continue with Facebook" button
4. Verify redirect to Facebook login
5. Login with Facebook test account
6. Grant app permissions
7. Verify redirect back to Al Ummah Now
8. Check profile data synchronization
9. Verify successful login

### Step 3: Twitter OAuth Integration
1. Logout from current session
2. Navigate to `/en/login`
3. Click "Continue with Twitter" button
4. Verify redirect to Twitter OAuth
5. Login with Twitter test account
6. Authorize application access
7. Verify redirect back to Al Ummah Now
8. Check Twitter profile import
9. Verify successful login

### Step 4: Account Linking
1. Login with email/password
2. Navigate to `/en/settings/accounts`
3. Click "Link Google Account"
4. Complete Google OAuth flow
5. Verify Google account is linked
6. Repeat for Facebook and Twitter
7. Verify all accounts appear linked
8. Test unlinking accounts

### Step 5: Social Login with Existing Email
1. Create account with email/password
2. Logout
3. Try to login with Google using same email
4. Verify account linking prompt
5. Confirm account linking
6. Verify successful login
7. Check that both login methods work

### Step 6: Profile Data Synchronization
1. Login with social provider
2. Check profile data accuracy
3. Verify profile picture import
4. Check name synchronization
5. Test profile update from social provider
6. Verify data privacy settings

### Step 7: Permission and Scope Handling
1. Test minimal permission requests
2. Verify optional permissions
3. Test permission denial scenarios
4. Check graceful handling of missing data
5. Verify user can revoke permissions
6. Test re-authentication requirements

### Step 8: Error Handling
1. Test OAuth flow cancellation
2. Test network errors during OAuth
3. Test invalid OAuth responses
4. Test provider service unavailability
5. Test expired OAuth tokens
6. Verify error messages and recovery

### Step 9: Security Validation
1. Verify OAuth state parameter usage
2. Test CSRF protection
3. Check token validation
4. Verify secure token storage
5. Test token refresh mechanisms
6. Verify logout from all providers

### Step 10: Arabic Interface Social Login
1. Repeat key social login tests in Arabic
2. Verify Arabic consent screens
3. Test Arabic error messages
4. Check Arabic profile display
5. Verify Arabic account linking interface

## Expected Results
- Social login providers work correctly
- Account linking functions properly
- Profile data synchronizes accurately
- Error scenarios are handled gracefully
- Security measures protect against attacks
- Both language interfaces support social login

## Error Scenarios
- OAuth provider downtime
- User denies permissions
- Network connectivity issues
- Invalid OAuth configurations
- Account linking conflicts

## Cross-Browser Testing
- Chrome, Firefox, Safari, Edge
- Mobile browsers for social apps
- Different OAuth redirect behaviors

## Playwright Test Implementation

```typescript
import { test, expect, BrowserContext } from '@playwright/test';
import { SocialLoginUtils } from '../utils/SocialLoginUtils';
import { OAuthMockService } from '../utils/OAuthMockService';

test.describe('Social Login Integration', () => {
  let socialLoginUtils: SocialLoginUtils;
  let oauthMock: OAuthMockService;
  let context: BrowserContext;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    socialLoginUtils = new SocialLoginUtils(context);
    oauthMock = new OAuthMockService();
  });

  test.afterAll(async () => {
    await context.close();
  });

  test('TCAUTH007_001: Google OAuth integration', async ({ page }) => {
    // Mock Google OAuth for testing
    await oauthMock.mockGoogleOAuth({
      email: 'testuser@gmail.com',
      name: 'Test User',
      avatar: 'https://lh3.googleusercontent.com/test-avatar.jpg'
    });

    // Step 1: Google OAuth flow
    await page.goto('/en/login');
    await page.click('button:has-text("Continue with Google")');
    
    // Should redirect to Google OAuth (mocked)
    await expect(page).toHaveURL(/.*google\.com.*/);
    
    // Complete mock OAuth flow
    await oauthMock.completeGoogleOAuth(page);
    
    // Verify redirect back and successful login
    await expect(page).toHaveURL('/en/dashboard');
    
    // Check user profile
    await page.goto('/en/profile');
    await expect(page.locator('[data-testid="user-name"]')).toContainText('Test User');
    await expect(page.locator('[data-testid="user-email"]')).toContainText('testuser@gmail.com');
  });

  test('TCAUTH007_002: Facebook OAuth integration', async ({ page }) => {
    // Mock Facebook OAuth
    await oauthMock.mockFacebookOAuth({
      email: 'testuser@facebook.com',
      name: 'Test User',
      id: '123456789'
    });

    // Logout first
    await page.goto('/en/logout');
    
    // Facebook OAuth flow
    await page.goto('/en/login');
    await page.click('button:has-text("Continue with Facebook")');
    
    // Should redirect to Facebook OAuth (mocked)
    await expect(page).toHaveURL(/.*facebook\.com.*/);
    
    // Complete mock OAuth flow
    await oauthMock.completeFacebookOAuth(page);
    
    // Verify successful login
    await expect(page).toHaveURL('/en/dashboard');
    
    // Check profile data
    await page.goto('/en/profile');
    await expect(page.locator('[data-testid="user-name"]')).toContainText('Test User');
  });

  test('TCAUTH007_003: Twitter OAuth integration', async ({ page }) => {
    // Mock Twitter OAuth
    await oauthMock.mockTwitterOAuth({
      handle: '@testuser',
      name: 'Test User',
      id: '987654321'
    });

    // Logout first
    await page.goto('/en/logout');
    
    // Twitter OAuth flow
    await page.goto('/en/login');
    await page.click('button:has-text("Continue with Twitter")');
    
    // Should redirect to Twitter OAuth (mocked)
    await expect(page).toHaveURL(/.*twitter\.com.*/);
    
    // Complete mock OAuth flow
    await oauthMock.completeTwitterOAuth(page);
    
    // Verify successful login
    await expect(page).toHaveURL('/en/dashboard');
    
    // Check Twitter-specific data
    await page.goto('/en/profile');
    await expect(page.locator('[data-testid="twitter-handle"]')).toContainText('@testuser');
  });

  test('TCAUTH007_004: Account linking functionality', async ({ page }) => {
    // Login with email/password first
    await page.goto('/en/login');
    await page.fill('input[type="email"]', 'socialuser@alummahnow.net');
    await page.fill('input[type="password"]', 'SocialLogin123!');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL('/en/dashboard');

    // Navigate to account settings
    await page.goto('/en/settings/accounts');
    
    // Link Google account
    await oauthMock.mockGoogleOAuth({
      email: 'socialuser@alummahnow.net',
      name: 'Social User'
    });
    
    await page.click('button:has-text("Link Google Account")');
    await oauthMock.completeGoogleOAuth(page);
    
    // Verify Google account is linked
    await expect(page.locator('[data-testid="linked-google"]')).toBeVisible();
    await expect(page.locator('[data-testid="linked-google"]')).toContainText('socialuser@alummahnow.net');
    
    // Link Facebook account
    await oauthMock.mockFacebookOAuth({
      email: 'socialuser@alummahnow.net',
      name: 'Social User'
    });
    
    await page.click('button:has-text("Link Facebook Account")');
    await oauthMock.completeFacebookOAuth(page);
    
    // Verify Facebook account is linked
    await expect(page.locator('[data-testid="linked-facebook"]')).toBeVisible();
  });

  test('TCAUTH007_005: Social login with existing email', async ({ page }) => {
    // Create account with email/password first
    await page.goto('/en/register');
    await page.fill('input[type="email"]', 'existing@alummahnow.net');
    await page.fill('input[type="password"]', 'Password123!');
    await page.fill('input[name="confirmPassword"]', 'Password123!');
    await page.click('button[type="submit"]');
    
    // Logout
    await page.goto('/en/logout');
    
    // Try Google login with same email
    await oauthMock.mockGoogleOAuth({
      email: 'existing@alummahnow.net',
      name: 'Existing User'
    });
    
    await page.goto('/en/login');
    await page.click('button:has-text("Continue with Google")');
    await oauthMock.completeGoogleOAuth(page);
    
    // Should show account linking prompt
    await expect(page.locator('[data-testid="account-linking-prompt"]')).toBeVisible();
    await expect(page.locator('h3')).toContainText('Link Existing Account');
    
    // Confirm linking
    await page.fill('input[type="password"]', 'Password123!');
    await page.click('button:has-text("Link Account")');
    
    // Verify successful login
    await expect(page).toHaveURL('/en/dashboard');
  });

  test('TCAUTH007_006: Profile data synchronization', async ({ page }) => {
    // Mock Google OAuth with profile data
    await oauthMock.mockGoogleOAuth({
      email: 'profiletest@gmail.com',
      name: 'Profile Test User',
      avatar: 'https://lh3.googleusercontent.com/profile-test.jpg',
      locale: 'en'
    });

    await page.goto('/en/login');
    await page.click('button:has-text("Continue with Google")');
    await oauthMock.completeGoogleOAuth(page);
    
    // Check profile synchronization
    await page.goto('/en/profile');
    
    // Verify name
    await expect(page.locator('[data-testid="user-name"]')).toContainText('Profile Test User');
    
    // Verify email
    await expect(page.locator('[data-testid="user-email"]')).toContainText('profiletest@gmail.com');
    
    // Verify avatar
    const avatarSrc = await page.locator('[data-testid="user-avatar"]').getAttribute('src');
    expect(avatarSrc).toContain('profile-test.jpg');
    
    // Test profile update from provider
    await oauthMock.updateGoogleProfile({
      name: 'Updated Name',
      avatar: 'https://lh3.googleusercontent.com/updated-avatar.jpg'
    });
    
    await page.reload();
    await expect(page.locator('[data-testid="user-name"]')).toContainText('Updated Name');
  });

  test('TCAUTH007_007: Permission and scope handling', async ({ page }) => {
    // Mock OAuth with minimal permissions
    await oauthMock.mockGoogleOAuth({
      email: 'minimal@gmail.com',
      name: 'Minimal User',
      scopes: ['email', 'profile']
    });

    await page.goto('/en/login');
    await page.click('button:has-text("Continue with Google")');
    
    // Should show permission request screen
    await expect(page.locator('[data-testid="permission-request"]')).toBeVisible();
    await expect(page.locator('text=email')).toBeVisible();
    await expect(page.locator('text=profile')).toBeVisible();
    
    // Grant permissions
    await page.click('button:has-text("Allow")');
    await oauthMock.completeGoogleOAuth(page);
    
    // Verify successful login with minimal data
    await expect(page).toHaveURL('/en/dashboard');
    
    // Test permission denial
    await page.goto('/en/logout');
    await oauthMock.mockGoogleOAuthWithDenial();
    
    await page.goto('/en/login');
    await page.click('button:has-text("Continue with Google")');
    await page.click('button:has-text("Deny")');
    
    // Should return to login with error
    await expect(page).toHaveURL('/en/login');
    await expect(page.locator('.error-message')).toContainText('permission denied');
  });

  test('TCAUTH007_008: Error handling scenarios', async ({ page }) => {
    // Test OAuth flow cancellation
    await oauthMock.mockGoogleOAuthCancellation();
    
    await page.goto('/en/login');
    await page.click('button:has-text("Continue with Google")');
    
    // Cancel OAuth flow
    await page.click('button:has-text("Cancel")');
    
    // Should return to login
    await expect(page).toHaveURL('/en/login');
    
    // Test network error
    await oauthMock.mockGoogleOAuthError('network_error');
    
    await page.click('button:has-text("Continue with Google")');
    
    // Should show error message
    await expect(page.locator('.error-message')).toContainText('network error');
    
    // Test provider unavailability
    await oauthMock.mockGoogleOAuthError('service_unavailable');
    
    await page.click('button:has-text("Continue with Google")');
    
    // Should show service unavailable message
    await expect(page.locator('.error-message')).toContainText('service unavailable');
  });

  test('TCAUTH007_009: Security validation', async ({ page }) => {
    // Test OAuth state parameter
    await oauthMock.mockGoogleOAuthWithInvalidState();
    
    await page.goto('/en/login');
    await page.click('button:has-text("Continue with Google")');
    await oauthMock.completeGoogleOAuth(page);
    
    // Should detect invalid state and show error
    await expect(page.locator('.error-message')).toContainText('invalid state');
    
    // Test CSRF protection
    await oauthMock.mockGoogleOAuthWithCSRF();
    
    await page.goto('/en/login');
    await page.click('button:has-text("Continue with Google")');
    await oauthMock.completeGoogleOAuth(page);
    
    // Should detect CSRF attempt
    await expect(page.locator('.error-message')).toContainText('security violation');
  });

  test('TCAUTH007_010: Arabic interface social login', async ({ page }) => {
    // Mock Google OAuth for Arabic interface
    await oauthMock.mockGoogleOAuth({
      email: 'arabic@gmail.com',
      name: 'مستخدم عربي'
    });

    // Test Arabic interface
    await page.goto('/ar/login');
    await page.click('button:has-text("متابعة باستخدام جوجل")');
    
    // Complete OAuth flow
    await oauthMock.completeGoogleOAuth(page);
    
    // Verify Arabic dashboard
    await expect(page).toHaveURL('/ar/dashboard');
    await expect(page.locator('h1')).toContainText('لوحة التحكم');
    
    // Check Arabic profile display
    await page.goto('/ar/profile');
    await expect(page.locator('[data-testid="user-name"]')).toContainText('مستخدم عربي');
  });
});

// Utility Classes
export class SocialLoginUtils {
  constructor(private context: BrowserContext) {}

  async unlinkAccount(page: Page, provider: string) {
    await page.goto('/en/settings/accounts');
    await page.click(`button:has-text("Unlink ${provider}")`);
    await page.click('button:has-text("Confirm")');
  }

  async getLinkedAccounts(page: Page): Promise<string[]> {
    await page.goto('/en/settings/accounts');
    const linkedElements = await page.locator('[data-testid^="linked-"]').all();
    const providers = [];
    
    for (const element of linkedElements) {
      const provider = await element.getAttribute('data-testid');
      if (provider) {
        providers.push(provider.replace('linked-', ''));
      }
    }
    
    return providers;
  }
}

export class OAuthMockService {
  private mockData: any = {};

  async mockGoogleOAuth(data: any) {
    this.mockData.google = data;
    // In real implementation, this would set up mock OAuth endpoints
  }

  async mockFacebookOAuth(data: any) {
    this.mockData.facebook = data;
  }

  async mockTwitterOAuth(data: any) {
    this.mockData.twitter = data;
  }

  async mockGoogleOAuthCancellation() {
    this.mockData.google = { cancelled: true };
  }

  async mockGoogleOAuthError(error: string) {
    this.mockData.google = { error };
  }

  async mockGoogleOAuthWithInvalidState() {
    this.mockData.google = { invalidState: true };
  }

  async mockGoogleOAuthWithCSRF() {
    this.mockData.google = { csrf: true };
  }

  async completeGoogleOAuth(page: Page) {
    // Mock OAuth completion
    if (this.mockData.google?.cancelled) {
      await page.goto('/en/login?error=cancelled');
      return;
    }

    if (this.mockData.google?.error) {
      await page.goto(`/en/login?error=${this.mockData.google.error}`);
      return;
    }

    if (this.mockData.google?.invalidState) {
      await page.goto('/en/login?error=invalid_state');
      return;
    }

    if (this.mockData.google?.csrf) {
      await page.goto('/en/login?error=csrf');
      return;
    }

    // Successful OAuth completion
    const params = new URLSearchParams({
      code: 'mock_google_code',
      state: 'mock_state'
    });
    
    await page.goto(`/en/auth/callback/google?${params.toString()}`);
  }

  async completeFacebookOAuth(page: Page) {
    const params = new URLSearchParams({
      code: 'mock_facebook_code',
      state: 'mock_state'
    });
    
    await page.goto(`/en/auth/callback/facebook?${params.toString()}`);
  }

  async completeTwitterOAuth(page: Page) {
    const params = new URLSearchParams({
      oauth_token: 'mock_twitter_token',
      oauth_verifier: 'mock_verifier'
    });
    
    await page.goto(`/en/auth/callback/twitter?${params.toString()}`);
  }

  async updateGoogleProfile(data: any) {
    this.mockData.google = { ...this.mockData.google, ...data };
  }
}
```

## Test Data Management
- Mock OAuth providers for testing
- Test social media accounts
- Profile data templates
- Permission scope configurations

## Cleanup Requirements
- Unlink social accounts from test users
- Clear OAuth tokens
- Reset mock OAuth services
- Remove test social accounts

## Success Criteria
- All social login providers work correctly
- Account linking functions properly
- Profile data synchronizes accurately
- Error scenarios are handled gracefully
- Security measures protect against attacks
- Both language interfaces support social login completely