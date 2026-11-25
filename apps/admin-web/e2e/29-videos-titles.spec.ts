/**
 * The Videos list's title column on the local stack (owner bug 2026-11-16: titles rendered one
 * letter per line, an id fragment showed as the title).
 *
 * Data: a channel, a profile and three videos (long English, long Arabic with an English
 * creator title, and mixed) in the admin index (content_ownership) and R2, all carrying this
 * run's marker, written through the stack's control API and removed afterwards, pass or fail.
 * The list is filtered to the run's channel, so nothing else on the stack is involved.
 */
import crypto from 'node:crypto';
import type { Page } from '@playwright/test';
import { test, expect } from './support/fixtures';
import { E2E_ENTITY_PREFIX, LOCAL_STACK } from './support/env';
import { stackR2, stackSql } from './support/local-stack';
import { horizontalOverflow, setPreferences } from './support/ui';

const SEARCH = 'al-ummah-now-search';
const hex = crypto.randomBytes(6).toString('hex');
const channelId = `${E2E_ENTITY_PREFIX}titles-ch-${hex}`;
const ownerId = `${E2E_ENTITY_PREFIX}titles-owner-${hex}`;
const videos = [
  {
    id: `${E2E_ENTITY_PREFIX}titles-en-${hex}`,
    title: `A very long English lecture title about patience gratitude and the etiquette of seeking knowledge in the classical tradition ${hex}`,
  },
  {
    id: `${E2E_ENTITY_PREFIX}titles-ar-${hex}`,
    title: `محاضرة طويلة جدا عن الصبر والشكر وآداب طلب العلم في التراث الإسلامي الكلاسيكي ${hex}`,
    titleLocalized: { en: `Long lecture on patience and gratitude ${hex}`, ar: `محاضرة طويلة جدا عن الصبر والشكر وآداب طلب العلم في التراث الإسلامي الكلاسيكي ${hex}` },
  },
  { id: `${E2E_ENTITY_PREFIX}titles-mix-${hex}`, title: `AlUmmahNow Ad — إعلان المنصة الجديد with mixed English and العربية words ${hex}` },
];
/**
 * Not all ready and public: whatever else is on the stack, the views All, Processing, Failed and Private have
 * counts, and those four never fit a phone's row (Pixel 5), so it has More
 */
