import { defineConfig, devices } from '@playwright/test';
import { SPEC_PLACEMENT } from './e2e/test-utils/placement';

/**
 * Release regressions: small, independent of the legacy suite's seeded users and
 * global setup. Every spec registers its own sink user. E2E_ENV=qa|stage picks
 * the target; codes come from the auth server's E2E sink (E2E_CODE_SINK_SECRET),
 * admin promotion uses TEST_PROMOTE_SECRET. Needs only @playwright/test.
 */
const PLAYER = /player\.spec\.ts$/;
/**
 * Specs that run in Chrome, Firefox and WebKit (the defect they pin showed in
 * every browser). Branded Chrome, not the bundled Chromium: they open the watch
 * page, and Chromium's missing H.264 decoder logs player errors of its own.
 */
const ALL_BROWSERS = /(anonymous-console|realtime-toasts|admin-content|embed-frame-sound|studio-[\w-]+)\.spec\.ts$/;
/**
 * The control-bar layout and progress-track specs also run in Firefox and WebKit when asked, locally:
 * RELEASE_PLAYER_BROWSERS=firefox,webkit (layout only, so the browsers' own decoders suffice).
 * PLAYER_FIREFOX_PATH runs the installed Firefox over WebDriver BiDi instead of Playwright's build,
 * as playwright.player.config.ts does.
 */
const BAR_ROW = /player-(bar-row|track)\.player\.spec\.ts$/;
/**
 * Specs that change state no run owns: errors.spec.ts reopens, resolves and
 * deletes the shared test error group; site-theme.spec.ts switches the global
 * site theme. CI (release-e2e.yml) runs the suite with E2E_SHARED_STATE=skip,
 * then these alone with E2E_SHARED_STATE=only under the cross-run qa-global lock
 * (scripts/ci/qa-lock.ts), so concurrent PR runs never collide on them. Unset
 * (local runs): everything in one go, as before.
 */
const SHARED_STATE = /\/(errors|site-theme)\.spec\.ts$/;
const SHARED_MODE = process.env.E2E_SHARED_STATE;
/**
 * Specs that wait for Bunny to encode an upload (ready within ~9 min). They share
 * one encode queue with every other run on the QA/stage library, so CI
 * (release-e2e.yml) runs them in their own step under a cross-run lock with a
 * few slots (scripts/ci/qa-lock.ts --slots, #838): E2E_ENCODE=skip in the main
 * step, =only in that step. Unset (local runs): everything together.
 */
const ENCODE_SPECS = '(bulk-rename-edit|upload-modes|studio-draft-path|display-name|embed-frame-sound)\\.spec\\.ts|processing\\.player\\.spec\\.ts';
const ENCODE = new RegExp(`/(${ENCODE_SPECS})$`);
const NOT_ENCODE = new RegExp(`^(?!.*/(${ENCODE_SPECS})$)`);
const ENCODE_MODE = process.env.E2E_ENCODE;
/** The encode split applied to a project's ignore list. */
const encodeIgnore = (ignore: RegExp[]): RegExp[] =>
  ENCODE_MODE === 'skip' ? [...ignore, ENCODE] : ENCODE_MODE === 'only' ? [...ignore, NOT_ENCODE] : ignore;
const OUTPUT_SUFFIX = /^[a-z0-9-]{1,32}$/.test(process.env.E2E_OUTPUT_SUFFIX ?? '') ? `-${process.env.E2E_OUTPUT_SUFFIX}` : '';
const EXTRA_BROWSERS = (process.env.RELEASE_PLAYER_BROWSERS ?? '').split(',').map((b) => b.trim()).filter(Boolean);
const EXTRA_DEVICES = {
  firefox: process.env.PLAYER_FIREFOX_PATH
    ? {
        ...devices['Desktop Firefox'],
        browserName: '_bidiFirefox' as 'firefox',
        launchOptions: { executablePath: process.env.PLAYER_FIREFOX_PATH },
      }
    : devices['Desktop Firefox'],
  webkit: devices['Desktop Safari'],
} as const;

/**
 * Load / performance / timing specs (tag @load: speed budgets, parallel-load probes, durations).
 * Owner rule 2026-11-12: functionality gates, load does not. Every run leaves them out; a run
 * with E2E_LOAD=only runs just them (non-blocking jobs: continue-on-error, nightly and releases).
 */
/**
 * E2E_ENV=local: the local E2E stack (docs/testing/LOCAL-STACK.md), booted by the job itself. Only
 * the specs placed `local` (e2e/test-utils/placement.ts) run there; the browser goes through the
 * stack's proxy, which answers the faked third-party HTTPS hosts (Bunny CDN, image host) with a
 * self-signed certificate and refuses every other non-local host.
 */
