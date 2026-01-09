# TCAUTH010: API Authentication

## Test Overview
**Test Case ID:** TCAUTH010  
**Category:** Authentication  
**Subcategory:** API Security  
**Test Type:** Functional + Security  
**Priority:** High  
**Estimated Duration:** 10 minutes  

## Description
Verify comprehensive API authentication mechanisms including JWT token validation, API key management, OAuth 2.0 flows, rate limiting, CORS configuration, and secure endpoint protection across different API versions and client types.

## Preconditions
- API authentication system is configured
- JWT tokens are properly signed
- API key management is available
- OAuth 2.0 endpoints are configured
- Rate limiting is enabled
- CORS policies are set

## Test Data
```typescript
const apiAuthTestData = {
  jwt: {
    validToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLWFwaS0wMDEiLCJpYXQiOjE2MDAwMDAwMDAsImV4cCI6MTYwMDA4NjQwMH0.valid_signature',
    expiredToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLWFwaS0wMDEiLCJpYXQiOjE2MDAwMDAwMDAsImV4cCI6MTYwMDAwMDAwMH0.expired_signature',
    invalidSignature: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLWFwaS0wMDEiLCJpYXQiOjE2MDAwMDAwMDAsImV4cCI6MTYwMDA4NjQwMH0.invalid_signature'
  },
  apiKeys: {
    validKey: 'ak_live_1234567890abcdef',
    readOnlyKey: 'ak_read_0987654321fedcba',
    expiredKey: 'ak_expired_1111111111111111',
    revokedKey: 'ak_revoked_2222222222222222'
  },
  oauth: {
    clientId: 'api_client_123',
    clientSecret: 'client_secret_456',
    accessToken: 'oauth_access_token_789',
    refreshToken: 'oauth_refresh_token_012',
    scope: 'read write'
  },
  endpoints: {
    public: ['/api/public/videos', '/api/public/channels'],
    authenticated: ['/api/user/profile', '/api/user/videos'],
    admin: ['/api/admin/users', '/api/admin/analytics'],
    rateLimited: ['/api/search', '/api/upload']
  }
};
```

## Test Steps

### Step 1: JWT Token Authentication
1. Login via web interface to get JWT token
2. Extract token from localStorage
3. Make authenticated API request with valid token
4. Verify 200 response and proper data
5. Test request with expired token
6. Verify 401 Unauthorized response
7. Test request with invalid signature
8. Verify 401 Unauthorized response
9. Test request without token
10. Verify 401 Unauthorized response

### Step 2: API Key Authentication
1. Generate API key via admin interface
2. Test API request with valid API key
3. Verify 200 response and proper data
4. Test read-only API key with write endpoint
5. Verify 403 Forbidden response
6. Test expired API key
7. Verify 401 Unauthorized response
8. Test revoked API key
9. Verify 401 Unauthorized response
10. Test API key rotation

### Step 3: OAuth 2.0 Client Credentials Flow
1. Register OAuth client application
2. Request access token with client credentials
3. Verify token response and structure
4. Use access token for API requests
5. Verify proper authentication
6. Test token refresh mechanism
7. Test scope validation
8. Test invalid client credentials
9. Verify error handling
10. Test token revocation

### Step 4: Bearer Token Validation
1. Test Authorization header format
2. Test "Bearer" prefix requirement
3. Test token extraction from header
4. Test malformed Authorization header
5. Test multiple authentication methods
6. Test token precedence (JWT vs API Key)
7. Test token caching behavior
8. Test token invalidation on logout

### Step 5: Rate Limiting with Authentication
1. Test rate limits for authenticated users
2. Test rate limits for API keys
3. Test rate limits for OAuth tokens
4. Test rate limit headers (X-RateLimit-Limit, etc.)
5. Test rate limit exceeded responses
6. Test rate limit reset behavior
7. Test different rate limits per user tier
8. Test rate limit bypass prevention

