import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';

/**
 * Read environment variables from .env.test.local file.
 * https://github.com/motdotla/dotenv
 */
dotenv.config({ path: path.resolve(__dirname, '.env.test.local') });

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './e2e',

  /* Run global setup before all tests */
  globalSetup: require.resolve('./e2e/auth.setup'),

  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. Limit workers for upload tests */
  workers: process.env.CI ? 1 : 2,
  /* Timeout for each test (3 minutes for video uploads) */
  timeout: 180000,
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
    baseURL: 'http://localhost:3001',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',

    /* Screenshot on failure */
    screenshot: 'only-on-failure',

    /* Video on failure */
    video: 'retain-on-failure',

    /* Accept downloads for file upload tests */
    acceptDownloads: true,

    /* Permissions for file access */
    permissions: ['clipboard-read', 'clipboard-write'],
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

  /* Run your local dev server before starting the tests */
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3001',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000, // 2 minutes for Next.js to start
  },
});
