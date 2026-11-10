/**
 * Release regression: the watch page's action row is one design system.
 * - Every visible action (the like/dislike pair, comments, share, watch later,
 *   save, more) is a pill of the same height, radius, fill, border and icon size.
 * - Like and dislike are a matched pair: thumbs up and thumbs down.
 * - The row stays on one line at every width from 320 to 1920 (labels give way
 *   to icons first), inside the page, with no sideways scroll.
 * - Report is reachable: in the row, or in the "more" menu, and opens its dialog.
 * Signed in (watch later, save and report are signed-in actions), en and ar,
 * Fawanees and Nahas, light and dark.
 */
import { test, expect, type Page } from '@playwright/test';
import { target } from './targets';
import { findPlayableVideo, NO_PLAYABLE_VIDEO, watchUrl } from './videos';
import { createProfile, signUpOnWeb, type Locale } from './web-session';

// Signs users in through the auth server: traces would hold the password and code
test.use({ trace: 'off' });

const WIDTHS = [320, 390, 768, 1000, 1280, 1920];
const THEMES = ['fawanees', 'nahas'] as const;
const REPORT = /report|إبلاغ/i;

interface Pill { name: string; top: number; bottom: number; left: number; right: number; height: number; radius: string; bg: string; border: string; icon: number }
interface Row { pills: Pill[]; row: { left: number; right: number; overflow: number }; pageOverflow: number; like: string; dislike: string }

/**
 * Every visible action in the row: an icon's closest pill (the joined
 * like/dislike group counts as one), or the icon's own wrapper when it has no
 * button around it. Menus and popovers opened from the row are left out.
 */
const readRow = (page: Page): Promise<Row> =>
  page.evaluate(() => {
    const row = document.querySelector<HTMLElement>('.watch-actions')!;
    const shown = (e: Element) => {
      const r = e.getBoundingClientRect();
      return e.getClientRects().length > 0 && r.width > 2 && r.height > 2 && getComputedStyle(e).visibility !== 'hidden';
    };
    const items = new Set<HTMLElement>();
    row.querySelectorAll('svg').forEach((svg) => {
      if (svg.closest('[role=menu],[role=dialog]') || !shown(svg)) return;
      const item = (svg.closest('[data-testid=video-reactions]') ?? svg.closest('button, a') ?? svg.parentElement) as HTMLElement;
      if (row.contains(item) && item !== row) items.add(item);
    });
    const pills = [...items].map((e) => {
      const c = getComputedStyle(e);
      const r = e.getBoundingClientRect();
      const svg = e.querySelector('svg')!.getBoundingClientRect();
      return {
        name: (e.getAttribute('aria-label') || e.textContent || e.dataset.testid || e.tagName).trim().slice(0, 30),
        top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height,
        radius: c.borderTopLeftRadius, bg: c.backgroundColor, border: c.borderTopWidth, icon: Math.round(svg.width),
      };
    });
    const rr = row.getBoundingClientRect();
    const icon = (id: string) => document.querySelector(`[data-testid=${id}] svg`)?.getAttribute('class') ?? '';
    return {
      pills,
      row: { left: rr.left, right: rr.right, overflow: row.scrollWidth - row.clientWidth },
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      like: icon('video-like-button'),
      dislike: icon('video-dislike-button'),
    };
  });

/** Theme and mode as the site sets them (html[data-theme], html.dark). */
async function applyTheme(page: Page, theme: string, dark: boolean): Promise<void> {
  await page.evaluate(
    ([t, d]) => {
      document.documentElement.dataset.theme = t as string;
      document.documentElement.classList.toggle('dark', d as boolean);
    },
    [theme, dark] as const,
  );
  await settle(page);
}

/** Two frames for the row to refit, then until the row's transitions (colour, radius) have finished. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await frame();
    const row = document.querySelector('.watch-actions');
    for (let i = 0; i < 20 && row; i++) {
      const running = row.getAnimations({ subtree: true }).filter((a) => a.playState !== 'finished');
      if (!running.length) break;
      await Promise.all(running.map((a) => a.finished.catch(() => undefined)));
      await frame();
    }
  });
}

/** The title, channel and action row, for the attached screenshot. */
async function rowClip(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  return page.evaluate(() => {
    const row = document.querySelector('.watch-actions')!.getBoundingClientRect();
    const top = (document.querySelector('.watch-title') ?? document.querySelector('.watch-actions')!).getBoundingClientRect().top;
    const y = Math.max(0, top - 8);
    return { x: Math.max(0, row.left - 8), y, width: row.width + 16, height: row.bottom - y + 8 };
  });
}

