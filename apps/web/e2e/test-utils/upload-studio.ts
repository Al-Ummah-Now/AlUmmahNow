import { expect, type Locator, type Page } from '@playwright/test';
import { type AuthUser } from './auth-state';
import { listOwnVideos, userApi, deleteVideoQuietly, type E2EVideo } from './e2e-videos';

/**
 * Helpers for the creator-studio specs (40-46): upload templates, schedules
 * and colour checks. Everything here works against the real QA API with the
 * stored E2E sessions; every helper that creates something has a matching
 * cleanup helper.
 */

export const ARABIC = /[؀-ۿ]/;

/** Unique, recognisable name for something a single test owns */
export function tempName(label: string): string {
  return `E2E Temp ${label} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// ---------------------------------------------------------------- templates

export interface TemplateRecord {
  id: string;
  name: string;
  isDefault?: boolean;
  template: { title?: string; description?: string; tags?: string[]; category?: string; visibility?: string };
}

export async function listTemplates(user: AuthUser): Promise<TemplateRecord[]> {
  const u = userApi(user);
  const res = await u.api.get<{ result?: { templates?: TemplateRecord[] } }>('/api/upload-defaults', { token: u.token });
  return res.data.result?.templates || [];
}

export async function createTemplate(
  user: AuthUser,
  body: { name: string; nameLocalized?: { en: string; ar: string }; isDefault?: boolean; template: Record<string, unknown> },
): Promise<TemplateRecord> {
  const u = userApi(user);
  const res = await u.api.post<{ result?: { template?: TemplateRecord } }>('/api/upload-defaults', body, { token: u.token });
  const template = res.data.result?.template;
  if (!template) throw new Error(`Creating template "${body.name}" returned no template`);
  return template;
}

export async function deleteTemplateQuietly(user: AuthUser, id: string | undefined | null): Promise<void> {
  if (!id) return;
  try {
    const u = userApi(user);
    await u.api.request(`/api/upload-defaults/${id}`, { method: 'DELETE', token: u.token, allowStatus: [400, 403, 404] });
  } catch {
    // cleanup must never fail a test
  }
}

/** Deletes every template of the user whose name starts with the given prefix */
export async function deleteTemplatesNamed(user: AuthUser, prefix: string): Promise<void> {
  for (const t of await listTemplates(user).catch(() => [])) {
    if (t.name.startsWith(prefix)) await deleteTemplateQuietly(user, t.id);
  }
}

// ------------------------------------------------------------------- videos

/** Deletes the user's videos whose title starts with `prefix` (videos a UI flow created) */
export async function deleteVideosTitled(user: AuthUser, prefix: string): Promise<void> {
  const videos = await listOwnVideos(userApi(user)).catch(() => [] as E2EVideo[]);
  for (const v of videos.filter((x) => x.title.startsWith(prefix))) await deleteVideoQuietly(user, v);
}

/** Schedules a video through the API, `days` from now at 12:00 UTC */
export async function scheduleVideoApi(user: AuthUser, video: E2EVideo, days: number): Promise<string> {
  const u = userApi(user);
  const when = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  when.setUTCHours(12, 0, 0, 0);
  await u.api.post(
    `/api/videos/${video.id}/schedule`,
    { scheduledPublishDate: when.toISOString(), timezone: 'UTC', notifyOnPublish: false },
    { token: u.token, channelId: video.channelId },
  );
  return when.toISOString();
}

export async function getSchedule(user: AuthUser, video: E2EVideo): Promise<{ status?: string; scheduledPublishDate?: string } | null> {
  const u = userApi(user);
  const res = await u.api.get<{ result?: { status?: string; scheduledPublishDate?: string } }>(`/api/videos/${video.id}/schedule`, {
    token: u.token,
    channelId: video.channelId,
    allowStatus: [400, 403, 404],
  });
  return res.status === 200 ? res.data.result || null : null;
}

// ------------------------------------------------------------------ theming

/**
 * Mean RGB brightness (0 = black, 255 = white) of a CSS colour, resolved by the
 * browser itself so modern formats (oklch, lab, color-mix) are handled.
 */
async function brightness(page: Page, color: string): Promise<number> {
  return page.evaluate((c) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#000';
    ctx.fillStyle = c;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return (r + g + b) / 3;
  }, color);
}

/** The nearest non-transparent background colour of an element */
export async function backgroundOf(locator: Locator): Promise<string> {
  return locator.evaluate((el) => {
    let node: Element | null = el;
    while (node) {
      const bg = getComputedStyle(node).backgroundColor;
      if (bg && bg !== 'transparent' && !/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(bg) && !/\/\s*0\)$/.test(bg)) return bg;
      node = node.parentElement;
    }
    return 'rgb(255, 255, 255)';
  });
}

/** Asserts the page follows the dark scheme: html.dark, dark surface, light text */
export async function expectDarkSurface(page: Page, surface: Locator, text: Locator) {
  await expect(page.locator('html')).toHaveClass(/(^|\s)dark(\s|$)/);
  const bg = await backgroundOf(surface);
  expect(await brightness(page, bg), `surface background ${bg}`).toBeLessThan(110);
  const color = await text.evaluate((el) => getComputedStyle(el).color);
  expect(await brightness(page, color), `text colour ${color}`).toBeGreaterThan(150);
}

/** Asserts the page uses the light scheme */
export async function expectLightSurface(page: Page, surface: Locator) {
  await expect(page.locator('html')).not.toHaveClass(/(^|\s)dark(\s|$)/);
  const bg = await backgroundOf(surface);
  expect(await brightness(page, bg), `surface background ${bg}`).toBeGreaterThan(200);
}

/** No horizontal page scroll (layout fits the viewport) */
export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, 'horizontal overflow in px').toBeLessThanOrEqual(1);
}
