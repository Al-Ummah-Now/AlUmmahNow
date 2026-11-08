/**
 * Logs in the admin, moderator and non-admin QA accounts through the real
 * auth server, saves their storage states, fetches API tokens for fixtures and
 * seeds enough reports to exercise pagination.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type FullConfig } from '@playwright/test';
import { ADMIN_WEB_URL, AUTH_DIR, TOKENS_PATH, accounts, storageStatePath, type Account } from './support/env';
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

export default async function globalSetup(_config: FullConfig) {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  const reuse = process.env.E2E_REUSE_AUTH === '1';
  const maxAge = 60 * 60 * 1000;
  const all = [accounts.admin, accounts.moderator, accounts.nonadmin];

  await Promise.all(
    all.map(async (account) => {
      if (reuse && fresh(storageStatePath(account.role), maxAge)) return;
      await saveStorageState(account);
    }),
  );

  if (!(reuse && fresh(TOKENS_PATH, maxAge))) {
    const [admin, moderator, reporter] = await Promise.all(all.map((a) => getAccessToken(a)));
    fs.writeFileSync(TOKENS_PATH, JSON.stringify({ admin, moderator, reporter }, null, 2));
  }

  // Close anything a previous, aborted run left open, then seed the
  // pagination fixture (> one page of pending comment reports).
  await closeOpenE2eReports();
  for (let i = 0; i < PAGINATION_REPORTS; i += 7) {
    const batch = Math.min(7, PAGINATION_REPORTS - i);
    await Promise.all(Array.from({ length: batch }, () => createReport({ label: PAGINATION_LABEL, entityType: 'comment' })));
  }
  fs.writeFileSync(path.join(AUTH_DIR, 'run.json'), JSON.stringify({ seededAt: new Date().toISOString() }));
}
