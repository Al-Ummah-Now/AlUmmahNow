import { defineConfig, devices } from '@playwright/test';

/**
 * The production player in Chromium, Firefox and WebKit (docs/specs/VIDEO-PLAYER.md section 9).
 *
 * Runs against the development harness at /[locale]/dev/player with local HLS fixtures served by
 * the specs' route handler (e2e/player/harness.ts): no backend, no account, no network media.
 * Every browser runs at device scale 2, where sub-pixel seams and clipped handles show.
 *
 * Chromium runs as Google Chrome (channel "chrome"): Playwright's own Chromium ships without
 * H.264, and Video.js's HLS engine (VHS) only handles HLS where Media Source plays H.264, so the
 * bundled build cannot play any HLS stream. CI installs Chrome with `playwright install chrome`.
 *
 *   pnpm --filter web exec playwright test -c playwright.player.config.ts
 *   PLAYER_BASE_URL=http://localhost:3101 ... to reuse a running dev server
 */
const port = Number(process.env.PLAYER_PORT || 3101);
const baseURL = process.env.PLAYER_BASE_URL || `http://localhost:${port}`;

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
    { name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chrome', deviceScaleFactor: 2, viewport: { width: 1280, height: 800 } } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], deviceScaleFactor: 2, viewport: { width: 1280, height: 800 } } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], deviceScaleFactor: 2, viewport: { width: 1280, height: 800 } } },
    // The installed Firefox (stock release, not Playwright's build) over WebDriver BiDi:
    // PLAYER_FIREFOX_PATH=/Applications/Firefox.app/Contents/MacOS/firefox
    ...(process.env.PLAYER_FIREFOX_PATH
      ? [{
          name: 'firefox-stable',
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
        command: `pnpm exec next dev -p ${port} --webpack`,
        url: `${baseURL}/en/dev/player`,
        reuseExistingServer: !process.env.CI,
        timeout: 300_000,
        stdout: 'ignore',
        stderr: 'pipe',
      },
});
