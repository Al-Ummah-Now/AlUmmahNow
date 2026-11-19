'use client';

import { useEffect, useRef, type RefObject } from 'react';

/** Pixels of slack: sub-pixel heights must not leave the fade on at the very end. */
const END_SLACK = 2;

/** True while part of the list is below the visible area (#1620). */
export function hasMoreBelow(el: Pick<HTMLElement, 'scrollTop' | 'clientHeight' | 'scrollHeight'>): boolean {
  return el.scrollTop + el.clientHeight < el.scrollHeight - END_SLACK;
}

/**
 * The side rail's list scrolls with a hidden scrollbar, so on a short window its last item was simply cut off
 * at the bottom edge (#1620). This keeps `data-more-below` on the list while items are below the visible
 * area; system.css then shades the edge strip under the list, never over it (and shows a thin scrollbar on hover/focus). Re-checked on
 * scroll, when the list or the window resizes (rail open/closed, language, zoom) and when items change.
 */
export function useMoreBelow<T extends HTMLElement>(): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      if (hasMoreBelow(el)) el.dataset.moreBelow = '';
      else delete el.dataset.moreBelow;
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    resize?.observe(el);
    const mutate = typeof MutationObserver === 'undefined' ? null : new MutationObserver(update);
    mutate?.observe(el, { childList: true, subtree: true });
    return () => {
      el.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      resize?.disconnect();
      mutate?.disconnect();
    };
  }, []);
  return ref;
}
