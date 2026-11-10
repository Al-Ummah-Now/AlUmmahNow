'use client';

import { useEffect } from 'react';

/** Where the shell switches between the phone drawer and the desktop rail (system.css). */
export const RAIL_DESKTOP_QUERY = '(min-width: 1024px)';

/**
 * Crossing the breakpoint changes the side panel's width (300 px drawer ↔ rail)
 * and the page's start padding at once. Their CSS transitions are meant for the
 * menu toggle; on a breakpoint change they would sweep the panel over the page
 * for a moment (longer while the page is busy, e.g. during a batch upload).
 * `html[data-rail-still]` turns those transitions off for the frames the layout
 * changes in, then the toggle animates again.
 */
export function useRailBreakpointStill(): void {
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(RAIL_DESKTOP_QUERY);
    const root = document.documentElement;
    let frame = 0;
    const onChange = () => {
      root.dataset.railStill = '';
      cancelAnimationFrame(frame);
      // Two frames: the new layout is painted before transitions come back
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          delete root.dataset.railStill;
        });
      });
    };
    query.addEventListener('change', onChange);
    return () => {
      query.removeEventListener('change', onChange);
      cancelAnimationFrame(frame);
      delete root.dataset.railStill;
    };
  }, []);
}
