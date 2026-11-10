'use client';

import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Renders overlays at the top of the document so no stacking context on the
 * page can trap them. While the player is fullscreen only the fullscreen
 * element is displayed, so overlays go there instead of the body.
 */
export function BodyPortal({ children }: { children: ReactNode }) {
  if (typeof document === 'undefined') return null;
  return createPortal(<div data-body-portal="">{children}</div>, document.fullscreenElement ?? document.body);
}
