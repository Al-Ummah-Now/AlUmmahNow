import { appendFileSync } from 'fs';
import { randomBytes } from 'crypto';

/**
 * Where the release regressions run. E2E_ENV=qa on PRs, E2E_ENV=stage in the
 * release workflow. E2E_ENV=production only from prod-signed-in.yml, which runs
 * the signed-in specs alone: every user is a test-release-*@delivered.resend.dev
 * address listed in PROD_USER_FILE before it exists, and the workflow deletes
 * them all afterwards (scripts/release/delete-test-user.ts). The other specs
 * create data and never run there.
 */
export type ReleaseEnv = 'qa' | 'stage' | 'production';

export interface Target {
  web: string;
  api: string;
  adminWeb: string;
  adminApi: string;
  auth: string;
  profile: string;
  /** Auth server admin app. */
  authAdmin: string;
  /** Public website (AlUmmahNowUI). */
  www: string;
  cms: string;
}

const TARGETS: Record<ReleaseEnv, Target> = {
  qa: {
    web: 'https://videos.qa.alummahnow.net',
    api: 'https://videos.api.qa.alummahnow.net',
    adminWeb: 'https://admin.qa.alummahnow.net',
    adminApi: 'https://admin.api.qa.alummahnow.net',
    auth: 'https://auth.qa.alummahnow.net',
    profile: 'https://profile.auth.qa.alummahnow.net',
    authAdmin: 'https://admin.auth.qa.alummahnow.net',
    www: 'https://www.qa.alummahnow.net',
    cms: 'https://cms.qa.alummahnow.net',
  },
  stage: {
    web: 'https://videos.stage.alummahnow.net',
    api: 'https://videos.api.stage.alummahnow.net',
    adminWeb: 'https://admin.stage.alummahnow.net',
    adminApi: 'https://admin.api.stage.alummahnow.net',
    auth: 'https://auth.stage.alummahnow.net',
    profile: 'https://profile.auth.stage.alummahnow.net',
    authAdmin: 'https://admin.auth.stage.alummahnow.net',
    www: 'https://www.stage.alummahnow.net',
    cms: 'https://cms.stage.alummahnow.net',
  },
  production: {
    web: 'https://videos.alummahnow.net',
    api: 'https://videos.api.alummahnow.net',
    adminWeb: 'https://admin.alummahnow.net',
    adminApi: 'https://admin.api.alummahnow.net',
    auth: 'https://auth.alummahnow.net',
    profile: 'https://profile.auth.alummahnow.net',
    authAdmin: 'https://admin.auth.alummahnow.net',
    www: 'https://www.alummahnow.net',
    cms: 'https://cms.alummahnow.net',
  },
};

export function releaseEnv(): ReleaseEnv {
  const env = process.env.E2E_ENV ?? 'qa';
  if (env === 'production') {
    // No cleanup list, no production run: every account must be deletable afterwards
    if (!process.env.PROD_USER_FILE) throw new Error('E2E_ENV=production needs PROD_USER_FILE (prod-signed-in.yml)');
    return env;
  }
  if (env !== 'qa' && env !== 'stage') throw new Error(`E2E_ENV must be qa, stage or production, got "${env}"`);
  return env;
}

export const target = (): Target => ({
  ...TARGETS[releaseEnv()],
  ...(process.env.WEB_APP_URL ? { web: process.env.WEB_APP_URL } : {}),
  ...(process.env.ADMIN_WEB_APP_URL ? { adminWeb: process.env.ADMIN_WEB_APP_URL } : {}),
  ...(process.env.ADMIN_API_APP_URL ? { adminApi: process.env.ADMIN_API_APP_URL } : {}),
});

/**
 * Sink addresses: the auth server stores their codes for the test instead of emailing them.
 * Production has no sink: there it is a Resend test address (codes read through the
 * Resend API, sink.ts), recorded in PROD_USER_FILE for deletion before it is used.
 * The prefix is dropped there (delete-test-user.ts only accepts test-release-<ms>-<hex>).
 */
export function sinkEmail(prefix: string): string {
  if (releaseEnv() === 'production') {
    const email = `test-release-${Date.now()}-${randomBytes(3).toString('hex')}@delivered.resend.dev`;
    appendFileSync(process.env.PROD_USER_FILE as string, `${email}\n`);
    return email;
  }
  // CI's run tag (release-e2e.yml E2E_RUN_TAG) lets the upload budget count this run's users
  const tag = /^[a-z0-9]{1,24}$/.test(process.env.E2E_RUN_TAG ?? '') ? `${process.env.E2E_RUN_TAG}-` : '';
  return `${prefix}-${tag}${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.alummahnow.net`;
}

/**
 * Random per run: every user is created and used inside one test, so nothing
 * needs it later, and the accounts left behind on QA/stage (including promoted
 * admins; the auth server has no demote route) cannot be signed into with a
 * password from the repo. CI generates E2E_TEST_PASSWORD so the artifact scan
 * (scripts/ci/scan-artifacts-for-secrets.py) can look for it; otherwise it is
 * random per worker process.
 */
export const TEST_PASSWORD = process.env.E2E_TEST_PASSWORD || `Rel-${randomBytes(12).toString('base64url')}-1!`;
