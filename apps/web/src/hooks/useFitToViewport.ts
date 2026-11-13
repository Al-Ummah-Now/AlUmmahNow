'use client';

import { useLayoutEffect, useRef } from 'react';
import { fitToViewport } from '../../../../packages/fanous-tokens/nav/menu-fit.js';

/**
 * Keeps a hand-positioned popup inside the viewport while `open` (docs/design/NAV.md: no menu ever
 * renders outside the screen; owner bug 2026-11-13). Fits when it opens, when `deps` change, and
 * when its own size changes (content that loads after opening). Radix menus and selects place
 * themselves (collision handling) and MenuButton has its own placement: they do not need it.
 */
export function useFitToViewport<T extends HTMLElement>(open: boolean, ...deps: unknown[]) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!open || !el) return;
    fitToViewport(el);
    if (typeof ResizeObserver === 'undefined') return;
    let last = '';
    const ro = new ResizeObserver(([entry]) => {
      const size = `${Math.round(entry.contentRect.width)}x${Math.round(entry.contentRect.height)}`;
      if (size !== last) {
        last = size;
        fitToViewport(el);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ...deps]);
  return ref;
}
