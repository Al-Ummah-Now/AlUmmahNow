import { defineConfig, devices } from '@playwright/test';

/**
 * Release regressions (docs/release-pipeline/SPEC.md §12): small, independent of
 * the legacy suite's seeded users and global setup. E2E_ENV=qa|stage picks the
 * target; codes come from the auth server's E2E sink (E2E_CODE_SINK_SECRET).
 */
export default defineConfig({
  testDir: './e2e/release',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 2,
  timeout: 120000,
  expect: { timeout: 20000 },
  reporter: process.env.CI ? [['github'], ['html', { outputFolder: 'release-report', open: 'never' }]] : [['list']],
  use: {
    actionTimeout: 15000,
    navigationTimeout: 30000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'auth-flows',
      testIgnore: /player\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
