/**
 * The web suite's specs (apps/web/playwright.config.ts) that have moved to the local stack
 * (local-e2e.yml, docs/testing/LOCAL-STACK.md), sub-batch by sub-batch. With E2E_ENV=local the
 * config runs only these; against QA (e2e-tests.yml) it leaves them out. A spec is added here
 * once it is green on the local stack and seeds its own data (release/builders.ts or the run's
 * own accounts from auth.setup.ts). Paths are relative to apps/web/e2e.
 *
 * Plain data, no imports.
 */
export const LOCAL_WEB_SPECS: readonly string[] = [
  // Sub-batch 1: pages, navigation, sessions and guards
  '01-homepage.spec.ts',
  '03-profile.spec.ts',
  '04-channels.spec.ts',
  '05-accessibility.spec.ts',
  '06-navigation.spec.ts',
  '08-unified-navigation.spec.ts',
  '09-channel-switching.spec.ts',
  '10-profile-guard-debug.spec.ts',
  '11-account-switching.spec.ts',
  '11-profile-guard-redirect.spec.ts',
  '22-explore.spec.ts',
  '34-live.spec.ts',
  '35-errors-404.spec.ts',
  '50-channels-directory.spec.ts',
  '65-consent-banner.spec.ts',
  '72-real-sign-in.spec.ts',
  '75-site-theme.spec.ts',
];
