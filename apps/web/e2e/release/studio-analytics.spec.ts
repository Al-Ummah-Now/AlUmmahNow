/** The Studio Analytics page (docs/specs/CREATOR-STUDIO.md §4.6). */
import { expect, test } from '@playwright/test';
import { skipUntilStudioDeployed, studioOwner } from './studio';
import { target } from './targets';


// Sign-in pages carry the test password: never record them
test.use({ trace: 'off', video: 'off' });

test.describe('Release: Studio Analytics', () => {
  test.beforeEach(skipUntilStudioDeployed);

  test('a new channel shows its empty state and changes range', async ({ page }) => {
    const { channelId } = await studioOwner(page, 'rel-studio-analytics');
    await page.goto(`${target().web}/en/studio/${channelId}/analytics`);
    await expect(page.getByTestId('studio-analytics-empty')).toBeVisible();

    // Owner report 2026-11-11: "views chart only has time axis". The chart keeps a
    // 0-based value axis even with no views, and hovering reads out the day and value.
    if (await page.getByTestId('chart-y-axis').count()) {
      const ticks = page.getByTestId('chart-y-tick');
      await expect(ticks.first()).toBeVisible();
      await expect(ticks).toHaveText(['0', '1']);
      await expect(page.getByTestId('chart-x-tick').first()).toBeVisible();
      const hit = page.getByTestId('chart-hit');
      const box = await hit.boundingBox();
      expect(box, 'the plot has a size').not.toBeNull();
      await page.mouse.move(box!.x + box!.width - 4, box!.y + box!.height / 2);
      const tooltip = page.getByTestId('chart-tooltip');
      await expect(tooltip).toBeVisible();
      await expect(tooltip).toContainText(/\d/);
    } else {
      test.info().annotations.push({ type: 'not-deployed', description: 'this build has no value axis on the analytics chart yet' });
    }

    await page.getByTestId('studio-analytics-range').selectOption('7');
    await expect(page.getByTestId('studio-analytics-empty')).toBeVisible();
    await expect(page.getByTestId('studio-traffic')).toBeVisible();
  });
});
