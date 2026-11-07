/**
 * Runtime Configuration
 *
 * Reads configuration injected by the server at runtime.
 * This allows environment-specific values without rebuilding.
 */

declare global {
  interface Window {
    __RUNTIME_CONFIG__?: {
      API_URL?: string;
      WEBSOCKET_URL?: string;
      AUTH_PROFILE_URL?: string;
    };
  }
}

/**
 * URL of the auth service's account (profile) app, where the sign-in account
 * itself is managed. Explicit AUTH_PROFILE_URL wins; otherwise it is derived
 * from the issuer: https://auth.qa.alummahnow.net -> https://profile.auth.qa.alummahnow.net
 */
export function deriveAuthProfileUrl(issuer: string | undefined, explicit?: string): string {
  if (explicit) return explicit.replace(/\/$/, '');
  if (!issuer) return '';
  try {
    const url = new URL(issuer);
    return `${url.protocol}//profile.${url.host}`;
  } catch {
    return '';
  }
}

export function getRuntimeConfig() {
  if (typeof window === 'undefined') {
    // Server-side: read from process.env
    return {
      API_URL: process.env.API_URL || '',
      WEBSOCKET_URL: process.env.WEBSOCKET_URL || '',
      AUTH_PROFILE_URL: deriveAuthProfileUrl(
        process.env.OPENAUTH_ISSUER || process.env.Issuer,
        process.env.AUTH_PROFILE_URL
      ),
    };
  }

  // Client-side: read from window
  return window.__RUNTIME_CONFIG__ || {
    API_URL: '',
    WEBSOCKET_URL: '',
    AUTH_PROFILE_URL: '',
  };
}

export function getApiUrl(): string {
  return getRuntimeConfig().API_URL || '';
}

export function getWebSocketUrl(): string {
  return getRuntimeConfig().WEBSOCKET_URL || '';
}

export function getAuthProfileUrl(): string {
  return getRuntimeConfig().AUTH_PROFILE_URL || '';
}
