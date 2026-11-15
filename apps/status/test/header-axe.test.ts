/**
 * Accessibility of the status page header (docs/design/NAV.md "Header"): axe-core on the
 * rendered page in English and Arabic, WCAG 2.0–2.2 A/AA, with the experimental
 * label-content-name-mismatch rule switched on (WCAG 2.5.3: the visible label of the language
 * button must be inside its accessible name). jsdom has no layout, so colour contrast is left to
 * the browser checks (the videos web and admin E2E, which run the same rules on the shared header);
 * every rule that reads the markup and ARIA runs here, in CI with the unit tests.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import type { AxeResults, RunOptions } from 'axe-core';
import { renderIncidentPage, renderStatusPage } from '../src/render';

const axeSource: string = createRequire(import.meta.url)('axe-core').source;

const OPTIONS: RunOptions = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  rules: { 'label-content-name-mismatch': { enabled: true }, 'color-contrast': { enabled: false } },
};

/**
 * jsdom has no canvas. label-content-name-mismatch draws each label's text on a canvas to rule out
 * icon-font ligatures (text that renders as an icon). The header has no icon fonts (its icons are
 * inline SVG), so this 2D context draws every string as plain text: each character as wide as the
 * next, and ink on the canvas.
 */
function plainTextCanvas(win: Window) {
  const proto = (win as unknown as { HTMLCanvasElement: { prototype: { getContext: unknown } } }).HTMLCanvasElement.prototype;
  proto.getContext = function (this: HTMLCanvasElement) {
    return {
      canvas: this,
      font: '',
      textAlign: 'left',
      textBaseline: 'top',
      measureText: (text: string) => ({ width: [...text].length * 30 }),
      fillText() {},
      clearRect() {},
      getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(Math.max(1, Math.ceil(w) * Math.ceil(h)) * 4).fill(255) }),
    };
  };
}

async function axeHeader(html: string): Promise<AxeResults> {
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
  try {
    plainTextCanvas(dom.window as unknown as Window);
    const win = dom.window as unknown as { eval(src: string): void; axe: { run(ctx: unknown, o: RunOptions): Promise<AxeResults> } };
    // axe-core's own bundled source, injected into the test page (its documented jsdom setup)
    win.eval(axeSource);
    const header = dom.window.document.querySelector('header.aun-header');
    assert.ok(header, 'the page has the shared header');
    return await win.axe.run({ include: [header] }, OPTIONS);
  } finally {
    dom.window.close();
  }
}

const empty = { overall: 'operational', lastCheckedAt: null, components: [], active: [], upcoming: [], history: [] } as unknown as Parameters<typeof renderStatusPage>[0];

describe('header accessibility (axe-core, WCAG 2.2 AA, label-content-name-mismatch on)', () => {
  for (const locale of ['en', 'ar'] as const) {
    it(`${locale}: no violations on the status and incident pages`, async () => {
      const o = { locale, path: '/incidents/i1', search: '?a=1', assetVersion: 'v', environment: 'qa' };
      for (const html of [renderStatusPage(empty, o), renderIncidentPage(null, o)]) {
        const r = await axeHeader(html);
        // Array.from: the results are arrays of the jsdom window's realm
        assert.deepEqual(Array.from(r.violations, (v) => `${v.id}: ${Array.from(v.nodes, (n) => n.html).join(' | ')}`), []);
        // the opt-in rule was switched on: axe reports it (inapplicable while no control has an aria-label)
        const seen = [...r.passes, ...r.incomplete, ...r.inapplicable].some((x) => x.id === 'label-content-name-mismatch');
        assert.ok(seen, 'label-content-name-mismatch was run');
      }
    });
  }

  it('a language link whose aria-label hides its visible text fails (the rule bites)', async () => {
    const html = renderStatusPage(empty, { locale: 'ar', path: '', search: '', assetVersion: 'v', environment: 'qa' })
      .replace('<a class="aun-lang"', '<a class="aun-lang" aria-label="Switch language"');
    const r = await axeHeader(html);
    assert.ok(r.violations.some((v) => v.id === 'label-content-name-mismatch'), 'the owner-reported failure is caught');
  });
});
