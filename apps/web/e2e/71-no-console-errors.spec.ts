import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { ANONYMOUS_STATE } from './test-utils/auth-state';
import { useOwnData, type CreatedVideo } from './release/builders';

/**
 * An uncaught script error or console.error on a public page fails the build.
 * Inline scripts break silently otherwise: a bundler helper leaking into the
 * theme bootstrap (`__name is not defined`) only showed up in the console.
 *
 * The embed pages use the spec's own public video (release/builders.ts),
 * encoded so the embed has a player, and deleted afterwards.
 */
const PAGES = ['/en', '/ar', '/en/explore', '/en/search?q=mosque', '/en/settings', '/en/community-guidelines'];
const EMBEDS = [(id: string) => `/embed/v/${id}`, (id: string) => `/embed/comments/${id}`];

/** Connection failures say nothing about the page; a 4xx or 5xx on a normal page does. */
const NETWORK_NOISE = /net::ERR_/;

async function expectCleanConsole(page: Page, path: string) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error' && !NETWORK_NOISE.test(message.text())) errors.push(`console.error: ${message.text()}`);
  });
  // "Failed to load resource" names no URL: list each failed response next to it, so a red run says which
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(`response ${response.status()}: ${response.request().method()} ${response.url()}`);
  });
  await page.goto(path, { waitUntil: 'load' });
  // An observation window: errors thrown after load (hydration, effects) count too
  await page.waitForTimeout(1500);
  expect(errors).toEqual([]);
}

test.describe('Console stays clean', () => {
  test.use({ storageState: ANONYMOUS_STATE });

  /** The home pages show other specs' videos, whose thumbnails can 404 mid-run on the stack (quarantined: #1030 @meywd) */
  const QUARANTINED = new Set(['/en', '/ar']);

  for (const path of PAGES) {
    // quarantined: #1030 @meywd (the home pages only)
    (QUARANTINED.has(path) ? test.fixme : test)(`no console errors on ${path}`, async ({ page }) => {
      await expectCleanConsole(page, path);
    });
  }
});

test.describe('Console stays clean - embeds', () => {
  test.describe.configure({ mode: 'serial' });
  test.use({ storageState: ANONYMOUS_STATE });
  const data = useOwnData(test);
  let video: CreatedVideo;

  test.beforeAll(async ({ browser }) => {
    // Sign-up, then QA's encode (a slow one skips with #929)
    test.setTimeout(15 * 60000);
    const context = await browser.newContext();
    try {
      const owner = await data.createUser(await context.newPage(), 'console-embed');
      await data.grantCreator(owner);
      const channelId = await data.createChannel(owner);
      video = await data.createVideo(owner, channelId, { clip: 'landscape40', isPublic: true });
    } finally {
      await context.close();
    }
  });

  for (const embed of EMBEDS) {
    test(`no console errors on ${embed('<own video>')}`, async ({ page }) => {
      await expectCleanConsole(page, embed(video.id));
    });
  }
});
