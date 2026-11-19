/**
 * Contrast of a post card's action row (counts and icons) against what is really behind them.
 *
 * The card is frosted glass over the page, so a token-to-token check cannot see the real
 * background. For each count (text) and icon in the row this hides the row's foreground, captures
 * the pixels behind each one, and measures its colour against the darkest and the lightest of
 * them: the worst of the two must meet WCAG AA (4.5:1 for text, 3:1 for an icon).
 */
import type { Locator, Page } from '@playwright/test';

export interface RowContrast {
  /** e.g. "button 2 icon", "button 1 count" */
  name: string;
  kind: 'text' | 'icon';
  color: string;
  ratio: number;
  required: number;
}

type Rgb = [number, number, number];

const lum = ([r, g, b]: Rgb) => {
  const c = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
};
const ratio = (a: Rgb, b: Rgb) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};

export async function actionRowContrast(page: Page, row: Locator): Promise<RowContrast[]> {
  const handle = await row.elementHandle();
  if (!handle) throw new Error('action row not found');
  // Targets: every icon, and every element whose own text is a count
  const targets = await handle.evaluate((root) => {
    const toRgb = (color: string): [number, number, number] => {
      const c = document.createElement('canvas');
      c.width = c.height = 1;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2]];
    };
    const out: Array<{ name: string; kind: 'text' | 'icon'; rgb: [number, number, number]; color: string; box: { x: number; y: number; width: number; height: number } }> = [];
    const controls = [...root.querySelectorAll<HTMLElement>('button, [data-testid="post-views"]')];
    controls.forEach((control, i) => {
      control.querySelectorAll<SVGElement>('svg').forEach((svg) => {
        const r = svg.getBoundingClientRect();
        if (!r.width) return;
        const color = getComputedStyle(svg).color;
        out.push({ name: `control ${i + 1} icon`, kind: 'icon', rgb: toRgb(color), color, box: { x: r.x, y: r.y, width: r.width, height: r.height } });
      });
      control.querySelectorAll<HTMLElement>('span').forEach((span) => {
        const own = [...span.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent ?? '').join('').trim();
        if (!own || getComputedStyle(span).position === 'absolute') return;
        const r = span.getBoundingClientRect();
        if (!r.width) return;
        const color = getComputedStyle(span).color;
        out.push({ name: `control ${i + 1} count "${own}"`, kind: 'text', rgb: toRgb(color), color, box: { x: r.x, y: r.y, width: r.width, height: r.height } });
      });
    });
    // Hide the foreground so the captures show only what is behind it
    // (transitions off first: a transition-all would animate visibility and keep it on screen)
    root.querySelectorAll<HTMLElement | SVGElement>('svg, span').forEach((el) => {
      el.style.setProperty('transition', 'none', 'important');
      el.style.setProperty('visibility', 'hidden', 'important');
    });
    return out;
  });

  const results: RowContrast[] = [];
  try {
    for (const t of targets) {
      const clip = { x: Math.max(0, t.box.x), y: Math.max(0, t.box.y), width: Math.max(1, t.box.width), height: Math.max(1, t.box.height) };
      const png = (await page.screenshot({ clip })).toString('base64');
      // The darkest and lightest pixels behind it, decoded in the page (no image library needed)
      const [dark, light] = await page.evaluate(async (data) => {
        const img = new Image();
        img.src = `data:image/png;base64,${data}`;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        const px = ctx.getImageData(0, 0, c.width, c.height).data;
        let lo: [number, number, number] = [255, 255, 255];
        let hi: [number, number, number] = [0, 0, 0];
        const l = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
        for (let i = 0; i < px.length; i += 4) {
          const p: [number, number, number] = [px[i], px[i + 1], px[i + 2]];
          if (l(...p) < l(...lo)) lo = p;
          if (l(...p) > l(...hi)) hi = p;
        }
        return [lo, hi];
      }, png);
      results.push({
        name: t.name,
        kind: t.kind,
        color: t.color,
        ratio: Math.round(Math.min(ratio(t.rgb, dark), ratio(t.rgb, light)) * 100) / 100,
        required: t.kind === 'text' ? 4.5 : 3,
      });
    }
  } finally {
    await handle.evaluate((root) => root.querySelectorAll<HTMLElement | SVGElement>('svg, span').forEach((el) => {
      el.style.removeProperty('visibility');
      el.style.removeProperty('transition');
    }));
  }
  return results;
}
