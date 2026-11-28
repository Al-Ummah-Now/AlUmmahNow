import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.QAF_WEB_PORT || 3134);
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: './e2e/qaf',
  outputDir: 'test-results/qaf',
  workers: 1,
  timeout: 45_000,
  use: { ...devices['Desktop Chrome'], baseURL, colorScheme: 'dark', viewport: { width: 1440, height: 950 }, trace: 'retain-on-failure' },
  webServer: {
    command: `pnpm exec next dev -p ${port} --webpack`,
    url: `${baseURL}/en/dev/qaf`,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    env: {
      API_URL: 'http://127.0.0.1:9',
      NEXT_PUBLIC_API_URL: 'http://127.0.0.1:9',
      OPENAUTH_ISSUER: 'http://127.0.0.1:9',
      Issuer: 'http://127.0.0.1:9',
      NEXTJS_ENV: 'local',
    },
  },
});
