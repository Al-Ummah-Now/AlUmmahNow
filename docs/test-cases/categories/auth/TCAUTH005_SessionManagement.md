# TCAUTH005: Session Management

## Test Overview
**Test Case ID:** TCAUTH005  
**Category:** Authentication  
**Subcategory:** Session Management  
**Test Type:** Functional + Security  
**Priority:** High  
**Estimated Duration:** 10 minutes  

## Description
Verify comprehensive session management including token storage, expiration, refresh mechanisms, concurrent sessions, and secure logout across multiple devices and browsers.

## Preconditions
- User has valid account
- Authentication system is configured
- JWT tokens are properly configured
- Session storage is available
- Multiple browser contexts available for testing

## Test Data
```typescript
const sessionTestData = {
  user: {
    email: 'sessionuser@alummahnow.net',
    password: 'SessionTest123!',
    userId: 'user-session-001'
  },
  tokens: {
    validToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    expiredToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.expired',
    refreshToken: 'refresh-token-12345'
  },
  sessions: {
    sessionId1: 'sess_abc123',
    sessionId2: 'sess_def456',
    sessionId3: 'sess_ghi789'
  }
};
```

## Test Steps

### Step 1: Session Creation and Storage
1. Navigate to `/en/login`
2. Enter valid credentials
3. Click "Sign In" button
4. Verify successful authentication
5. Check JWT token is stored in localStorage
6. Verify token contains required claims (sub, iat, exp)
7. Verify session cookie is set if applicable
8. Check session data in browser storage

### Step 2: Session Validation
1. After login, navigate to protected route `/en/dashboard`
2. Verify access is granted
3. Check token validation in network requests
4. Verify Authorization header contains Bearer token
5. Test token payload structure
6. Verify user session is active

### Step 3: Session Expiration
1. Wait for token to expire (or simulate expiration)
2. Navigate to protected route
3. Verify redirect to login page
4. Check for expired session message
5. Verify token is removed from storage
6. Test automatic token refresh if configured

### Step 4: Token Refresh Mechanism
1. Login with refresh token enabled
2. Wait for access token to near expiration
3. Make API call that should trigger refresh
4. Verify new access token is issued
5. Verify refresh token remains valid
6. Check old token is invalidated
7. Test refresh token expiration

