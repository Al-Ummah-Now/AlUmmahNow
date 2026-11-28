import { defineConfig, devices } from '@playwright/test';

/**
 * The production player in Chromium, Firefox and WebKit (docs/specs/VIDEO-PLAYER.md section 9).
 *
 * Runs against a production build with the test harness at /[locale]/dev/player with local HLS fixtures served by
 * the specs' route handler (e2e/player/harness.ts): no backend, no account, no network media.
 * Every browser runs at device scale 2, where sub-pixel seams and clipped handles show.
 *
 * Chromium runs as Google Chrome (channel "chrome"): Playwright's own Chromium ships without
 * H.264, and Video.js's HLS engine (VHS) only handles HLS where Media Source plays H.264, so the
 * bundled build cannot play any HLS stream. CI installs Chrome with `playwright install chrome`.
 *
 *   pnpm --filter web exec playwright test -c playwright.player.config.ts
 *   PLAYER_BASE_URL=http://localhost:3101 ... to reuse a running harness server
 */
/** Phone and foldable specs run only in the mobile projects, and only there */
const MOBILE_SPECS = /\/mobile-[^/]*\.spec\.ts$/;

const port = Number(process.env.PLAYER_PORT || 3101);
const baseURL = process.env.PLAYER_BASE_URL || `http://localhost:${port}`;

/** Linux: not the FFmpeg H.264 decoder, which aborts WebKit on a rendition switch (why: playwright.release.config.ts, #2013) */
if (process.platform === 'linux') process.env.GST_PLUGIN_FEATURE_RANK ??= 'avdec_h264:NONE';

export default defineConfig({
  testDir: './e2e/player',
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{arg}{ext}',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 3,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never', outputFolder: 'playwright-report-player' }]] : [['list']],
  outputDir: 'test-results-player',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    deviceScaleFactor: 2,
    viewport: { width: 1280, height: 800 },
    colorScheme: 'dark',
  },
  projects: [
    { name: 'chromium', testIgnore: MOBILE_SPECS, use: { ...devices['Desktop Chrome'], channel: 'chrome', deviceScaleFactor: 2, viewport: { width: 1280, height: 800 } } },
    // Traced on the retry only: recording a trace made the same Firefox test take 96 s instead of 60 s (the
    // median of 16 each, alternating on one runner, #2040), past the 90 s limit. A failure still has its
    // screenshot, and its retry the trace
    { name: 'firefox', testIgnore: MOBILE_SPECS, use: { ...devices['Desktop Firefox'], trace: 'on-first-retry', deviceScaleFactor: 2, viewport: { width: 1280, height: 800 } } },
    { name: 'webkit', testIgnore: MOBILE_SPECS, use: { ...devices['Desktop Safari'], deviceScaleFactor: 2, viewport: { width: 1280, height: 800 } } },
    // Touch phones and foldables (e2e/player/mobile-*.spec.ts): Android Chrome and iPhone Safari
    { name: 'mobile-chrome', testMatch: MOBILE_SPECS, use: { ...devices['Pixel 7'], channel: 'chrome' } },
    { name: 'mobile-webkit', testMatch: MOBILE_SPECS, use: { ...devices['iPhone 15'] } },
    // The installed Firefox (stock release, not Playwright's build) over WebDriver BiDi:
    // PLAYER_FIREFOX_PATH=/Applications/Firefox.app/Contents/MacOS/firefox
    ...(process.env.PLAYER_FIREFOX_PATH
      ? [{
          name: 'firefox-stable',
          testIgnore: MOBILE_SPECS,
          use: {
            ...devices['Desktop Firefox'],
            browserName: '_bidiFirefox' as 'firefox',
            launchOptions: { executablePath: process.env.PLAYER_FIREFOX_PATH },
            deviceScaleFactor: 2,
            viewport: { width: 1280, height: 800 },
          },
        }]
      : []),
  ],
  webServer: process.env.PLAYER_BASE_URL
    ? undefined
    : {
        command: `pnpm run build && pnpm run start -p ${port}`,
        env: { NEXT_PUBLIC_PLAYER_HARNESS: '1' },
        url: `${baseURL}/en/dev/player`,
        reuseExistingServer: !process.env.CI,
        timeout: 300_000,
        stdout: 'ignore',
        stderr: 'pipe',
      },
});
