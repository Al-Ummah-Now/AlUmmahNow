/**
 * Content Security Policy (Story 1.2, AC 3, 6)
 *
 * Production policy:
 * - script-src uses a per-request nonce plus 'strict-dynamic': only scripts that
 *   Next.js renders with the nonce (and scripts they load) execute. Injected
 *   inline scripts, inline event handler attributes (onclick="...") and
 *   javascript: URLs are refused by the browser.
 * - 'unsafe-eval' is not allowed, so string-to-code sinks (eval, new Function,
 *   setTimeout("...")) throw.
 * - 'unsafe-inline' and the host allowlist are kept only as a fallback for
 *   CSP Level 2 browsers; CSP3 browsers ignore both when a nonce is present.
 * - Violations are reported to /api/security/csp-report.
 *
 * Development keeps 'unsafe-eval'/'unsafe-inline' without a nonce because the
 * Next.js dev server (HMR / React Refresh) depends on them.
 */

export const CSP_REPORT_PATH = '/api/security/csp-report';

export interface CspEnv {
  apiUrl?: string;
  websocketUrl?: string;
  bunnyPullZone?: string;
  authUrl?: string;
}

export interface CspOptions {
  isDevelopment: boolean;
  nonce?: string;
  env?: CspEnv;
  /**
   * Who may frame the page. Default 'none' (every app page). Embed frames
   * (/embed/*) pass '*' so any site can embed public videos (docs/embeds).
   */
  frameAncestors?: "'none'" | '*';
}

function origin(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

function websocketOrigins(url: string | undefined): string[] {
  if (!url) return [];
  const match = url.match(/^(?:wss?|https?):\/\/([^/]+)/);
  if (!match) return [];
  return [`https://${match[1]}`, `wss://${match[1]}`];
}

/** Generate a base64 nonce with 128 bits of entropy. */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  bytes.forEach(b => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

export function buildContentSecurityPolicy({ isDevelopment, nonce, env = {}, frameAncestors = "'none'" }: CspOptions): string {
  const apiOrigin = origin(env.apiUrl);
  const authOrigin = origin(env.authUrl);
  const bunny = env.bunnyPullZone ? `https://${env.bunnyPullZone.replace(/^https?:\/\//, '')}` : '';

  const connectSrc = [
    "'self'",
    'https://*.b-cdn.net',
    bunny,
    apiOrigin,
    authOrigin,
    ...(isDevelopment
      ? ['http://127.0.0.1:*', 'http://localhost:*', 'ws://localhost:*', 'wss://localhost:*', 'ws://127.0.0.1:*']
      : websocketOrigins(env.websocketUrl)),
  ].filter(Boolean);

  const scriptHosts = ['https://vjs.zencdn.net', 'https://assets.mediadelivery.net'];
  const scriptSrc = isDevelopment
    ? ["'self'", "'unsafe-eval'", "'unsafe-inline'", ...scriptHosts]
    : nonce
      ? ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", "'unsafe-inline'", ...scriptHosts]
      : ["'self'", "'unsafe-inline'", ...scriptHosts];

  const policy = [
    "default-src 'self'",
    `script-src ${scriptSrc.join(' ')}`,
    // Inline event-handler attributes are never needed: React attaches handlers via addEventListener.
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline' https://vjs.zencdn.net https://cdnjs.cloudflare.com",
    "media-src 'self' https://cdn.bunny.net https://bunny-cdn.b-cdn.net https://*.b-cdn.net blob:",
    `connect-src ${Array.from(new Set(connectSrc)).join(' ')}`,
    "img-src 'self' data: https: blob:",
    "font-src 'self' data: https://cdnjs.cloudflare.com",
    "frame-src 'self' https://iframe.mediadelivery.net",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    `form-action 'self'${authOrigin ? ` ${authOrigin}` : ''}`,
    `frame-ancestors ${frameAncestors}`,
    `report-uri ${CSP_REPORT_PATH}`,
  ];

  if (!isDevelopment) policy.push('upgrade-insecure-requests');
  return policy.join('; ');
}

/** Response headers applied alongside the CSP. */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  // The legacy XSS auditor is removed from modern browsers and could itself be abused; CSP replaces it.
  'X-XSS-Protection': '0',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
};

/**
 * Headers for embed frames (/embed/*): the same set minus X-Frame-Options,
 * which has no "allow any origin" value and would override frame-ancestors in
 * old browsers. Autoplay, fullscreen and PiP are delegated by the embedding
 * iframe's `allow` attribute; this page must not deny them.
 */
export const EMBED_SECURITY_HEADERS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(SECURITY_HEADERS).filter(([header]) => header !== 'X-Frame-Options'),
);

/**
 * Serialize a value for embedding inside an inline <script>. Escapes characters
 * that could terminate the script element or be interpreted as markup.
 */
export function serializeForInlineScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
