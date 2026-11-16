/**
 * Text on the frosted-glass boxes (`pb-glass` and the page builder's toned panels,
 * @al-ummah/shared-types/page-blocks.css) must stay WCAG AA whatever shows through them (the Fawanees
 * lantern street). For one box: every text line in the window that sits on the glass (not on a
 * button's own surface, not under the sticky header) is measured against the darkest AND the lightest
 * pixel behind it, with the page's text made transparent for the measuring shot. Self-contained (the
 * release suite needs only @playwright/test); AlUmmahNowUI apps/www/e2e/page-blocks-glass.spec.ts
 * measures www the same way.
 */
import type { Locator, Page } from '@playwright/test';

interface TextBox { x: number; y: number; w: number; h: number; rgb: [number, number, number]; large: boolean; text: string }

const lin = (v: number) => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const lum = ([r, g, b]: [number, number, number]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

async function textBoxes(box: Locator): Promise<TextBox[]> {
  return box.evaluate((panel) => {
    // Computed colours come as rgb()/rgba() or color(srgb r g b / a) (WebKit's canvas can't parse the latter)

    const rgbOf = (c: string): [number, number, number] => {

      let m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(c);

      if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];

      m = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(c);

      if (m) return [Number(m[1]) * 255, Number(m[2]) * 255, Number(m[3]) * 255];

      throw new Error(`text colour not understood: ${c}`);

    };
    const out: TextBox[] = [];
    const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = (n.textContent || '').trim();
      const el = n.parentElement;
      if (!text || !el || el.closest('[aria-hidden=true], .sr-only, svg')) continue;
      let own = false;
      for (let a: HTMLElement | null = el; a && a !== panel; a = a.parentElement) {
        const ac = getComputedStyle(a);
        if (ac.backgroundImage !== 'none' || !/rgba\(.*, 0\)$|transparent/.test(ac.backgroundColor)) own = true;
      }
      if (own) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility !== 'visible' || Number(cs.opacity) === 0) continue;
      const size = parseFloat(cs.fontSize);
      const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) {
        if (r.width < 2 || r.height < 2 || r.bottom <= 0 || r.top >= innerHeight) continue;
        const cx = r.left + r.width / 2;
        const ends = [document.elementFromPoint(cx, r.top + 1), document.elementFromPoint(cx, r.bottom - 1)];
        if (ends.some((e) => !e || !panel.contains(e))) continue;
        const inset = Math.max(0, (r.height - size) / 2);
        out.push({ x: r.left, y: r.top + inset, w: r.width, h: r.height - 2 * inset, rgb: rgbOf(cs.color), large, text: text.slice(0, 40) });
      }
    }
    return out;
  });
}

async function extremes(page: Page, png: Buffer, boxes: TextBox[]): Promise<{ min: number; max: number }[]> {
  return page.evaluate(async ([b64, list]) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0);
    const L = (v: number) => {
      const s = v / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return (list as TextBox[]).map((b) => {
      const x = Math.max(0, Math.floor(b.x)), y = Math.max(0, Math.floor(b.y));
      const w = Math.max(1, Math.min(c.width - x, Math.ceil(b.w))), h = Math.max(1, Math.min(c.height - y, Math.ceil(b.h)));
      const d = ctx.getImageData(x, y, w, h).data;
      let min = 1, max = 0;
      for (let i = 0; i < d.length; i += 4) {
        const v = 0.2126 * L(d[i]) + 0.7152 * L(d[i + 1]) + 0.0722 * L(d[i + 2]);
        if (v < min) min = v;
        if (v > max) max = v;
      }
      return { min, max };
    });
  }, [png.toString('base64'), boxes] as const);
}

/** The text on `box`'s glass at three scroll positions: problems (empty when all AA) and lines measured. */
export async function glassContrast(page: Page, box: Locator, label: string): Promise<{ problems: string[]; measured: number }> {
  const problems: string[] = [];
  let measured = 0;
  for (const block of ['start', 'center', 'end'] as const) {
    await box.evaluate((e, b) => e.scrollIntoView({ block: b as ScrollLogicalPosition }), block);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const boxes = await textBoxes(box);
    if (!boxes.length) continue;
    // CSSOM (a <style> tag could be refused by a CSP)
    const hide = (on: boolean) =>
      page.evaluate((v) => {
        for (const el of document.querySelectorAll<HTMLElement>('main, main *')) {
          // transitions off while the colours change, both ways: a colour transition (Fawanees) outranks even
          // an inline !important, and one left running would be read back as the text's colour
          el.style.setProperty('transition', 'none', 'important');
          for (const prop of ['color', '-webkit-text-fill-color', 'text-decoration-color', 'text-shadow']) {
            if (v) el.style.setProperty(prop, prop === 'text-shadow' ? 'none' : 'transparent', 'important');
            else el.style.removeProperty(prop);
          }
          if (!v) {
            void getComputedStyle(el).color;
            el.style.removeProperty('transition');
          }
        }
      }, on);
    await hide(true);
    // until the text is really gone: the same frame twice (a stale composited frame can still show it)
    let png = await page.screenshot({ scale: 'css' });
    for (let tries = 0; tries < 10; tries++) {
      const again = await page.screenshot({ scale: 'css' });
      if (again.equals(png)) break;
      png = again;
    }
    await hide(false);
    const ext = await extremes(page, png, boxes);
    measured += boxes.length;
    boxes.forEach((b, k) => {
      const L = lum(b.rgb);
      const worst = Math.min(ratio(L, ext[k].min), ratio(L, ext[k].max));
      const need = b.large ? 3 : 4.5;
      if (worst < need) problems.push(`${label} (${block}) "${b.text}": ${worst.toFixed(2)} < ${need}`);
    });
  }
  return { problems, measured };
}

/** The glass itself: a blur behind, a translucent surface, a glow in the theme's primary. */
export async function glassStyle(box: Locator): Promise<{ blur: string; shadow: string }> {
  return box.evaluate((e) => {
    const cs = getComputedStyle(e);
    return { blur: cs.backdropFilter || (cs as unknown as Record<string, string>).webkitBackdropFilter || '', shadow: cs.boxShadow };
  });
}
