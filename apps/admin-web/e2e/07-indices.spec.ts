import { test, expect } from './support/fixtures';
import { adminApi } from './support/api';

interface IndexStats {
  indices: { name: string; count: number; stale: boolean; lastUpdated: string }[];
  totalVideos: number;
}

test.describe('video indices', () => {
  test('IDX-01 endpoint requires an admin token', async () => {
    const anonymous = await adminApi('/api/indices?operation=status', { token: 'invalid' });
    expect(anonymous.status).toBe(401);
  });

  test('IDX-02 page shows the status reported by admin-api', async ({ page }) => {
    const { status, body } = await adminApi('/api/indices?operation=status');
    expect(status).toBe(200);
    const stats = body.stats as IndexStats;

    await page.goto('/indices');
    await expect(page.getByRole('heading', { level: 1, name: 'Video Indices' })).toBeVisible();
    await expect(page.getByTestId('indices-error')).toHaveCount(0);
    // Live QA data: other suites upload videos concurrently
    const shown = Number(await page.getByTestId('indices-total-videos').locator('dd').getAttribute('data-value'));
    expect(Math.abs(shown - stats.totalVideos)).toBeLessThanOrEqual(5);

    if (stats.indices.length === 0) {
      await expect(page.getByTestId('indices-empty')).toBeVisible();
      return;
    }
    await expect(page.getByTestId('index-row')).toHaveCount(stats.indices.length);
    for (const index of stats.indices) {
      const row = page.locator(`[data-testid="index-row"][data-index="${index.name}"]`);
      await expect(row).toContainText(index.name);
      await expect(row).toContainText(index.stale ? 'Stale' : 'Fresh');
    }
  });
});
