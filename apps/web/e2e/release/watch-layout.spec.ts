/**
 * Release regression: the watch page and header lay out sensibly from tablet to
 * desktop, en and ar. At a ~1000px tablet the related column took half the page
 * with full-width card thumbnails and squeezed the player; the header's account
 * chevron sat a gap away from the avatar. At every width the player must be the
 * dominant column (or the related list stacks under it), side-column thumbnails
 * stay compact, RTL mirrors the columns, and header items never overlap.
 */
import { test, expect, type Page } from '@playwright/test';
import { target } from './targets';
import { findPlayableVideo, NO_PLAYABLE_VIDEO, watchUrl } from './videos';
import { createProfile, signUpOnWeb, type Locale } from './web-session';
import { grantCreatorTier } from './creator-tier';

// Signs in through the auth server: a retained trace would hold the password and code
test.use({ trace: 'off' });

// Signs up/in: no trace or video, they would record the password (see secret-fill.ts)
test.use({ trace: 'off', video: 'off' });

const WIDTHS = [768, 1024, 1280, 1440];
/** Side-column rows: thumbnail beside the text, never a full-width card. */
const MAX_SIDE_THUMB = 180;
/** The player column is at least this many times wider than the related column. */
const PLAYER_DOMINANCE = 1.5;
/** Avatar to chevron inside the account trigger. */
const MAX_CHEVRON_GAP = 6;

type Box = { x: number; y: number; width: number; height: number };

async function boxOf(page: Page, selector: string): Promise<Box | null> {
  return page.evaluate((sel) => {
    const el = [...document.querySelectorAll(sel)].find((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden';
    });
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }, selector);
}

async function expectWatchLayout(page: Page, locale: Locale, width: number): Promise<void> {
  const where = `${locale} @ ${width}px`;
  const player = await boxOf(page, '#video-player');
  const related = await boxOf(page, '[data-testid="related-videos-list"]');
  expect(player, `${where}: player is visible`).not.toBeNull();
  expect(related, `${where}: related list is visible`).not.toBeNull();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `${where}: no horizontal page scroll`).toBeLessThanOrEqual(1);

  const stacked = related!.y >= player!.y + player!.height - 1;
  if (stacked) {
    // Below the video the list may use the full content width
    expect(related!.width, `${where}: stacked related list spans the content`).toBeGreaterThanOrEqual(player!.width * 0.9);
    return;
  }

  expect(
    player!.width,
    `${where}: player column (${Math.round(player!.width)}px) dominates the related column (${Math.round(related!.width)}px)`,
  ).toBeGreaterThanOrEqual(related!.width * PLAYER_DOMINANCE);

  // RTL mirrors the columns: related on the right of the player in en, on the left in ar
  if (locale === 'en') expect(related!.x, `${where}: related column follows the player`).toBeGreaterThanOrEqual(player!.x + player!.width - 1);
  else expect(related!.x + related!.width, `${where}: related column precedes the player (RTL)`).toBeLessThanOrEqual(player!.x + 1);

  const thumbs = await page.evaluate(() => {
    const list = [...document.querySelectorAll('[data-testid="related-videos-list"]')].find((e) => e.getBoundingClientRect().width > 0);
    return [...(list?.querySelectorAll('a') ?? [])].slice(0, 4).map((a) => {
      const img = a.querySelector('.rv-t') ?? a.querySelector('img');
      return img ? img.getBoundingClientRect().width : 0;
    });
  });
  expect(thumbs.length, `${where}: related rows rendered`).toBeGreaterThan(0);
  for (const w of thumbs) {
    expect(w, `${where}: side-column thumbnail is compact (${Math.round(w)}px)`).toBeLessThanOrEqual(MAX_SIDE_THUMB);
  }
}

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5;

