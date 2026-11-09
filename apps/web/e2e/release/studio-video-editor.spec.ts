/** The video editor inside Studio (docs/specs/CREATOR-STUDIO.md §4.5). */
import { expect, test } from '@playwright/test';
import { skipUntilStudioDeployed, studioOwner } from './studio';
import { target } from './targets';

test.describe('Release: Studio video editor', () => {
  test.beforeEach(skipUntilStudioDeployed);

  test('gives 404 for a video that isn\'t in this channel', async ({ page }) => {
    const { channelId } = await studioOwner(page, 'rel-studio-editor');
    const res = await page.goto(`${target().web}/en/studio/${channelId}/content/videos/no-such-video/edit`);
    expect(res?.status()).toBe(404);
  });
});