### Step 6: CORS Configuration
1. Test preflight OPTIONS requests
2. Test allowed origins configuration
3. Test allowed headers and methods
4. Test credentials support
5. Test cross-origin authenticated requests
6. Test CORS error responses
7. Test wildcard origin restrictions
8. Test custom CORS headers

### Step 7: Endpoint Protection Levels
1. Test public endpoints (no auth required)
2. Test authenticated endpoints (valid token required)
3. Test admin endpoints (admin role required)
4. Test role-based endpoint access
5. Test permission inheritance
6. Test endpoint-specific rate limits
7. Test endpoint-specific CORS rules
8. Test deprecated endpoint handling

### Step 8: Token Refresh Mechanism
1. Test automatic token refresh
2. Test refresh token expiration
3. Test refresh token rotation
4. Test refresh token revocation
5. Test concurrent refresh requests
6. Test refresh token storage
7. Test refresh token security
8. Test refresh token scope changes

### Step 9: API Security Headers
1. Test security headers presence
2. Test Content Security Policy
3. Test X-Frame-Options
4. Test X-Content-Type-Options
5. Test Strict-Transport-Security
6. Test X-XSS-Protection
7. Test Referrer-Policy
8. Test Permissions-Policy

### Step 10: Multi-Version API Authentication
1. Test v1 API authentication
2. Test v2 API authentication
3. Test version-specific token validation
4. Test backward compatibility
5. Test version deprecation warnings
6. Test version-specific rate limits
7. Test version-specific CORS rules
8. Test version migration scenarios

## Expected Results
- JWT tokens are validated correctly
- API keys work with proper permissions
- OAuth 2.0 flows function properly
- Rate limiting is enforced appropriately
- CORS configuration is secure
- Endpoint protection works correctly
- Token refresh mechanisms function
- Security headers are properly set
- Multi-version APIs are supported

## Error Scenarios
- Token validation failures
- API key generation failures
- OAuth service unavailability
- Rate limiting service failures
- CORS configuration errors

## Cross-Browser Testing
- Chrome, Firefox, Safari, Edge
- Mobile browsers for API testing
- Different HTTP client libraries

## Playwright Test Implementation

