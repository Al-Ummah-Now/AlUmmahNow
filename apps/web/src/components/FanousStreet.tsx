'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
// The shared lantern street module (one file for every app; other repos vendor it)
import { startStreet } from '../../../../packages/fanous-tokens/street/fanous-street.js';

/**
 * Pages that play video keep the street off, so the player stays smooth: the watch page (Shorts
 * open there too), Shorts and embeds.
 */
export const STREETLESS = /^\/(?:en|ar)\/(?:video|shorts|watch|embed)(?:\/|$)/;

/**
 * The Fawanees lantern street. Renders nothing: the module draws when the active theme switches
 * the street on (--fanous-street-on: 1) and follows layout, theme and mode changes by itself.
 */
export function FanousStreet() {
  const pathname = usePathname() ?? '';
  const off = STREETLESS.test(pathname);
  useEffect(() => {
    // The module reads this before it draws, and drops the street at once when it is set
    if (off) document.documentElement.dataset.fanousStreet = 'off';
    else delete document.documentElement.dataset.fanousStreet;
  }, [off]);
  useEffect(() => startStreet(), []);
  return null;
}
