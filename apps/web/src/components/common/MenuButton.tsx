'use client';

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';

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
 * focus, Tab closes. Positioned with logical `end-0` so it works in LTR and RTL.
 */
export function MenuButton({ label, children, items, buttonClassName = '', menuClassName = '', testId, onOpen, disabled }: MenuButtonProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const focusItem = (index: number) => {
    const count = items.length;
    if (count === 0) return;
    itemRefs.current[(index + count) % count]?.focus();
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
    if (open && pendingFocus.current !== null) {
      focusItem(pendingFocus.current);
      pendingFocus.current = null;
    }
  });

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) close(false);
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
        close(false);
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
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          className={`absolute end-0 z-40 mt-1 min-w-[14rem] rounded-lg border border-gray-200 bg-white py-1 text-start shadow-lg dark:border-gray-700 dark:bg-gray-900 ${menuClassName}`}
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
              className="flex w-full items-start gap-2 px-3 py-2 text-start text-sm text-gray-900 hover:bg-gray-100 focus:bg-gray-100 focus:outline-none dark:text-gray-100 dark:hover:bg-gray-800 dark:focus:bg-gray-800"
            >
              {item.icon && <span className="mt-0.5 flex-shrink-0" aria-hidden="true">{item.icon}</span>}
              <span className="min-w-0">
                <span className={`block ${item.checked ? 'font-semibold' : ''}`}>{item.label}</span>
                {item.description && <span className="block text-xs text-gray-500 dark:text-gray-400">{item.description}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default MenuButton;
