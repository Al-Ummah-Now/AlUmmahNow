import { defineConfig, devices } from '@playwright/test';
import { ADMIN_WEB_URL, LOCAL_STACK, SHARED_STATE_PROJECT, storageStatePath } from './e2e/support/env';
import { SPEC_PLACEMENT } from '../web/e2e/test-utils/placement';

/**
 * Specs that change state shared by every run and every reader of QA (the
 * translation file, the public site theme, the profiles bucket the legacy
 * restore scans). They run once, in the shared-state project, which CI runs
 * under a cross-run lock; every other spec only touches this job's own
 * accounts and reports, so the device projects run concurrently with other runs.
 */
const SHARED_STATE_SPECS = /(06-translations-save|11-site-theme|12-legacy-profiles|17-live-streaming)\.spec\.ts$/;

/**
 * E2E_ENV=local: the local E2E stack (docs/testing/LOCAL-STACK.md) the job booted. Only the specs
 * placed `local` (apps/web/e2e/test-utils/placement.ts) run there, the rest stay on QA; the browser
 * goes through the stack's proxy, which answers the faked third-party hosts and refuses every other
 * non-local host, so a local run can never reach QA or production.
 */
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const adminSpecs = (placement: 'local' | 'deployed') =>
  Object.keys(SPEC_PLACEMENT)
    .filter((p) => p.startsWith('apps/admin-web/e2e/') && SPEC_PLACEMENT[p].placement === placement)
    .map((p) => escape(p.slice('apps/admin-web/e2e/'.length)));
const DEPLOYED_SPECS = adminSpecs('deployed');
const LOCAL_ONLY_IGNORE = LOCAL_STACK && DEPLOYED_SPECS.length > 0 ? [new RegExp(`/(${DEPLOYED_SPECS.join('|')})$`)] : [];
const LOCAL_USE = LOCAL_STACK ? { proxy: { server: 'http://127.0.0.1:3191', bypass: 'localhost,127.0.0.1' }, ignoreHTTPSErrors: true } : {};

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
    ...LOCAL_USE,
  },
  projects: [
    { name: 'chromium', testIgnore: [SHARED_STATE_SPECS, ...LOCAL_ONLY_IGNORE], use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', testIgnore: [SHARED_STATE_SPECS, ...LOCAL_ONLY_IGNORE], use: { ...devices['Desktop Safari'] } },
    { name: 'mobile', testIgnore: [SHARED_STATE_SPECS, ...LOCAL_ONLY_IGNORE], use: { ...devices['Pixel 5'] } },
    { name: SHARED_STATE_PROJECT, testMatch: SHARED_STATE_SPECS, testIgnore: LOCAL_ONLY_IGNORE, use: { ...devices['Desktop Chrome'] } },
  ],
});
