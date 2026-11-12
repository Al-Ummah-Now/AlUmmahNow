/**
 * Environment for the admin-web E2E suite. Defaults target QA; every value
 * can be overridden through environment variables. Passwords are never
 * committed: QA_SEED_PASSWORD must come from the environment (CI secret or a
 * local `export QA_SEED_PASSWORD=...`).
 */
import path from 'node:path';
// The one place the suite imports the run-account contract shared with the
// web suites and the workflow teardown (listed in tsconfig.json's include).
import { RUN_USER_DOMAIN, runId, runUserEmail, runUserName } from '../../../web/e2e/test-utils/run-users';

export { runUserEmail };

/**
 * E2E_ENV=local: the local E2E stack (docs/testing/LOCAL-STACK.md) the job booted for itself. Every
 * app is on localhost with the production OAuth client ids (the boot rewrites their redirect URIs),
 * and the job registers every account it signs in with, roles included (support/local-stack.ts).
 */
export const LOCAL_STACK = process.env.E2E_ENV === 'local';
const target = (name: string, qa: string, local: string) => (process.env[name] || (LOCAL_STACK ? local : qa)).replace(/\/$/, '');

export const ADMIN_WEB_URL = target('ADMIN_WEB_URL', 'https://admin.qa.alummahnow.net', 'http://localhost:3091');
export const ADMIN_API_URL = target('ADMIN_API_URL', 'https://admin.api.qa.alummahnow.net', 'http://localhost:3090');
export const VIDEOS_API_URL = target('VIDEOS_API_URL', 'https://videos.api.qa.alummahnow.net', 'http://localhost:3086');
export const OPENAUTH_URL = target('OPENAUTH_URL', 'https://auth.qa.alummahnow.net', 'http://localhost:3301');
export const AUTH_ADMIN_URL = target('AUTH_ADMIN_URL', 'https://admin.auth.qa.alummahnow.net', 'http://localhost:3303');
export const WEB_APP_URL = target('WEB_APP_URL', 'https://videos.qa.alummahnow.net', 'http://localhost:3001');
export const ADMIN_CLIENT_ID =
  process.env.ADMIN_OPENAUTH_CLIENT_ID || (LOCAL_STACK ? 'a24e39de-601d-463b-b50d-37a0a94e986b' : 'b24e39de-601d-463b-b50d-37a0a94e986b');
/** The stack's loopback control API (fake Bunny/Resend, local D1 and R2); local stack only. */
export const STACK_CONTROL_URL = target('LOCAL_STACK_CONTROL_URL', '', 'http://127.0.0.1:3190');
export const CALLBACK_URL = `${ADMIN_WEB_URL}/api/callback`;

export interface Account {
  role: 'superadmin' | 'admin' | 'moderator' | 'nonadmin';
  email: string;
  password: string;
}

function seedPassword(): string {
  const value = process.env.QA_SEED_PASSWORD;
  if (!value) {
    throw new Error('QA_SEED_PASSWORD is not set. Export it (see docs/testing/ADMIN-UI-TEST-PLAN.md) before running the admin suite.');
  }
  return value;
}

/**
 * Run mode (CI sets E2E_RUN_ID): every job signs in with accounts it registered
 * itself (global-setup.ts), so concurrent runs and matrix jobs never share an
 * admin or a viewer. Unset (local runs): the seeded QA accounts, as before.
 */
export const RUN_ID = runId();

/**
 * Local stack in run mode: the moderator and the super admin are this job's
 * own accounts too, their roles granted in the stack's database
 * (support/local-stack.ts). On QA they are the seeds (no test route grants them).
 */
export const LOCAL_RUN_ROLES = LOCAL_STACK && !!RUN_ID;

/**
 * Goes into the name of everything the suite creates (channels, tiers, invites, profiles), so the
 * end-of-job leftover check (scripts/local-stack/leftovers.ts) finds anything a teardown missed.
 */
export const RUN_TAG = RUN_ID ?? 'local';

export const SHARED_STATE_PROJECT = 'shared-state';

/**
 * Skip reason for tests that end sessions (sign out everywhere, revoke): they
 * may only sign in as this job's own run accounts. Outside run mode
 * accounts.admin / accounts.nonadmin are the shared seeds, and signing those
 * out ends every other suite's sessions. Use: test.skip(!RUN_ID, RUN_ACCOUNTS_ONLY).
 * scripts/qa/__tests__/session-killers.test.ts enforces it.
 */
