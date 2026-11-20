'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import Link from '@/components/AppLink';
import { useLanguage } from '@/i18n/I18nProvider';
import { fitToViewport } from '../../../../packages/fanous-tokens/nav/menu-fit.js';

/**
 * One row of link tabs that never cuts a tab at the edge and never wraps (owner rule, #1669; the
 * videos site's components/ui/PriorityStrip): as many tabs as fit, measured at run time, the rest
 * in a "More ▾" menu at the row's end, and the current tab always in the row (when it would be in
 * the menu it takes the row's last slot). The menu is the shared header menu (aun-menu: frosted,
 * kept on screen), a real menu for keyboards and screen readers.
 */
export interface PriorityTab {
  id: string;
  label: string;
  href: string;
  current: boolean;
  /** Shown after the label in the row and the menu (a count badge) */
  extra?: ReactNode;
}

interface PriorityTabsProps {
  tabs: PriorityTab[];
  /** The nav's accessible name */
  label: string;
  /** Classes of one tab and of More; the current one adds `currentClassName` */
  tabClassName: string;
  currentClassName: string;
  idleClassName: string;
  /** Classes of the nav (border, margin) */
  className?: string;
  /** Classes of the row of tabs (gap) */
  rowClassName?: string;
  testId?: string;
  /** Test ids of the tabs: `<prefix><id>` (a string: server pages render this) */
  tabTestIdPrefix?: string;
}

/** How many leading tabs fit, and where the current one goes (the videos site's fitItems) */
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
  return current >= 0 && widths[current] + gap + moreWidth <= available + 0.5 ? [current] : [];
}

export function PriorityTabs({ tabs, label, tabClassName, currentClassName, idleClassName, className = '', rowClassName = '', testId, tabTestIdPrefix }: PriorityTabsProps) {
  const { t } = useLanguage();
  const navRef = useRef<HTMLElement>(null);
  const rowRef = useRef<HTMLUListElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [widths, setWidths] = useState<{ items: number[]; more: number; gap: number } | null>(null);
  const [visible, setVisible] = useState<number[] | null>(null);
  const signature = tabs.map((tab) => `${tab.id}\u0000${tab.label}`).join('\u0001');
  const current = tabs.findIndex((tab) => tab.current);

  useLayoutEffect(() => {
    setWidths(null);
    setVisible(null);
  }, [signature]);

  useLayoutEffect(() => {
    if (widths || !rowRef.current || !moreRef.current) return;
    const items = Array.from(rowRef.current.children) as HTMLElement[];
    if (items.length !== tabs.length) return;
    const gap = parseFloat(getComputedStyle(rowRef.current).columnGap) || 0;
    setWidths({ items: items.map((el) => el.getBoundingClientRect().width), more: moreRef.current.getBoundingClientRect().width, gap });
    // Again whenever the widths are reset (new labels, fonts in)
  }, [widths, signature]);

  const recompute = useCallback(() => {
    const nav = navRef.current;
    if (!nav || !widths) return;
    const style = getComputedStyle(nav);
    const available = nav.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
    const next = fitItems(widths.items, widths.gap, available, widths.more, current);
    setVisible((prev) => (prev && prev.length === next.length && prev.every((v, i) => v === next[i]) ? prev : next));
  }, [widths, current]);

  useLayoutEffect(recompute, [recompute]);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => recompute());
    observer.observe(nav);
    return () => observer.disconnect();
  }, [recompute]);

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
  const rowTabs = measuring ? tabs : tabs.filter((_, i) => shown!.has(i));
  const menuTabs = measuring ? [] : tabs.filter((_, i) => !shown!.has(i));
  const hasMenu = measuring || menuTabs.length > 0;

  const close = useCallback((focusButton: boolean) => {
    setOpen(false);
    if (focusButton) moreRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || moreRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !menuRef.current) return;
    fitToViewport(menuRef.current);
    const entries = Array.from(menuRef.current.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    (entries.find((e) => e.getAttribute('aria-current')) ?? entries[0])?.focus();
  }, [open]);

  const onMenuKey = (event: KeyboardEvent<HTMLUListElement>) => {
    const entries = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const at = entries.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => entries[(i + entries.length) % entries.length]?.focus();
    if (event.key === 'ArrowDown') { event.preventDefault(); go(at + 1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); go(at - 1); }
    else if (event.key === 'Home') { event.preventDefault(); go(0); }
    else if (event.key === 'End') { event.preventDefault(); go(entries.length - 1); }
    else if (event.key === 'Escape') { event.preventDefault(); close(true); }
    else if (event.key === 'Tab') setOpen(false);
    else if (event.key === ' ') { event.preventDefault(); (document.activeElement as HTMLElement | null)?.click(); }
  };

  const onMoreKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
    }
  };

  return (
    <nav ref={navRef} aria-label={label} className={`relative flex min-w-0 items-center ${className}`} data-testid={testId} data-measuring={measuring || undefined}>
      <ul ref={rowRef} className={`flex min-w-0 flex-nowrap [&>*]:shrink-0 ${measuring ? 'invisible overflow-hidden' : ''} ${rowClassName}`}>
        {rowTabs.map((tab) => (
          <li key={tab.id}>
            <Link href={tab.href} aria-current={tab.current ? 'page' : undefined} className={`${tabClassName} ${tab.current ? currentClassName : idleClassName}`} data-testid={tabTestIdPrefix ? `${tabTestIdPrefix}${tab.id}` : undefined}>
              {tab.label}
              {tab.extra}
            </Link>
          </li>
        ))}
      </ul>
      {hasMenu && (
        <div className={`relative shrink-0 ${measuring ? 'invisible' : ''}`} style={widths?.gap ? { marginInlineStart: widths.gap } : undefined}>
          <button
            ref={moreRef}
            type="button"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-controls={open ? menuId : undefined}
            tabIndex={measuring ? -1 : undefined}
            onClick={() => setOpen((o) => !o)}
            onKeyDown={onMoreKey}
            className={`inline-flex items-center gap-1 whitespace-nowrap ${tabClassName} ${idleClassName}`}
            data-testid={testId ? `${testId}-more` : undefined}
          >
            {t('common.moreTabs')}
            <svg aria-hidden="true" viewBox="0 0 24 24" className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
          </button>
          {open && menuTabs.length > 0 && (
            <ul ref={menuRef} id={menuId} role="menu" aria-label={t('common.moreTabsMenu')} onKeyDown={onMenuKey} className="aun-menu" style={{ width: 'max-content', minWidth: '12rem', maxWidth: 'calc(100vw - 16px)', paddingTop: 4 }} data-testid={testId ? `${testId}-menu` : undefined}>
              {menuTabs.map((tab) => (
                <li key={tab.id} role="none">
                  <Link
                    href={tab.href}
                    role="menuitem"
                    tabIndex={-1}
                    aria-current={tab.current ? 'page' : undefined}
                    onClick={() => close(false)}
                    className={`aun-menu-item ${tab.current ? 'font-semibold' : ''}`}
                    data-testid={testId ? `${testId}-menu-${tab.id}` : undefined}
                  >
                    {tab.label}
                    {tab.extra}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </nav>
  );
}
