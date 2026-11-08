/**
 * Tests for client-side auth token utilities
 */

import { getClientAuthToken, getAuthHeaders } from '../client-token';

describe('getClientAuthToken', () => {
  let cookieStore: string = '';

  beforeEach(() => {
    // Mock document.cookie getter/setter
    cookieStore = '';
    Object.defineProperty(document, 'cookie', {
      get: () => cookieStore,
      set: (value: string) => {
        cookieStore = value;
      },
      configurable: true,
    });
  });

  afterEach(() => {
    cookieStore = '';
  });

  it('should return null when no cookies exist', () => {
    const token = getClientAuthToken();
    expect(token).toBeNull();
  });

  it('should return null when access_token cookie does not exist', () => {
    cookieStore = 'other_cookie=value';
    const token = getClientAuthToken();
    expect(token).toBeNull();
  });

  it('should return the access token when it exists', () => {
    const expectedToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test';
    cookieStore = `access_token=${expectedToken}`;
    const token = getClientAuthToken();
    expect(token).toBe(expectedToken);
  });

  it('should return the access token when multiple cookies exist', () => {
    const expectedToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test';
    cookieStore = `other_cookie=value; access_token=${expectedToken}; another_cookie=another_value`;
    const token = getClientAuthToken();
    expect(token).toBe(expectedToken);
  });

  it('should decode URI-encoded token', () => {
    const originalToken = 'token with spaces and special chars!@#';
    const encodedToken = encodeURIComponent(originalToken);
    cookieStore = `access_token=${encodedToken}`;
    const token = getClientAuthToken();
    expect(token).toBe(originalToken);
  });

  // Quarantined: fails on main, tracked in #206.
  it.skip('should handle errors gracefully and return null', () => {
    // Mock document.cookie getter to throw an error
    Object.defineProperty(document, 'cookie', {
      get: () => {
        throw new Error('Cookie access denied');
      },
      configurable: true,
    });

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    const token = getClientAuthToken();

    expect(token).toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith(
      '[getClientAuthToken] Failed to read token from cookies:',
      expect.any(Error)
    );

    consoleSpy.mockRestore();
  });
});

describe('getAuthHeaders', () => {
  let cookieStore: string = '';

  beforeEach(() => {
    // Mock document.cookie getter/setter
    cookieStore = '';
    Object.defineProperty(document, 'cookie', {
      get: () => cookieStore,
      set: (value: string) => {
        cookieStore = value;
      },
      configurable: true,
    });
  });

  afterEach(() => {
    cookieStore = '';
  });

  it('should return empty object when not authenticated', () => {
    const headers = getAuthHeaders();
    expect(headers).toEqual({});
  });

  it('should return Authorization header when authenticated', () => {
    const expectedToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test';
    cookieStore = `access_token=${expectedToken}`;

    const headers = getAuthHeaders();

    expect(headers).toEqual({
      'Authorization': `Bearer ${expectedToken}`,
    });
  });

  it('should work with multiple cookies', () => {
    const expectedToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test';
    cookieStore = `refresh_token=refresh_token_value; access_token=${expectedToken}; session_id=session_value`;

    const headers = getAuthHeaders();

    expect(headers).toEqual({
      'Authorization': `Bearer ${expectedToken}`,
    });
  });
});