### Step 5: Concurrent Sessions
1. Login in Browser A (Session 1)
2. Login in Browser B (Session 2) with same account
3. Verify both sessions are active initially
4. Test session isolation (actions in A don't affect B)
5. Check session list in user settings
6. Terminate Session 1 from Browser B
7. Verify Session 1 is invalidated
8. Verify Session 2 remains active

### Step 6: Session Persistence
1. Login and close browser
2. Reopen browser and navigate to protected route
3. Verify session is restored (if persistent)
4. Test session across browser restart
5. Verify token survives browser close
6. Test session in incognito mode

### Step 7: Secure Logout
1. Login successfully
2. Navigate to `/en/logout` or click logout
3. Verify JWT token is removed from storage
4. Check session cookie is cleared
5. Verify server-side session invalidation
6. Test accessing protected route after logout
7. Verify redirect to login page
8. Check logout from all devices option

### Step 8: Session Hijacking Prevention
1. Copy JWT token from logged-in session
2. Use token in different browser/context
3. Verify token validation includes device/IP binding
4. Test token reuse detection
5. Verify suspicious activity logging
6. Test automatic session termination

### Step 9: Cross-Tab Session Sync
1. Login in Browser Tab A
2. Open new Tab B to same domain
3. Verify session is available in Tab B
4. Logout from Tab A
5. Verify Tab B session is invalidated
6. Test session events across tabs

### Step 10: Arabic Interface Session Management
1. Repeat key session tests on Arabic interface
2. Verify session messages in Arabic
3. Test logout flow in Arabic
4. Verify session expiration messages in Arabic

## Expected Results
- Sessions are created and stored securely
- Token validation works correctly
- Session expiration is handled gracefully
- Token refresh mechanism functions properly
- Concurrent sessions are managed correctly
- Logout completely invalidates sessions
- Cross-tab synchronization works
- Both language interfaces handle sessions correctly

## Error Scenarios
- Token storage failures
- Network issues during refresh
- Corrupted session data
- Server-side session store failures
- Concurrent session conflicts

## Cross-Browser Testing
- Chrome, Firefox, Safari, Edge
- Mobile browsers (iOS Safari, Android Chrome)
- Different storage mechanisms (localStorage, sessionStorage, cookies)

## Playwright Test Implementation

```typescript
import { test, expect, BrowserContext, Page } from '@playwright/test';
import { AuthUtils } from '../utils/AuthUtils';
import { SessionManager } from '../utils/SessionManager';

test.describe('Session Management', () => {
  let authUtils: AuthUtils;
  let sessionManager: SessionManager;
  let contextA: BrowserContext;
  let contextB: BrowserContext;
  let pageA: Page;
  let pageB: Page;

  test.beforeAll(async ({ browser }) => {
    authUtils = new AuthUtils();
    sessionManager = new SessionManager();
    
    // Create separate browser contexts for concurrent session testing
    contextA = await browser.newContext();
    contextB = await browser.newContext();
    pageA = await contextA.newPage();
    pageB = await contextB.newPage();
  });

  test.afterAll(async () => {
    await contextA.close();
    await contextB.close();
  });

  test('TCAUTH005_001: Session creation and storage', async ({ page }) => {
    // Step 1: Login and create session
    await page.goto('/en/login');
    await page.fill('input[type="email"]', 'sessionuser@alummahnow.net');
    await page.fill('input[type="password"]', 'SessionTest123!');
    await page.click('button[type="submit"]');
    
    // Verify successful login
    await expect(page).toHaveURL('/en/dashboard');
    
    // Step 5: Check JWT token storage
    const token = await page.evaluate(() => localStorage.getItem('auth_token'));
    expect(token).toBeTruthy();
    
    // Verify token structure
    const tokenPayload = authUtils.decodeJWT(token!);
    expect(tokenPayload).toHaveProperty('sub');
    expect(tokenPayload).toHaveProperty('iat');
    expect(tokenPayload).toHaveProperty('exp');
    expect(tokenPayload.sub).toBe('user-session-001');
    
    // Check session data
    const sessionData = await page.evaluate(() => {
      return {
        token: localStorage.getItem('auth_token'),
        refreshToken: localStorage.getItem('refresh_token'),
        user: JSON.parse(localStorage.getItem('user') || '{}')
      };
    });
    
    expect(sessionData.token).toBeTruthy();
    expect(sessionData.user.email).toBe('sessionuser@alummahnow.net');
  });

  test('TCAUTH005_002: Session validation and protected routes', async ({ page }) => {
    // Login first
    await authUtils.login(page, 'sessionuser@alummahnow.net', 'SessionTest123!');
    
    // Step 2: Access protected route
    await page.goto('/en/dashboard');
    await expect(page).toHaveURL('/en/dashboard');
    
    // Check Authorization header in API calls
    const [response] = await Promise.all([
      page.waitForResponse(response => 
        response.url().includes('/api/user') && response.status() === 200
      ),
      page.reload()
    ]);
    
    const authHeader = response.request().headers()['authorization'];
    expect(authHeader).toBeTruthy();
    expect(authHeader).toMatch(/^Bearer\s+/);
  });

  test('TCAUTH005_003: Session expiration handling', async ({ page }) => {
    // Login with short-lived token
    await authUtils.loginWithExpiringToken(page, 'sessionuser@alummahnow.net', 'SessionTest123!', 1); // 1 second
    
    // Wait for token to expire
    await page.waitForTimeout(2000);
    
    // Try to access protected route
    await page.goto('/en/dashboard');
    
    // Should redirect to login
    await expect(page).toHaveURL('/en/login');
    
    // Check for expiration message
    await expect(page.locator('.error-message, .alert')).toContainText('session expired');
    
    // Verify token is removed
    const token = await page.evaluate(() => localStorage.getItem('auth_token'));
    expect(token).toBeNull();
  });

  test('TCAUTH005_004: Token refresh mechanism', async ({ page }) => {
    // Login with refresh token
    await authUtils.loginWithRefreshToken(page, 'sessionuser@alummahnow.net', 'SessionTest123!');
    
    const originalToken = await page.evaluate(() => localStorage.getItem('auth_token'));
    
    // Wait for near expiration and make API call
    await page.waitForTimeout(30000); // Wait 30 seconds
    
    // Make API call that should trigger refresh
    await page.goto('/en/api/user/profile');
    
    // Check if token was refreshed
    const newToken = await page.evaluate(() => localStorage.getItem('auth_token'));
    expect(newToken).not.toBe(originalToken);
    
    // Verify new token is valid
    const tokenPayload = authUtils.decodeJWT(newToken!);
    expect(tokenPayload.exp).toBeGreaterThan(Date.now() / 1000);
  });

  test('TCAUTH005_005: Concurrent sessions management', async () => {
    // Session 1 in Browser A
    await authUtils.login(pageA, 'sessionuser@alummahnow.net', 'SessionTest123!');
    await expect(pageA).toHaveURL('/en/dashboard');
    
    // Session 2 in Browser B
    await authUtils.login(pageB, 'sessionuser@alummahnow.net', 'SessionTest123!');
    await expect(pageB).toHaveURL('/en/dashboard');
    
    // Both sessions should be active
    await expect(pageA.locator('h1')).toContainText('Dashboard');
    await expect(pageB.locator('h1')).toContainText('Dashboard');
    
    // Terminate Session 1 from Session 2
    await pageB.goto('/en/settings/sessions');
    await pageB.click('[data-testid="terminate-session"]:first-child');
    await pageB.click('button:has-text("Confirm")');
    
    // Session 1 should be invalidated
    await pageA.reload();
    await expect(pageA).toHaveURL('/en/login');
    
    // Session 2 should remain active
    await pageB.reload();
    await expect(pageB).toHaveURL('/en/settings/sessions');
  });

  test('TCAUTH005_006: Session persistence across browser restart', async ({ context }) => {
    const page = await context.newPage();
    
    // Login
    await authUtils.login(page, 'sessionuser@alummahnow.net', 'SessionTest123!');
    
    // Close and reopen browser (simulate)
    await context.close();
    const newContext = await test.browser().newContext();
    const newPage = await newContext.newPage();
    
    // Navigate to protected route
    await newPage.goto('/en/dashboard');
    
    // Should still be logged in (if persistent)
    await expect(newPage).toHaveURL('/en/dashboard');
    
    await newContext.close();
  });

  test('TCAUTH005_007: Secure logout functionality', async ({ page }) => {
    // Login first
    await authUtils.login(page, 'sessionuser@alummahnow.net', 'SessionTest123!');
    
    // Logout
    await page.click('[data-testid="user-menu"]');
    await page.click('button:has-text("Logout")');
    
    // Verify token removal
    const token = await page.evaluate(() => localStorage.getItem('auth_token'));
    expect(token).toBeNull();
    
    // Verify redirect to login
    await expect(page).toHaveURL('/en/login');
    
    // Try to access protected route
    await page.goto('/en/dashboard');
    await expect(page).toHaveURL('/en/login');
  });

  test('TCAUTH005_008: Cross-tab session synchronization', async ({ context }) => {
    const page1 = await context.newPage();
    const page2 = await context.newPage();
    
    // Login in Tab 1
    await authUtils.login(page1, 'sessionuser@alummahnow.net', 'SessionTest123!');
    
    // Tab 2 should have session
    await page2.goto('/en/dashboard');
    await expect(page2).toHaveURL('/en/dashboard');
    
    // Logout from Tab 1
    await page1.click('[data-testid="user-menu"]');
    await page1.click('button:has-text("Logout")');
    
    // Tab 2 should be logged out
    await page2.reload();
    await expect(page2).toHaveURL('/en/login');
    
    await page1.close();
    await page2.close();
  });

  test('TCAUTH005_009: Arabic interface session management', async ({ page }) => {
    // Test in Arabic
    await page.goto('/ar/login');
    await page.fill('input[type="email"]', 'sessionuser@alummahnow.net');
    await page.fill('input[type="password"]', 'SessionTest123!');
    await page.click('button[type="submit"]');
    
    // Verify Arabic dashboard
    await expect(page).toHaveURL('/ar/dashboard');
    await expect(page.locator('h1')).toContainText('لوحة التحكم');
    
    // Logout in Arabic
    await page.click('[data-testid="user-menu"]');
    await page.click('button:has-text("تسجيل الخروج")');
    
    // Verify Arabic login page
    await expect(page).toHaveURL('/ar/login');
    await expect(page.locator('h1')).toContainText('تسجيل الدخول');
  });

  test('TCAUTH005_010: Session hijacking prevention', async ({ context }) => {
    const page1 = await context.newPage();
    const page2 = await context.newPage();
    
    // Login in page1
    await authUtils.login(page1, 'sessionuser@alummahnow.net', 'SessionTest123!');
    
    // Get token from page1
    const token = await page1.evaluate(() => localStorage.getItem('auth_token'));
    
    // Try to use token in page2 (different context)
    await page2.goto('/en/login');
    await page2.evaluate((authToken) => {
      localStorage.setItem('auth_token', authToken);
    }, token);
    
    // Try to access protected route
    await page2.goto('/en/dashboard');
    
    // Should be rejected if device/IP binding is enabled
    await expect(page2).toHaveURL('/en/login');
    
    await page1.close();
    await page2.close();
  });
});

// Utility Classes
export class AuthUtils {
  async login(page: Page, email: string, password: string) {
    await page.goto('/en/login');
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForURL('/en/dashboard');
  }

  async loginWithExpiringToken(page: Page, email: string, password: string, expiresInMinutes: number) {
    // Mock login with custom token expiration
    await page.goto('/en/login');
    await page.route('**/api/auth/login', async route => {
      const response = await route.fetch();
      const body = await response.json();
      body.token = this.generateExpiringToken(expiresInMinutes);
      await route.fulfill({ response, json: body });
    });
    
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForURL('/en/dashboard');
  }

  async loginWithRefreshToken(page: Page, email: string, password: string) {
    await page.goto('/en/login');
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForURL('/en/dashboard');
  }

  decodeJWT(token: string): any {
    try {
      const payload = token.split('.')[1];
      return JSON.parse(atob(payload));
    } catch {
      return {};
    }
  }

  private generateExiringToken(expiresInMinutes: number): string {
    // Mock token generation for testing
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = btoa(JSON.stringify({
      sub: 'user-session-001',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + (expiresInMinutes * 60)
    }));
    return `${header}.${payload}.mock_signature`;
  }
}

export class SessionManager {
  async getActiveSessions(userId: string): Promise<any[]> {
    // Mock implementation to get active sessions
    return [
      { id: 'sess_abc123', device: 'Chrome on Windows', lastActive: new Date() },
      { id: 'sess_def456', device: 'Safari on iPhone', lastActive: new Date() }
    ];
  }

  async terminateSession(sessionId: string): Promise<boolean> {
    // Mock implementation to terminate session
    return true;
  }

  async terminateAllSessionsExceptCurrent(userId: string, currentSessionId: string): Promise<boolean> {
    // Mock implementation to terminate all sessions except current
    return true;
  }
}
```

## Test Data Management
- Mock JWT token generation and validation
- Test user accounts with session data
- Session storage utilities
- Token expiration simulation

## Cleanup Requirements
- Clear all session tokens after tests
- Terminate test sessions
- Reset user session state
- Clear browser storage

## Success Criteria
- Sessions are created and managed securely
- Token validation and refresh work correctly
- Concurrent sessions are handled properly
- Logout completely invalidates sessions
- Cross-tab synchronization functions
- Both language interfaces work correctly
- Security measures prevent session hijacking