/**
 * Client-side authentication token utilities
 *
 * Provides safe access to JWT tokens from cookies on the client side.
 * Used by analytics services and other client-side modules that need authentication.
 *
 * Note: This is CLIENT-SIDE ONLY. For server-side auth, use @/lib/actions.
 */

/**
 * Get the access token from cookies (client-side only)
 *
 * @returns The JWT access token or null if not authenticated
 */
export function getClientAuthToken(): string | null {
  if (typeof document === 'undefined') {
    return null;
  }

  try {
    const cookies = document.cookie.split(';');
    console.log('[getClientAuthToken] All cookies:', document.cookie);
    console.log('[getClientAuthToken] Parsed cookies:', cookies);

    for (const cookie of cookies) {
      const [name, value] = cookie.trim().split('=');
      console.log('[getClientAuthToken] Checking cookie:', { name, hasValue: !!value });
      if (name === 'access_token') {
        const token = decodeURIComponent(value);
        console.log('[getClientAuthToken] Found access_token, length:', token?.length);
        return token;
      }
    }
    console.warn('[getClientAuthToken] access_token cookie not found');
    return null;
  } catch (error) {
    console.error('[getClientAuthToken] Failed to read token from cookies:', error);
    return null;
  }
}

/**
 * Create Authorization header with Bearer token
 *
 * @returns Headers object with Authorization header, or empty object if not authenticated
 */
export function getAuthHeaders(): Record<string, string> {
  const token = getClientAuthToken();
  if (!token) {
    return {};
  }

  return {
    'Authorization': `Bearer ${token}`,
  };
}
