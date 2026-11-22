import { test, expect } from './fixtures';
import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { ANONYMOUS_STATE } from './test-utils/auth-state';
import { ownPublicVideos } from './test-utils/own-public-video';
import { onLocalStack } from './release/builders';
import { target } from './release/targets';

/**
 * Discovery ranking (wiki E07) on the home page and Explore, against the local stack:
 * - a ranking run ("Run now": api-videos /internal/discovery/rank → admin-jobs queue) finishes;
 * - test accounts' videos never rank: this file's own public videos (an @e2e.alummahnow.net creator)
 *   are in no ranked rail, home or Explore, in either language;
 * - every rail the home page shows is a labelled region whose heading is what the list is right now
 *   (`data-label`: with no viewer signal Trending is "New this week", never "Trending"), with no video
 *   or heading repeated, and its "See all" opens the full list;
 * - Explore's Trending heading follows the same label; en and ar (rtl), phone width, axe WCAG 2.2 AA.
 *
 * Own data: a creator with five public videos (ownPublicVideos), deleted afterwards. The ranking run
 * writes only the ranked lists, which every run rewrites.
 *
 * Every worker that runs this file starts its own ranking run once its videos exist (beforeAll), so a
 * test never depends on DSC-01 running first in the same shard: without a run, Explore's Trending
 * falls back to the unranked list, which holds this file's fresh public videos.
 */
const INTERNAL_KEY = 'local-stack-internal-key';

/** Every heading a rail label can get (shared-types i18n-rails.ts), en and ar */
const HEADINGS: Record<string, { en: RegExp; ar: RegExp }> = {
  trending_today: { en: /^Trending today$/, ar: /^الرائج اليوم$/ },
  trending_this_week: { en: /^Trending this week$/, ar: /^الرائج هذا الأسبوع$/ },
  trending_this_month: { en: /^Trending this month$/, ar: /^الرائج هذا الشهر$/ },
  popular: { en: /^Popular$/, ar: /^الأكثر مشاهدة$/ },
  new_today: { en: /^New today$/, ar: /^جديد اليوم$/ },
  new_this_week: { en: /^New this week$/, ar: /^جديد هذا الأسبوع$/ },
  new_this_month: { en: /^New this month$/, ar: /^جديد هذا الشهر$/ },
  latest: { en: /^Latest videos$/, ar: /^أحدث المرئيات$/ },
  featured: { en: /^Featured$/, ar: /^مرئيات مختارة$/ },
  top: { en: /^Top in .+$/, ar: /^الأبرز في .+$/ },
};

test.skip(!onLocalStack(), 'starts a ranking run with the local stack internal key');
test.describe.configure({ mode: 'default' });

const own = ownPublicVideos(test, 'discovery-rails', [{}, {}, {}, {}, {}]);

