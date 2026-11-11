/** The Studio Dashboard (docs/specs/CREATOR-STUDIO.md §4.3). */
import { expect, test } from '@playwright/test';
import { skipUntilStudioDeployed, studioOwner } from './studio';
import { target } from './targets';

// Sign-in pages carry the test password: never record them
test.use({ trace: 'off', video: 'off' });

test.describe('Release: Studio Dashboard', () => {
  test.beforeEach(skipUntilStudioDeployed);

  test('welcomes a new channel', async ({ page }) => {
    const { channelId } = await studioOwner(page, 'rel-studio-dashboard');
    await page.goto(`${target().web}/en/studio/${channelId}/dashboard`);
    await expect(page.getByTestId('studio-dash-welcome')).toContainText('Upload your first video');
  });
});
