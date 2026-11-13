/**
 * nav/menu-fit.js: a popup is shifted, narrowed and height-capped into the viewport
 * (docs/design/NAV.md "Menus never leave the screen").
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

type Rect = { left: number; right: number; top: number; width: number };

function stubPopup(rect: Rect, cssMaxBlock = 'none') {
  const style: Record<string, string> = {};
  const el = {
    hidden: false,
    isConnected: true,
    getClientRects: () => [rect],
    getBoundingClientRect: () => {
      const width = style['max-inline-size'] ? Math.min(rect.width, parseFloat(style['max-inline-size'])) : rect.width;
      return { left: rect.left, right: rect.left + width, top: rect.top, width };
    },
    style: {
      removeProperty: (k: string) => delete style[k],
      set translate(v: string) { style.translate = v; },
      set maxInlineSize(v: string) { style['max-inline-size'] = v; },
      set maxBlockSize(v: string) { style['max-block-size'] = v; },
    },
  };
  Object.assign(globalThis, {
    document: { documentElement: { clientWidth: 375 } },
    window: { innerHeight: 667, addEventListener: () => {} },
    getComputedStyle: () => ({ maxBlockSize: cssMaxBlock }),
  });
  return { el, style };
}

const { fitToViewport } = await import('../nav/menu-fit.js');

test('a menu past the start edge slides in to the 8px gutter', () => {
  const { el, style } = stubPopup({ left: -262, right: 74, top: 60, width: 336 });
  fitToViewport(el as unknown as HTMLElement);
  assert.equal(style.translate, '270px 0');
});

test('a menu past the end edge slides back', () => {
  const { el, style } = stubPopup({ left: 200, right: 536, top: 60, width: 336 });
  fitToViewport(el as unknown as HTMLElement);
  assert.equal(style.translate, '-169px 0');
});

test('a menu wider than the screen is narrowed to it', () => {
  const { el, style } = stubPopup({ left: 0, right: 500, top: 60, width: 500 });
  fitToViewport(el as unknown as HTMLElement);
  assert.equal(style['max-inline-size'], '359px');
  assert.equal(style.translate, '8px 0');
});

test('its height is capped to the room below its top, unless its own cap is smaller', () => {
  const tall = stubPopup({ left: 10, right: 300, top: 114, width: 290 }, 'none');
  fitToViewport(tall.el as unknown as HTMLElement);
  assert.equal(tall.style['max-block-size'], '545px');
  assert.equal(tall.style.translate, undefined);
  const short = stubPopup({ left: 10, right: 300, top: 114, width: 290 }, '320px');
  fitToViewport(short.el as unknown as HTMLElement);
  assert.equal(short.style['max-block-size'], undefined);
});
