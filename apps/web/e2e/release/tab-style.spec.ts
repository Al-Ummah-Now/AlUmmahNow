/**
 * Release regression (#488): every tab row uses the one `.tab-item` style.
 * - Selected and hover look the same: one bar (inset shadow) and one tile.
 * - Exactly one bar: no border-bottom or ::before/::after bar on top of it.
 * - The bar is the theme token (--fanous-c-tabs-indicator, else --fanous-color-primary).
 * - A tab's box does not move at rest, on hover, on focus or when selected.
 * Public pages only (channel tabs, search result-type row), en and ar, desktop and phone.
 */
import { test, expect, type Page, type Locator } from '@playwright/test';
import { target } from './targets';

const SELECTED = '[aria-selected="true"],[data-active="true"],[data-state="active"]';

interface Style { sh: string; bw: string; bg: string; fg: string; br: string; box: string }

const readStyle = (el: Locator): Promise<Style> =>
  el.evaluate((t) => {
    const c = getComputedStyle(t);
    const r = t.getBoundingClientRect();
    return {
      sh: c.boxShadow,
      bw: c.borderBottomWidth,
      bg: c.backgroundColor,
      fg: c.color,
      br: c.borderRadius,
      box: [(t as HTMLElement).offsetLeft, (t as HTMLElement).offsetTop, r.width, r.height].map((n) => n.toFixed(1)).join(','),
    };
  });

/** Problems visible without interaction: unstyled tabs, selected count, bar count and colour. */
const staticProblems = (page: Page): Promise<string[]> =>
  page.evaluate((sel) => {
    const out: string[] = [];
    document.querySelectorAll('[role=tab]:not(.tab-item)').forEach((t) => {
      if (t.getClientRects().length) out.push(`tab outside the shared style: ${t.textContent?.trim().slice(0, 20)}`);
    });
    const probe = document.createElement('i');
    probe.style.color = 'var(--fanous-c-tabs-indicator, var(--fanous-color-primary))';
    document.body.appendChild(probe);
    const token = getComputedStyle(probe).color;
    probe.remove();
    const rows = new Set([...document.querySelectorAll('.tab-item')].filter((e) => e.getClientRects().length).map((e) => e.parentElement!));
    rows.forEach((r) => {
      const tabs = [...r.querySelectorAll(':scope > .tab-item')];
      const active = tabs.filter((t) => t.matches(sel));
      if (active.length !== 1) out.push(`selected count ${active.length}`);
      active.forEach((t) => {
        const c = getComputedStyle(t);
        if (parseFloat(c.borderBottomWidth) > 0) out.push(`border-bottom stacked with the bar: ${c.borderBottomWidth}`);
        if (c.boxShadow === 'none') out.push('no bar');
        else if (!c.boxShadow.includes(token)) out.push(`bar colour is not the token: ${c.boxShadow} vs ${token}`);
        for (const ps of ['::before', '::after']) {
          const p = getComputedStyle(t, ps);
          if (p.content !== 'none' && p.content !== 'normal' && parseFloat(p.height) > 0) out.push(`second bar ${ps}`);
        }
      });
    });
    return out;
  }, SELECTED);

/**
 * Waits for the element's transitions to finish instead of a fixed delay: two
 * frames so a just-triggered transition has started, then every running
 * animation (pseudo-elements included) until none is left. A fixed wait was
 * flaky under parallel load, when a 120ms transition can take longer.
 */
const settle = (el: Locator) =>
  el.evaluate(async (t) => {
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await frame();
    for (let i = 0; i < 20; i++) {
      const running = t.getAnimations({ subtree: true }).filter((a) => a.playState !== 'finished');
      if (!running.length) break;
      await Promise.all(running.map((a) => a.finished.catch(() => undefined)));
      await frame();
    }
  });

/** Pointer away and nothing focused, then wait for the tab to finish transitioning back. */
async function rest(page: Page, el?: Locator) {
  await page.mouse.move(1, 1);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  if (el) await settle(el);
}

