'use client';

import { useLayoutEffect, useRef } from 'react';

/** Where the shell switches between the phone drawer and the desktop rail (system.css). */
export const RAIL_DESKTOP_QUERY = '(min-width: 1024px)';

/** Longest rail/drawer/padding transition in system.css (240 ms drawer), plus a margin. */
export const RAIL_MOTION_MS = 320;

/**
 * The side panel (rail width, phone drawer slide) and the page's start padding
 * animate only while the menu is toggled: `html[data-rail-moving]` turns their
 * CSS transitions on for one transition's length (system.css).
 *
 * They used to be on all the time and turned off on a breakpoint change (a
 * rotation, a foldable unfolding) from the media query's change event. WebKit
 * can report that event after the new layout already started its transition,
 * so the page slid sideways under the viewer's finger, and a tap meant for
 * the player landed on the rail (player E2E, theatre on a Galaxy Z Fold, #1130).
 * Opting in on the toggle never animates a breakpoint change, whatever order
 * the browser reports it in.
 */
export function useRailMotion(open: boolean): void {
  const first = useRef(true);
  // Before paint: the drawer's data-open changes in the same commit, and its transition must already apply
  useLayoutEffect(() => {
    // The first render is the page's own layout, not a toggle
    if (first.current) {
      first.current = false;
      return;
    }
    const root = document.documentElement;
    root.dataset.railMoving = '';
    const timer = window.setTimeout(() => {
      delete root.dataset.railMoving;
    }, RAIL_MOTION_MS);
    return () => {
      window.clearTimeout(timer);
      delete root.dataset.railMoving;
    };
  }, [open]);
}
