/**
 * Where the release regressions run (docs/release-pipeline/SPEC.md §7).
 * E2E_ENV=qa on PRs, E2E_ENV=stage in the release workflow. Never production:
 * these specs create accounts.
 */
export type ReleaseEnv = 'qa' | 'stage';

const TARGETS: Record<ReleaseEnv, { web: string; auth: string }> = {
  qa: { web: 'https://videos.qa.alummahnow.net', auth: 'https://auth.qa.alummahnow.net' },
  stage: { web: 'https://videos.stage.alummahnow.net', auth: 'https://auth.stage.alummahnow.net' },
};

export function releaseEnv(): ReleaseEnv {
  const env = process.env.E2E_ENV ?? 'qa';
  if (env !== 'qa' && env !== 'stage') throw new Error(`E2E_ENV must be qa or stage, got "${env}"`);
  return env;
}

export const target = () => ({ ...TARGETS[releaseEnv()], ...(process.env.WEB_APP_URL ? { web: process.env.WEB_APP_URL } : {}) });

/** Sink addresses: the auth server stores their codes for the test instead of emailing them. */
export function sinkEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.alummahnow.net`;
}

export const TEST_PASSWORD = 'Release-Test-Pass-1!';
