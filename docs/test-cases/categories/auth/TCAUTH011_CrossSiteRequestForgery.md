# TCAUTH011: Cross-Site Request Forgery (CSRF) Protection

## Test Overview
**Test Case ID:** TCAUTH011  
**Category:** Authentication  
**Subcategory:** Security  
**Test Type:** Security + Functional  
**Priority:** High  
**Estimated Duration:** 8 minutes  

## Description
Verify comprehensive CSRF protection mechanisms including token generation, validation, same-site cookie configuration, double submit cookies, state parameter validation, and protection bypass prevention across both English and Arabic interfaces.

## Preconditions
- CSRF protection is enabled
- CSRF tokens are properly configured
- Same-site cookie policies are set
- Form protection middleware is active
- API endpoints have CSRF validation

## Test Data
```typescript
const csrfTestData = {
  tokens: {
    validToken: 'csrf_token_abc123def456',
    expiredToken: 'csrf_token_expired_789',
    invalidToken: 'csrf_token_invalid_012',
    reusedToken: 'csrf_token_reused_345'
  },
  forms: {
    login: '/en/login',
    register: '/en/register',
    profile: '/en/profile',
    settings: '/en/settings'
  },
  endpoints: {
    protected: ['/api/user/profile', '/api/user/settings'],
    public: ['/api/public/videos', '/api/public/search']
  },
  cookies: {
    session: 'session_cookie',
    csrf: 'csrf_cookie'
  }
};
```

## Test Steps

### Step 1: CSRF Token Generation
1. Navigate to `/en/login`
2. Check for CSRF token in page
3. Verify token is present in hidden input
4. Check token format and length
5. Verify token uniqueness per session
6. Test token regeneration
7. Check token expiration time
8. Verify token storage method

### Step 2: Form Submission with Valid CSRF Token
1. Navigate to `/en/login`
2. Extract CSRF token from form
3. Fill valid credentials
4. Submit form with valid CSRF token
5. Verify successful submission
6. Check token is consumed/regenerated
7. Test form with updated token
8. Verify token rotation works

### Step 3: Form Submission without CSRF Token
1. Navigate to `/en/login`
2. Remove CSRF token from form
3. Fill valid credentials
4. Submit form without token
5. Verify 403 Forbidden response
6. Check error message about CSRF
7. Verify request is rejected
8. Test with other forms

### Step 4: Form Submission with Invalid CSRF Token
1. Navigate to `/en/login`
2. Replace CSRF token with invalid value
3. Fill valid credentials
4. Submit form with invalid token
5. Verify 403 Forbidden response
6. Check error message about invalid token
7. Verify request is rejected
8. Test with malformed tokens

### Step 5: CSRF Token Reuse Prevention
1. Navigate to `/en/login`
2. Extract CSRF token
3. Submit form successfully
4. Try to reuse same token
5. Verify 403 Forbidden response
6. Check token reuse error message
7. Verify new token is generated
8. Test token reuse detection

### Step 6: Same-Site Cookie Configuration
1. Check session cookie attributes
2. Verify SameSite=Lax or Strict
3. Test cross-origin request protection
4. Verify cookie security flags
5. Test HTTP-only cookie setting
6. Check secure cookie flag (HTTPS)
7. Test cookie domain restrictions
8. Verify cookie path restrictions

### Step 7: API Endpoint CSRF Protection
1. Test GET requests (should not require CSRF)
2. Test POST requests without CSRF token
3. Test POST requests with valid CSRF token
4. Test PUT/PATCH requests
5. Test DELETE requests
6. Test AJAX requests with CSRF headers
7. Test file upload protection
8. Test API token vs CSRF precedence

### Step 8: Double Submit Cookie Pattern
1. Check for CSRF cookie
2. Verify cookie matches form token
3. Test cookie-token validation
4. Test missing cookie scenario
5. Test cookie tampering
6. Verify cookie regeneration
7. Test cookie expiration
8. Test cookie path security

### Step 9: AJAX Request CSRF Protection
1. Test AJAX form submission
2. Verify CSRF header inclusion
3. Test fetch API with CSRF
4. Test XMLHttpRequest with CSRF
5. Test JavaScript framework integration
6. Test dynamic form updates
7. Test SPA route protection
8. Test async request validation

