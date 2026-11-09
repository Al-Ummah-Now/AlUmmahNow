'use client';
/**
 * The element a player's dialogs, menus and tooltips portal into, following fullscreen changes
 * (lib/video/player-layer.ts). Null until mounted, so nothing portals during server rendering.
 */
import { useEffect, useState } from 'react';
import { FULLSCREEN_EVENTS, layerHostFor } from '@/lib/video/player-layer';

export function usePlayerLayerHost(playerEl: Element | null | undefined): HTMLElement | null {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const update = () => setHost(layerHostFor(playerEl));
    update();
    for (const name of FULLSCREEN_EVENTS) document.addEventListener(name, update);
    return () => {
      for (const name of FULLSCREEN_EVENTS) document.removeEventListener(name, update);
    };
  }, [playerEl]);
  return host;
}
