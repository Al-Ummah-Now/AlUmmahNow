# TCERR004: Authentication Error Handling

## Test Overview

**Test Case ID**: TCERR004  
**Category**: Error Handling  
**Sub-category**: Authentication & Authorization Errors  
**Priority**: Critical  
**Estimated Duration**: 55 minutes  
**Test Type**: Functional Testing + Security Testing

## Description

This test case validates the application's handling of authentication and authorization errors, including login failures, token expiration, permission denied scenarios, and session management issues. The test ensures secure error handling, proper user feedback, and appropriate security measures during authentication failures.

## Requirements

### Functional Requirements
- FR1: Secure login error handling with generic error messages
- FR2: Token expiration detection and refresh mechanisms
- FR3: Permission denied error handling with appropriate redirects
- FR4: Session timeout handling and re-authentication flows
- FR5: Multi-factor authentication error handling
- FR6: Account lockout and rate limiting error responses
- FR7: Social authentication error handling
- FR8: Password reset and recovery error handling

### Technical Requirements
- TR1: JWT token validation and refresh logic
- TR2: OAuth 2.0 error response handling
- TR3: Session management and timeout detection
- TR4: Rate limiting and account lockout mechanisms
- TR5: Secure error message generation
- TR6: Authentication state management
- TR7: Cross-tab authentication synchronization
- TR8: Security event logging and monitoring

### Business Requirements
- BR1: Protect user accounts from enumeration attacks
- BR2: Provide clear but secure error messaging
- BR3: Maintain application security during auth failures
- BR4: Support various authentication methods
- BR5: Ensure compliance with security standards
- BR6: Provide good user experience during auth issues

## Test Environment

### Required Components
- **Frontend**: Next.js application with auth handling
- **Backend**: Hono API with authentication middleware
- **Auth Service**: OpenAuth integration
- **Token Management**: JWT handling utilities
- **Security**: Rate limiting and monitoring
- **Testing**: Auth error simulation utilities

### Test Data
- User accounts with various auth scenarios
- Expired and invalid tokens
- Permission configurations
- Rate limiting configurations
- Social auth provider configurations

### Test Accounts
- **Valid User**: Normal authentication flow
- **Locked User**: Account lockout scenarios
- **Expired User**: Token expiration testing
- **Unauthorized User**: Permission testing
- **Social User**: OAuth authentication testing

## Test Procedure

### Phase 1: Login Error Handling (15 minutes)

1. **Navigate to Login Page**
   - Access login page
   - Verify page loads correctly
   - Check form validation

2. **Test Invalid Credentials**
   - Enter invalid username/password
   - Verify generic error message
   - Check rate limiting behavior
   - Test account lockout after multiple failures

3. **Test Account Status Errors**
   - Try login with locked account
   - Test suspended account login
   - Verify unverified account handling
   - Check deleted account scenarios

4. **Test Form Validation Errors**
   - Submit empty login form
   - Test invalid email formats
   - Verify password requirements
   - Check client-side validation

### Phase 2: Token and Session Management (15 minutes)

5. **Test Token Expiration**
   - Login with valid credentials
   - Simulate token expiration
   - Verify automatic token refresh
   - Test manual re-authentication

6. **Test Session Timeout**
   - Establish active session
   - Simulate session timeout
   - Verify timeout detection
   - Test session recovery flow

7. **Test Concurrent Session Handling**
   - Login from multiple tabs/devices
   - Test session conflict resolution
   - Verify session synchronization
   - Check logout propagation

### Phase 3: Authorization Errors (10 minutes)

8. **Test Permission Denied**
   - Access protected resource without permissions
   - Verify 403 error handling
   - Check appropriate redirects
   - Test error message clarity

9. **Test Role-Based Access**
   - Test access with insufficient role
   - Verify role validation
   - Check role escalation prevention
   - Test admin-only resource access

10. **Test Resource Access Control**
    - Test cross-user resource access
    - Verify ownership validation
    - Check shared resource permissions
    - Test API endpoint authorization

### Phase 4: Advanced Authentication Scenarios (15 minutes)

11. **Test Multi-Factor Authentication**
    - Enable MFA for test account
    - Test invalid MFA codes
    - Verify backup code usage
    - Check MFA setup errors

