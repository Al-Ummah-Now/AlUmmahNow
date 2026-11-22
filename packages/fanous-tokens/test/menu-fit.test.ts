/**
 * nav/menu-fit.js: a popup is shifted, narrowed, height-capped or opened upwards into the viewport
 * (docs/design/NAV.md "Menus never leave the screen").
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

type Box = { left: number; top: number; width: number; height: number };
const rect = (b: Box) => ({ ...b, right: b.left + b.width, bottom: b.top + b.height });

function stubPopup(box: Box, opts: { vw?: number; vh?: number; anchor?: Box; position?: string; visual?: { offsetTop: number; height: number }; bar?: Box } = {}) {
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
    closest: (sel: string) => (sel === '.aun-header' && opts.bar ? { getBoundingClientRect: () => rect(opts.bar!) } : null),
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

const { coverBar, fitToViewport } = await import('../nav/menu-fit.js');

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

test('a phone sheet hangs 4px under its bar when a banner pushes the bar down (AUDIT-2, CMS #154)', () => {
  // CSS puts the sheet at the bar's height + 4px (60px); a 40px banner puts the bar's bottom at 96px
  const { el, style } = stubPopup({ left: 8, top: 60, width: 359, height: 300 }, { position: 'fixed', bar: { left: 0, top: 40, width: 375, height: 56 } });
  fitToViewport(el);
  assert.equal(style.translate, '0px 40px');
  // the height cap counts from where the sheet now starts
  const tall = stubPopup({ left: 8, top: 60, width: 359, height: 900 }, { position: 'fixed', bar: { left: 0, top: 40, width: 375, height: 56 } });
  fitToViewport(tall.el);
  assert.equal(tall.style['max-block-size'], `${667 - 8 - 100}px`);
});

test('a phone sheet under a bar at the top stays where its CSS put it', () => {
  const { el, style } = stubPopup({ left: 8, top: 60, width: 359, height: 300 }, { position: 'fixed', bar: { left: 0, top: 0, width: 375, height: 56 } });
  fitToViewport(el);
  assert.equal(style.translate, undefined);
});

/** The search sheet (fixed, CSS top 0) inside a bar whose top a banner moved; listeners recorded. */
function stubSheet(bar: { top: number }) {
  const style: Record<string, string> = {};
  const listeners: Record<string, Set<() => void>> = {};
  const el = {
    closest: (sel: string) => (sel === '.aun-header' ? { getBoundingClientRect: () => rect({ left: 0, top: bar.top, width: 375, height: 56 }) } : null),
    getBoundingClientRect: () => rect({ left: 0, top: 0, width: 375, height: 56 }),
    style: { removeProperty: (k: string) => delete style[k], set translate(v: string) { style.translate = v; } },
  };
  Object.assign(globalThis, {
    window: {
      addEventListener: (type: string, fn: () => void) => (listeners[type] ??= new Set()).add(fn),
      removeEventListener: (type: string, fn: () => void) => listeners[type]?.delete(fn),
    },
  });
  const fire = (type: string) => listeners[type]?.forEach((fn) => fn());
  return { el: el as unknown as HTMLElement, style, fire, listeners };
}

test('the search sheet covers its bar under a banner, and follows it on scroll until it closes (CMS #154)', () => {
  const bar = { top: 66 };
  const { el, style, fire, listeners } = stubSheet(bar);
  const release = coverBar(el);
  assert.equal(style.translate, '0px 66px');
  // the page scrolls: the banner leaves, the sticky bar reaches the top, the sheet follows
  bar.top = 20;
  fire('scroll');
  assert.equal(style.translate, '0px 20px');
  bar.top = -10;
  fire('scroll');
  assert.equal(style.translate, undefined, 'never above the viewport');
  release();
  assert.equal(listeners.scroll.size + listeners.resize.size, 0);
  assert.equal(style.translate, undefined);
});

test('the search sheet under a bar at the top stays where its CSS put it', () => {
  const { el, style } = stubSheet({ top: 0 });
  coverBar(el)();
  assert.equal(style.translate, undefined);
});
