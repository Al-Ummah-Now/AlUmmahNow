'use client';

import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getVisibleBand, placeInBand } from '@/lib/ui/visible-band';

export interface MenuButtonItem {
  id: string;
  label: string;
  description?: string;
  icon?: React.ReactNode;
  /** Renders as menuitemradio with aria-checked when defined. */
  checked?: boolean;
  testId?: string;
  onSelect: () => void | Promise<void>;
}

interface MenuButtonProps {
  label: string;
  children: React.ReactNode;
  items: MenuButtonItem[];
  buttonClassName?: string;
  menuClassName?: string;
  testId?: string;
  /** Called when the menu opens (lazy loading). */
  onOpen?: () => void;
  disabled?: boolean;
}

/**
 * Accessible menu button (WAI-ARIA menu pattern): Enter/Space/ArrowDown open
 * and focus the first item, arrows/Home/End move, Escape closes and returns
 * focus, Tab closes.
 *
 * The menu is portalled to the top of the document (no card's stacking context
 * or overflow can trap it) at the popover layer (--z-popover), fixed-positioned
 * against the button: below it when it fits, else flipped above, then shifted to
 * stay inside the band between the sticky header and the phone tab bar. Its end
 * edge lines up with the button's end, so it works in LTR and RTL.
 */
export function MenuButton({ label, children, items, buttonClassName = '', menuClassName = '', testId, onOpen, disabled }: MenuButtonProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [place, setPlace] = useState<{ top: number; left: number; maxHeight: number; side: 'top' | 'bottom' } | null>(null);

  const position = useCallback(() => {
    const button = buttonRef.current;
    const menu = menuRef.current;
    if (!button || !menu) return;
    const anchor = button.getBoundingClientRect();
    const rtl = getComputedStyle(button).direction === 'rtl';
    // Natural size, unconstrained by a previous max height
    const prev = menu.style.maxHeight;
    menu.style.maxHeight = 'none';
    const size = { width: menu.offsetWidth, height: menu.offsetHeight };
    menu.style.maxHeight = prev;
    const next = placeInBand(anchor, size, getVisibleBand(), rtl);
    setPlace((cur) =>
      cur && cur.top === next.top && cur.left === next.left && cur.maxHeight === next.maxHeight && cur.side === next.side ? cur : next,
    );
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPlace(null);
      return;
    }
    position();
    const vv = window.visualViewport;
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    vv?.addEventListener('resize', position);
    vv?.addEventListener('scroll', position);
    return () => {
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
      vv?.removeEventListener('resize', position);
      vv?.removeEventListener('scroll', position);
    };
  }, [open, position, items.length]);

  const focusItem = (index: number) => {
    const count = items.length;
    if (count === 0) return;
    itemRefs.current[(index + count) % count]?.focus({ preventScroll: true });
  };

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) buttonRef.current?.focus();
  }, []);

  // Item to focus once the menu has rendered
  const pendingFocus = useRef<number | null>(null);

  const openMenu = (focusIndex = 0) => {
    pendingFocus.current = focusIndex;
    setOpen(true);
    onOpen?.();
  };

  useEffect(() => {
    // Once placed: a hidden (still measuring) item cannot take focus
    if (open && place && pendingFocus.current !== null) {
      focusItem(pendingFocus.current);
      pendingFocus.current = null;
    }
  });

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (containerRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      close(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open, close]);

  const onButtonKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      openMenu(0);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      openMenu(items.length - 1);
    }
  };

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    const current = itemRefs.current.findIndex((el) => el === document.activeElement);
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        focusItem(current + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        focusItem(current - 1);
        break;
      case 'Home':
        e.preventDefault();
        focusItem(0);
        break;
      case 'End':
        e.preventDefault();
        focusItem(items.length - 1);
        break;
      case 'Escape':
        e.preventDefault();
        close(true);
        break;
      case 'Tab':
        // The menu is portalled to the end of the page: back on the button first,
        // so Tab's default move continues from there, not from the page's end
        close(true);
        break;
    }
  };

  return (
    <div className="relative inline-block" ref={containerRef}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (open) close(false);
          else openMenu(0);
        }}
        onKeyDown={onButtonKeyDown}
        className={buttonClassName}
        data-testid={testId}
      >
        {children}
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          dir={buttonRef.current ? getComputedStyle(buttonRef.current).direction : undefined}
          data-side={place?.side}
          onKeyDown={onMenuKeyDown}
          style={{
            position: 'fixed',
            zIndex: 'var(--z-popover, 1000)',
            top: place?.top ?? 0,
            left: place?.left ?? 0,
            maxHeight: place?.maxHeight,
            overflowY: 'auto',
            // Measured before it is shown, so it never flashes in the wrong place
            visibility: place ? 'visible' : 'hidden',
          }}
          // Theme menu surface (.menu / [role=menu] tokens); never wider than the phone
          className={`menu max-w-[calc(100vw-16px)] text-start ${menuClassName}`}
        >
          {items.map((item, index) => (
            <button
              key={item.id}
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
              type="button"
              role={item.checked === undefined ? 'menuitem' : 'menuitemradio'}
              aria-checked={item.checked === undefined ? undefined : item.checked}
              tabIndex={-1}
              data-testid={item.testId}
              onClick={async (e) => {
                e.preventDefault();
                e.stopPropagation();
                close(true);
                await item.onSelect();
              }}
              // Theme menu row (.mi): token hover/focus; no bg-gray-* class (the theme turns those buttons primary)
              className="mi w-full py-2 text-start focus:outline-none"
            >
              {item.icon && <span className="flex-shrink-0" aria-hidden="true">{item.icon}</span>}
              <span className="min-w-0">
                <span className={`block ${item.checked ? 'font-semibold' : ''}`}>{item.label}</span>
                {item.description && <span className="block text-xs" style={{ color: 'var(--fanous-c-menu-muted)' }}>{item.description}</span>}
              </span>
            </button>
          ))}
        </div>,
        document.fullscreenElement ?? document.body,
      )}
    </div>
  );
}

export default MenuButton;
