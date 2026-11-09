/** The Studio Analytics page (docs/specs/CREATOR-STUDIO.md §4.6). */
import { expect, test } from '@playwright/test';
import { skipUntilStudioDeployed, studioOwner } from './studio';
import { target } from './targets';

test.describe('Release: Studio Analytics', () => {
  test.beforeEach(skipUntilStudioDeployed);

  test('a new channel shows its empty state and changes range', async ({ page }) => {
    const { channelId } = await studioOwner(page, 'rel-studio-analytics');
    await page.goto(`${target().web}/en/studio/${channelId}/analytics`);
    await expect(page.getByTestId('studio-analytics-empty')).toBeVisible();
    await page.getByTestId('studio-analytics-range').selectOption('7');
    await expect(page.getByTestId('studio-analytics-empty')).toBeVisible();
    await expect(page.getByTestId('studio-traffic')).toBeVisible();
  });
});
