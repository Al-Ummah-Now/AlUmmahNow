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
    baseURL: target().web,
    channel: 'chrome',
    trace: 'retain-on-failure',
  },
});
