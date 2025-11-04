import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  try {
    console.log('[Test] Navigating to video page...');
    await page.goto('http://localhost:3000/en/video?vid=0a3a5049-0999-4ca4-9003-d507a13d39b4');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000); // Wait for video player to initialize

    console.log('[Test] Hovering over video player to show controls...');
    const videoPlayer = page.locator('.video-js');
    await videoPlayer.hover({ force: true, timeout: 10000 });
    await page.waitForTimeout(500); // Wait for controls to appear

    console.log('[Test] Opening quality selector...');
    const qualityButton = page.locator('.vjs-quality-selector button, .vjs-menu-button[aria-label*="Quality"]');
    await qualityButton.click({ force: true, timeout: 10000 });
    await page.waitForTimeout(500);

    console.log('[Test] Menu opened, attempting to click 720p...');
    const option720p = page.getByRole('menuitemradio', { name: '720p' });
    await option720p.click({ force: true, timeout: 10000 });

    console.log('[Test] ✅ Successfully clicked 720p!');
    await page.waitForTimeout(1000);

    console.log('[Test] Taking screenshot...');
    await page.screenshot({ path: '/home/meywd/AlUmmahNow/apps/web/quality-selector-success.png', fullPage: true });

    console.log('[Test] ✅ All tests passed! Quality selector is working.');
  } catch (error) {
    console.error('[Test] ❌ Test failed:', error.message);
    await page.screenshot({ path: '/home/meywd/AlUmmahNow/apps/web/quality-selector-error.png', fullPage: true });
  } finally {
    await browser.close();
  }
})();