async function checkRow(page: Page, row: Locator, select: boolean): Promise<string[]> {
  const bad: string[] = [];
  const tabs = row.locator(':scope > .tab-item');
  const n = await tabs.count();
  let activeIdx = -1;
  for (let i = 0; i < n; i++) if (await tabs.nth(i).evaluate((t, s) => t.matches(s), SELECTED)) activeIdx = i;
  expect(activeIdx, 'one selected tab').toBeGreaterThanOrEqual(0);
  await rest(page, tabs.nth(activeIdx));
  const selected = await readStyle(tabs.nth(activeIdx));

  for (let i = 0; i < n; i++) {
    if (i === activeIdx) continue;
    const tab = tabs.nth(i);
    if (await tab.isDisabled()) continue;
    await tab.scrollIntoViewIfNeeded();
    await rest(page, tab);
    const before = await readStyle(tab);
    const name = (await tab.textContent())?.trim();
    {
      await tab.hover();
      await settle(tab);
      const h = await readStyle(tab);
      for (const f of ['sh', 'bw', 'bg', 'fg', 'br'] as const) {
        if (h[f] !== selected[f]) bad.push(`${name}: hover ${f} ${h[f]} differs from selected ${selected[f]}`);
      }
      if (h.box !== before.box) bad.push(`${name}: box moves on hover ${before.box} -> ${h.box}`);
      await rest(page, tab);
    }
    await tab.focus();
    await page.keyboard.press('Shift');
    await settle(tab);
    const f = await readStyle(tab);
    if (f.box !== before.box) bad.push(`${name}: box moves on focus ${before.box} -> ${f.box}`);
    await rest(page, tab);
  }

  if (select) {
    const idx = activeIdx === 0 ? 1 : 0;
    const tab = tabs.nth(idx);
    await rest(page, tab);
    const before = await readStyle(tab);
    await tab.click();
    await expect.poll(() => tab.evaluate((t, s) => t.matches(s), SELECTED), { timeout: 15000 }).toBe(true);
    await rest(page, tab);
    const after = await readStyle(tab);
    if (after.box !== before.box) bad.push(`box moves when selected ${before.box} -> ${after.box}`);
    const now = await readStyle(tab);
    for (const f of ['sh', 'bw', 'bg', 'fg', 'br'] as const) {
      if (now[f] !== selected[f]) bad.push(`newly selected ${f} ${now[f]} differs from selected ${selected[f]}`);
    }
  }
  return bad;
}

async function channelId(): Promise<string> {
  const res = await fetch(`${target().api}/api/channels?limit=10`);
  const body = (await res.json()) as { data?: { id: string }[] };
  const id = body.data?.[0]?.id;
  if (!id) throw new Error('no public channel to open');
  return id;
}

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'phone', width: 390, height: 844 },
];

for (const lang of ['en', 'ar'] as const) {
  for (const vp of VIEWPORTS) {
    test.describe(`tabs ${lang} ${vp.name}`, () => {
      test.use({ viewport: { width: vp.width, height: vp.height }, hasTouch: false });

      test.beforeEach(async ({ context }) => {
        await context.addCookies([{ name: 'aun_consent', value: `v1.a0.e0.p0.${Date.now()}`, url: target().web, sameSite: 'Lax' }]);
      });

      test('channel tabs: one bar, hover equals selected, nothing moves', async ({ page }) => {
        const id = await channelId();
        await page.goto(`${target().web}/${lang}/channels/${id}?tab=videos`);
        const row = page.getByTestId('channel-tabs');
        await expect(row).toBeVisible({ timeout: 60000 });
        await rest(page, row);
        expect(await staticProblems(page)).toEqual([]);
        expect(await checkRow(page, row, true)).toEqual([]);
        expect(await staticProblems(page)).toEqual([]);
      });

      test('search result types: one bar, hover equals selected, nothing moves', async ({ page }) => {
        await page.goto(`${target().web}/${lang}/search?q=a`);
        const row = page.getByTestId('search-type-all').locator('xpath=..');
        await expect(row).toBeVisible({ timeout: 60000 });
        await rest(page, row);
        expect(await staticProblems(page)).toEqual([]);
        expect(await checkRow(page, row, true)).toEqual([]);
        expect(await staticProblems(page)).toEqual([]);
      });
    });
  }
}
