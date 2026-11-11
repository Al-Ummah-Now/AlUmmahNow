/** Shared helpers for the Studio release specs. */
import { expect, test } from '@playwright/test';
import { apiFetch, createProfile, menuTrigger, signUpOnWeb, type Locale, type WebUser } from './web-session';
import { target } from './targets';
import { grantCreatorTier } from './creator-tier';
import type { Page } from '@playwright/test';

/**
 * PR checks run against QA, which follows main, so a Studio spec can run before
 * its pages are deployed. Skip with a reason until /studio answers there.
 */
export async function skipUntilStudioDeployed(): Promise<void> {
  const res = await fetch(`${target().web}/en/studio`, { redirect: 'manual' });
  test.skip(res.status === 404, 'Studio is not deployed to this environment yet');
}

/**
 * After the spec changed the account behind the app's back (profile, tier and
 * channel made through the API), loads the home page and waits until the header
 * has loaded that session (its account menu shows), so the next page.goto starts
 * from a settled page. The post-sign-up redirect itself is waited for by
 * signUpOnWeb (web-session.ts settleSignIn).
 */
export async function settleSession(page: Page, locale: Locale = 'en'): Promise<void> {
  await page.goto(`${target().web}/${locale}`);
  await expect(menuTrigger(page)).toBeVisible({ timeout: 45000 });
}

export async function studioOwner(page: Page, prefix: string, locale: Locale = 'en'): Promise<{ user: WebUser; channelId: string }> {
  const user = await signUpOnWeb(page, prefix, locale);
  await createProfile(user);
  // Channels and uploads are by invitation (creator tiers)
  await grantCreatorTier(user);
  const res = await apiFetch(user, '/api/channels', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `Release Studio ${Date.now().toString(36)}`, description: 'Created by the release E2E suite', isMain: true }),
  });
  const text = await res.text();
  expect(res.status, `POST /api/channels: ${text}`).toBeLessThan(300);
  const channelId = (JSON.parse(text) as { result?: { channel?: { id?: string } } }).result?.channel?.id;
  expect(channelId, 'channel create returned no id').toBeTruthy();
  await settleSession(page, locale);
  return { user, channelId: channelId as string };
}

/** A video record on the channel (upload started, no bytes sent): it lists under Processing. */
export async function studioDraftRecord(user: WebUser, channelId: string, title: string): Promise<string> {
  const res = await apiFetch(user, '/api/videos/upload/initiate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', channelId },
    body: JSON.stringify({ title, description: 'Created by the release E2E suite', isPublic: false, fileSize: 1024, mimeType: 'video/mp4' }),
  });
  const text = await res.text();
  expect(res.status, `POST /api/videos/upload/initiate: ${text}`).toBeLessThan(300);
  const id = (JSON.parse(text) as { result?: { videoId?: string } }).result?.videoId;
  expect(id, 'upload initiate returned no video id').toBeTruthy();
  return id as string;
}
