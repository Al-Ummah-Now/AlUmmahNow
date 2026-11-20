'use client';

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

/**
 * One row of tabs or chips that never cuts an item at the edge and never wraps (owner rule,
 * #1669): as many items as fit, measured at run time, and the rest in a "More ▾" menu at the
 * row's end (the priority+ pattern). The current item is always in the row: when it would be
 * in the menu it takes the row's last slot.
 *
 * The caller renders the row's items (tabs, chips, links: its own markup and roles). The menu is
 * the site's menu (components/ui/dropdown-menu: Radix, so keyboard, focus, screen readers, page
 * direction and staying on screen are handled); its entries call `onSelect` or follow `href`.
 */
export interface PriorityItem {
  id: string;
  /** Text of the menu entry */
  label: string;
  current: boolean;
  /** A link: the menu entry follows it (client navigation is the caller's `onSelect`) */
  href?: string;
}

interface PriorityStripProps<T extends PriorityItem> {
  items: T[];
  /** One item of the row (a direct child of the row element: its own key, role and test id) */
  renderItem: (item: T) => React.ReactElement;
  onSelect?: (item: T) => void;
  moreLabel: string;
  menuLabel: string;
  /** Props of the row element itself (role="tablist", aria-label, data-testid, dir, classes) */
  rowProps?: React.HTMLAttributes<HTMLDivElement> & { 'data-testid'?: string };
  /** Classes of the element that holds the row and the More button */
  className?: string;
  /** Classes of the More button (match the row's items) */
  moreClassName?: string;
  testId?: string;
}

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** How many leading items fit, and where the current one goes (exported for tests) */
export function fitItems(widths: number[], gap: number, available: number, moreWidth: number, current: number): number[] {
  const n = widths.length;
  const span = (ids: number[]) => ids.reduce((sum, i) => sum + widths[i], 0) + Math.max(0, ids.length - 1) * gap;
  const all = widths.map((_, i) => i);
  if (span(all) <= available + 0.5) return all;
  const room = available - moreWidth - gap;
  for (let k = n - 1; k >= 1; k--) {
    const lead = all.slice(0, k);
    const ids = current >= k ? [...lead.slice(0, k - 1), current] : lead;
    if (span(ids) <= room + 0.5) return ids;
  }
  // Not even one item beside More: the current one alone (or nothing)
  return current >= 0 && widths[current] + gap + moreWidth <= available + 0.5 ? [current] : [];
}

export function PriorityStrip<T extends PriorityItem>({
  items,
  renderItem,
  onSelect,
  moreLabel,
  menuLabel,
  rowProps,
  className = '',
  moreClassName = '',
  testId,
}: PriorityStripProps<T>) {
  const holderRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  /** Natural widths of every item and of More, measured with all items in the row */
  const [widths, setWidths] = useState<{ items: number[]; more: number; gap: number } | null>(null);
  const [visible, setVisible] = useState<number[] | null>(null);
  const signature = items.map((i) => `${i.id}\u0000${i.label}`).join('\u0001');
  const current = items.findIndex((i) => i.current);

  // A new set of items (or labels): show them all, hidden, and measure again
  useIsomorphicLayoutEffect(() => {
    setWidths(null);
    setVisible(null);
  }, [signature]);

  useIsomorphicLayoutEffect(() => {
    if (widths || !rowRef.current || !moreRef.current) return;
    const children = Array.from(rowRef.current.children) as HTMLElement[];
    if (children.length !== items.length) return;
    const gap = parseFloat(getComputedStyle(rowRef.current).columnGap) || 0;
    setWidths({ items: children.map((c) => c.getBoundingClientRect().width), more: moreRef.current.getBoundingClientRect().width, gap });
  });

  const recompute = useCallback(() => {
    const holder = holderRef.current;
    if (!holder || !widths) return;
    const style = getComputedStyle(holder);
    const available = holder.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
    const next = fitItems(widths.items, widths.gap, available, widths.more, current);
    setVisible((prev) => (prev && prev.length === next.length && prev.every((v, i) => v === next[i]) ? prev : next));
  }, [widths, current]);

  useIsomorphicLayoutEffect(recompute, [recompute]);

  useEffect(() => {
    const holder = holderRef.current;
    if (!holder || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => recompute());
    observer.observe(holder);
    return () => observer.disconnect();
  }, [recompute]);

  // Web fonts change the widths: measure again once they are in
  useEffect(() => {
    let live = true;
    document.fonts?.ready.then(() => {
      if (live) {
        setWidths(null);
        setVisible(null);
      }
    });
    return () => {
      live = false;
    };
  }, []);

  const measuring = visible === null;
  const shown = useMemo(() => (visible ? new Set(visible) : null), [visible]);
  const rowItems = measuring ? items : items.filter((_, i) => shown!.has(i));
  const menuItems = measuring ? [] : items.filter((_, i) => !shown!.has(i));
  const hasMenu = measuring || menuItems.length > 0;

  const choose = (item: T) => {
    setOpen(false);
    onSelect?.(item);
  };

  return (
    <div ref={holderRef} className={`relative flex min-w-0 flex-1 items-center ${className}`} data-testid={testId} data-measuring={measuring || undefined}>
      <div
        {...rowProps}
        ref={rowRef}
        className={`flex min-w-0 flex-nowrap [&>*]:shrink-0 ${measuring ? 'invisible overflow-hidden' : ''} ${rowProps?.className ?? ''}`}
      >
        {rowItems.map((item) => renderItem(item))}
      </div>
      {hasMenu && (
        // The row's own gap before More (fitItems counts it)
        <div className={`shrink-0 ${measuring ? 'invisible' : ''}`} style={widths?.gap ? { marginInlineStart: widths.gap } : undefined}>
          <DropdownMenu open={open && !measuring} onOpenChange={setOpen}>
            <DropdownMenuTrigger asChild>
              <button
                ref={moreRef}
                type="button"
                tabIndex={measuring ? -1 : undefined}
                data-testid={testId ? `${testId}-more` : undefined}
                className={`inline-flex items-center gap-1 whitespace-nowrap ${moreClassName}`}
              >
                {moreLabel}
                <ChevronDown aria-hidden="true" className={`size-4 transition-transform ${open ? 'rotate-180' : ''}`} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" aria-label={menuLabel} data-testid={testId ? `${testId}-menu` : undefined} className="min-w-44">
              {menuItems.map((item) => {
                const shared = {
                  'aria-current': item.current ? ('true' as const) : undefined,
                  'data-testid': testId ? `${testId}-menu-${item.id}` : undefined,
                  className: item.current ? 'font-semibold' : undefined,
                };
                return item.href && !onSelect ? (
                  <DropdownMenuItem key={item.id} asChild {...shared}>
                    <Link href={item.href}>{item.label}</Link>
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem key={item.id} {...shared} onSelect={() => choose(item)}>
                    {item.label}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
}
