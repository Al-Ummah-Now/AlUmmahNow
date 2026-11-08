import { defineConfig, devices } from '@playwright/test';
import { ADMIN_WEB_URL, storageStatePath } from './e2e/support/env';

/**
 * admin-web UI suite. Runs against a deployed environment (QA by default,
 * override with ADMIN_WEB_URL). Projects: desktop Chromium, desktop WebKit,
 * and a mobile (Pixel 5) viewport. Specs use the admin storage state unless
 * they opt into another role with test.use({ storageState }).
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
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile', use: { ...devices['Pixel 5'] } },
  ],
});
