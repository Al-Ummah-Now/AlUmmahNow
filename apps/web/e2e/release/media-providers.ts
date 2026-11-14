/**
 * Shared steps of the media provider specs (docs/media-delivery/PROVIDERS.md), local stack only:
 * per-channel provider overrides through api-videos' internal route (the one admin-api's Delivery
 * settings call), a channel made in the account menu, and a fresh copy of the sample clip.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { expect, type Page } from '@playwright/test';
import { target } from './targets';
import { apiFetch, type WebUser } from './web-session';
import { submitNewChannelInMenu } from './account-menu';

const CLIP = path.join(__dirname, '..', 'test-fixtures', 'e2e-sample.mp4');
export const CONTROL = process.env.LOCAL_STACK_CONTROL_URL || 'http://127.0.0.1:3190';
/** The local stack's internal key (scripts/local-stack/stack.ts LOCAL_SECRETS): never a deployed value */
const LOCAL_INTERNAL_KEY = 'local-stack-internal-key';
export const MEDIA_HOST = 'media.local-stack.test';

export function freshClip(): string {
  const file = path.join(os.tmpdir(), `e2e-media-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}.mp4`);
  fs.copyFileSync(CLIP, file);
  return file;
}

export async function internal(pathname: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${target().api}/internal/media${pathname}`, { ...init, headers: { 'content-type': 'application/json', 'X-API-Key': LOCAL_INTERNAL_KEY, ...(init.headers ?? {}) } });
}

export type Settings = { channels?: Record<string, unknown> } & Record<string, unknown>;

export async function readSettings(): Promise<Settings> {
  const res = await internal('/providers');
  expect(res.ok, `GET providers: ${res.status}`).toBe(true);
  return ((await res.json()) as { result: { settings: Settings } }).result.settings;
}

export async function writeSettings(settings: Settings): Promise<void> {
  const res = await internal('/providers', { method: 'PUT', body: JSON.stringify({ settings, actorId: 'e2e-media-providers' }) });
  expect(res.ok, `PUT providers: ${res.status} ${await res.text()}`).toBe(true);
}

export async function createChannelInMenu(page: Page, user: WebUser, name: string): Promise<string> {
  await page.context().addCookies([{ name: 'aun_consent', value: `v1.a0.e0.p0.${Date.now()}`, url: target().web, sameSite: 'Lax' }]);
  await page.goto(`${target().web}/en`);
  await submitNewChannelInMenu(page, name);
  let channelId = '';
  await expect
    .poll(async () => {
      const body = (await (await apiFetch(user, '/api/channels?limit=100')).json().catch(() => ({}))) as { data?: Array<{ id: string; name: string }> };
      channelId = body.data?.find((c) => c.name === name)?.id ?? '';
      return channelId;
    }, { timeout: 30000 })
    .not.toBe('');
  return channelId;
}

/** Take this spec's channel override out of the settings again (whatever else changed meanwhile). */
export async function removeChannelOverride(channelId: string): Promise<void> {
  const now = await readSettings();
  const { [channelId]: _mine, ...others } = (now.channels ?? {}) as Record<string, unknown>;
  await writeSettings({ ...now, channels: others });
}
