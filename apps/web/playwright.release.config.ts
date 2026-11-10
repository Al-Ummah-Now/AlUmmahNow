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
const ALL_BROWSERS = /(anonymous-console|realtime-toasts|admin-content)\.spec\.ts$/;
/**
 * The control-bar layout and progress-track specs also run in Firefox and WebKit when asked, locally:
 * RELEASE_PLAYER_BROWSERS=firefox,webkit (layout only, so the browsers' own decoders suffice).
 * PLAYER_FIREFOX_PATH runs the installed Firefox over WebDriver BiDi instead of Playwright's build,
 * as playwright.player.config.ts does.
 */
const BAR_ROW = /player-(bar-row|track)\.player\.spec\.ts$/;
const EXTRA_BROWSERS = (process.env.RELEASE_PLAYER_BROWSERS ?? '').split(',').map((b) => b.trim()).filter(Boolean);
const EXTRA_DEVICES = {
  firefox: process.env.PLAYER_FIREFOX_PATH
    ? {
        ...devices['Desktop Firefox'],
        browserName: '_bidiFirefox' as 'firefox',
        launchOptions: { executablePath: process.env.PLAYER_FIREFOX_PATH },
      }
    : devices['Desktop Firefox'],
  webkit: devices['Desktop Safari'],
} as const;

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
    ...EXTRA_BROWSERS.filter((b): b is keyof typeof EXTRA_DEVICES => b in EXTRA_DEVICES).flatMap((b) =>
      b === 'firefox'
        ? [
            { name: 'player-firefox', testMatch: BAR_ROW, grepInvert: /, touch\)/, use: { ...EXTRA_DEVICES.firefox } },
            {
              // Firefox's hasTouch leaves (pointer: coarse) off; its pointer prefs turn it on
              // (1 = coarse, no hover). Prefs are per browser, so touch gets its own project.
              name: 'player-firefox-coarse',
              testMatch: BAR_ROW,
              grep: /, touch\)/,
              use: {
                ...EXTRA_DEVICES.firefox,
                launchOptions: {
                  ...('launchOptions' in EXTRA_DEVICES.firefox ? EXTRA_DEVICES.firefox.launchOptions : {}),
                  firefoxUserPrefs: { 'ui.primaryPointerCapabilities': 1, 'ui.allPointerCapabilities': 1 },
                },
              },
            },
          ]
        : [{ name: `player-${b}`, testMatch: BAR_ROW, use: { ...EXTRA_DEVICES[b] } }],
    ),
  ],
});
