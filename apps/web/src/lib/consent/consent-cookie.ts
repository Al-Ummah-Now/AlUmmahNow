/**
 * Consent cookie format (Story 1.3, AC 3, 4)
 *
 * Pure helpers shared by the browser (ConsentManager) and server route handlers
 * (beacon endpoints check the cookie before forwarding events). No browser or
 * Next.js imports.
 *
 * The cookie itself is strictly necessary (it records the user's choice) and
 * therefore does not require consent. Format, kept short and human-readable:
 *
 *   aun_consent=v1.a1.e0.p1.1730900000000
 *               |  |  |  |  └ decision time (epoch ms)
 *               |  |  |  └ performance monitoring (web vitals, player QoS)
 *               |  |  └ experiments (A/B testing)
 *               |  └ analytics (video engagement analytics)
 *               └ policy version
 */

export const CONSENT_COOKIE = 'aun_consent';

/**
 * Bump when the categories or the privacy notice change materially; users
 * with an older version are asked again.
 */
export const CONSENT_VERSION = 1;

/** Consent is re-requested after this long (6 months, per EDPB/CNIL guidance). */
export const CONSENT_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;

export type ConsentCategory = 'analytics' | 'experiments' | 'performance';

export const CONSENT_CATEGORIES: ReadonlyArray<ConsentCategory> = ['analytics', 'experiments', 'performance'];

export interface ConsentChoices {
  analytics: boolean;
  experiments: boolean;
  performance: boolean;
}

export interface ConsentState extends ConsentChoices {
  version: number;
  /** Epoch milliseconds of the decision. */
  decidedAt: number;
}

const FLAG: Record<ConsentCategory, string> = { analytics: 'a', experiments: 'e', performance: 'p' };

export function serializeConsent(state: ConsentState): string {
  return [
    `v${state.version}`,
    ...CONSENT_CATEGORIES.map(category => `${FLAG[category]}${state[category] ? 1 : 0}`),
    String(Math.floor(state.decidedAt)),
  ].join('.');
}

/**
 * Parse a cookie value. Returns null for missing, malformed, outdated or
 * expired values; callers must treat null as "no consent".
 */
export function parseConsent(value: string | null | undefined, now = Date.now()): ConsentState | null {
  if (!value) return null;
  const match = /^v(\d+)\.a([01])\.e([01])\.p([01])\.(\d{10,16})$/.exec(decodeURIComponent(value).trim());
  if (!match) return null;
  const version = Number(match[1]);
  const decidedAt = Number(match[5]);
  if (version !== CONSENT_VERSION) return null;
  if (decidedAt > now + 60_000 || now - decidedAt > CONSENT_MAX_AGE_SECONDS * 1000) return null;
  return {
    version,
    analytics: match[2] === '1',
    experiments: match[3] === '1',
    performance: match[4] === '1',
    decidedAt,
  };
}

/** Read the consent value out of a raw `Cookie` header. */
export function consentFromCookieHeader(cookieHeader: string | null | undefined, now = Date.now()): ConsentState | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === CONSENT_COOKIE) return parseConsent(rest.join('='), now);
  }
  return null;
}

/** Default-deny: true only if the user explicitly opted in to the category. */
export function isCategoryAllowed(state: ConsentState | null, category: ConsentCategory): boolean {
  return state !== null && state[category] === true;
}