function rowProblems(r: Row, where: string): string[] {
  const out: string[] = [];
  if (r.pills.length < 4) out.push(`${where}: only ${r.pills.length} actions visible`);
  const [first] = r.pills;
  for (const p of r.pills) {
    if (Math.abs(p.height - first.height) > 0.5) out.push(`${where}: "${p.name}" height ${p.height} vs "${first.name}" ${first.height}`);
    if (p.radius !== first.radius) out.push(`${where}: "${p.name}" radius ${p.radius} vs ${first.radius}`);
    if (p.bg !== first.bg) out.push(`${where}: "${p.name}" fill ${p.bg} vs ${first.bg}`);
    if (p.border !== first.border) out.push(`${where}: "${p.name}" border ${p.border} vs ${first.border}`);
    if (p.icon !== first.icon) out.push(`${where}: "${p.name}" icon ${p.icon}px vs ${first.icon}px`);
    // One line: every pill on the first pill's line, inside the row
    if (Math.abs(p.top - first.top) > 1) out.push(`${where}: "${p.name}" on another line (top ${p.top} vs ${first.top})`);
    if (p.left < r.row.left - 1 || p.right > r.row.right + 1) out.push(`${where}: "${p.name}" outside the row`);
  }
  if (r.row.overflow > 1) out.push(`${where}: row overflows by ${r.row.overflow}px`);
  if (r.pageOverflow > 0) out.push(`${where}: page scrolls sideways by ${r.pageOverflow}px`);
  return out;
}

/** Report, directly in the row or through its "more" menu; opens the report dialog and closes it. */
async function openReport(page: Page, where: string): Promise<void> {
  const row = page.locator('.watch-actions');
  const direct = row.getByRole('button', { name: REPORT });
  if (await direct.isVisible()) {
    await direct.click();
  } else {
    const more = row.locator('button[aria-haspopup="menu"]');
    await expect(more, `${where}: no report button and no "more" menu`).toBeVisible();
    await more.click();
    // The menu may render outside the row (a portal): find it through the button
    const menuId = await more.getAttribute('aria-controls');
    const menu = menuId ? page.locator(`[id="${menuId}"]`) : page.getByRole('menu');
    await menu.getByRole('menuitem', { name: REPORT }).click();
  }
  const dialog = page.locator('[role="dialog"][aria-labelledby="report-content-title"]');
  await expect(dialog, `${where}: report dialog`).toBeVisible();
  await page.locator('#report-content-title ~ button, #report-content-title + button').first().click();
  await expect(dialog).toBeHidden();
}

for (const locale of ['en', 'ar'] as Locale[]) {
  test(`watch actions share one pill style and stay on one line (${locale})`, async ({ page, context }) => {
    test.setTimeout(300000);
    const video = await findPlayableVideo();
    test.skip(!video, NO_PLAYABLE_VIDEO);

    await context.addCookies([{ name: 'aun_consent', value: `v1.a0.e0.p0.${Date.now()}`, url: target().web, sameSite: 'Lax' }]);
    const user = await signUpOnWeb(page, 'rel-watch-actions', locale);
    await createProfile(user);

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(watchUrl(video!.id, locale));
    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
    const row = page.locator('.watch-actions');
    await expect(row).toBeVisible({ timeout: 30000 });
    // Signed-in actions have rendered
    await expect(page.getByTestId('watch-later-button')).toBeAttached({ timeout: 20000 });

    const problems: string[] = [];
    for (const theme of THEMES) {
      for (const dark of [true, false]) {
        await applyTheme(page, theme, dark);
        for (const width of WIDTHS) {
          await page.setViewportSize({ width, height: 900 });
          await settle(page);
          await row.scrollIntoViewIfNeeded();
          const where = `${locale} ${theme} ${dark ? 'dark' : 'light'} ${width}px`;
          const r = await readRow(page);
          if (width === 1000 && theme === 'fawanees' && dark) {
            const shot = test.info().outputPath(`watch-actions-${locale}-1000.png`);
            await page.screenshot({ path: shot, clip: await rowClip(page) });
            await test.info().attach(`row ${locale} 1000px`, { path: shot, contentType: 'image/png' });
          }
          problems.push(...rowProblems(r, where));
          if (!/thumbs-up/.test(r.like) || !/thumbs-down/.test(r.dislike)) {
            problems.push(`${where}: like/dislike icons are not a matched pair (${r.like} / ${r.dislike})`);
          }
        }
      }
    }
    expect(problems, problems.join('\n')).toEqual([]);

    for (const width of [320, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await settle(page);
      await openReport(page, `${locale} ${width}px`);
    }
  });
}