12. **Test Social Authentication**
    - Test OAuth provider errors
    - Verify social auth failure handling
    - Test account linking errors
    - Check social auth disconnection

13. **Test Password Recovery**
    - Test invalid email recovery
    - Verify expired recovery tokens
    - Test recovery rate limiting
    - Check recovery process errors

## Test Data

### Authentication Error Configuration Structure
```typescript
interface AuthErrorConfig {
  login: {
    maxAttempts: number;
    lockoutDuration: number; // minutes
    rateLimitWindow: number; // minutes
    genericErrorMessage: string;
  };
  tokens: {
    accessTokenExpiry: number; // minutes
    refreshTokenExpiry: number; // days
    refreshThreshold: number; // minutes before expiry
    leeway: number; // seconds
  };
  sessions: {
    timeout: number; // minutes
    renewalThreshold: number; // minutes
    maxConcurrentSessions: number;
  };
  mfa: {
    maxAttempts: number;
    codeExpiry: number; // minutes
    backupCodeCount: number;
  };
  security: {
    logFailedAttempts: boolean;
    logSuccessfulLogins: boolean;
    alertSuspiciousActivity: boolean;
  };
}

interface AuthError {
  type: 'invalid_credentials' | 'account_locked' | 'token_expired' | 'permission_denied' | 'session_timeout' | 'mfa_required';
  code: string;
  message: string;
  details?: Record<string, any>;
  retryAfter?: number;
  requiresAction?: boolean;
}

interface UserAuthState {
  isAuthenticated: boolean;
  user?: User;
  tokens?: {
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
  };
  permissions: string[];
  roles: string[];
  mfaEnabled: boolean;
  sessionActive: boolean;
}
```

### Test Scenarios
```typescript
const authErrorTestScenarios = {
  invalidCredentials: {
    attempts: [
      { username: 'user@example.com', password: 'wrong1', expectedError: 'Invalid credentials' },
      { username: 'user@example.com', password: 'wrong2', expectedError: 'Invalid credentials' },
      { username: 'user@example.com', password: 'wrong3', expectedError: 'Invalid credentials' },
      { username: 'user@example.com', password: 'wrong4', expectedError: 'Invalid credentials' },
      { username: 'user@example.com', password: 'wrong5', expectedError: 'Account locked' }
    ]
  },
  
  tokenExpiration: {
    scenarios: [
      { tokenAge: 'expired', expectedBehavior: 'refresh_token' },
      { tokenAge: 'expiring_soon', expectedBehavior: 'auto_refresh' },
      { tokenAge: 'valid', expectedBehavior: 'no_action' }
    ]
  },
  
  permissionDenied: {
    resources: [
      { path: '/admin/users', role: 'user', expectedError: 'Permission denied' },
      { path: '/api/channels/123', role: 'user', owner: false, expectedError: 'Access denied' },
      { path: '/api/channels/123', role: 'user', owner: true, expectedError: 'Success' }
    ]
  },
  
  mfaErrors: {
    scenarios: [
      { code: '123456', valid: false, expectedError: 'Invalid code' },
      { code: 'expired', valid: false, expectedError: 'Code expired' },
      { code: 'correct', valid: true, expectedError: 'Success' }
    ]
  }
};
```

## Expected Results

### Success Criteria
- All authentication errors handled securely
- Generic error messages prevent enumeration
- Token refresh works automatically
- Permission errors handled appropriately
- Session management functions correctly
- Security measures enforced during errors

### Security Criteria
- No sensitive information leaked in errors
- Rate limiting enforced during auth failures
- Account lockout mechanisms functional
- Secure token handling and refresh
- Proper session invalidation

### User Experience Criteria
- Clear but secure error messages
- Smooth authentication flows
- Intuitive recovery processes
- Consistent error handling across auth methods
- Helpful guidance for error resolution

## Error Scenarios

### Common Authentication Errors
1. **Invalid Credentials**
   - Error: Username or password incorrect
   - Resolution: Generic error message, rate limiting

2. **Account Locked**
   - Error: Account temporarily locked
   - Resolution: Lockout duration, recovery options

3. **Token Expired**
   - Error: Authentication token expired
   - Resolution: Automatic refresh, re-authentication

4. **Permission Denied**
   - Error: Insufficient permissions
   - Resolution: Access denied page, permission request

