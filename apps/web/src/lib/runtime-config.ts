/**
 * Runtime Configuration
 *
 * Reads configuration injected by the server at runtime.
 * This allows environment-specific values without rebuilding.
 */

import { shortLinkOriginFor } from '@al-ummah/shared-types';
import { deriveCmsUrl, deriveWwwUrl } from './scholars/sites';

export interface RuntimeConfig {
  API_URL?: string;
  WEBSOCKET_URL?: string;
  AUTH_PROFILE_URL?: string;
  /** Auth server origin: the page asks it for the browser's accounts. */
  AUTH_URL?: string;
  /** The CMS (scholars write articles there) and www (scholar pages). '' = links hidden. */
  CMS_URL?: string;
  WWW_URL?: string;
  /** Short share links host (alummahnow.link, wiki AUN-SHORT-LINKS). '' = share the page's own URL. */
  SHORT_LINK_URL?: string;
}

/**
 * The short link host: SHORT_LINK_URL when set ('off' turns short links off), else the one of this
 * environment, from the API host (videos.api.qa.alummahnow.net → https://qa.alummahnow.link).
 * '' where there is none (localhost, previews): sharing then uses the page's own URL.
 */
export function deriveShortLinkUrl(apiUrl: string | undefined, explicit?: string): string {
  if (explicit === 'off') return '';
  if (explicit) return explicit.replace(/\/+$/, '');
  return shortLinkOriginFor(apiUrl) ?? '';
}

declare global {
  interface Window {
    __RUNTIME_CONFIG__?: RuntimeConfig;
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

/** Origin of the auth server (issuer), '' when unset or malformed. */
export function authOrigin(issuer: string | undefined): string {
  if (!issuer) return '';
  try {
    return new URL(issuer).origin;
  } catch {
    return '';
  }
}

export function getRuntimeConfig(): RuntimeConfig {
  if (typeof window === 'undefined') {
    // Server-side: read from process.env
    return {
      API_URL: process.env.API_URL || '',
      WEBSOCKET_URL: process.env.WEBSOCKET_URL || '',
      AUTH_PROFILE_URL: deriveAuthProfileUrl(
        process.env.OPENAUTH_ISSUER || process.env.Issuer,
        process.env.AUTH_PROFILE_URL
      ),
      AUTH_URL: authOrigin(process.env.OPENAUTH_ISSUER || process.env.Issuer),
      CMS_URL: deriveCmsUrl(process.env.OPENAUTH_ISSUER || process.env.Issuer, process.env.CMS_URL),
      WWW_URL: deriveWwwUrl(process.env.OPENAUTH_ISSUER || process.env.Issuer, process.env.WWW_URL),
      SHORT_LINK_URL: deriveShortLinkUrl(process.env.API_URL || process.env.NEXT_PUBLIC_API_URL, process.env.SHORT_LINK_URL),
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

export function getCmsUrl(): string {
  return getRuntimeConfig().CMS_URL || '';
}

export function getShortLinkUrl(): string {
  return getRuntimeConfig().SHORT_LINK_URL || '';
}

export function getWwwUrl(): string {
  return getRuntimeConfig().WWW_URL || '';
}

export function getWebSocketUrl(): string {
  return getRuntimeConfig().WEBSOCKET_URL || '';
}

export function getAuthProfileUrl(): string {
  return getRuntimeConfig().AUTH_PROFILE_URL || '';
}

export function getAuthUrl(): string {
  return getRuntimeConfig().AUTH_URL || '';
}
