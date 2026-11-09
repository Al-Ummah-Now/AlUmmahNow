/** Shared helpers for the Studio release specs. */
import { expect, test } from '@playwright/test';
import { apiFetch, createProfile, signUpOnWeb, type Locale, type WebUser } from './web-session';
import { target } from './targets';
import type { Page } from '@playwright/test';

/**
 * PR checks run against QA, which follows main, so a Studio spec can run before
 * its pages are deployed. Skip with a reason until /studio answers there.
 */
export async function skipUntilStudioDeployed(): Promise<void> {
  const res = await fetch(`${target().web}/en/studio`, { redirect: 'manual' });
  test.skip(res.status === 404, 'Studio is not deployed to this environment yet');
}

export async function studioOwner(page: Page, prefix: string, locale: Locale = 'en'): Promise<{ user: WebUser; channelId: string }> {
  const user = await signUpOnWeb(page, prefix, locale);
  await createProfile(user);
  const res = await apiFetch(user, '/api/channels', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `Release Studio ${Date.now().toString(36)}`, description: 'Created by the release E2E suite', isMain: true }),
  });
  const text = await res.text();
  expect(res.status, `POST /api/channels: ${text}`).toBeLessThan(300);
  const channelId = (JSON.parse(text) as { result?: { channel?: { id?: string } } }).result?.channel?.id;
  expect(channelId, 'channel create returned no id').toBeTruthy();
  return { user, channelId: channelId as string };
}