async function internal(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${target().api}/internal/discovery${path}`, {
    ...init,
    headers: { 'X-API-Key': INTERNAL_KEY, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
}

/** "Run now" and wait for that run (or the one already running) to finish */
async function rankNow(): Promise<void> {
  const res = await internal('/rank', { method: 'POST', body: JSON.stringify({ actorId: 'e2e' }) });
  expect(res.status, await res.clone().text()).toBe(202);
  const { result } = (await res.json()) as { result: { job: { id: string } } };
  await expect
    .poll(
      async () => {
        const status = (await (await internal('/status')).json()) as { result?: { jobs?: Array<{ id: string; status: string; error?: string }> } };
        const job = status.result?.jobs?.find((j) => j.id === result.job.id);
        return job?.status ?? 'missing';
      },
      { timeout: 120_000, intervals: [1000, 2000, 3000] },
    )
    .toBe('succeeded');
}

async function homeRailIds(language: 'en' | 'ar'): Promise<string[]> {
  const body = (await (await fetch(`${target().api}/api/discovery/home?language=${language}&limit=24`, { cache: 'no-store' })).json()) as {
    data?: { rails?: Array<{ data: Array<{ id: string }> }> };
  };
  return (body.data?.rails ?? []).flatMap((r) => r.data.map((v) => v.id));
}

async function expectRailsMatchLabels(page: Page, lang: 'en' | 'ar') {
  const rails = page.getByTestId('home-rail');
  const count = await rails.count();
  const headings: string[] = [];
  const cards: string[] = [];
  for (let i = 0; i < count; i++) {
    const rail = rails.nth(i);
    const label = (await rail.getAttribute('data-label')) ?? '';
    const heading = (await rail.getByRole('heading', { level: 2 }).innerText()).trim();
    expect(HEADINGS[label], `unknown rail label ${label}`).toBeTruthy();
    expect(heading).toMatch(HEADINGS[label][lang]);
    headings.push(heading);
    for (const id of await rail.getByTestId('video-card').evaluateAll((els) => els.map((e) => e.getAttribute('data-video-id') ?? ''))) cards.push(id);
    await expect(rail.getByTestId('home-rail-all')).toHaveAttribute('href', new RegExp(`^/${lang}/`));
  }
  expect(new Set(headings).size, 'a heading repeats').toBe(headings.length);
  expect(new Set(cards).size, 'a video repeats across rails').toBe(cards.length);
  return cards;
}

test.describe('Discovery rails', () => {
  test.use({ storageState: ANONYMOUS_STATE });

  test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(180_000);
    await rankNow();
  });

  test('DSC-01 a ranking run finishes and test accounts never rank', async () => {
    test.setTimeout(180_000);
    // A second run in the same worker: runs are repeatable and still leave test accounts out
    await rankNow();
    const ownIds = new Set(own.videos().map((v) => v.id));
    for (const language of ['en', 'ar'] as const) {
      const ranked = await homeRailIds(language);
      expect(ranked.filter((id) => ownIds.has(id)), `own videos on the ${language} home rails`).toEqual([]);
    }
    const trending = (await (await fetch(`${target().api}/api/trending?period=week&limit=50`, { cache: 'no-store' })).json()) as { data?: Array<{ id: string }> };
    expect((trending.data ?? []).filter((v) => ownIds.has(v.id))).toEqual([]);
  });

  for (const lang of ['en', 'ar'] as const) {
    test(`DSC-02 home rails are headed by what they are now (${lang})`, async ({ page }) => {
      await page.goto(`/${lang}`);
      await expect(page.getByTestId('video-grid')).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('html')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
      const ownIds = new Set(own.videos().map((v) => v.id));
      const cards = await expectRailsMatchLabels(page, lang);
      expect(cards.filter((id) => ownIds.has(id))).toEqual([]);
      if (cards.length > 0) {
        const axe = await new AxeBuilder({ page }).include('[data-testid="home-rails"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
        expect(axe.violations.map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);
      }
    });
  }

  test('DSC-03 at phone width a rail scrolls sideways inside the page', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/ar');
    await expect(page.getByTestId('video-grid')).toBeVisible({ timeout: 30_000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await expectRailsMatchLabels(page, 'ar');
  });

  test("DSC-04 Explore's Trending heading follows the ranking label", async ({ page }) => {
    await page.goto('/en/explore');
    const section = page.getByTestId('explore-trending');
    await expect(section).toBeVisible({ timeout: 30_000 });
    const label = await section.getAttribute('data-label');
    const heading = (await section.getByRole('heading', { level: 2 }).innerText()).trim();
    if (label) expect(heading).toMatch(HEADINGS[label].en);
    else expect(heading).toMatch(/^(Trending|Popular this month)$/);
    if (heading === 'Popular this month') {
      // No ranked list: Explore shows the search fallback (hooks/useExplore.ts). That is search, not ranking, so
      // test accounts' videos may be in it; on a stack whose only public videos are test accounts' (this file's
      // own), the ranked list is rightly empty and this is what shows
      return;
    }
    // The ranked list never holds test accounts' videos
    const ownIds = new Set(own.videos().map((v) => v.id));
    const ids = await section.getByTestId('video-card').evaluateAll((els) => els.map((e) => e.getAttribute('data-video-id') ?? ''));
    expect(ids.filter((id) => ownIds.has(id))).toEqual([]);
  });
});