5. **Session Timeout**
   - Error: Session expired
   - Resolution: Re-authentication prompt

### Security Considerations
1. **Error Message Security**
   - Avoid revealing account existence
   - Use generic error messages
   - Sanitize all error outputs

2. **Rate Limiting**
   - Implement progressive delays
   - Account lockout after failures
   - IP-based rate limiting

3. **Token Security**
   - Secure token storage
   - Proper token invalidation
   - Refresh token rotation

## Test Automation

### Playwright Test Implementation
```typescript
import { test, expect } from '@playwright/test';

test.describe('Authentication Error Handling', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to login page
    await page.goto('/login');
  });

  test('should handle invalid credentials securely', async ({ page }) => {
    // Test invalid credentials
    await page.fill('[data-testid="email-input"]', 'user@example.com');
    await page.fill('[data-testid="password-input"]', 'wrongpassword');
    await page.click('[data-testid="login-button"]');
    
    // Verify generic error message
    await expect(page.locator('[data-testid="auth-error"]')).toBeVisible();
    await expect(page.locator('[data-testid="auth-error"]')).toContainText('Invalid email or password');
    
    // Verify no account enumeration
    await expect(page.locator('[data-testid="auth-error"]')).not.toContainText('user');
    await expect(page.locator('[data-testid="auth-error"]')).not.toContainText('exists');
    
    // Test multiple failed attempts
    for (let i = 0; i < 4; i++) {
      await page.fill('[data-testid="password-input"]', `wrongpassword${i}`);
      await page.click('[data-testid="login-button"]');
      await expect(page.locator('[data-testid="auth-error"]')).toBeVisible();
    }
    
    // Verify account lockout
    await expect(page.locator('[data-testid="auth-error"]')).toContainText('Account temporarily locked');
    await expect(page.locator('[data-testid="lockout-timer"]')).toBeVisible();
  });

  test('should handle token expiration gracefully', async ({ page }) => {
    // Login successfully
    await page.fill('[data-testid="email-input"]', 'valid@example.com');
    await page.fill('[data-testid="password-input"]', 'validpassword');
    await page.click('[data-testid="login-button"]');
    await expect(page.locator('[data-testid="user-dashboard"]')).toBeVisible();
    
    // Simulate token expiration
    await page.evaluate(() => {
      localStorage.setItem('access_token', 'expired_token');
      localStorage.setItem('token_expires', '0');
    });
    
    // Try to access protected resource
    await page.goto('/protected-resource');
    
    // Verify automatic token refresh attempt
    await expect(page.locator('[data-testid="token-refresh"]')).toBeVisible();
    
    // If refresh fails, redirect to login
    await expect(page.locator('[data-testid="login-redirect"]')).toBeVisible();
    await expect(page.locator('[data-testid="session-expired-message"]')).toContainText('Your session has expired');
  });

  test('should handle permission denied errors', async ({ page }) => {
    // Login as regular user
    await page.fill('[data-testid="email-input"]', 'user@example.com');
    await page.fill('[data-testid="password-input"]', 'userpassword');
    await page.click('[data-testid="login-button"]');
    await expect(page.locator('[data-testid="user-dashboard"]')).toBeVisible();
    
    // Try to access admin resource
    await page.goto('/admin/users');
    
    // Verify permission denied handling
    await expect(page.locator('[data-testid="permission-denied"]')).toBeVisible();
    await expect(page.locator('[data-testid="error-message"]')).toContainText('You don\'t have permission');
    
    // Verify appropriate redirect
    await expect(page.url()).toContain('/unauthorized');
    
    // Test API permission denied
    const response = await page.evaluate(async () => {
      try {
        const resp = await fetch('/api/admin/users', {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('access_token')}`
          }
        });
        return { status: resp.status, data: await resp.json() };
      } catch (error) {
        return { error: error.message };
      }
    });
    
    expect(response.status).toBe(403);
    expect(response.data.error).toContain('Permission denied');
  });

  test('should handle session timeout correctly', async ({ page }) => {
    // Login successfully
    await page.fill('[data-testid="email-input"]', 'valid@example.com');
    await page.fill('[data-testid="password-input"]', 'validpassword');
    await page.click('[data-testid="login-button"]');
    await expect(page.locator('[data-testid="user-dashboard"]')).toBeVisible();
    
    // Simulate session timeout
    await page.evaluate(() => {
      localStorage.setItem('session_timeout', '0');
    });
    
    // Wait for session timeout detection
    await page.waitForTimeout(60000); // Wait for timeout check
    
    // Verify session timeout handling
    await expect(page.locator('[data-testid="session-timeout-modal"]')).toBeVisible();
    await expect(page.locator('[data-testid="timeout-message"]')).toContainText('Your session has expired due to inactivity');
    
    // Test re-authentication option
    await page.click('[data-testid="reauth-button"]');
    await expect(page.locator('[data-testid="reauth-form"]')).toBeVisible();
    
    // Test logout option
    await page.click('[data-testid="logout-button"]');
    await expect(page.locator('[data-testid="login-page"]')).toBeVisible();
  });

  test('should handle multi-factor authentication errors', async ({ page }) => {
    // Login with MFA-enabled account
    await page.fill('[data-testid="email-input"]', 'mfa@example.com');
    await page.fill('[data-testid="password-input"]', 'mfapassword');
    await page.click('[data-testid="login-button"]');
    
    // Verify MFA prompt
    await expect(page.locator('[data-testid="mfa-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="mfa-message"]')).toContainText('Enter your verification code');
    
    // Test invalid MFA code
    await page.fill('[data-testid="mfa-input"]', '123456');
    await page.click('[data-testid="verify-mfa"]');
    
    await expect(page.locator('[data-testid="mfa-error"]')).toBeVisible();
    await expect(page.locator('[data-testid="mfa-error"]')).toContainText('Invalid verification code');
    
    // Test multiple MFA failures
    for (let i = 0; i < 2; i++) {
      await page.fill('[data-testid="mfa-input"]', `${123456 + i}`);
      await page.click('[data-testid="verify-mfa"]');
      await expect(page.locator('[data-testid="mfa-error"]')).toBeVisible();
    }
    
    // Verify MFA lockout
    await expect(page.locator('[data-testid="mfa-lockout"]')).toBeVisible();
    await expect(page.locator('[data-testid="backup-code-option"]')).toBeVisible();
    
    // Test backup code usage
    await page.click('[data-testid="use-backup-code"]');
    await page.fill('[data-testid="backup-code-input"]', 'backup123');
    await page.click('[data-testid="verify-backup-code"]');
    
    await expect(page.locator('[data-testid="user-dashboard"]')).toBeVisible();
  });

  test('should handle social authentication errors', async ({ page }) => {
    // Test social auth provider error
    await page.click('[data-testid="google-login"]');
    
    // Mock OAuth error
    await page.route('**/oauth/google**', route => {
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'access_denied',
          error_description: 'User denied access'
        })
      });
    });
    
    // Verify error handling
    await expect(page.locator('[data-testid="social-auth-error"]')).toBeVisible();
    await expect(page.locator('[data-testid="error-message"]')).toContainText('Authentication failed');
    
    // Test account linking error
    await page.fill('[data-testid="email-input"]', 'existing@example.com');
    await page.fill('[data-testid="password-input"]', 'password');
    await page.click('[data-testid="login-button"]');
    
    // Try to link same social account
    await page.click('[data-testid="link-google-account"]');
    
    await expect(page.locator('[data-testid="link-error"]')).toBeVisible();
    await expect(page.locator('[data-testid="link-error"]')).toContainText('Account already linked');
  });

  test('should handle password recovery errors', async ({ page }) => {
    // Navigate to password recovery
    await page.click('[data-testid="forgot-password"]');
    await expect(page.locator('[data-testid="recovery-form"]')).toBeVisible();
    
    // Test invalid email
    await page.fill('[data-testid="recovery-email"]', 'nonexistent@example.com');
    await page.click('[data-testid="send-recovery"]');
    
    // Verify generic success message (security)
    await expect(page.locator('[data-testid="recovery-success"]')).toBeVisible();
    await expect(page.locator('[data-testid="recovery-success"]')).toContainText('If an account exists');
    
    // Test rate limiting
    await page.click('[data-testid="forgot-password"]');
    await page.fill('[data-testid="recovery-email"]', 'test@example.com');
    await page.click('[data-testid="send-recovery"]');
    
    await expect(page.locator('[data-testid="rate-limit-error"]')).toBeVisible();
    await expect(page.locator('[data-testid="rate-limit-error"]')).toContainText('Too many requests');
    
    // Test expired recovery token
    await page.goto('/reset-password?token=expired_token');
    await expect(page.locator('[data-testid="token-expired-error"]')).toBeVisible();
    await expect(page.locator('[data-testid="token-expired-error"]')).toContainText('Reset link has expired');
  });

  test('should handle concurrent session conflicts', async ({ page, context }) => {
    // Login in first tab
    await page.fill('[data-testid="email-input"]', 'user@example.com');
    await page.fill('[data-testid="password-input"]', 'userpassword');
    await page.click('[data-testid="login-button"]');
    await expect(page.locator('[data-testid="user-dashboard"]')).toBeVisible();
    
    // Open new tab and login same account
    const newPage = await context.newPage();
    await newPage.goto('/login');
    await newPage.fill('[data-testid="email-input"]', 'user@example.com');
    await newPage.fill('[data-testid="password-input"]', 'userpassword');
    await newPage.click('[data-testid="login-button"]');
    await expect(newPage.locator('[data-testid="user-dashboard"]')).toBeVisible();
    
    // Check first tab for session conflict
    await page.bringToFront();
    await page.waitForTimeout(2000);
    
    // Verify session conflict handling
    await expect(page.locator('[data-testid="session-conflict"]')).toBeVisible();
    await expect(page.locator('[data-testid="conflict-message"]')).toContainText('Account logged in from another device');
    
    // Test session conflict resolution
    await page.click('[data-testid="continue-session"]');
    await expect(page.locator('[data-testid="user-dashboard"]')).toBeVisible();
    
    // Verify other session is invalidated
    await newPage.bringToFront();
    await newPage.reload();
    await expect(newPage.locator('[data-testid="login-page"]')).toBeVisible();
  });

  test('should provide secure error logging', async ({ page }) => {
    // Trigger various auth errors
    await page.fill('[data-testid="email-input"]', 'test@example.com');
    await page.fill('[data-testid="password-input"]', 'wrong');
    await page.click('[data-testid="login-button"]');
    
    // Check security logging (mock)
    const securityLogs = await page.evaluate(() => {
      return window.securityLogs || [];
    });
    
    expect(securityLogs.some(log => 
      log.event === 'login_failed' &&
      log.email === 'test@example.com' &&
      log.ipAddress &&
      log.userAgent &&
      log.timestamp
    )).toBe(true);
    
    // Verify no sensitive data in logs
    expect(securityLogs.some(log => log.password)).toBe(false);
    expect(securityLogs.some(log => log.token)).toBe(false);
  });
});
```

### API Authentication Tests
```typescript
import { test, expect } from '@playwright/test';

