'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Click-away layer behind the open account menu.
 *
 * The header blurs what is behind it (backdrop-filter), which makes it the
 * containing block of its `position: fixed` children: a fixed inset-0 backdrop
 * inside it covers only the 64px header, so a click on the page or the rail went
 * through and left the menu open. The in-header layer still covers the header
 * (under the menu, which shares the header's stacking context); a second layer
 * covers everything else, just under the header (z-index 50).
 *
 * That second layer goes next to the header (into the header's parent), not on
 * <body>: the page wrapper (.demo-layer, z-index 1) is its own stacking
 * context, so a z-49 layer on <body> sat above the whole wrapper, header and
 * menu included, and swallowed every click in the menu (Sign In among them).
 */
export function MenuBackdrop({ onClose }: { onClose: () => void }) {
  const headerLayer = useRef<HTMLDivElement>(null);
  const [pageHost, setPageHost] = useState<Element | null>(null);

  useLayoutEffect(() => {
    const header = headerLayer.current?.closest('header');
    setPageHost(header?.parentElement ?? document.body);
  }, []);

  return (
    <>
      <div ref={headerLayer} className="fixed inset-0 z-40" onClick={onClose} aria-hidden="true" data-testid="nav-menu-backdrop" />
      {pageHost &&
        createPortal(
          <div className="fixed inset-0 z-[49]" onClick={onClose} aria-hidden="true" data-testid="nav-menu-backdrop-page" />,
          pageHost,
        )}
    </>
  );
}
