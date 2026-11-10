import { defineConfig, devices } from '@playwright/test';

/**
 * Release regressions: small, independent of the legacy suite's seeded users and
 * global setup. Every spec registers its own sink user. E2E_ENV=qa|stage picks
 * the target; codes come from the auth server's E2E sink (E2E_CODE_SINK_SECRET),
 * admin promotion uses TEST_PROMOTE_SECRET. Needs only @playwright/test.
 */
const PLAYER = /player\.spec\.ts$/;
/**
 * Specs that run in Chrome, Firefox and WebKit (the defect they pin showed in
 * every browser). Branded Chrome, not the bundled Chromium: they open the watch
 * page, and Chromium's missing H.264 decoder logs player errors of its own.
 */
const ALL_BROWSERS = /anonymous-console\.spec\.ts$/;

export default defineConfig({
  testDir: './e2e/release',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 4,
  timeout: 180000,
  expect: { timeout: 20000 },
  reporter: process.env.CI ? [['github'], ['list'], ['html', { outputFolder: 'release-report', open: 'never' }]] : [['list']],
  use: {
    actionTimeout: 15000,
    navigationTimeout: 30000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'auth-flows',
      testIgnore: [PLAYER, ALL_BROWSERS],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // Real playback: bundled Chromium has no H.264 decoder for the HLS streams
      name: 'player',
      testMatch: PLAYER,
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
    { name: 'chrome', testMatch: ALL_BROWSERS, use: { ...devices['Desktop Chrome'], channel: 'chrome' } },
    { name: 'firefox', testMatch: ALL_BROWSERS, use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', testMatch: ALL_BROWSERS, use: { ...devices['Desktop Safari'] } },
  ],
});
