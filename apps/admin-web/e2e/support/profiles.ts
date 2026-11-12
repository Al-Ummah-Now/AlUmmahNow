/**
 * Videos profiles for this job's accounts: the admin's user pages, Creators
 * list and owner picker only list users with one, and a run account has none
 * until a spec creates it.
 */
import crypto from 'node:crypto';
import type { Browser } from '@playwright/test';
import { RUN_ID, VIDEOS_API_URL, runAccountName, runPassword, runUserEmail, type Account } from './env';
import { getAccessToken } from './oauth';
import { registerSinkUser } from './run-accounts';

export interface VideosProfile {
  id: string;
  email: string;
  userName: string;
  displayName: string;
}

/** Creates the videos profile of the account `token` belongs to (POST /api/profiles, as the web app does). */
export async function createVideosProfile(token: string, email: string, displayName: string): Promise<VideosProfile> {
  const userName = `e2e_admin_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
  const res = await fetch(`${VIDEOS_API_URL}/api/profiles`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ email, userName, displayName, timezone: 'UTC' }),
  });
  const text = await res.text();
  if (res.status >= 300) throw new Error(`create the videos profile of ${email} -> ${res.status} ${text.slice(0, 200)}`);
  const id = (JSON.parse(text) as { result?: { profile?: { id?: string } } }).result?.profile?.id;
  if (!id) throw new Error(`the videos profile of ${email} came back without an id`);
  return { id, email, userName, displayName };
}

let counter = 0;

/**
 * A new account of this job (run mode: a recorded run address the workflow
 * deletes) with a videos profile, for specs that need a second user, such as
 * the new owner of a channel transfer.
 */
export async function createRunUser(browser: Browser, label: string, displayName: string): Promise<VideosProfile & { account: Account }> {
  if (!RUN_ID) throw new Error('createRunUser needs run mode (E2E_RUN_ID)');
  const email = runUserEmail(runAccountName(`${label}-${process.pid}-${++counter}`));
  const account: Account = { role: 'nonadmin', email, password: runPassword() };
  await registerSinkUser(browser, email, account.password);
  const profile = await createVideosProfile(await getAccessToken(account), email, displayName);
  return { ...profile, account };
}
