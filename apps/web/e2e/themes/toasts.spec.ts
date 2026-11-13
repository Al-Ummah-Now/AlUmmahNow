import { test, expect, type WebSocketRoute } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { applyTheme, LANGS, measureText, MODES, mockApi, signIn, THEMES } from './harness';

/**
 * THEME-TOAST (#1169): a real-time notification toast, with its action button, is readable in every
 * built-in theme, light and dark, English and Arabic: every text at least 4.5:1 from the rendered
 * pixels and axe colour-contrast clean. It is readable from its first frame too: it slides in
 * without fading (axe once caught the action at 1.09:1 mid-fade).
 */
for (const lang of LANGS) {
  for (const theme of THEMES) {
    for (const mode of MODES) {
      test(`toast ${theme} ${mode} ${lang}`, async ({ page, context, baseURL }, info) => {
        const sockets: WebSocketRoute[] = [];
        await page.routeWebSocket((u) => !/\/_next\//.test(u.pathname), (ws) => { sockets.push(ws); ws.onMessage(() => undefined); });
        await signIn(context, baseURL!);
        await mockApi(page);
        await page.goto(`/${lang}`);
        await applyTheme(page, theme, mode);
        await expect.poll(() => sockets.length, { timeout: 30_000 }).toBeGreaterThan(0);
        const data = { type: 'notification', notificationId: `t${Date.now()}`, userId: 'x', notificationType: 'upload', notificationKey: 'uploadReady', params: { videoTitle: 'Toast contrast' }, actionUrl: '/video/v1', persisted: false };
        const toast = page.getByTestId('realtime-toast').first();
        // The socket can open before the page subscribes to user:x, and a message sent before that is
        // dropped: send again (same notificationId, so one toast) until it shows (#1196)
        await expect(async () => {
          sockets.forEach((ws) => ws.send(JSON.stringify({ type: 'notification', channel: 'user:x', timestamp: Date.now(), data })));
          await expect(toast.getByTestId('realtime-toast-action')).toBeVisible({ timeout: 3_000 });
        }).toPass({ timeout: 30_000 });
        // Never see-through while it arrives: no opacity in its animation, fully opaque from the start
        const fade = await toast.evaluate((el) => {
          const name = getComputedStyle(el).animationName;
          const keyframes = [...document.styleSheets].flatMap((sheet) => { try { return [...sheet.cssRules]; } catch { return []; } })
            .filter((r): r is CSSKeyframesRule => r instanceof CSSKeyframesRule && r.name === name);
          return { opacity: getComputedStyle(el).opacity, fades: keyframes.some((k) => /opacity/.test(k.cssText)) };
        });
        expect(fade).toEqual({ opacity: '1', fades: false });

        // Keep it open while measuring: a toast expires after 8 s (TOAST_TTL_MS) and a busy dev server can
        // take longer than that for the steps below, so hover its message, which pauses the expiry and has
        // no hover style (only the close and action buttons do) (#1196)
        await toast.getByTestId('realtime-toast-message').hover();
        // Measure once it has finished sliding in
        await expect.poll(() => toast.evaluate((el) => el.getAnimations({ subtree: true }).every((a) => a.playState !== 'running')), { timeout: 5_000 }).toBe(true);
        await page.screenshot({ path: info.outputPath(`toast-${theme}-${mode}-${lang}.png`) });

        const texts = await measureText(page, '[data-testid=realtime-toasts]');
        expect(texts.some((t) => t.selector.startsWith('realtime-toast-action')), 'the action was measured').toBe(true);
        const low = texts.filter((t) => t.ratio < 4.5);
        expect(low, `low contrast:\n${low.map((t) => `${t.ratio}:1 ${t.fg} on ${t.bg} "${t.text}" (${t.selector})`).join('\n')}`).toEqual([]);

        const axe = await new AxeBuilder({ page }).include('[data-testid=realtime-toasts]').withRules(['color-contrast']).analyze();
        expect(axe.violations.flatMap((v) => v.nodes.map((n) => n.failureSummary))).toEqual([]);
      });
    }
  }
}
