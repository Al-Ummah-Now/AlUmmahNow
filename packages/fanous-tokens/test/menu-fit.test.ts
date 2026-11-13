/**
 * nav/menu-fit.js: a popup is shifted, narrowed, height-capped or opened upwards into the viewport
 * (docs/design/NAV.md "Menus never leave the screen").
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

type Box = { left: number; top: number; width: number; height: number };
const rect = (b: Box) => ({ ...b, right: b.left + b.width, bottom: b.top + b.height });

function stubPopup(box: Box, opts: { vw?: number; vh?: number; anchor?: Box; position?: string; visual?: { offsetTop: number; height: number } } = {}) {
  const style: Record<string, string> = {};
  const vw = opts.vw ?? 375;
  const vh = opts.vh ?? 667;
  const el = {
    hidden: false,
    isConnected: true,
    getClientRects: () => [box],
    getBoundingClientRect: () => {
      const width = style['max-inline-size'] ? Math.min(box.width, parseFloat(style['max-inline-size'])) : box.width;
      return rect({ ...box, width });
    },
    offsetParent: opts.anchor ? { getBoundingClientRect: () => rect(opts.anchor!) } : null,
    style: {
      removeProperty: (k: string) => delete style[k],
      set translate(v: string) { style.translate = v; },
      set maxInlineSize(v: string) { style['max-inline-size'] = v; },
      set maxBlockSize(v: string) { style['max-block-size'] = v; },
    },
  };
  Object.assign(globalThis, {
    document: { documentElement: { clientWidth: vw }, body: {} },
    window: {
      innerHeight: vh,
      addEventListener: () => {},
      visualViewport: opts.visual ? { offsetLeft: 0, offsetTop: opts.visual.offsetTop, width: vw, height: opts.visual.height, addEventListener: () => {} } : undefined,
    },
    getComputedStyle: () => ({ position: opts.position ?? 'absolute' }),
  });
  return { el: el as unknown as HTMLElement, style };
}

const { fitToViewport } = await import('../nav/menu-fit.js');

test('a menu past the start edge slides in to the 8px gutter', () => {
  const { el, style } = stubPopup({ left: -262, top: 60, width: 336, height: 200 });
  fitToViewport(el);
  assert.equal(style.translate, '270px 0px');
});

test('a menu past the end edge slides back', () => {
  const { el, style } = stubPopup({ left: 200, top: 60, width: 336, height: 200 });
  fitToViewport(el);
  assert.equal(style.translate, '-169px 0px');
});

test('a menu wider than the screen is narrowed to it', () => {
  const { el, style } = stubPopup({ left: 0, top: 60, width: 500, height: 200 });
  fitToViewport(el);
  assert.equal(style['max-inline-size'], '359px');
  assert.equal(style.translate, '8px 0px');
});

test('a menu that fits below is left alone', () => {
  const { el, style } = stubPopup({ left: 10, top: 114, width: 290, height: 300 });
  fitToViewport(el);
  assert.deepEqual(style, {});
});

test('too tall with no anchor to flip around: capped to the room below, never a minimum height', () => {
  const { el, style } = stubPopup({ left: 10, top: 314, width: 290, height: 320 }, { vw: 844, vh: 390, position: 'fixed' });
  fitToViewport(el);
  assert.equal(style['max-block-size'], '68px');
  assert.equal(style.translate, undefined);
});

test('little room below and more above the anchor: opens upwards, capped to the room above (WebKit 844×390)', () => {
  // the picker's input sits at 266..310; its list hangs 4px under it and wants 320px
  const { el, style } = stubPopup({ left: 290, top: 314, width: 460, height: 320 }, { vw: 844, vh: 390, anchor: { left: 290, top: 266, width: 460, height: 44 } });
  fitToViewport(el);
  // above = 266 - 4 - 8 = 254 > below = 68: list ends 4px above the anchor
  assert.equal(style['max-block-size'], '254px');
  assert.equal(style.translate, `0px ${266 - 4 - 254 - 314}px`);
});

test('opens upwards uncapped when the whole list fits above', () => {
  const { el, style } = stubPopup({ left: 290, top: 314, width: 460, height: 120 }, { vw: 844, vh: 390, anchor: { left: 290, top: 266, width: 460, height: 44 } });
  fitToViewport(el);
  assert.equal(style['max-block-size'], undefined);
  assert.equal(style.translate, `0px ${266 - 4 - 120 - 314}px`);
});

test('an on-screen keyboard (smaller visual viewport) counts as the bottom', () => {
  const { el, style } = stubPopup({ left: 10, top: 100, width: 290, height: 300 }, { position: 'fixed', visual: { offsetTop: 0, height: 300 } });
  fitToViewport(el);
  assert.equal(style['max-block-size'], '192px');
});
