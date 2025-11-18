import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { TestClient, TestResponse } from '../helpers/test-client';
import { AuthFactory } from '../helpers/data-factory';

describe('Authentication Endpoints', () => {
  let client: TestClient;
  let testUser: any;

  beforeEach(async () => {
    client = new TestClient(process.env.API_BASE_URL || 'http://127.0.0.1:3086');
    testUser = AuthFactory.createUser();
  });

  afterEach(async () => {
    // Cleanup test user if created
    if (testUser.id) {
      await client.request(`/auth/users/${testUser.id}`, {
        method: 'DELETE'
      });
    }
  });

  describe('POST /auth/login', () => {
    it('should authenticate with valid credentials', async () => {
      // First register a user
      await client.request('/auth/register', {
        method: 'POST',
        body: JSON.stringify(testUser)
      });

      // Then login
      const response = await client.request('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: testUser.email,
          password: testUser.password
        })
      });

      expect(response.status).toBe(200);
      
      const data = await response.json();
      expect(data).toHaveProperty('token');
      expect(data).toHaveProperty('user');
      expect(data.user.email).toBe(testUser.email);
      expect(data.token).toMatch(/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/);
    });

    it('should reject invalid credentials', async () => {
      const response = await client.request('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: 'invalid@example.com',
          password: 'wrong-password'
        })
      });

      expect(response.status).toBe(401);
      
      const data = await response.json();
      expect(data).toHaveProperty('error');
      expect(data.error).toContain('Invalid credentials');
    });

    it('should validate required fields', async () => {
      const response = await client.request('/auth/login', {
        method: 'POST',
        body: JSON.stringify({})
      });

      expect(response.status).toBe(400);
      
      const data = await response.json();
      expect(data).toHaveProperty('error');
      expect(data.error).toContain('required');
    });

    it('should handle malformed email', async () => {
      const response = await client.request('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: 'invalid-email',
          password: 'password123'
        })
      });

      expect(response.status).toBe(400);
      
      const data = await response.json();
      expect(data).toHaveProperty('error');
    });
  });

  describe('POST /auth/register', () => {
    it('should register new user with valid data', async () => {
      const newUser = AuthFactory.createUser();
      
      const response = await client.request('/auth/register', {
        method: 'POST',
        body: JSON.stringify(newUser)
      });

      expect(response.status).toBe(201);
      
      const data = await response.json();
      expect(data).toHaveProperty('user');
      expect(data).toHaveProperty('token');
      expect(data.user.email).toBe(newUser.email);
      expect(data.user).not.toHaveProperty('password');
      
      testUser = data.user; // Store for cleanup
    });

    it('should reject duplicate email', async () => {
      // Register first user
      await client.request('/auth/register', {
        method: 'POST',
        body: JSON.stringify(testUser)
      });

      // Try to register with same email
      const response = await client.request('/auth/register', {
        method: 'POST',
        body: JSON.stringify(testUser)
      });

      expect(response.status).toBe(409);
      
      const data = await response.json();
      expect(data).toHaveProperty('error');
      expect(data.error).toContain('already exists');
    });

    it('should validate password strength', async () => {
      const weakUser = AuthFactory.createUser({ password: '123' });
      
      const response = await client.request('/auth/register', {
        method: 'POST',
        body: JSON.stringify(weakUser)
      });

      expect(response.status).toBe(400);
      
      const data = await response.json();
      expect(data).toHaveProperty('error');
      expect(data.error).toContain('password');
    });

    it('should validate email format', async () => {
      const invalidUser = AuthFactory.createUser({ 
        email: 'invalid-email-format' 
      });
      
      const response = await client.request('/auth/register', {
        method: 'POST',
        body: JSON.stringify(invalidUser)
      });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /auth/refresh', () => {
    let refreshToken: string;

    beforeEach(async () => {
      // Register and login to get tokens
      await client.request('/auth/register', {
        method: 'POST',
        body: JSON.stringify(testUser)
      });

      const loginResponse = await client.request('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: testUser.email,
          password: testUser.password
        })
      });

      const loginData = await loginResponse.json();
      refreshToken = loginData.refreshToken;
    });

    it('should refresh access token with valid refresh token', async () => {
      const response = await client.request('/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refreshToken })
      });

      expect(response.status).toBe(200);
      
      const data = await response.json();
      expect(data).toHaveProperty('token');
      expect(data).toHaveProperty('refreshToken');
      expect(data.token).not.toBe(refreshToken);
    });

    it('should reject invalid refresh token', async () => {
      const response = await client.request('/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ 
          refreshToken: 'invalid-refresh-token' 
        })
      });

      expect(response.status).toBe(401);
    });

    it('should require refresh token', async () => {
      const response = await client.request('/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({})
      });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /auth/logout', () => {
    beforeEach(async () => {
      // Register and authenticate
      await client.request('/auth/register', {
        method: 'POST',
        body: JSON.stringify(testUser)
      });

      await client.authenticate({
        email: testUser.email,
        password: testUser.password
      });
    });

    it('should logout authenticated user', async () => {
      const response = await client.request('/auth/logout', {
        method: 'POST'
      });

      expect(response.status).toBe(200);
      
      const data = await response.json();
      expect(data).toHaveProperty('message');
      expect(data.message).toContain('logged out');
    });

    it('should reject logout for unauthenticated user', async () => {
      // Create new client without authentication
      const unauthClient = new TestClient(client.baseUrl);
      
      const response = await unauthClient.request('/auth/logout', {
        method: 'POST'
      });

      expect(response.status).toBe(401);
    });
  });

  describe('GET /auth/me', () => {
    beforeEach(async () => {
      // Register and authenticate
      await client.request('/auth/register', {
        method: 'POST',
        body: JSON.stringify(testUser)
      });

      await client.authenticate({
        email: testUser.email,
        password: testUser.password
      });
    });

    it('should return current user profile', async () => {
      const response = await client.request('/auth/me');

      expect(response.status).toBe(200);
      
      const data = await response.json();
      expect(data).toHaveProperty('user');
      expect(data.user.email).toBe(testUser.email);
      expect(data.user).not.toHaveProperty('password');
    });

    it('should reject unauthenticated access', async () => {
      const unauthClient = new TestClient(client.baseUrl);
      
      const response = await unauthClient.request('/auth/me');

      expect(response.status).toBe(401);
    });

    it('should validate JWT token format', async () => {
      // Test with malformed token
      const badClient = new TestClient(client.baseUrl);
      (badClient as any).authToken = 'invalid-jwt-token';
      
      const response = await badClient.request('/auth/me');

      expect(response.status).toBe(401);
    });
  });

  describe('POST /auth/forgot-password', () => {
    it('should send reset email for existing user', async () => {
      // Register user first
      await client.request('/auth/register', {
        method: 'POST',
        body: JSON.stringify(testUser)
      });

      const response = await client.request('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: testUser.email })
      });

      expect(response.status).toBe(200);
      
      const data = await response.json();
      expect(data).toHaveProperty('message');
      expect(data.message).toContain('email sent');
    });

    it('should not reveal if email exists', async () => {
      const response = await client.request('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ 
          email: 'nonexistent@example.com' 
        })
      });

      expect(response.status).toBe(200);
      // Should return same message as existing email to prevent enumeration
    });

    it('should validate email format', async () => {
      const response = await client.request('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: 'invalid-email' })
      });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /auth/reset-password', () => {
    let resetToken: string;

    beforeEach(async () => {
      // Register user and request reset
      await client.request('/auth/register', {
        method: 'POST',
        body: JSON.stringify(testUser)
      });

      const forgotResponse = await client.request('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: testUser.email })
      });

      // In real implementation, this would come from email
      // For testing, we'll generate a test token
      resetToken = 'test-reset-token-' + Date.now();
    });

    it('should reset password with valid token', async () => {
      const newPassword = 'new-secure-password-123';
      
      const response = await client.request('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({
          token: resetToken,
          password: newPassword
        })
      });

      expect(response.status).toBe(200);
      
      const data = await response.json();
      expect(data).toHaveProperty('message');
      expect(data.message).toContain('password reset');

      // Verify new password works
      const loginResponse = await client.request('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: testUser.email,
          password: newPassword
        })
      });

      expect(loginResponse.status).toBe(200);
    });

    it('should reject invalid reset token', async () => {
      const response = await client.request('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({
          token: 'invalid-token',
          password: 'new-password'
        })
      });

      expect(response.status).toBe(400);
    });

    it('should validate new password strength', async () => {
      const response = await client.request('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({
          token: resetToken,
          password: '123'
        })
      });

      expect(response.status).toBe(400);
    });
  });

  describe('Rate Limiting', () => {
    it('should limit login attempts', async () => {
      const credentials = {
        email: 'ratelimit@test.com',
        password: 'wrong-password'
      };

      // Make multiple failed attempts
      const responses: TestResponse[] = [];
      for (let i = 0; i < 10; i++) {
        const response = await client.request('/auth/login', {
          method: 'POST',
          body: JSON.stringify(credentials)
        });
        responses.push(response);
      }
      
      // Should be rate limited after several attempts
      const rateLimitedResponse = responses[responses.length - 1];
      expect(rateLimitedResponse.status).toBe(429);
    });

    it('should limit registration attempts', async () => {
      const responses: TestResponse[] = [];
      for (let i = 0; i < 5; i++) {
        const newUser = AuthFactory.createUser({
          email: `ratelimit${i}@test.com`
        });
        
        const response = await client.request('/auth/register', {
          method: 'POST',
          body: JSON.stringify(newUser)
        });
        responses.push(response);
      }
      
      // Should allow some but eventually rate limit
      const hasRateLimit = responses.some(r => r.status === 429);
      expect(hasRateLimit).toBe(true);
    });
  });

  describe('Security Headers', () => {
    it('should include security headers', async () => {
      const response = await client.request('/auth/me');

      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('x-frame-options')).toBe('DENY');
      expect(response.headers.get('x-xss-protection')).toBe('1; mode=block');
    });
  });
});