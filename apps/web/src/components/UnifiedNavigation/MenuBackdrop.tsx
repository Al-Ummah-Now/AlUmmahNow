'use client';

import { createPortal } from 'react-dom';

/**
 * Click-away layer behind the open account menu.
 *
 * The header blurs what is behind it (backdrop-filter), which makes it the
 * containing block of its `position: fixed` children: a fixed inset-0 backdrop
 * inside it covers only the 64px header, so a click on the page or the rail went
 * through and left the menu open. The in-header layer still covers the header
 * (under the menu, which shares the header's stacking context); a second layer
 * on <body>, just under the header (z-index 50), covers everything else.
 */
export function MenuBackdrop({ onClose }: { onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden="true" data-testid="nav-menu-backdrop" />
      {typeof document !== 'undefined' &&
        createPortal(
          <div className="fixed inset-0 z-[49]" onClick={onClose} aria-hidden="true" data-testid="nav-menu-backdrop-page" />,
          document.body,
        )}
    </>
  );
}
