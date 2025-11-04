import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  console.log('🔍 Testing video metrics WebSocket connection...\n');
  
  // Listen for console logs
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('useVideoWebSocket') || text.includes('WebSocket') || text.includes('Initializing')) {
      console.log('🔌 Console:', text);
    }
  });
  
  // Navigate to video page
  console.log('📱 Loading video page...');
  await page.goto('http://localhost:3000/en/video?vid=0a3a5049-0999-4ca4-9003-d507a13d39b4');
  await page.waitForTimeout(3000);
  
  // Check if the Static/Live indicator exists
  const indicator = await page.locator('text=/🟢 Live|🔴 Static/').first();
  const indicatorText = await indicator.textContent().catch(() => null);
  
  console.log('\n📊 Initial Status:', indicatorText || 'NOT FOUND');
  
  // Wait for WebSocket to connect
  console.log('⏳ Waiting 10 seconds for WebSocket connection...\n');
  await page.waitForTimeout(10000);
  
  // Check indicator again
  const finalIndicatorText = await indicator.textContent().catch(() => null);
  console.log('📊 Final Status:', finalIndicatorText || 'NOT FOUND');
  
  // Take screenshot
  await page.screenshot({ path: 'websocket-test-result.png', fullPage: true });
  console.log('\n📸 Screenshot saved to websocket-test-result.png');
  
  // Check if it's Live
  if (finalIndicatorText && finalIndicatorText.includes('🟢 Live')) {
    console.log('\n✅ SUCCESS: WebSocket connected without authentication!');
  } else if (finalIndicatorText && finalIndicatorText.includes('🔴 Static')) {
    console.log('\n❌ FAILED: Still showing Static (WebSocket not connecting)');
    console.log('💡 Check browser console for errors');
  } else {
    console.log('\n❌ FAILED: Indicator not found');
  }
  
  await browser.close();
})();
