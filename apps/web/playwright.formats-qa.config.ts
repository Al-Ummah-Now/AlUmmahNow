import { defineConfig, devices } from '@playwright/test';

/** The by-hand real-upload check of every video format (e2e/manual/upload-formats-qa.manual.ts, #1938). */
export default defineConfig({
  testDir: './e2e/manual',
  testMatch: /upload-formats-qa\.manual\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 55 * 60_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  // Every click, fill and navigation is bounded, so no single hung action can run out the test's time
  use: { ...devices['Desktop Chrome'], actionTimeout: 60_000, navigationTimeout: 60_000 },
});