const LOCAL = process.env.E2E_ENV === 'local';
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const releaseSpecs = (placement: 'local' | 'deployed') =>
  Object.keys(SPEC_PLACEMENT)
    .filter((p) => p.startsWith('apps/web/e2e/release/') && SPEC_PLACEMENT[p].placement === placement)
    .map((p) => escape(p.slice('apps/web/e2e/release/'.length)));
const DEPLOYED_ONLY = new RegExp(`/(${releaseSpecs('deployed').join('|')})$`);
const LOCAL_USE = LOCAL ? { proxy: { server: 'http://127.0.0.1:3191', bypass: 'localhost,127.0.0.1' }, ignoreHTTPSErrors: true } : {};

const LOAD_TAG = /@load/;
const LOAD_ONLY = process.env.E2E_LOAD === 'only';

export default defineConfig({
  testDir: './e2e/release',
  ...(LOAD_ONLY ? { grep: LOAD_TAG } : { grepInvert: LOAD_TAG }),
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // One retry, never more. A test that needs it is reported as flaky (job summary, annotation) and
  // the nightly 3x run files an issue for it. The nightly run itself has no retries (E2E_RETRIES=0).
  retries: process.env.CI ? (process.env.E2E_RETRIES === '0' ? 0 : 1) : 0,
  workers: 4,
  timeout: 180000,
  expect: { timeout: 20000 },
  // A second invocation in the same job (the shared-state specs) writes next to the first one's output
  outputDir: `test-results${OUTPUT_SUFFIX}`,
  // outcome-reporter: failed and flaky tests in the job summary, release-outcomes*.json for the nightly job
  reporter: process.env.CI
    ? [['github'], ['list'], ['html', { outputFolder: `release-report${OUTPUT_SUFFIX}`, open: 'never' }], ['./e2e/release/outcome-reporter.ts']]
    : [['list'], ['./e2e/release/outcome-reporter.ts']],
  use: {
    actionTimeout: 15000,
    navigationTimeout: 30000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...LOCAL_USE,
  },
  projects: SHARED_MODE === 'only' ? [{ name: 'shared-state', testMatch: SHARED_STATE, use: { ...devices['Desktop Chrome'] } }] : ([
    {
      name: 'auth-flows',
      testIgnore: SHARED_MODE === 'skip' ? [PLAYER, ALL_BROWSERS, SHARED_STATE] : [PLAYER, ALL_BROWSERS],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // Real playback: bundled Chromium has no H.264 decoder for the HLS streams
      name: 'player',
      testMatch: PLAYER,
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
    { name: 'chrome', testMatch: ALL_BROWSERS, use: { ...devices['Desktop Chrome'], channel: 'chrome' } },
    { name: 'firefox', testMatch: ALL_BROWSERS, use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', testMatch: ALL_BROWSERS, use: { ...devices['Desktop Safari'] } },
    ...EXTRA_BROWSERS.filter((b): b is keyof typeof EXTRA_DEVICES => b in EXTRA_DEVICES).flatMap((b) =>
      b === 'firefox'
        ? [
            { name: 'player-firefox', testMatch: BAR_ROW, grepInvert: /, touch\)/, use: { ...EXTRA_DEVICES.firefox } },
            {
              // Firefox's hasTouch leaves (pointer: coarse) off; its pointer prefs turn it on
              // (1 = coarse, no hover). Prefs are per browser, so touch gets its own project.
              name: 'player-firefox-coarse',
              testMatch: BAR_ROW,
              grep: /, touch\)/,
              use: {
                ...EXTRA_DEVICES.firefox,
                launchOptions: {
                  ...('launchOptions' in EXTRA_DEVICES.firefox ? EXTRA_DEVICES.firefox.launchOptions : {}),
                  firefoxUserPrefs: { 'ui.primaryPointerCapabilities': 1, 'ui.allPointerCapabilities': 1 },
                },
              },
            },
          ]
        : [{ name: `player-${b}`, testMatch: BAR_ROW, use: { ...EXTRA_DEVICES[b] } }],
    ),
  ] as Array<{ name: string; testIgnore?: RegExp | RegExp[] } & Record<string, unknown>>).map((project) => ({
    ...project,
    testIgnore: encodeIgnore([...(project.testIgnore === undefined ? [] : ([] as RegExp[]).concat(project.testIgnore)), ...(LOCAL ? [DEPLOYED_ONLY] : [])]),
  })),
});
