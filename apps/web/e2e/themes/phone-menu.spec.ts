import { test, expect, type WebSocketRoute } from '@playwright/test';
import { applyTheme, MODES, mockApi, signIn, THEMES } from './harness';

/**
 * THEME-MENU (#898): on a phone the account menu is an opaque surface in every theme (Zujaj's glass card
 * material once made it see-through), and real-time toasts stay up beside it without covering an item.
 */
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

for (const theme of THEMES) {
  for (const mode of MODES) {
    test(`phone account menu ${theme} ${mode}`, async ({ page, context, baseURL }, info) => {
      test.skip(info.project.name !== 'phone', 'phone layout only');
      const sockets: WebSocketRoute[] = [];
      await page.routeWebSocket((u) => !/\/_next\//.test(u.pathname), (ws) => { sockets.push(ws); ws.onMessage(() => undefined); });
      await signIn(context, baseURL!);
      await mockApi(page);
      await page.goto('/en');
      await applyTheme(page, theme, mode);
      await expect.poll(() => sockets.length, { timeout: 30_000 }).toBeGreaterThan(0);
      for (let i = 0; i < 3; i++) {
        const data = { type: 'notification', notificationId: `m${Date.now()}${i}`, userId: 'x', notificationType: 'upload', notificationKey: 'uploadReady', params: { videoTitle: `V${i}` }, actionUrl: '/video/v1', persisted: false };
        sockets.forEach((ws) => ws.send(JSON.stringify({ type: 'notification', channel: 'user:x', timestamp: Date.now(), data })));
      }
      const toast = page.locator('[data-testid="realtime-toast"]').first();
      await expect(toast).toBeVisible();

      await page.locator('[data-testid="nav-menu-trigger"]:visible').first().click();
      const menu = page.locator('[data-testid="nav-menu"]:visible').first();
      await expect(menu).toBeVisible();
      await expect(toast, 'toasts stay up while the menu is open').toBeVisible();
      await page.screenshot({ path: info.outputPath(`phone-menu-${theme}-${mode}.png`) });

      // Never see-through (#898): frosted glass since O36 (2026-11-16), so the fill layers together cover at
      // least 85% (a Canvas layer that always resolves plus the menu colour) and the page behind is blurred
      const surface = await menu.evaluate((m) => { const s = getComputedStyle(m); return { color: s.backgroundColor, image: s.backgroundImage, blur: s.backdropFilter || (s as unknown as Record<string, string>).webkitBackdropFilter || '' }; });
      const alphaOf = (c: string): number => {
        if (/^rgb\(/.test(c)) return 1;
        const m = /\/\s*([\d.]+)\s*\)$/.exec(c) ?? /^rgba\([^)]*,\s*([\d.]+)\)$/.exec(c);
        return m ? Number(m[1]) : c.startsWith('color(') ? 1 : 0;
      };
      const layers = [surface.color, ...(surface.image.match(/(?:rgba?|color)\([^()]*\)/g) ?? []).slice(0, 1)];
      const cover = 1 - layers.reduce((clear, c) => clear * (1 - alphaOf(c)), 1);
      expect(cover, `menu surface ${JSON.stringify(surface)}`).toBeGreaterThanOrEqual(0.85);
      if (cover < 1) expect(surface.blur, `a translucent menu blurs the page behind it ${JSON.stringify(surface)}`).toMatch(/blur\(/);

      const covered = await menu.locator('[role^="menuitem"], a, button').evaluateAll((els) => els
        .filter((el) => el.getClientRects().length)
        .map((el) => { const r = el.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, Math.min(r.top + r.height / 2, innerHeight - 1)); return hit && !el.contains(hit) && hit.closest('[data-testid="realtime-toasts"]') ? el.textContent?.trim() : null; })
        .filter(Boolean));
      expect(covered, 'menu items covered by a toast').toEqual([]);
    });
  }
}
