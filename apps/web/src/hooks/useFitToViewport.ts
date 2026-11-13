'use client';

import { useLayoutEffect, useRef } from 'react';
import { fitToViewport, releaseFit } from '../../../../packages/fanous-tokens/nav/menu-fit.js';

/**
 * Keeps a hand-positioned popup inside the viewport while `open` (docs/design/NAV.md: no menu ever
 * renders outside the screen; owner bug 2026-11-13). Fits when it opens and when `deps` change;
 * fitToViewport itself re-fits when the popup's size changes (content that loads after opening)
 * and on resize. Radix menus and selects place themselves (collision handling) and MenuButton has
 * its own placement: they do not need it.
 */
export function useFitToViewport<T extends HTMLElement>(open: boolean, ...deps: unknown[]) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!open || !el) return;
    fitToViewport(el);
    return () => releaseFit(el);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ...deps]);
  return ref;
}
