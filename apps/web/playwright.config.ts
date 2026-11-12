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
/*
 * The axe-on-every-page sweep (e2e/a11y) and the visual snapshots (e2e/visual)
 * run in their own projects, once, on Desktop Chrome; the browser/device
 * projects run every other spec.
 */
// e2e/release/ is the release suite (playwright.release.config.ts), never run here
// e2e/themes runs on its own config (playwright.themes.config.ts) against a local server
// e2e/player is the player harness suite (playwright.player.config.ts, player-e2e.yml): it opens
// /dev/player, which deployed builds answer with 404, so it never runs against a deployed site
const DEDICATED_DIRS = [/e2e\/a11y\//, /e2e\/visual\//, /e2e\/release\//, /e2e\/themes\//, /e2e\/player\//];

/*
 * Upload transport and upload UI specs: every test sends real bytes to the Bunny
 * library QA and stage share, and every upload is one Bunny encode. On
 * 2026-11-10 the suites sent ~4,400 QA uploads in a day and filled that
 * library's encoding queue. So:
 *  - they run in the chromium project only (the transport is the same in every
 *    browser; the other browser/device projects still run every other spec);
 *  - E2E_SKIP_UPLOAD_SPECS=1 (pull requests, e2e-tests.yml) skips them, as the
 *    release suite (release-e2e.yml) covers upload modes, resume, reuse, bulk and
 *    upload -> ready -> plays on every pull request. Nightly and after every
 *    Release they run in chromium.
 */
const UPLOAD_SPECS = /\/(12-video-upload|13-video-upload-tus-resume|17-tus-proxy-upload|18-tus-proxy-logs|40-upload-form|41-batch-upload|42-upload-templates)\.spec\.ts$/;
const SKIP_UPLOAD_SPECS = process.env.E2E_SKIP_UPLOAD_SPECS === '1';
const OUTPUT_SUFFIX = /^[a-z0-9-]{1,32}$/.test(process.env.E2E_OUTPUT_SUFFIX ?? '') ? `-${process.env.E2E_OUTPUT_SUFFIX}` : '';
/**
 * Specs that write or assert state no run owns: likes and comments on the QA
 * seed videos (exact counts), and the global site theme (admin-web's site-theme
 * spec switches it). CI runs every other spec with the job's own accounts, in
 * parallel with other runs; these run in the `shared-state` project only, which
 * e2e-tests.yml runs under the cross-run lock (scripts/ci/qa-lock.ts, qa-global).
 */
const SHARED_STATE_SPECS = /\/(30-watch-page|32-comments|75-site-theme)\.spec\.ts$/;
/** testIgnore of a browser/device project: the dedicated dirs and shared-state specs, plus the upload specs unless this project runs them. */
const browserIgnore = (runsUploads: boolean) =>
  runsUploads && !SKIP_UPLOAD_SPECS ? [...DEDICATED_DIRS, SHARED_STATE_SPECS] : [...DEDICATED_DIRS, SHARED_STATE_SPECS, UPLOAD_SPECS];

/**
 * Load / performance / timing specs (tag @load: speed budgets, parallel-load probes, durations).
 * Owner rule 2026-11-12: functionality gates, load does not. Every run leaves them out; a run
 * with E2E_LOAD=only runs just them (non-blocking jobs: continue-on-error, nightly and releases).
 */
const LOAD_TAG = /@load/;
const LOAD_ONLY = process.env.E2E_LOAD === 'only';

export default defineConfig({
  testDir: './e2e',
  ...(LOAD_ONLY ? { grep: LOAD_TAG } : { grepInvert: LOAD_TAG }),
  /* Visual baselines are OS-independent paths; they are generated on Linux in CI */
  snapshotPathTemplate: '{testDir}/visual/__screenshots__/{projectName}/{arg}{ext}',
  testIgnore: DEDICATED_DIRS,

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
  globalTimeout: process.env.CI ? Number(process.env.E2E_GLOBAL_TIMEOUT_MINUTES || 45) * 60 * 1000 : undefined,
  maxFailures: process.env.CI ? Number(process.env.E2E_MAX_FAILURES || 5) : 0,
  /* Expect timeout */
  expect: {
    timeout: 30000,
  },
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  // E2E_OUTPUT_SUFFIX: a second invocation in the same job (CI runs the
  // shared-state project separately, under the lock) writes next to the first
  // one's results instead of wiping them (test-results-<suffix>, playwright-report-<suffix>)
  outputDir: `test-results${OUTPUT_SUFFIX}`,
  reporter: [
    ['html', { outputFolder: `playwright-report${OUTPUT_SUFFIX}` }],
    ['junit', { outputFile: `test-results${OUTPUT_SUFFIX}/junit.xml` }],
    ['json', { outputFile: `test-results${OUTPUT_SUFFIX}/test-results.json` }],
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

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer
     * Not in CI: most specs run signed in (storageState), and a trace records the E2E users'
     * live QA session cookies in request headers. CI output is a public artifact (this repo is
     * public), and the pre-upload secret scan cannot recognise cookies. Failure video,
     * screenshot and error context still upload. */
    trace: process.env.CI ? 'off' : 'on-first-retry',

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
      testIgnore: browserIgnore(true),
      use: { ...devices['Desktop Chrome'] },
    },

    {
      name: 'firefox',
      testIgnore: browserIgnore(false),
      use: { ...devices['Desktop Firefox'] },
    },

    {
      name: 'webkit',
      testIgnore: browserIgnore(false),
      use: { ...devices['Desktop Safari'] },
    },

    /* Test against mobile viewports. */
    {
      name: 'Mobile Chrome',
      testIgnore: browserIgnore(false),
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'Mobile Safari',
      testIgnore: browserIgnore(false),
      use: { ...devices['iPhone 12'] },
    },

    /* Global-state specs (SHARED_STATE_SPECS): one run at a time, under the qa-global lock */
    {
      name: 'shared-state',
      testMatch: SHARED_STATE_SPECS,
      testIgnore: DEDICATED_DIRS,
      fullyParallel: false,
      use: { ...devices['Desktop Chrome'] },
    },

    /* axe-core WCAG 2.1 AA sweep of every page, en/ar x light/dark */
    {
      name: 'a11y',
      testMatch: /a11y\/.*\.spec\.ts/,
      testIgnore: [],
      use: { ...devices['Desktop Chrome'] },
    },

    /* Visual snapshots of key pages (baselines generated on Linux in CI) */
    {
      name: 'visual',
      testMatch: /visual\/.*\.spec\.ts/,
      testIgnore: [],
      use: { ...devices['Desktop Chrome'] },
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
