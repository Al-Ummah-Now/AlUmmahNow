/**
 * Studio Videos list speed (owner report 2026-11-11: "not consistent, especially
 * back from a video edit"). Returning to the list renders it from the client
 * cache at once (rows or the empty state, never the loading skeleton) and
 * revalidates in the background, so Back is bounded by the browser, not the
 * network. Timed inside the page: from Back's popstate to the list being shown.
 * The list's content does not matter here, so the channel needs no test videos
 * (upload placeholders change status mid-test on stage).
 *
 * CI variance: the first round trip is a warm-up (it loads the Dashboard's code
 * and data), then ROUNDS are timed and the median must be under the budget. A
 * single slow round on a busy runner does not fail it; a regression that makes
 * Back slow every time does, and so does any round over the hard ceiling (the
 * list going back to the network, which takes seconds).
 */
import { expect, test, type Page } from '@playwright/test';
import { skipUntilStudioDeployed, studioOwner } from './studio';
import { target } from './targets';
import { expectHydrated } from './web-session';

test.use({ trace: 'off', video: 'off' });

const BACK_BUDGET_MS = 300;
/** No single round may take this long: that is a network round trip, not a cache render. */
const BACK_CEILING_MS = 1500;
const ROUNDS = 5;
const SHOWN = '[data-testid="studio-video-row"], [data-testid="studio-videos-empty"]';

async function timeBackToList(page: Page): Promise<number> {
  await page.evaluate((shown) => {
    const w = window as unknown as { __back?: { t0?: number; t1?: number } };
    w.__back = {};
    window.addEventListener('popstate', () => {
      w.__back!.t0 = performance.now();
      const seen = () => {
        if (document.querySelector(shown) && !document.querySelector('[data-testid="studio-videos-loading"]')) {
          w.__back!.t1 = performance.now();
          return true;
        }
        return false;
      };
      if (seen()) return;
      const observer = new MutationObserver(() => { if (seen()) observer.disconnect(); });
      observer.observe(document.body, { childList: true, subtree: true });
    }, { once: true });
  }, SHOWN);
  await page.goBack();
  await expect(page.locator(SHOWN).first(), 'Back did not show the list').toBeVisible({ timeout: 15000 });
  await expect.poll(() => page.evaluate(() => (window as unknown as { __back: { t1?: number } }).__back.t1 !== undefined)).toBe(true);
  return page.evaluate(() => {
    const b = (window as unknown as { __back: { t0: number; t1: number } }).__back;
    return Math.round(b.t1 - b.t0);
  });
}

test.describe('Release: Studio list speed', { tag: '@load' }, () => {
  test.beforeEach(skipUntilStudioDeployed);

  test(`back to the Videos list shows it from cache in under ${BACK_BUDGET_MS} ms`, async ({ page }) => {
    const { channelId } = await studioOwner(page, 'rel-studio-speed');
    const list = `${target().web}/en/studio/${channelId}/content/videos?status=drafts&sort=oldest`;
    await page.goto(list);
    await expect(page.locator(SHOWN).first()).toBeVisible({ timeout: 30000 });

    const dashboardLink = page.getByTestId('studio-nav-dashboard').first();
    const leaveAndComeBack = async () => {
      // Leave the list inside the app (a client navigation: the link must be hydrated, or the
      // click is a full page load and Back is too), then come back with the browser's Back
      await expectHydrated(dashboardLink);
      await dashboardLink.click();
      await expect(page.getByTestId('studio-dashboard')).toBeVisible({ timeout: 30000 });
      const ms = await timeBackToList(page);
      // Same list as it was: status and sort
      await expect(page).toHaveURL(list);
      await expect(page.getByTestId('studio-status-drafts')).toHaveAttribute('aria-pressed', 'true');
      return ms;
    };
    // Warm once (first Dashboard visit compiles and caches its own code and data)
    await leaveAndComeBack();
    const timings: number[] = [];
    for (let run = 0; run < ROUNDS; run++) timings.push(await leaveAndComeBack());
    const median = [...timings].sort((a, b) => a - b)[Math.floor(ROUNDS / 2)];
    test.info().annotations.push({ type: 'back-to-list-ms', description: `${timings.join(', ')} (median ${median})` });
    expect(median, `back to the list took ${timings.join(', ')} ms (median ${median})`).toBeLessThan(BACK_BUDGET_MS);
    expect(Math.max(...timings), `a Back went to the network: ${timings.join(', ')} ms`).toBeLessThan(BACK_CEILING_MS);
  });
});