const state = (i: number) => ({ upload: i === 2 ? 'processing' : i === 0 ? 'failed' : 'ready', isPublic: i !== 1 });
const expected = (v: (typeof videos)[number], locale: 'en' | 'ar') => v.titleLocalized?.[locale] ?? v.title;
const q = (s: string) => s.replace(/'/g, "''");

async function openList(page: Page) {
  await page.goto(`/videos?channelId=${encodeURIComponent(channelId)}`);
  await expect(page.getByTestId('videos-list')).toHaveAttribute('data-list-ready', 'true');
  await expect(page.locator('[data-testid="video-row"]')).toHaveCount(videos.length);
}

test.describe('videos list titles', () => {
  test.beforeAll(async ({}, testInfo) => {
    test.skip(!LOCAL_STACK, 'Seeds the admin index through the local stack');
    test.skip(testInfo.project.name !== 'chromium' && testInfo.project.name !== 'mobile', 'Desktop and phone layouts');
    const now = new Date().toISOString();
    const ms = Date.now();
    for (const v of videos) {
      const s = state(videos.indexOf(v));
      const object = { id: v.id, title: v.title, ...(v.titleLocalized ? { titleLocalized: v.titleLocalized } : {}), userId: ownerId, channelId, isPublic: s.isPublic, uploadStatus: s.upload, dateCreated: now, dateModified: now, comments: [], likes: [] };
      expect((await stackR2('PUT', 'videos', v.id, object)).ok).toBe(true);
    }
    // admin_cols = OWNERSHIP_ADMIN_COLS_VERSION (shared-types search/ownership.ts): an older value
    // would mark the whole admin index stale for every spec running beside this one
    const row = (kind: string, id: string, channel: string | null, title: string, upload: string | null, isPublic = true) =>
      `('${kind}', '${id}', '${ownerId}', ${channel ? `'${channel}'` : 'NULL'}, '${q(title)}', ${upload ? `'${upload}'` : 'NULL'}, ${isPublic ? 1 : 0}, 1, ${ms}, ${ms}, ${ms})`;
    const rows = [
      row('channel', channelId, null, `E2E titles channel ${hex}`, null),
      row('profile', ownerId, null, `E2E Titles Owner ${hex}`, null),
      ...videos.map((v, i) => row('video', v.id, channelId, v.title, state(i).upload, state(i).isPublic)),
    ];
    await stackSql(
      SEARCH,
      `INSERT OR REPLACE INTO content_ownership (kind, id, owner_id, channel_id, admin_title, upload_status, is_public, admin_cols, created_at, updated_at, indexed_at)
       VALUES ${rows.join(', ')}`,
    );
  });

  test.afterAll(async () => {
    if (!LOCAL_STACK) return;
    await stackSql(SEARCH, `DELETE FROM content_ownership WHERE id IN ('${[channelId, ownerId, ...videos.map((v) => v.id)].join("','")}')`);
    for (const v of videos) await stackR2('DELETE', 'videos', v.id);
  });

  for (const locale of ['en', 'ar'] as const) {
    test(`TITLES-01 ${locale}: titles wrap by words in a wide cell, no ids, no sideways scroll`, async ({ page }, testInfo) => {
      const phone = testInfo.project.name === 'mobile';
      await setPreferences(page, { locale });
      await openList(page);
      for (const v of videos) {
        const row = page.locator(`[data-testid="video-row"][data-video-id="${v.id}"]`);
        await expect(row.getByTestId('video-title')).toHaveText(expected(v, locale));
        // Never the id, whole or cut: its "titles-<kind>-" segment is in no title or name (the run marker is)
        await expect(row).not.toContainText(v.id);
        await expect(row).not.toContainText('titles-');
        const cell = await row.getByTestId('video-title').boundingBox();
        const box = await row.boundingBox();
        expect(cell, 'title cell is laid out').not.toBeNull();
        // The column keeps its minimum width: 18rem less padding and the 96 px thumbnail is ~148 px
        // of title on a desktop (the bug left ~10 px, one letter per line)
        expect(cell!.width, `title width (${v.id})`).toBeGreaterThanOrEqual(140);
        // Two lines at most for the title; the row stays compact (was ~900 px)
        expect(cell!.height, `title height (${v.id})`).toBeLessThanOrEqual(50);
        // A failed video's row also says why (FailureWhy), so only the others are held to the compact height
        if (state(videos.indexOf(v)).upload !== 'failed') expect(box!.height, `row height (${v.id})`).toBeLessThanOrEqual(phone ? 320 : 160);
      }
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
      // The saved views are one row: each tab in it whole and on screen, the rest under More, also in RTL
      // Once the counts are in (no pill busy) and the row is measured with them
      await expect(page.locator('[data-testid="video-status-summary"] [aria-busy="true"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="video-status-summary"]:not([data-measuring])')).toBeVisible();
      const tabs = await page.locator('[data-testid^="saved-view-"]').evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return { id: el.getAttribute('data-testid'), top: Math.round(r.top), left: r.left, right: r.right, clipped: el.scrollWidth > el.clientWidth + 1 };
        }),
      );
      expect(tabs.length).toBeGreaterThan(0);
      expect(new Set(tabs.map((tab) => tab.top)).size, 'one row').toBe(1);
      const vw = page.viewportSize()!.width;
      for (const tab of tabs) {
        expect(tab.left, `tab ${tab.id} starts on screen`).toBeGreaterThanOrEqual(0);
        expect(tab.right, `tab ${tab.id} ends on screen`).toBeLessThanOrEqual(vw);
        expect(tab.clipped, `tab ${tab.id} label not clipped`).toBe(false);
      }
      // A phone's row has no room for every view: More opens a menu under itself, on screen, and a view picked there
      // takes a slot in the row as the current one
      if (phone) {
        const more = page.getByTestId('video-status-summary-more');
        await expect(more).toBeVisible();
        await more.click();
        const menu = page.getByTestId('video-status-summary-menu');
        await expect(menu).toBeVisible();
        const [m, b] = [await menu.boundingBox(), await more.boundingBox()];
        expect(m!.x).toBeGreaterThanOrEqual(0);
        expect(m!.x + m!.width).toBeLessThanOrEqual(vw);
        expect(m!.y, 'under More').toBeGreaterThanOrEqual(b!.y + b!.height - 1);
        const entries = menu.getByRole('menuitem');
        expect(await entries.count()).toBeGreaterThan(0);
        const picked = (await entries.first().getAttribute('data-testid'))!.replace('video-status-summary-menu-', '');
        await entries.first().click();
        await expect(menu).toBeHidden();
        await expect(page.getByTestId(`saved-view-${picked}`)).toHaveAttribute('aria-current', 'page');
      }
    });
  }
});
