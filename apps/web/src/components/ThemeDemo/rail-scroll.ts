'use client';

import { useEffect, useRef, type RefObject } from 'react';

/** Pixels of slack: sub-pixel heights must not leave the fade on at the very end. */
const END_SLACK = 2;

/** True while part of the list is below the visible area (#1620). */
export function hasMoreBelow(el: Pick<HTMLElement, 'scrollTop' | 'clientHeight' | 'scrollHeight'>): boolean {
  return el.scrollTop + el.clientHeight < el.scrollHeight - END_SLACK;
}

/**
 * How many pixels to hide at the bottom of the list so no item shows cut by its edge: the item that
 * straddles the bottom edge is hidden whole, so the edge strip always sits under a complete item with
 * that item's own padding as the gap (AUDIT-2: «إرشادات» ended 3px above the strip). Rects are viewport
 * coordinates; 0 when nothing straddles the edge.
 */
export function cutItemTail(listBottom: number, items: ReadonlyArray<{ top: number; bottom: number }>): number {
  for (const it of items) {
    if (it.top < listBottom - END_SLACK && it.bottom > listBottom + 0.5) return Math.max(0, Math.ceil(listBottom - it.top));
  }
  return 0;
}

/** The collapsed rail item's own block padding (system.css .nv) and the least it may shrink to. */
const BASE_PAD = 10;
const MIN_PAD = 6;

/**
 * The block padding that lets every collapsed rail item fit, when the list is only a little taller than
 * its box: the Arabic labels take more lines than English («المرئيات التي أعجبتك», «الخصوصية وملفات تعريف
 * الارتباط»), so at 1280×800 «إرشادات المجتمع» did not fit where "Community guidelines" does (#1723 ruling:
 * the rail shows the same items in both languages). `overflow` is the list's height beyond its box at the
 * full padding; null keeps the full padding (it fits, or tightening could not make it fit: the list then
 * scrolls and the cut item is hidden as before).
 */
export function railPad(overflow: number, count: number): number | null {
  if (overflow <= END_SLACK || count === 0) return null;
  const pad = Math.floor(BASE_PAD - overflow / (2 * count));
  return pad >= MIN_PAD ? pad : null;
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
      // Tighten first (collapsed rail only; the open rail's rows have a fixed height): the overflow is
      // measured as if at the full padding, so applying the padding never flips the result back
      const links = el.querySelectorAll<HTMLElement>('.nv');
      const collapsed = typeof document !== 'undefined' && document.documentElement.dataset.rail !== 'open';
      const current = parseFloat(el.style.getPropertyValue('--nv-pad-y')) || BASE_PAD;
      const natural = el.scrollHeight + links.length * 2 * (BASE_PAD - current) - el.clientHeight;
      const pad = collapsed ? railPad(natural, links.length) : null;
      if (pad === null) {
        if (el.style.getPropertyValue('--nv-pad-y')) el.style.removeProperty('--nv-pad-y');
      } else if (pad !== current) {
        el.style.setProperty('--nv-pad-y', `${pad}px`);
      }
      if (hasMoreBelow(el)) {
        el.dataset.moreBelow = '';
        // Hide the item the edge would cut (system.css clips the list by --nv-tail; layout is unchanged)
        const bottom = el.getBoundingClientRect().bottom;
        const items = Array.from(el.querySelectorAll<HTMLElement>('.nv, .nv-heading'), (n) => n.getBoundingClientRect());
        el.style.setProperty('--nv-tail', `${cutItemTail(bottom, items)}px`);
      } else {
        delete el.dataset.moreBelow;
        el.style.removeProperty('--nv-tail');
      }
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    // The items too, not only the list: when the web font arrives the labels rewrap (an Arabic label
    // set in the fallback font took a line more), the list's own box keeps its size, and a tail
    // measured before then hid «إرشادات المجتمع» behind an empty band (AUDIT-2, #1630)
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    const watchItems = () => {
      resize?.disconnect();
      resize?.observe(el);
      el.querySelectorAll<HTMLElement>('.nv, .nv-heading').forEach((n) => resize?.observe(n));
    };
    watchItems();
    const mutate = typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => { watchItems(); update(); });
    mutate?.observe(el, { childList: true, subtree: true });
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    fonts?.addEventListener?.('loadingdone', update);
    void fonts?.ready?.then(update);
    return () => {
      el.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      fonts?.removeEventListener?.('loadingdone', update);
      resize?.disconnect();
      mutate?.disconnect();
    };
  }, []);
  return ref;
}