async function expectHeader(page: Page, locale: Locale, width: number): Promise<void> {
  const where = `${locale} @ ${width}px header`;
  const items = await page.evaluate(() => {
    const box = (el: Element | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
    };
    const header = document.querySelector('header.ah') ?? document.querySelector('header');
    const end = header?.querySelector('.ah-end');
    const named: Array<[string, Element | null]> = [
      ['menu', document.querySelector('[data-testid="nav-drawer-toggle"]')],
      ['logo', header?.querySelector('.ah-brand') ?? null],
      ['upload', document.querySelector('[data-testid="header-upload"]')],
      ['search', header?.querySelector('.ah-search-wrap .ah-search, [data-testid="header-search-open"]') ?? null],
      ...[...(end?.children ?? [])].map((c, i) => [`end-${i}`, c] as [string, Element]),
    ];
    return named.map(([name, el]) => ({ name, box: box(el) })).filter((i) => i.box);
  });
  const names = items.map((i) => i.name);
  for (const required of ['menu', 'logo', 'upload', 'search']) expect(names, `${where}: ${required} is shown`).toContain(required);

  for (let i = 0; i < items.length; i++) {
    const a = items[i].box!;
    expect(a.x, `${where}: ${items[i].name} inside the viewport`).toBeGreaterThanOrEqual(-0.5);
    expect(a.x + a.width, `${where}: ${items[i].name} inside the viewport`).toBeLessThanOrEqual(width + 0.5);
    for (let j = i + 1; j < items.length; j++) {
      expect(overlaps(a, items[j].box!), `${where}: ${items[i].name} overlaps ${items[j].name}`).toBe(false);
    }
  }

  // Reading order: menu, logo, upload, search, then the end group; mirrored in RTL
  const xs = items.map((i) => i.box!.x + i.box!.width / 2);
  const ordered = locale === 'en' ? xs.every((x, i) => i === 0 || x > xs[i - 1]) : xs.every((x, i) => i === 0 || x < xs[i - 1]);
  expect(ordered, `${where}: items in reading order (${names.join(', ')})`).toBe(true);

  // The account chevron belongs to the avatar: adjacent and on the same line
  const parts = await page.evaluate(() => {
    const trigger = document.querySelector('[data-testid="nav-menu-trigger"]');
    const avatar = trigger?.firstElementChild;
    const chevron = trigger?.querySelector(':scope > svg:last-of-type');
    const box = (el: Element | null | undefined) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
    };
    return { avatar: box(avatar), chevron: box(chevron) };
  });
  expect(parts.avatar, `${where}: account avatar is shown`).not.toBeNull();
  if (!parts.chevron) return; // phones hide the chevron
  const { avatar, chevron } = parts as { avatar: Box; chevron: Box };
  const gap = locale === 'en' ? chevron.x - (avatar.x + avatar.width) : avatar.x - (chevron.x + chevron.width);
  expect(gap, `${where}: chevron follows the avatar (gap ${Math.round(gap)}px)`).toBeGreaterThanOrEqual(-0.5);
  expect(gap, `${where}: chevron sits next to the avatar (gap ${Math.round(gap)}px)`).toBeLessThanOrEqual(MAX_CHEVRON_GAP);
  expect(
    Math.abs(chevron.y + chevron.height / 2 - (avatar.y + avatar.height / 2)),
    `${where}: chevron is vertically centred on the avatar`,
  ).toBeLessThanOrEqual(2);
}

async function checkAllWidths(page: Page, videoId: string, locale: Locale): Promise<void> {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(watchUrl(videoId, locale));
    await expect(page.locator('[data-testid="related-videos-list"]:visible a').first(), 'related videos load').toBeVisible({ timeout: 30000 });
    await expect(page.locator('#video-player')).toBeVisible();
    await expect(page.getByTestId('nav-menu-trigger')).toBeVisible();
    await expectWatchLayout(page, locale, width);
    await expectHeader(page, locale, width);
  }
}

async function videoWithRelated(): Promise<string | null> {
  const video = await findPlayableVideo();
  if (!video) return null;
  const res = await fetch(`${target().api}/api/videos?limit=2`);
  const { data = [] } = (await res.json()) as { data?: Array<{ id: string }> };
  return data.some((v) => v.id !== video.id) ? video.id : null;
}

test.describe('Release: watch page and header layout, tablet to desktop', () => {
  for (const locale of ['en', 'ar'] as const) {
    test(`player dominates, related stays compact, header aligned, anonymous (${locale})`, async ({ page }) => {
      const id = await videoWithRelated();
      test.skip(!id, NO_PLAYABLE_VIDEO);
      await checkAllWidths(page, id!, locale);
    });

    test(`player dominates, related stays compact, header aligned, signed in (${locale})`, async ({ page }) => {
      const id = await videoWithRelated();
      test.skip(!id, NO_PLAYABLE_VIDEO);
      // With no video profile the app sends a new user to profile/create once
      // its check answers, which can land between "player visible" and the
      // measurements: create the profile the way the other signed-in specs do.
      const user = await signUpOnWeb(page, 'watch-layout', locale);
      await createProfile(user);
      // The header's Upload button shows only with a creator tier (uploads are by invitation)
      await grantCreatorTier(user);
      await checkAllWidths(page, id!, locale);
    });
  }
});
