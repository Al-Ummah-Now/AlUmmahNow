/**
 * Pre-answers the cookie-consent banner (all optional categories rejected) so
 * its fixed bottom bar never covers elements under test.
 * Format: aun_consent=v1.a<analytics>.e<experiments>.p<personalization>.<timestamp>
 */
export function consentCookie(baseURL: string) {
  return {
    name: 'aun_consent',
    value: `v1.a0.e0.p0.${Date.now()}`,
    url: baseURL,
    sameSite: 'Lax' as const,
  };
}
