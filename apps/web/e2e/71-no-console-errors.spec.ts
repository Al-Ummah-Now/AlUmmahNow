import { test, expect } from './fixtures';
import { ANONYMOUS_STATE } from './test-utils/auth-state';

/**
 * An uncaught script error or console.error on a public page fails the build.
 * Inline scripts break silently otherwise: a bundler helper leaking into the
 * theme bootstrap (`__name is not defined`) only showed up in the console.
 */
const EMBED_VIDEO = process.env.E2E_PLAYBACK_VIDEO_ID || '443418c1-dc70-43d9-944d-5388ab7dc4c3';
const PAGES = ['/en', '/ar', '/en/explore', '/en/search?q=mosque', '/en/settings', '/en/community-guidelines', `/embed/v/${EMBED_VIDEO}`, `/embed/comments/${EMBED_VIDEO}`];

/** Network failures are reported by the resource and are not script faults. */
const NETWORK_NOISE = /Failed to load resource|net::ERR_/;

test.describe('Console stays clean', () => {
  test.use({ storageState: ANONYMOUS_STATE });

  for (const path of PAGES) {
    test(`no console errors on ${path}`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
      page.on('console', (message) => {
        if (message.type() === 'error' && !NETWORK_NOISE.test(message.text())) errors.push(`console.error: ${message.text()}`);
      });
      await page.goto(path, { waitUntil: 'load' });
      await page.waitForTimeout(1500);
      expect(errors).toEqual([]);
    });
  }
});