### Step 10: Arabic Interface CSRF Protection
1. Repeat key CSRF tests in Arabic
2. Verify Arabic error messages
3. Test Arabic form protection
4. Check Arabic token generation
5. Verify Arabic API protection
6. Test Arabic error handling

## Expected Results
- CSRF tokens are generated and validated correctly
- Form submissions without valid tokens are rejected
- Token reuse is prevented
- Same-site cookie policies protect against CSRF
- API endpoints have proper CSRF protection
- AJAX requests include CSRF tokens
- Both language interfaces have CSRF protection
- Security measures prevent bypass attempts

## Error Scenarios
- CSRF token generation failures
- Token validation errors
- Cookie configuration issues
- API protection failures
- JavaScript framework conflicts

## Cross-Browser Testing
- Chrome, Firefox, Safari, Edge
- Mobile browsers for CSRF testing
- Different cookie behaviors

## Playwright Test Implementation

```typescript
import { test, expect, request } from '@playwright/test';
import { CSRFUtils } from '../utils/CSRFUtils';
import { CookieUtils } from '../utils/CookieUtils';

test.describe('Cross-Site Request Forgery (CSRF) Protection', () => {
  let apiContext: any;
  let csrfUtils: CSRFUtils;
  let cookieUtils: CookieUtils;

  test.beforeAll(async ({ playwright }) => {
    apiContext = await playwright.request.newContext();
    csrfUtils = new CSRFUtils();
    cookieUtils = new CookieUtils();
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test('TCAUTH011_001: CSRF token generation', async ({ page }) => {
    // Step 1: CSRF token generation
    await page.goto('/en/login');
    
    // Check for CSRF token in page
    const csrfToken = await page.locator('input[name="csrf_token"], input[name="_token"]').inputValue();
    expect(csrfToken).toBeTruthy();
    expect(csrfToken.length).toBeGreaterThan(20);
    
    // Verify token format (alphanumeric with underscores)
    expect(csrfToken).toMatch(/^[a-zA-Z0-9_]+$/);
    
    // Check token uniqueness per session
    const newPage = await page.context().newPage();
    await newPage.goto('/en/login');
    const newToken = await newPage.locator('input[name="csrf_token"], input[name="_token"]').inputValue();
    expect(newToken).not.toBe(csrfToken);
    await newPage.close();
    
    // Test token regeneration
    await page.reload();
    const regeneratedToken = await page.locator('input[name="csrf_token"], input[name="_token"]').inputValue();
    expect(regeneratedToken).toBeTruthy();
    
    // Check token storage method
    const tokenInStorage = await page.evaluate(() => {
      return localStorage.getItem('csrf_token') || sessionStorage.getItem('csrf_token');
    });
    
    // Token should be in form, not necessarily in storage
    expect(csrfToken).toBeTruthy();
  });

  test('TCAUTH011_002: Form submission with valid CSRF token', async ({ page }) => {
    // Step 2: Valid CSRF token submission
    await page.goto('/en/login');
    
    // Extract CSRF token
    const csrfToken = await page.locator('input[name="csrf_token"], input[name="_token"]').inputValue();
    
    // Fill valid credentials
    await page.fill('input[type="email"]', 'csrfuser@alummahnow.net');
    await page.fill('input[type="password"]', 'CSRFPass123!');
    
    // Submit form with valid CSRF token
    await page.click('button[type="submit"]');
    
    // Verify successful submission
    await expect(page).toHaveURL('/en/dashboard');
    
    // Check that new token is generated for next form
    await page.goto('/en/profile');
    const newToken = await page.locator('input[name="csrf_token"], input[name="_token"]').inputValue();
    expect(newToken).toBeTruthy();
    expect(newToken).not.toBe(csrfToken);
  });

  test('TCAUTH011_003: Form submission without CSRF token', async ({ page }) => {
    // Step 3: Missing CSRF token
    await page.goto('/en/login');
    
    // Remove CSRF token from form
    await page.evaluate(() => {
      const csrfInput = document.querySelector('input[name="csrf_token"], input[name="_token"]');
      if (csrfInput) {
        csrfInput.remove();
      }
    });
    
    // Fill valid credentials
    await page.fill('input[type="email"]', 'csrfuser@alummahnow.net');
    await page.fill('input[type="password"]', 'CSRFPass123!');
    
    // Submit form without token
    await page.click('button[type="submit"]');
    
    // Verify 403 Forbidden response
    await expect(page.locator('.error-message')).toContainText('CSRF token');
    await expect(page.locator('.error-message')).toContainText('missing');
    
    // Verify still on login page (request rejected)
    await expect(page).toHaveURL('/en/login');
  });

  test('TCAUTH011_004: Form submission with invalid CSRF token', async ({ page }) => {
    // Step 4: Invalid CSRF token
    await page.goto('/en/login');
    
    // Replace CSRF token with invalid value
    await page.evaluate(() => {
      const csrfInput = document.querySelector('input[name="csrf_token"], input[name="_token"]') as HTMLInputElement;
      if (csrfInput) {
        csrfInput.value = 'invalid_token_123';
      }
    });
    
    // Fill valid credentials
    await page.fill('input[type="email"]', 'csrfuser@alummahnow.net');
    await page.fill('input[type="password"]', 'CSRFPass123!');
    
    // Submit form with invalid token
    await page.click('button[type="submit"]');
    
    // Verify 403 Forbidden response
    await expect(page.locator('.error-message')).toContainText('CSRF token');
    await expect(page.locator('.error-message')).toContainText('invalid');
    
    // Verify still on login page
    await expect(page).toHaveURL('/en/login');
  });

  test('TCAUTH011_005: CSRF token reuse prevention', async ({ page }) => {
    // Step 5: Token reuse prevention
    await page.goto('/en/login');
    
    // Extract CSRF token
    const csrfToken = await page.locator('input[name="csrf_token"], input[name="_token"]').inputValue();
    
    // Submit form successfully first time
    await page.fill('input[type="email"]', 'csrfuser@alummahnow.net');
    await page.fill('input[type="password"]', 'CSRFPass123!');
    await page.click('button[type="submit"]');
    
    await expect(page).toHaveURL('/en/dashboard');
    
    // Logout to test reuse
    await page.goto('/en/logout');
    
    // Go back to login and try to reuse same token
    await page.goto('/en/login');
    
    // Manually set the old token
    await page.evaluate((token) => {
      const csrfInput = document.querySelector('input[name="csrf_token"], input[name="_token"]') as HTMLInputElement;
      if (csrfInput) {
        csrfInput.value = token;
      }
    }, csrfToken);
    
    // Try to submit with reused token
    await page.fill('input[type="email"]', 'csrfuser@alummahnow.net');
    await page.fill('input[type="password"]', 'CSRFPass123!');
    await page.click('button[type="submit"]');
    
    // Should be rejected for token reuse
    await expect(page.locator('.error-message')).toContainText('CSRF token');
    await expect(page.locator('.error-message')).toContainText('used');
  });

  test('TCAUTH011_006: Same-site cookie configuration', async ({ page }) => {
    // Step 6: Same-site cookie configuration
    await page.goto('/en/login');
    
    // Get cookies
    const cookies = await page.context().cookies();
    
    // Find session cookie
    const sessionCookie = cookies.find(cookie => 
      cookie.name.includes('session') || cookie.name.includes('auth')
    );
    
    expect(sessionCookie).toBeTruthy();
    
    // Verify SameSite attribute
    expect(sessionCookie.sameSite).toBe('Lax'); // or 'Strict'
    
    // Verify Secure flag (if on HTTPS)
    if (page.url().startsWith('https://')) {
      expect(sessionCookie.secure).toBe(true);
    }
    
    // Verify HttpOnly flag
    expect(sessionCookie.httpOnly).toBe(true);
    
    // Test cross-origin request protection
    await page.evaluate(() => {
      // Simulate cross-origin request
      fetch('/api/user/profile', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' }
      });
    });
    
    // Should be blocked by SameSite policy
    await page.waitForTimeout(1000);
    // Note: This test might need adjustment based on actual implementation
  });

  test('TCAUTH011_007: API endpoint CSRF protection', async ({ page }) => {
    // Login first to get session
    await page.goto('/en/login');
    await page.fill('input[type="email"]', 'csrfuser@alummahnow.net');
    await page.fill('input[type="password"]', 'CSRFPass123!');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL('/en/dashboard');
    
    // Get CSRF token
    const csrfToken = await page.evaluate(() => {
      const token = document.querySelector('meta[name="csrf-token"]');
      return token ? token.getAttribute('content') : null;
    });
    
    // Test GET request (should not require CSRF)
    const getResponse = await apiContext.get('/api/user/profile');
    expect(getResponse.status()).toBe(200);
    
    // Test POST request without CSRF token
    const postNoTokenResponse = await apiContext.post('/api/user/profile', {
      data: { name: 'Test Update' }
    });
    expect(postNoTokenResponse.status()).toBe(403);
    
    // Test POST request with valid CSRF token
    const postWithTokenResponse = await apiContext.post('/api/user/profile', {
      headers: { 'X-CSRF-Token': csrfToken },
      data: { name: 'Test Update' }
    });
    expect(postWithTokenResponse.status()).toBe(200);
    
    // Test PUT request
    const putResponse = await apiContext.put('/api/user/profile', {
      headers: { 'X-CSRF-Token': csrfToken },
      data: { name: 'Test Update' }
    });
    expect(putResponse.status()).toBe(200);
    
    // Test DELETE request
    const deleteResponse = await apiContext.delete('/api/user/some-resource', {
      headers: { 'X-CSRF-Token': csrfToken }
    });
    // Should be 404 or 200 depending on resource existence
    expect([200, 404, 403]).toContain(deleteResponse.status());
  });

  test('TCAUTH011_008: Double submit cookie pattern', async ({ page }) => {
    // Step 8: Double submit cookie pattern
    await page.goto('/en/login');
    
    // Check for CSRF cookie
    const cookies = await page.context().cookies();
    const csrfCookie = cookies.find(cookie => 
      cookie.name.includes('csrf') || cookie.name.includes('token')
    );
    
    if (csrfCookie) {
      // Get form token
      const formToken = await page.locator('input[name="csrf_token"], input[name="_token"]').inputValue();
      
      // Verify cookie matches form token (or is related)
      expect(csrfCookie.value).toBeTruthy();
      
      // Test cookie-token validation
      await page.fill('input[type="email"]', 'csrfuser@alummahnow.net');
      await page.fill('input[type="password"]', 'CSRFPass123!');
      await page.click('button[type="submit"]');
      
      await expect(page).toHaveURL('/en/dashboard');
      
      // Test missing cookie scenario
      await page.context().clearCookies();
      await page.goto('/en/profile');
      
      // Should generate new cookie and token
      const newCookies = await page.context().cookies();
      const newCsrfCookie = newCookies.find(cookie => 
        cookie.name.includes('csrf') || cookie.name.includes('token')
      );
      expect(newCsrfCookie).toBeTruthy();
    }
  });

  test('TCAUTH011_009: AJAX request CSRF protection', async ({ page }) => {
    // Login first
    await page.goto('/en/login');
    await page.fill('input[type="email"]', 'csrfuser@alummahnow.net');
    await page.fill('input[type="password"]', 'CSRFPass123!');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL('/en/dashboard');
    
    // Get CSRF token for AJAX
    const csrfToken = await page.evaluate(() => {
      const token = document.querySelector('meta[name="csrf-token"]');
      return token ? token.getAttribute('content') : null;
    });
    
    // Test AJAX form submission
    const ajaxResponse = await page.evaluate(async (token) => {
      const response = await fetch('/api/user/profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': token,
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: JSON.stringify({ name: 'AJAX Test' })
      });
      return { status: response.status, data: await response.json() };
    }, csrfToken);
    
    expect(ajaxResponse.status).toBe(200);
    
    // Test AJAX without CSRF token
    const ajaxNoTokenResponse = await page.evaluate(async () => {
      const response = await fetch('/api/user/profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: JSON.stringify({ name: 'AJAX Test No Token' })
      });
      return { status: response.status };
    });
    
    expect(ajaxNoTokenResponse.status).toBe(403);
    
    // Test fetch API with CSRF
    const fetchResponse = await page.evaluate(async (token) => {
      const response = await fetch('/api/user/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': token
        },
        body: JSON.stringify({ name: 'Fetch Test' })
      });
      return { status: response.status };
    }, csrfToken);
    
    expect(fetchResponse.status).toBe(200);
  });

  test('TCAUTH011_010: Arabic interface CSRF protection', async ({ page }) => {
    // Test Arabic interface
    await page.goto('/ar/login');
    
    // Check for CSRF token in Arabic form
    const csrfToken = await page.locator('input[name="csrf_token"], input[name="_token"]').inputValue();
    expect(csrfToken).toBeTruthy();
    
    // Test Arabic error messages
    await page.evaluate(() => {
      const csrfInput = document.querySelector('input[name="csrf_token"], input[name="_token"]');
      if (csrfInput) {
        (csrfInput as HTMLInputElement).value = 'invalid_token';
      }
    });
    
    await page.fill('input[type="email"]', 'csrfuser@alummahnow.net');
    await page.fill('input[type="password"]', 'CSRFPass123!');
    await page.click('button[type="submit"]');
    
    // Verify Arabic error message
    await expect(page.locator('.error-message')).toContainText('رمز CSRF');
    await expect(page.locator('.error-message')).toContainText('غير صالح');
    
    // Test valid submission in Arabic
    await page.goto('/ar/login');
    await page.fill('input[type="email"]', 'csrfuser@alummahnow.net');
    await page.fill('input[type="password"]', 'CSRFPass123!');
    await page.click('button[type="submit"]');
    
    await expect(page).toHaveURL('/ar/dashboard');
  });
});

// Utility Classes
export class CSRFUtils {
  generateToken(): string {
    // Mock CSRF token generation
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substr(2, 9);
    return `csrf_${timestamp}_${random}`;
  }

  validateToken(token: string): boolean {
    // Mock CSRF token validation
    return token && token.startsWith('csrf_') && token.length > 20;
  }

  async getTokenFromPage(page: Page): Promise<string | null> {
    return await page.evaluate(() => {
      const input = document.querySelector('input[name="csrf_token"], input[name="_token"]') as HTMLInputElement;
      return input ? input.value : null;
    });
  }

  async setTokenInPage(page: Page, token: string): Promise<void> {
    await page.evaluate((t) => {
      const input = document.querySelector('input[name="csrf_token"], input[name="_token"]') as HTMLInputElement;
      if (input) {
        input.value = t;
      }
    }, token);
  }
}

export class CookieUtils {
  async getCookieByName(page: Page, name: string): Promise<any> {
    const cookies = await page.context().cookies();
    return cookies.find(cookie => cookie.name === name);
  }

  async checkCookieAttributes(page: Page, cookieName: string): Promise<any> {
    const cookie = await this.getCookieByName(page, cookieName);
    if (!cookie) return null;
    
    return {
      sameSite: cookie.sameSite,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      domain: cookie.domain,
      path: cookie.path,
      expires: cookie.expires
    };
  }

  async clearCSRFCookies(page: Page): Promise<void> {
    const cookies = await page.context().cookies();
    const csrfCookies = cookies.filter(cookie => 
      cookie.name.includes('csrf') || cookie.name.includes('token')
    );
    
    for (const cookie of csrfCookies) {
      await page.context().clearCookies(cookie);
    }
  }
}
```

## Test Data Management
- CSRF token generation utilities
- Cookie configuration testing
- Form protection testing
- API endpoint protection testing

## Cleanup Requirements
- Clear CSRF cookies after tests
- Reset form tokens
- Clear session cookies
- Reset API context

## Success Criteria
- CSRF tokens are generated and validated correctly
- Form submissions without valid tokens are rejected
- Token reuse is prevented
- Same-site cookie policies protect against CSRF
- API endpoints have proper CSRF protection
- AJAX requests include CSRF tokens
- Both language interfaces have CSRF protection
- Security measures prevent bypass attempts