```typescript
import { test, expect, request } from '@playwright/test';
import { APIAuthUtils } from '../utils/APIAuthUtils';
import { TokenManager } from '../utils/TokenManager';

test.describe('API Authentication', () => {
  let apiContext: any;
  let authUtils: APIAuthUtils;
  let tokenManager: TokenManager;

  test.beforeAll(async ({ playwright }) => {
    apiContext = await playwright.request.newContext();
    authUtils = new APIAuthUtils(apiContext);
    tokenManager = new TokenManager();
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test('TCAUTH010_001: JWT token authentication', async ({ page }) => {
    // Step 1: Get JWT token via web login
    await page.goto('/en/login');
    await page.fill('input[type="email"]', 'apiuser@alummahnow.net');
    await page.fill('input[type="password"]', 'APIPass123!');
    await page.click('button[type="submit"]');
    await page.waitForURL('/en/dashboard');
    
    // Extract JWT token
    const jwtToken = await page.evaluate(() => localStorage.getItem('auth_token'));
    expect(jwtToken).toBeTruthy();
    
    // Test authenticated request with valid token
    const validResponse = await apiContext.get('/api/user/profile', {
      headers: { 'Authorization': `Bearer ${jwtToken}` }
    });
    
    expect(validResponse.status()).toBe(200);
    const profileData = await validResponse.json();
    expect(profileData).toHaveProperty('email');
    expect(profileData.email).toBe('apiuser@alummahnow.net');
    
    // Test with expired token
    const expiredToken = await tokenManager.generateExpiredToken('apiuser@alummahnow.net');
    const expiredResponse = await apiContext.get('/api/user/profile', {
      headers: { 'Authorization': `Bearer ${expiredToken}` }
    });
    
    expect(expiredResponse.status()).toBe(401);
    const expiredError = await expiredResponse.json();
    expect(expiredError.error).toContain('token expired');
    
    // Test with invalid signature
    const invalidToken = await tokenManager.generateInvalidToken('apiuser@alummahnow.net');
    const invalidResponse = await apiContext.get('/api/user/profile', {
      headers: { 'Authorization': `Bearer ${invalidToken}` }
    });
    
    expect(invalidResponse.status()).toBe(401);
    const invalidError = await invalidResponse.json();
    expect(invalidError.error).toContain('invalid signature');
    
    // Test without token
    const noTokenResponse = await apiContext.get('/api/user/profile');
    expect(noTokenResponse.status()).toBe(401);
  });

  test('TCAUTH010_002: API key authentication', async ({ page }) => {
    // Generate API key via admin interface
    await page.goto('/en/login');
    await page.fill('input[type="email"]', 'admin@alummahnow.net');
    await page.fill('input[type="password"]', 'AdminPass123!');
    await page.click('button[type="submit"]');
    
    await page.goto('/en/admin/api-keys');
    await page.click('button:has-text("Generate API Key")');
    await page.selectOption('select[name="permissions"]', 'read_write');
    await page.fill('input[name="description"]', 'Test API Key');
    await page.click('button:has-text("Generate")');
    
    // Extract API key
    const apiKey = await page.locator('[data-testid="api-key"]').textContent();
    expect(apiKey).toBeTruthy();
    expect(apiKey).toMatch(/^ak_live_/);
    
    // Test API request with valid key
    const validKeyResponse = await apiContext.get('/api/user/profile', {
      headers: { 'X-API-Key': apiKey }
    });
    
    expect(validKeyResponse.status()).toBe(200);
    
    // Test read-only key with write endpoint
    const readOnlyKey = await tokenManager.generateReadOnlyAPIKey();
    const readOnlyResponse = await apiContext.post('/api/videos', {
      headers: { 'X-API-Key': readOnlyKey },
      data: { title: 'Test Video' }
    });
    
    expect(readOnlyResponse.status()).toBe(403);
    const readOnlyError = await readOnlyResponse.json();
    expect(readOnlyError.error).toContain('insufficient permissions');
    
    // Test expired API key
    const expiredKey = await tokenManager.generateExpiredAPIKey();
    const expiredKeyResponse = await apiContext.get('/api/user/profile', {
      headers: { 'X-API-Key': expiredKey }
    });
    
    expect(expiredKeyResponse.status()).toBe(401);
    
    // Test revoked API key
    const revokedKey = await tokenManager.generateRevokedAPIKey();
    const revokedKeyResponse = await apiContext.get('/api/user/profile', {
      headers: { 'X-API-Key': revokedKey }
    });
    
    expect(revokedKeyResponse.status()).toBe(401);
  });

  test('TCAUTH010_003: OAuth 2.0 client credentials flow', async () => {
    // Register OAuth client
    const clientRegistration = await apiContext.post('/api/oauth/clients', {
      data: {
        name: 'Test Client',
        redirect_uris: ['https://example.com/callback'],
        scopes: ['read', 'write']
      }
    });
    
    expect(clientRegistration.status()).toBe(201);
    const clientData = await clientRegistration.json();
    const clientId = clientData.client_id;
    const clientSecret = clientData.client_secret;
    
    // Request access token
    const tokenResponse = await apiContext.post('/api/oauth/token', {
      data: {
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'read write'
      }
    });
    
    expect(tokenResponse.status()).toBe(200);
    const tokenData = await tokenResponse.json();
    expect(tokenData).toHaveProperty('access_token');
    expect(tokenData).toHaveProperty('token_type');
    expect(tokenData).toHaveProperty('expires_in');
    expect(tokenData).toHaveProperty('scope');
    
    const accessToken = tokenData.access_token;
    
    // Use access token for API requests
    const apiResponse = await apiContext.get('/api/user/profile', {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    
    expect(apiResponse.status()).toBe(200);
    
    // Test token refresh
    const refreshResponse = await apiContext.post('/api/oauth/token', {
      data: {
        grant_type: 'refresh_token',
        refresh_token: tokenData.refresh_token,
        client_id: clientId,
        client_secret: clientSecret
      }
    });
    
    expect(refreshResponse.status()).toBe(200);
    const refreshData = await refreshResponse.json();
    expect(refreshData).toHaveProperty('access_token');
    
    // Test invalid client credentials
    const invalidAuthResponse = await apiContext.post('/api/oauth/token', {
      data: {
        grant_type: 'client_credentials',
        client_id: 'invalid_client',
        client_secret: 'invalid_secret'
      }
    });
    
    expect(invalidAuthResponse.status()).toBe(401);
  });

  test('TCAUTH010_004: Bearer token validation', async ({ page }) => {
    // Get valid JWT token
    await page.goto('/en/login');
    await page.fill('input[type="email"]', 'apiuser@alummahnow.net');
    await page.fill('input[type="password"]', 'APIPass123!');
    await page.click('button[type="submit"]');
    
    const jwtToken = await page.evaluate(() => localStorage.getItem('auth_token'));
    
    // Test correct Authorization header format
    const correctResponse = await apiContext.get('/api/user/profile', {
      headers: { 'Authorization': `Bearer ${jwtToken}` }
    });
    expect(correctResponse.status()).toBe(200);
    
    // Test missing Bearer prefix
    const noBearerResponse = await apiContext.get('/api/user/profile', {
      headers: { 'Authorization': jwtToken }
    });
    expect(noBearerResponse.status()).toBe(401);
    
    // Test malformed Authorization header
    const malformedResponse = await apiContext.get('/api/user/profile', {
      headers: { 'Authorization': 'Bearer' }
    });
    expect(malformedResponse.status()).toBe(401);
    
    // Test multiple authentication methods (JWT should take precedence)
    const apiKey = await tokenManager.generateValidAPIKey();
    const multiAuthResponse = await apiContext.get('/api/user/profile', {
      headers: { 
        'Authorization': `Bearer ${jwtToken}`,
        'X-API-Key': apiKey
      }
    });
    expect(multiAuthResponse.status()).toBe(200);
  });

  test('TCAUTH010_005: Rate limiting with authentication', async ({ page }) => {
    // Get authenticated token
    await page.goto('/en/login');
    await page.fill('input[type="email"]', 'apiuser@alummahnow.net');
    await page.fill('input[type="password"]', 'APIPass123!');
    await page.click('button[type="submit"]');
    
    const jwtToken = await page.evaluate(() => localStorage.getItem('auth_token'));
    
    // Test rate limits for authenticated users
    const responses = [];
    for (let i = 0; i < 10; i++) {
      const response = await apiContext.get('/api/search?q=test', {
        headers: { 'Authorization': `Bearer ${jwtToken}` }
      });
      responses.push(response);
      
      // Check rate limit headers
      const rateLimit = response.headers()['x-ratelimit-limit'];
      const rateRemaining = response.headers()['x-ratelimit-remaining'];
      const rateReset = response.headers()['x-ratelimit-reset'];
      
      expect(rateLimit).toBeTruthy();
      expect(rateRemaining).toBeTruthy();
      expect(rateReset).toBeTruthy();
    }
    
    // Test rate limit exceeded
    const exceededResponse = await apiContext.get('/api/search?q=test', {
      headers: { 'Authorization': `Bearer ${jwtToken}` }
    });
    
    expect(exceededResponse.status()).toBe(429);
    const exceededError = await exceededResponse.json();
    expect(exceededError.error).toContain('rate limit exceeded');
    
    // Test different rate limits for API keys
    const apiKey = await tokenManager.generateValidAPIKey();
    const apikeyResponse = await apiContext.get('/api/search?q=test', {
      headers: { 'X-API-Key': apiKey }
    });
    
    const apiKeyRateLimit = apikeyResponse.headers()['x-ratelimit-limit'];
    expect(apiKeyRateLimit).toBeTruthy();
  });

  test('TCAUTH010_006: CORS configuration', async () => {
    // Test preflight OPTIONS request
    const preflightResponse = await apiContext.fetch('/api/user/profile', {
      method: 'OPTIONS',
      headers: {
        'Origin': 'https://example.com',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'Authorization'
      }
    });
    
    expect(preflightResponse.status()).toBe(204);
    
    // Check CORS headers
    const corsHeaders = preflightResponse.headers();
    expect(corsHeaders['access-control-allow-origin']).toBeTruthy();
    expect(corsHeaders['access-control-allow-methods']).toContain('GET');
    expect(corsHeaders['access-control-allow-headers']).toContain('Authorization');
    
    // Test cross-origin authenticated request
    const crossOriginResponse = await apiContext.get('/api/user/profile', {
      headers: {
        'Origin': 'https://example.com',
        'Authorization': 'Bearer valid_token'
      }
    });
    
    expect(crossOriginResponse.status()).toBe(200);
    expect(crossOriginResponse.headers()['access-control-allow-origin']).toBeTruthy();
    
    // Test disallowed origin
    const disallowedResponse = await apiContext.fetch('/api/user/profile', {
      method: 'OPTIONS',
      headers: {
        'Origin': 'https://malicious.com',
        'Access-Control-Request-Method': 'GET'
      }
    });
    
    expect(disallowedResponse.status()).toBe(400);
  });

  test('TCAUTH010_007: Endpoint protection levels', async ({ page }) => {
    // Get admin token
    await page.goto('/en/login');
    await page.fill('input[type="email"]', 'admin@alummahnow.net');
    await page.fill('input[type="password"]', 'AdminPass123!');
    await page.click('button[type="submit"]');
    
    const adminToken = await page.evaluate(() => localStorage.getItem('auth_token'));
    
    // Test public endpoints (no auth required)
    const publicResponse = await apiContext.get('/api/public/videos');
    expect(publicResponse.status()).toBe(200);
    
    // Test authenticated endpoints
    const authResponse = await apiContext.get('/api/user/profile', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    expect(authResponse.status()).toBe(200);
    
    // Test admin endpoints
    const adminResponse = await apiContext.get('/api/admin/users', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    expect(adminResponse.status()).toBe(200);
    
    // Test admin endpoint with regular user token
    await page.goto('/en/logout');
    await page.goto('/en/login');
    await page.fill('input[type="email"]', 'user@alummahnow.net');
    await page.fill('input[type="password"]', 'UserPass123!');
    await page.click('button[type="submit"]');
    
    const userToken = await page.evaluate(() => localStorage.getItem('auth_token'));
    
    const userAdminResponse = await apiContext.get('/api/admin/users', {
      headers: { 'Authorization': `Bearer ${userToken}` }
    });
    expect(userAdminResponse.status()).toBe(403);
  });

  test('TCAUTH010_008: Token refresh mechanism', async ({ page }) => {
    // Login with refresh token enabled
    await page.goto('/en/login');
    await page.fill('input[type="email"]', 'apiuser@alummahnow.net');
    await page.fill('input[type="password"]', 'APIPass123!');
    await page.click('button[type="submit"]');
    
    const accessToken = await page.evaluate(() => localStorage.getItem('auth_token'));
    const refreshToken = await page.evaluate(() => localStorage.getItem('refresh_token'));
    
    // Wait for token to near expiration (mock)
    await page.waitForTimeout(1000);
    
    // Make API call that should trigger refresh
    const refreshResponse = await apiContext.get('/api/user/profile', {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    
    expect(refreshResponse.status()).toBe(200);
    
    // Test refresh token expiration
    const expiredRefreshToken = await tokenManager.generateExpiredRefreshToken();
    const expiredRefreshResponse = await apiContext.post('/api/auth/refresh', {
      data: { refresh_token: expiredRefreshToken }
    });
    
    expect(expiredRefreshResponse.status()).toBe(401);
  });

  test('TCAUTH010_009: API security headers', async () => {
    // Test security headers on API responses
    const response = await apiContext.get('/api/public/videos');
    
    const headers = response.headers();
    
    // Check security headers
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['x-xss-protection']).toBe('1; mode=block');
    expect(headers['referrer-policy']).toBeTruthy();
    expect(headers['strict-transport-security']).toBeTruthy();
  });

  test('TCAUTH010_010: Multi-version API authentication', async ({ page }) => {
    // Get authentication token
    await page.goto('/en/login');
    await page.fill('input[type="email"]', 'apiuser@alummahnow.net');
    await page.fill('input[type="password"]', 'APIPass123!');
    await page.click('button[type="submit"]');
    
    const token = await page.evaluate(() => localStorage.getItem('auth_token'));
    
    // Test v1 API authentication
    const v1Response = await apiContext.get('/api/v1/user/profile', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    expect(v1Response.status()).toBe(200);
    
    // Test v2 API authentication
    const v2Response = await apiContext.get('/api/v2/user/profile', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    expect(v2Response.status()).toBe(200);
    
    // Test version deprecation warning
    const deprecatedResponse = await apiContext.get('/api/v1/old-endpoint', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (deprecatedResponse.status() === 200) {
      const deprecationWarning = deprecatedResponse.headers()['x-deprecation-warning'];
      expect(deprecationWarning).toBeTruthy();
    }
  });
});

// Utility Classes
export class APIAuthUtils {
  constructor(private apiContext: any) {}

  async authenticateWithJWT(token: string): Promise<any> {
    return await this.apiContext.get('/api/user/profile', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
  }

  async authenticateWithAPIKey(apiKey: string): Promise<any> {
    return await this.apiContext.get('/api/user/profile', {
      headers: { 'X-API-Key': apiKey }
    });
  }

  async getRateLimitInfo(endpoint: string, token: string): Promise<any> {
    const response = await this.apiContext.get(endpoint, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    return {
      limit: response.headers()['x-ratelimit-limit'],
      remaining: response.headers()['x-ratelimit-remaining'],
      reset: response.headers()['x-ratelimit-reset']
    };
  }
}

export class TokenManager {
  async generateExpiredToken(userId: string): Promise<string> {
    // Mock expired token generation
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = btoa(JSON.stringify({
      sub: userId,
      iat: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
      exp: Math.floor(Date.now() / 1000) - 1800  // 30 minutes ago
    }));
    return `${header}.${payload}.expired_signature`;
  }

  async generateInvalidToken(userId: string): Promise<string> {
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = btoa(JSON.stringify({
      sub: userId,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600
    }));
    return `${header}.${payload}.invalid_signature`;
  }

  async generateValidAPIKey(): Promise<string> {
    return 'ak_live_' + Math.random().toString(36).substr(2, 16);
  }

  async generateReadOnlyAPIKey(): Promise<string> {
    return 'ak_read_' + Math.random().toString(36).substr(2, 16);
  }

  async generateExpiredAPIKey(): Promise<string> {
    return 'ak_expired_' + Math.random().toString(36).substr(2, 16);
  }

  async generateRevokedAPIKey(): Promise<string> {
    return 'ak_revoked_' + Math.random().toString(36).substr(2, 16);
  }

  async generateExpiredRefreshToken(): Promise<string> {
    return 'refresh_expired_' + Math.random().toString(36).substr(2, 16);
  }
}
```

## Test Data Management
- JWT token generation utilities
- API key generation and management
- OAuth client registration
- Token expiration simulation

## Cleanup Requirements
- Revoke test API keys
- Delete OAuth clients
- Clear authentication tokens
- Reset rate limit counters

## Success Criteria
- JWT tokens are validated correctly
- API keys work with proper permissions
- OAuth 2.0 flows function properly
- Rate limiting is enforced appropriately
- CORS configuration is secure
- Endpoint protection works correctly
- Token refresh mechanisms function
- Security headers are properly set
- Multi-version APIs are supported