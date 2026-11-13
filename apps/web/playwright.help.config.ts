/**
 * Help's pictures and clips (e2e/help-capture/capture.help.ts, docs/features/HELP-AND-TOUR.md).
 * Not a test suite: it photographs the real site on the local stack. One worker, in order, on
 * Google Chrome (the mini-player clip plays H.264, which Playwright's Chromium cannot decode).
 *
 *   E2E_ENV=local pnpm exec playwright test -c playwright.help.config.ts
 */
import { defineConfig } from '@playwright/test';
import { target } from './e2e/release/targets';

export default defineConfig({
  testDir: './e2e/help-capture',
  testMatch: /\.help\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 10 * 60_000,
  reporter: [['list']],
  outputDir: './test-results/help-capture',
  use: {
    // The stack's proxy answers the faked third-party HTTPS hosts (Bunny CDN, image host), as in
    // playwright.release.config.ts: without it the player cannot load the video
    proxy: { server: 'http://127.0.0.1:3191', bypass: 'localhost,127.0.0.1' },
    ignoreHTTPSErrors: true,
    baseURL: target().web,
    channel: 'chrome',
    trace: 'retain-on-failure',
  },
});
