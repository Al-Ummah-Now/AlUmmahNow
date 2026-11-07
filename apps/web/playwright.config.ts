import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';

/**
 * Read environment variables from .env.test.local file.
 * https://github.com/motdotla/dotenv
 */
dotenv.config({ path: path.resolve(__dirname, '.env.test.local') });

/**
 * Use WEB_APP_URL for deployed environments (QA, staging, production)
 * Fall back to localhost for local development
 */
const baseURL = process.env.WEB_APP_URL || 'http://localhost:3001';
const isRemoteTarget = baseURL.startsWith('https://');

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './e2e',

  /* Run global setup before all tests */
  globalSetup: require.resolve('./e2e/auth.setup'),
  /* Delete videos the run created for the E2E users (seed videos are kept) */
  globalTeardown: require.resolve('./e2e/cleanup-test-content'),

  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only (1 retry — 2 tripled the cost of every broken test) */
  retries: process.env.CI ? 1 : 0,
  /* Opt out of parallel tests on CI. Limit workers for upload tests */
  workers: process.env.CI ? 1 : 2,
  /* Timeout for each test (3 minutes for video uploads) */
  timeout: 180000,
  /*
   * Failure ceilings so a stuck/broken test fails fast instead of consuming the
   * whole 60-90min job (previously the E2E jobs hit their timeout-minutes and
   * were cancelled). globalTimeout caps the whole run; maxFailures aborts early.
   */
  globalTimeout: process.env.CI ? 15 * 60 * 1000 : undefined,
  maxFailures: process.env.CI ? 5 : 0,
  /* Expect timeout */
  expect: {
    timeout: 30000,
  },
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [
    ['html'],
    ['junit', { outputFile: 'test-results/junit.xml' }],
    ['json', { outputFile: 'test-results/test-results.json' }],
  ],
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL,

    /*
     * Bound individual actions/navigations so a single stuck operation (e.g. a
     * never-settling load) fails in seconds instead of blocking for the full
     * per-test timeout. Key to preventing runaway jobs against a remote target.
     */
    actionTimeout: 15000,
    navigationTimeout: 30000,

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',

    /* Screenshot on failure */
    screenshot: 'only-on-failure',

    /* Video on failure */
    video: 'retain-on-failure',

    /* Accept downloads for file upload tests */
    acceptDownloads: true,
  },

  /* Configure projects for major browsers */
  projects: [
    // Setup project - runs global setup to register users
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts/,
    },

    // Authenticated user projects with saved storage state
    {
      name: 'single-channel-user',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/user-single.json',
      },
      dependencies: ['setup'],
    },
    {
      name: 'multi-channel-user',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/user-multi.json',
      },
      dependencies: ['setup'],
    },
    {
      name: 'no-channels-user',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/user-none.json',
      },
      dependencies: ['setup'],
    },

    // Standard browser projects (for tests that don't need authentication)
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },

    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },

    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },

    /* Test against mobile viewports. */
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 12'] },
    },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    // },
  ],

  /* Run your local dev server before starting the tests (only for local development) */
  webServer: isRemoteTarget
    ? undefined
    : {
        command: 'pnpm dev',
        url: 'http://localhost:3001',
        // Always reuse if server is already running (CI starts it manually for globalSetup)
        reuseExistingServer: true,
        // CI runners are slower - allow 5 minutes for Next.js to start
        timeout: process.env.CI ? 300 * 1000 : 120 * 1000,
      },
});
