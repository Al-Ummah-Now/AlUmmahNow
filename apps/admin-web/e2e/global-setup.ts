/**
 * Logs in the super admin, admin, moderator and non-admin accounts through the
 * real auth server (run mode: this job's own admin and viewer), saves their
 * storage states, fetches API tokens for fixtures and
 * seeds enough reports to exercise pagination.
 *
 * Run mode (E2E_RUN_ID, CI): the admin and the non-admin are first registered
 * for this job (support/env.ts names them), the admin promoted, so concurrent
 * runs never share them. The workflow deletes every recorded run account when
 * the job ends. Local runs keep using the seeded QA accounts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type FullConfig } from '@playwright/test';
import {
  ADMIN_WEB_URL,
  AUTH_DIR,
  RUN_ID,
  SHARED_STATE_PROJECT,
  TOKENS_PATH,
  accounts,
  adminProject,
  runAccountEmail,
  runAccountName,
  runUserEmail,
  storageStatePath,
  type Account,
} from './support/env';
import { promoteToAdmin, registerSinkUser } from './support/run-accounts';
import { getAccessToken } from './support/oauth';
import { closeOpenE2eReports, createReport } from './support/api';
import { uiLogin } from './support/ui';

export const PAGINATION_LABEL = 'page';
export const PAGINATION_REPORTS = 21;

function fresh(file: string, maxAgeMs: number) {
  try {
    return Date.now() - fs.statSync(file).mtimeMs < maxAgeMs;
  } catch {
    return false;
  }
}

async function saveStorageState(account: Account) {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL: ADMIN_WEB_URL });
    const page = await context.newPage();
    const expected = account.role === 'nonadmin' ? /\/access-denied$/ : /\/dashboard$/;
    await uiLogin(page, account, expected);
    await context.storageState({ path: storageStatePath(account.role) });
  } finally {
    await browser.close();
  }
}

/**
 * Registers this job's admin and viewer (recorded for the teardown first) and
 * promotes the admin, before anything signs in: tokens carry the roles the
 * account had at sign-in.
 */
async function registerRunAccounts() {
  const browser = await chromium.launch();
  try {
    await Promise.all(
      [
        { role: 'admin', account: accounts.admin },
        { role: 'viewer', account: accounts.nonadmin },
      ].map(async ({ role, account }) => {
        const email = runUserEmail(runAccountName(role));
        if (email !== runAccountEmail(role)) throw new Error(`run account address mismatch for ${role}`);
        await registerSinkUser(browser, email, account.password);
        if (role === 'admin') await promoteToAdmin(email);
      }),
    );
  } finally {
    await browser.close();
  }
}

export default async function globalSetup(_config: FullConfig) {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  if (RUN_ID) await registerRunAccounts();
  const reuse = !RUN_ID && process.env.E2E_REUSE_AUTH === '1';
  const maxAge = 60 * 60 * 1000;
  const all = [accounts.admin, accounts.moderator, accounts.nonadmin, accounts.superadmin];

  await Promise.all(
    all.map(async (account) => {
      if (reuse && fresh(storageStatePath(account.role), maxAge)) return;
      await saveStorageState(account);
    }),
  );

  if (!(reuse && fresh(TOKENS_PATH, maxAge))) {
    const [admin, moderator, reporter, superadmin] = await Promise.all(all.map((a) => getAccessToken(a)));
    fs.writeFileSync(TOKENS_PATH, JSON.stringify({ admin, moderator, reporter, superadmin }, null, 2));
  }

  // Close anything a previous, aborted run left open, then seed the
  // pagination fixture (> one page of pending comment reports). The
  // shared-state specs do not use it, so that job files no reports.
  await closeOpenE2eReports();
  if (adminProject() !== SHARED_STATE_PROJECT) {
    for (let i = 0; i < PAGINATION_REPORTS; i += 7) {
      const batch = Math.min(7, PAGINATION_REPORTS - i);
      await Promise.all(Array.from({ length: batch }, () => createReport({ label: PAGINATION_LABEL, entityType: 'comment' })));
    }
  }
  fs.writeFileSync(path.join(AUTH_DIR, 'run.json'), JSON.stringify({ seededAt: new Date().toISOString() }));
}
