// Temporary probe for the lantern street's cost (PR comment numbers); not merged.
// Street performance probe: scroll and "play" (an injected canvas-stream video) on a page with
// Fawanees on, 4x CPU throttle in Chromium. usage: node perf.mjs <baseURL> <browser> <label> path...
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const pw = require('@playwright/test');
const [base, bname, label, ...paths] = process.argv.slice(2);
const browser = await pw[bname].launch();
const out = [];
for (const mode of ['dark']) {
  for (const p of paths) {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 }, colorScheme: mode });
    await ctx.addCookies([{ name: 'aun_consent', value: `v1.a0.e0.p0.${Date.now()}`, url: base, sameSite: 'Lax' }]);
    await ctx.addInitScript((m) => { try { localStorage.setItem('theme', m); } catch {} }, mode);
    const page = await ctx.newPage();
    console.error('goto', p); await page.goto(base + p, { waitUntil: 'load', timeout: 120000 }).catch((e) => console.error('goto fail', e.message));
    await page.evaluate(([m, t]) => { const h = document.documentElement; h.dataset.theme = t; h.classList.toggle('dark', m === 'dark'); }, [mode, process.env.THEME || 'fawanees']);
    await page.waitForTimeout(3000);
    let cdp = null;
    if (bname === 'chromium' && process.env.THROTTLE !== '0') {
      cdp = await ctx.newCDPSession(page);
      await cdp.send('Performance.enable');
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    }
    const metrics = async () => {
      if (!cdp) return {};
      const { metrics } = await cdp.send('Performance.getMetrics');
      return Object.fromEntries(metrics.filter((m) => /Duration$/.test(m.name)).map((m) => [m.name, m.value]));
    };
    // One run: 5 s with a playing video (canvas stream redrawn every frame) while scrolling down and up
    const run = async () => {
      const m0 = await metrics();
      const r = await page.evaluate(async () => {
        const c = document.createElement('canvas'); c.width = 480; c.height = 270;
        const g = c.getContext('2d');
        const v = document.createElement('video'); v.muted = true; v.playsInline = true;
        v.style.cssText = 'position:fixed;right:16px;bottom:16px;width:320px;z-index:50';
        v.srcObject = c.captureStream(30); document.body.append(v); await Promise.race([v.play().catch(() => {}), new Promise((r) => setTimeout(r, 2000))]);
        let frames = 0, long = 0, last = performance.now(), worst = 0; const t0 = last;
        let dir = 1;
        await new Promise((done) => {
          const tick = (now) => {
            const dt = now - last; last = now; frames++; if (dt > 34) long++; worst = Math.max(worst, dt);
            g.fillStyle = `hsl(${(now / 10) % 360} 60% 40%)`; g.fillRect(0, 0, 480, 270); g.fillStyle = '#fff'; g.fillText(String(Math.round(now)), 20, 40);
            const max = document.documentElement.scrollHeight - innerHeight;
            if (scrollY >= max - 2) dir = -1; else if (scrollY <= 2) dir = 1;
            scrollBy(0, 30 * dir);
            if (now - t0 < 5000) requestAnimationFrame(tick); else done();
          };
          requestAnimationFrame(tick);
        });
        v.remove();
        return { fps: Math.round(frames / 5), longFrames: long, worstMs: Math.round(worst), street: document.documentElement.classList.contains('fanous-street'), lanterns: document.querySelectorAll('#fanous-street .fs-l').length };
      });
      const m1 = await metrics();
      const d = (k) => m1[k] != null ? Math.round((m1[k] - m0[k]) * 1000) : undefined;
      return { ...r, scriptMs: d('ScriptDuration'), layoutMs: d('LayoutDuration'), styleMs: d('RecalcStyleDuration'), taskMs: d('TaskDuration') };
    };
    console.error('run', p); const res = await run();
    out.push({ label, theme: process.env.THEME || 'fawanees', browser: bname, page: p, mode, ...res });
    console.log(JSON.stringify(out.at(-1)));
    await ctx.close();
  }
}
await browser.close();
