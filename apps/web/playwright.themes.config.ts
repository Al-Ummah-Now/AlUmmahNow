import { defineConfig, devices } from '@playwright/test';

/**
 * Theme visibility sweep (e2e/themes): every built-in site theme x light/dark x en/ar x desktop/phone,
 * against a local dev server and a local mock API (e2e/themes/mock-server.mjs): no QA, no network.
 * The session is a local cookie, never a real account.
 *
 *   pnpm --filter web exec playwright test -c playwright.themes.config.ts
 *   THEMES_BASE_URL=http://localhost:3157 ... to reuse a running dev server
 */
const port = Number(process.env.THEMES_PORT || 3157);
const baseURL = process.env.THEMES_BASE_URL || `http://localhost:${port}`;
const mockPort = Number(process.env.MOCK_API_PORT || 3158);
export const MOCK_API = `http://127.0.0.1:${mockPort}`;

export default defineConfig({
  testDir: './e2e/themes',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 2 : 2,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  outputDir: 'test-results-themes',
  use: { baseURL, trace: 'off', screenshot: 'off', deviceScaleFactor: 1 },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      command: 'node e2e/themes/mock-server.mjs',
      url: `${MOCK_API}/api/profile`,
      reuseExistingServer: !process.env.CI,
      env: { MOCK_API_PORT: String(mockPort), THEMES_ORIGIN: new URL(baseURL).origin },
      stdout: 'ignore',
      stderr: 'pipe',
    },
    ...(process.env.THEMES_BASE_URL ? [] : [{
        command: `pnpm exec next dev -p ${port} --webpack`,
        url: `${baseURL}/en`,
        reuseExistingServer: !process.env.CI,
        timeout: 300_000,
        env: { API_URL: MOCK_API, NEXT_PUBLIC_API_URL: MOCK_API, WEBSOCKET_URL: `${MOCK_API.replace('http', 'ws')}/ws`, NEXT_PUBLIC_WEBSOCKET_URL: `${MOCK_API.replace('http', 'ws')}/ws` },
        stdout: 'ignore' as const,
        stderr: 'pipe' as const,
      }]),
  ],
});
