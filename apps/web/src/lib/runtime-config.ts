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
    };
  }
}

export function getRuntimeConfig() {
  if (typeof window === 'undefined') {
    // Server-side: read from process.env
    return {
      API_URL: process.env.API_URL || '',
      WEBSOCKET_URL: process.env.WEBSOCKET_URL || '',
    };
  }

  // Client-side: read from window
  return window.__RUNTIME_CONFIG__ || {
    API_URL: '',
    WEBSOCKET_URL: '',
  };
}

export function getApiUrl(): string {
  return getRuntimeConfig().API_URL || '';
}

export function getWebSocketUrl(): string {
  return getRuntimeConfig().WEBSOCKET_URL || '';
}
