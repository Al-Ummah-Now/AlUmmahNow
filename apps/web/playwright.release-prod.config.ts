import { defineConfig, devices } from '@playwright/test';

/**
 * Production signed-in check, run by release.yml after the promote. Creates one
 * test-release-*@delivered.resend.dev account per run (deleted by the workflow).
 * No retries: a retry would create a second account; the workflow rolls back on failure.
 */
export default defineConfig({
  testDir: './e2e/release-prod',
  testMatch: /\.check\.ts$/,
  retries: 0,
  workers: 1,
  timeout: 240000,
  expect: { timeout: 20000 },
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: { ...devices['Desktop Chrome'], actionTimeout: 15000, navigationTimeout: 30000, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
});