export const RUN_ACCOUNTS_ONLY = 'ends the account\'s sessions everywhere: only with this job\'s own run accounts (E2E_RUN_ID)';

/**
 * The Playwright project this job runs. Global setup and the workers must agree
 * on the run account names before any test has a TestInfo, so it comes from the
 * environment; required in run mode because two jobs with the same name would
 * try to register the same address.
 */
export function adminProject(): string {
  const project = (process.env.E2E_ADMIN_PROJECT ?? '').trim();
  if (RUN_ID && !project) throw new Error('E2E_ADMIN_PROJECT must name the Playwright project in run mode (E2E_RUN_ID is set)');
  return project || 'local';
}

/** run-users.ts name for one of this job's accounts, e.g. admin-webkit-viewer. */
export const runAccountName = (role: string) => `admin-${adminProject()}-${role}`;

/**
 * The address runUserEmail(runAccountName(role)) registers, without recording
 * it again: workers read it on every accounts.* access, global setup records it.
 */
export function runAccountEmail(role: string): string {
  if (!RUN_ID) throw new Error('runAccountEmail needs run mode (E2E_RUN_ID)');
  return `e2e+${RUN_ID}-${runUserName(runAccountName(role))}@${RUN_USER_DOMAIN}`;
}

/** The workflow generates and masks it per run; never logged or written to artifacts. */
export function runPassword(): string {
  const value = process.env.E2E_RUN_USER_PASSWORD;
  if (!value) throw new Error('E2E_RUN_USER_PASSWORD is not set: run mode (E2E_RUN_ID) registers its own accounts with it');
  return value;
}

/** The seeded QA viewer, for specs that need its existing videos profile even in run mode. */
export const SEED_VIEWER_EMAIL = process.env.QA_NONADMIN_EMAIL || 'qa-viewer@delivered.resend.dev';

export const accounts = {
  /** Seeded QA super admin (seed-qa.ts): super-admin-only flows such as channel transfer. */
  get superadmin(): Account {
    if (LOCAL_RUN_ROLES) return { role: 'superadmin', email: runAccountEmail('superadmin'), password: runPassword() };
    return { role: 'superadmin', email: process.env.QA_SUPERADMIN_EMAIL || 'qa-superadmin@delivered.resend.dev', password: seedPassword() };
  },
  get admin(): Account {
    if (RUN_ID) return { role: 'admin', email: runAccountEmail('admin'), password: runPassword() };
    return { role: 'admin', email: process.env.QA_ADMIN_EMAIL || 'qa-admin@delivered.resend.dev', password: seedPassword() };
  },
  get moderator(): Account {
    // QA: the seed, as there is no moderator promote there. It only acts on
    // reports this run filed, so sharing it across runs is safe. The local
    // stack grants the role to this job's own account.
    if (LOCAL_RUN_ROLES) return { role: 'moderator', email: runAccountEmail('moderator'), password: runPassword() };
    return {
      role: 'moderator',
      email: process.env.QA_MODERATOR_EMAIL || 'qa-moderator@delivered.resend.dev',
      password: seedPassword(),
    };
  },
  get nonadmin(): Account {
    // No admin role; it also files the test reports.
    if (RUN_ID) return { role: 'nonadmin', email: runAccountEmail('viewer'), password: runPassword() };
    return {
      role: 'nonadmin',
      email: SEED_VIEWER_EMAIL,
      password: process.env.QA_NONADMIN_PASSWORD || seedPassword(),
    };
  },
};

export const AUTH_DIR = path.join(__dirname, '..', '.auth');
export const storageStatePath = (role: Account['role']) => path.join(AUTH_DIR, `${role}.json`);
export const TOKENS_PATH = path.join(AUTH_DIR, 'tokens.json');

/** Every e2e report's entity id starts with this, whichever run filed it. */
export const E2E_ENTITY_ROOT = 'e2e-admin-';
/**
 * Prefix for every entity id this job reports, so leftovers can be found and
 * closed. Run mode adds the run and project: setup, teardown and specs then
 * only touch this job's reports, never those of a job running alongside.
 */
export const E2E_ENTITY_PREFIX = RUN_ID ? `${E2E_ENTITY_ROOT}${RUN_ID}-${adminProject()}-` : E2E_ENTITY_ROOT;
export const E2E_DESCRIPTION_TAG = '[e2e-admin]';
