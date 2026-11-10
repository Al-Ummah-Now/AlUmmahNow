'use client';

import { useLayoutEffect, type RefObject } from 'react';

/** Layouts for a one-line action row, widest first. */
export const ACTION_ROW_FITS = ['full', 'icons', 'tight'] as const;
export type ActionRowFit = (typeof ACTION_ROW_FITS)[number];

/**
 * Keeps an action row on one line: sets `data-fit` on the row to the widest
 * layout whose content fits (full labels, then icon-only pills, then tight),
 * re-checking whenever the row or one of its items changes size. Each check
 * runs the ladder synchronously from `full`, so it never oscillates and the
 * browser paints only the final layout (ResizeObserver runs before paint).
 */
export function useActionRowFit(ref: RefObject<HTMLElement | null>, deps: readonly unknown[] = []): void {
  useLayoutEffect(() => {
    const row = ref.current;
    if (!row) return;
    const fits = () => row.scrollWidth <= row.clientWidth + 1;
    const apply = () => {
      for (const fit of ACTION_ROW_FITS) {
        if (row.dataset.fit !== fit) row.dataset.fit = fit;
        if (fits()) return;
      }
    };
    apply();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(apply);
    observer.observe(row);
    for (const child of Array.from(row.children)) observer.observe(child);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, ...deps]);
}
