import { defineConfig, devices } from '@playwright/test';
import { ADMIN_WEB_URL, SHARED_STATE_PROJECT, storageStatePath } from './e2e/support/env';

/**
 * Specs that change state shared by every run and every reader of QA (the
 * translation file, the public site theme, the profiles bucket the legacy
 * restore scans). They run once, in the shared-state project, which CI runs
 * under a cross-run lock; every other spec only touches this job's own
 * accounts and reports, so the device projects run concurrently with other runs.
 */
const SHARED_STATE_SPECS = /(06-translations-save|11-site-theme|12-legacy-profiles)\.spec\.ts$/;

/**
 * admin-web UI suite. Runs against a deployed environment (QA by default,
 * override with ADMIN_WEB_URL). Projects: desktop Chromium, desktop WebKit,
 * a mobile (Pixel 5) viewport, and shared-state (see SHARED_STATE_SPECS).
 * Specs use the admin storage state unless they opt into another role with
 * test.use({ storageState }).
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts$/,
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 4 : 6,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ['junit', { outputFile: 'test-results/junit.xml' }],
  ],
  use: {
    baseURL: ADMIN_WEB_URL,
    storageState: storageStatePath('admin'),
    locale: 'en-US',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
  },
  projects: [
    { name: 'chromium', testIgnore: SHARED_STATE_SPECS, use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', testIgnore: SHARED_STATE_SPECS, use: { ...devices['Desktop Safari'] } },
    { name: 'mobile', testIgnore: SHARED_STATE_SPECS, use: { ...devices['Pixel 5'] } },
    { name: SHARED_STATE_PROJECT, testMatch: SHARED_STATE_SPECS, use: { ...devices['Desktop Chrome'] } },
  ],
});
