/**
 * Studio Videos list speed (owner report 2026-11-11: "not consistent, especially
 * back from a video edit"). Returning to the list shows the cached rows at once
 * and revalidates in the background, so back is bounded by the browser, not the
 * network. Timed inside the page: from the popstate of Back to the first row.
 */
import { expect, test, type Page } from '@playwright/test';
import { skipUntilStudioDeployed, studioDraftRecord, studioOwner } from './studio';
import { target } from './targets';

test.use({ trace: 'off', video: 'off' });

const BACK_BUDGET_MS = 300;

async function timeBackToRows(page: Page): Promise<number> {
  await page.evaluate(() => {
    const w = window as unknown as { __back?: { t0?: number; t1?: number } };
    w.__back = {};
    window.addEventListener('popstate', () => {
      w.__back!.t0 = performance.now();
      const seen = () => {
        if (document.querySelector('[data-testid="studio-video-row"]')) {
          w.__back!.t1 = performance.now();
          return true;
        }
        return false;
      };
      if (seen()) return;
      const observer = new MutationObserver(() => { if (seen()) observer.disconnect(); });
      observer.observe(document.body, { childList: true, subtree: true });
    }, { once: true });
  });
  await page.goBack();
  await expect(page.getByTestId('studio-video-row').first()).toBeVisible();
  return page.evaluate(() => {
    const b = (window as unknown as { __back: { t0: number; t1: number } }).__back;
    return Math.round(b.t1 - b.t0);
  });
}

test.describe('Release: Studio list speed', () => {
  test.beforeEach(skipUntilStudioDeployed);

  test(`back to the Videos list shows rows from cache in under ${BACK_BUDGET_MS} ms`, async ({ page }) => {
    const { user, channelId } = await studioOwner(page, 'rel-studio-speed');
    for (const n of [1, 2]) await studioDraftRecord(user, channelId, `Release E2E speed ${n} ${Date.now().toString(36)}`);
    const list = `${target().web}/en/studio/${channelId}/content/videos?status=processing&sort=oldest`;
    await page.goto(list);
    await expect(page.getByTestId('studio-video-row')).toHaveCount(2, { timeout: 30000 });

    const timings: number[] = [];
    for (let run = 0; run < 3; run++) {
      // Leave the list inside the app, then come back with the browser's Back
      await page.getByTestId('studio-nav-dashboard').first().click();
      await expect(page.getByTestId('studio-dashboard')).toBeVisible();
      timings.push(await timeBackToRows(page));
      // Same list as it was: status, sort and rows
      await expect(page).toHaveURL(list);
      await expect(page.getByTestId('studio-status-processing')).toHaveAttribute('aria-pressed', 'true');
    }
    test.info().annotations.push({ type: 'back-to-rows-ms', description: timings.join(', ') });
    expect(Math.max(...timings), `back to rows took ${timings.join(', ')} ms`).toBeLessThan(BACK_BUDGET_MS);
  });
});