test.describe('API Authentication Error Handling', () => {
  test('should handle missing authentication token', async ({ request }) => {
    const response = await request.get('/api/protected-resource', {
      headers: {} // No auth header
    });
    
    expect(response.status()).toBe(401);
    const data = await response.json();
    expect(data.error).toContain('Authentication required');
  });

  test('should handle invalid authentication token', async ({ request }) => {
    const response = await request.get('/api/protected-resource', {
      headers: {
        'Authorization': 'Bearer invalid_token'
      }
    });
    
    expect(response.status()).toBe(401);
    const data = await response.json();
    expect(data.error).toContain('Invalid token');
  });

  test('should handle expired authentication token', async ({ request }) => {
    const response = await request.get('/api/protected-resource', {
      headers: {
        'Authorization': 'Bearer expired_token'
      }
    });
    
    expect(response.status()).toBe(401);
    const data = await response.json();
    expect(data.error).toContain('Token expired');
  });

  test('should handle insufficient permissions', async ({ request }) => {
    const response = await request.get('/api/admin/users', {
      headers: {
        'Authorization': 'Bearer user_token' // User token, not admin
      }
    });
    
    expect(response.status()).toBe(403);
    const data = await response.json();
    expect(data.error).toContain('Permission denied');
  });
});
```

## Cross-Browser Testing Matrix

| Browser | Version | OS | Priority | Notes |
|---------|---------|----|----------|-------|
| Chrome | Latest | Windows/Mac/Linux | High | Primary testing browser |
| Firefox | Latest | Windows/Mac/Linux | High | Auth API compatibility |
| Safari | Latest | Mac | Medium | WebKit auth handling |
| Edge | Latest | Windows | Medium | Chromium auth features |
| Mobile Chrome | Latest | Android | High | Mobile auth flows |
| Mobile Safari | Latest | iOS | High | iOS auth handling |

## Cross-Device Testing

| Device | Screen Size | Test Focus | Priority |
|--------|-------------|------------|----------|
| Desktop | 1920x1080 | Full auth error handling | High |
| Laptop | 1366x768 | Compact auth forms | Medium |
| Tablet | 768x1024 | Touch-based auth | High |
| Mobile | 375x667 | Mobile auth flows | High |

## Performance Testing

### Load Testing
- Concurrent login attempts: 100
- Auth error response time: < 500ms
- Token refresh time: < 1 second
- Session timeout detection: < 2 seconds

### Stress Testing
- High auth failure rate: 50%
- Rate limiting effectiveness
- Account lockout performance
- Session management under load

## Security Testing

### Authentication Security
- Brute force attack prevention
- Account enumeration prevention
- Token security validation
- Session hijacking prevention

### Error Information Security
- Sensitive data leakage prevention
- Error message sanitization
- Stack trace protection
- Debug information restriction

## Accessibility Testing

### WCAG 2.1 AA Compliance
- Screen reader error announcements
- Keyboard navigation for auth forms
- Color contrast for error states
- Focus management during errors

### ARIA Implementation
- `aria-invalid` for form errors
- `aria-describedby` for error messages
- `role="alert"` for dynamic errors
- Focus trapping in auth modals

## Test Metrics

### Coverage Metrics
- **Code Coverage**: > 95%
- **Auth Error Coverage**: 100%
- **Security Coverage**: > 90%
- **Accessibility Coverage**: > 85%

### Performance Metrics
- **Auth Error Response**: < 500ms
- **Token Refresh**: < 1 second
- **Session Detection**: < 2 seconds
- **Error Display**: < 100ms

## Test Deliverables

1. **Test Plan Document** - This file
2. **Test Cases** - Detailed auth error test procedures
3. **Test Scripts** - Automated test implementations
4. **Security Reports** - Auth security validation
5. **Accessibility Reports** - Auth error accessibility compliance
6. **Performance Reports** - Auth error handling performance

## Test Schedule

| Phase | Duration | Start Date | End Date |
|-------|----------|------------|----------|
| Planning | 2 days | Week 1 | Week 1 |
| Test Case Development | 4 days | Week 1 | Week 2 |
| Auth Setup | 1 day | Week 2 | Week 2 |
| Test Execution | 5 days | Week 2 | Week 3 |
| Bug Fixing | 3 days | Week 3 | Week 3 |
| Regression Testing | 2 days | Week 3 | Week 4 |
| Reporting | 1 day | Week 4 | Week 4 |

## Entry Criteria

- Authentication system implemented
- Error handling configured
- Security measures in place
- Test accounts prepared
- Monitoring tools available

## Exit Criteria

- All auth error test cases executed
- 98% pass rate achieved
- Critical auth security bugs resolved
- Performance benchmarks met
- Security requirements validated
- Documentation completed

## Risks and Mitigations

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Security vulnerabilities | High | Critical | Comprehensive security testing |
| User experience issues | Medium | Medium | User testing and feedback |
| Performance degradation | Medium | Medium | Performance monitoring |
| Authentication bypass | Low | Critical | Security audit and testing |
| Error information leakage | Medium | High | Security review of error messages |

## Test Environment Cleanup

### Data Cleanup
- Clear test user accounts
- Reset authentication tokens
- Clear session data
- Reset rate limiting counters

### Environment Reset
- Clear auth service cache
- Reset security logs
- Clear browser storage
- Verify clean auth state

## Sign-off

**Test Engineer**: _________________________  
**Date**: _________________________  
**Project Manager**: _________________________  
**Date**: _________________________  

---

*This test case is part of the Al Ummah Now comprehensive testing suite. For related test cases, refer to the Error Handling section of the Master Test Index.*