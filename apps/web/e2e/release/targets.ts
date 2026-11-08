/**
 * Where the release regressions run. E2E_ENV=qa on PRs, E2E_ENV=stage in the
 * release workflow. Never production: these specs create accounts and data.
 */
export type ReleaseEnv = 'qa' | 'stage';

export interface Target {
  web: string;
  api: string;
  adminWeb: string;
  adminApi: string;
  auth: string;
  profile: string;
}

const TARGETS: Record<ReleaseEnv, Target> = {
  qa: {
    web: 'https://videos.qa.alummahnow.net',
    api: 'https://videos.api.qa.alummahnow.net',
    adminWeb: 'https://admin.qa.alummahnow.net',
    adminApi: 'https://admin.api.qa.alummahnow.net',
    auth: 'https://auth.qa.alummahnow.net',
    profile: 'https://profile.auth.qa.alummahnow.net',
  },
  stage: {
    web: 'https://videos.stage.alummahnow.net',
    api: 'https://videos.api.stage.alummahnow.net',
    adminWeb: 'https://admin.stage.alummahnow.net',
    adminApi: 'https://admin.api.stage.alummahnow.net',
    auth: 'https://auth.stage.alummahnow.net',
    profile: 'https://profile.auth.stage.alummahnow.net',
  },
};

export function releaseEnv(): ReleaseEnv {
  const env = process.env.E2E_ENV ?? 'qa';
  if (env !== 'qa' && env !== 'stage') throw new Error(`E2E_ENV must be qa or stage, got "${env}"`);
  return env;
}

export const target = (): Target => ({
  ...TARGETS[releaseEnv()],
  ...(process.env.WEB_APP_URL ? { web: process.env.WEB_APP_URL } : {}),
});

/** Sink addresses: the auth server stores their codes for the test instead of emailing them. */
export function sinkEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.alummahnow.net`;
}

export const TEST_PASSWORD = 'Release-Test-Pass-1!';
