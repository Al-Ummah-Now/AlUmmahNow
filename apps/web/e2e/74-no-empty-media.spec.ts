import { test, expect } from './fixtures';
import { ANONYMOUS_STATE } from './test-utils/auth-state';

/** Cards, tiles, covers and avatars show a loaded image or a designed placeholder, never an empty box. */
const PAGES = ['/en', '/ar', '/en/explore', '/en/search?q=mosque'];

const findProblems = ()=>{const bad: string[][]=[];const vis=(e: Element)=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>12&&r.height>12&&s.visibility!=='hidden'&&s.display!=='none'};
document.querySelectorAll<HTMLImageElement>('main img, header img').forEach(i=>{if(vis(i)&&(!i.complete||i.naturalWidth===0))bad.push(['broken image',(i.currentSrc||i.src||'').slice(-70)])});
document.querySelectorAll('main [class*="aspect-video"], main .rv-t, main .vc-t, main .video-card > :first-child, main [class*="rounded-full"][class*="overflow-hidden"]').forEach(e=>{if(!vis(e)||e.closest('.custom-video-player,.wsk-player,[data-testid=watch-skeleton]'))return;const filled=e.querySelector('img,svg,video,canvas,[data-testid*="placeholder"]')||getComputedStyle(e).backgroundImage!=='none'||[...e.querySelectorAll('*')].some(c=>getComputedStyle(c).backgroundImage!=='none')||(e.textContent||'').trim().length>0;if(!filled)bad.push(['empty media box',e.className.toString().slice(0,60)])});return bad};

test.describe('Media is never an empty box', () => {
  test.use({ storageState: ANONYMOUS_STATE });

  for (const path of PAGES) {
    test(`MEDIA-001 ${path}`, async ({ page }) => {
      await page.goto(path, { waitUntil: 'load' });
      await page.waitForTimeout(2000);
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      for (let y = 0; y < height; y += 700) {
        await page.evaluate((top) => window.scrollTo(0, top), y);
        await page.waitForTimeout(150);
      }
      await page.waitForTimeout(1500);
      expect(await page.evaluate(findProblems)).toEqual([]);
    });
  }
});
