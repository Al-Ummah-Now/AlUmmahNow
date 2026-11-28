import { test, expect } from '@playwright/test';

/**
 * Injection & security regression E2E tests (docs/security/injection-audit-web.md).
 *
 * Verifies live rendering, security headers, open-redirect resistance, and route-handler
 * input validation against the running web server without hitting production or paid APIs.
 */

test.describe('Web injection & security regressions', () => {
  test('INJ-001 page responses carry strict CSP and security headers without script execution on XSS query params', async ({ page }) => {
    const dialogTriggered: string[] = [];
    page.on('dialog', async (dialog) => {
      dialogTriggered.push(dialog.message());
      await dialog.dismiss();
    });

    const payload = '"><img src=x onerror=alert(1)><script>alert(2)</script>';
    const response = await page.goto(`/en/search?q=${encodeURIComponent(payload)}`, { waitUntil: 'domcontentloaded' });
    expect(response, 'search page responded').not.toBeNull();
    expect(response!.status()).toBeLessThan(500);

    const headers = response!.headers();
    const csp = headers['content-security-policy'] ?? '';
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("script-src-attr 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(headers['x-content-type-options']).toBe('nosniff');

    // No alert dialog triggered and no injected onerror image node
    expect(dialogTriggered).toEqual([]);
    await expect(page.locator('img[onerror]')).toHaveCount(0);

    // Every JSON-LD script block parses cleanly and never contains raw script-closing sequences
    const jsonLdBlocks = await page.locator('script[type="application/ld+json"]').allTextContents();
    for (const block of jsonLdBlocks) {
      expect(() => JSON.parse(block)).not.toThrow();
      expect(block.toLowerCase()).not.toContain('</script');
    }
  });

  test('INJ-002 blocks open redirects and dot-dot path traversal at middleware and route boundaries', async ({ request }) => {
    // Legacy watch redirect must reject dot traversal and invalid locales
    const traversal = await request.get('/en/video?vid=..', { maxRedirects: 0 });
    expect(traversal.headers()['location'] ?? '').not.toContain('/video/..');

    // /api/auth/login must never accept external return URLs into the return cookie
    const loginRes = await request.get('/api/auth/login?return=//evil.example/phish&locale=../../evil', {
      maxRedirects: 0,
    });
    const setCookie = loginRes.headers()['set-cookie'] ?? '';
    expect(setCookie).not.toContain('evil.example');
    expect(setCookie).not.toContain('auth_locale=..');

    // /api/studio/site-domains must block dot-dot traversal
    const domainTraversal = await request.delete('/api/studio/site-domains/ch1/..');
    expect(domainTraversal.status()).toBe(404);

    // /api/theme-packages must reject path traversal
    const themeTraversal = await request.get('/api/theme-packages/my-theme/1.0.0/assets/../theme.json');
    expect(themeTraversal.status()).toBe(404);
  });

  test('INJ-003 route handlers reject malformed or forged JSON payloads', async ({ request }) => {
    const badQoe = await request.post('/api/analytics/qoe', {
      data: { videoId: '../../admin', watchMs: 'not-a-number' },
    });
    expect(badQoe.status()).toBe(400);

    const badContact = await request.post('/api/contact', {
      headers: { 'sec-fetch-site': 'same-origin' },
      data: ['array-not-object'],
    });
    expect(badContact.status()).toBe(400);

    const badReport = await request.post('/api/report', {
      headers: { 'sec-fetch-site': 'same-origin' },
      data: ['array-not-object'],
    });
    expect(badReport.status()).toBe(400);

    const badErrors = await request.post('/api/errors', {
      headers: { 'sec-fetch-site': 'same-origin' },
      data: { events: 'not-an-array' },
    });
    expect(badErrors.status()).toBe(400);
  });
});
