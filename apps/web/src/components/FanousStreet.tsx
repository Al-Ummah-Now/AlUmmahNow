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
const BUILT_IN = ['lantern', 'zujaj', 'nahas', 'fawanees'];

/**
 * Preview deployments only (a *.workers.dev host, never alummahnow.net): ?theme=<built-in id>
 * shows that site theme in this tab, for reviewing a theme before an admin makes it active.
 * It changes nothing for anyone else and is kept for the tab's session.
 */
function previewTheme(): string | null {
  if (!location.hostname.endsWith('.workers.dev')) return null;
  const asked = new URLSearchParams(location.search).get('theme');
  try {
    if (asked && BUILT_IN.includes(asked)) sessionStorage.setItem('aun-preview-theme', asked);
    return sessionStorage.getItem('aun-preview-theme');
  } catch {
    return asked && BUILT_IN.includes(asked) ? asked : null;
  }
}

export function FanousStreet() {
  const pathname = usePathname() ?? '';
  const off = STREETLESS.test(pathname);
  useEffect(() => {
    const theme = previewTheme();
    if (theme) document.documentElement.dataset.theme = theme;
  }, [pathname]);
  useEffect(() => {
    // The module reads this before it draws, and drops the street at once when it is set
    if (off) document.documentElement.dataset.fanousStreet = 'off';
    else delete document.documentElement.dataset.fanousStreet;
  }, [off]);
  useEffect(() => startStreet(), []);
  return null;
}
