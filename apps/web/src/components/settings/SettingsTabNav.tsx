'use client';

/**
 * Settings section links under a settings header. Looks like the public
 * channel tab bar (same spacing, underline and colours) so the settings page
 * reads as the channel page, but these are links with aria-current.
 * Scrolls sideways on narrow screens and keeps the current item in view.
 */

import React, { useEffect, useRef } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/hooks/useLanguage';
import { cn } from '@/lib/utils';

export interface SettingsTabItem {
  key: string;
  label: string;
  href: string;
}

interface SettingsTabNavProps {
  items: SettingsTabItem[];
  current: string;
  testId?: string;
}

export function SettingsTabNav({ items, current, testId = 'settings-tab-nav' }: SettingsTabNavProps) {
  const { t, dir } = useLanguage();
  const activeRef = useRef<HTMLAnchorElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Bring the current tab into view sideways only (never scroll the page)
  useEffect(() => {
    const list = listRef.current;
    const el = activeRef.current;
    if (!list || !el || list.scrollWidth <= list.clientWidth) return;
    const box = el.getBoundingClientRect();
    const frame = list.getBoundingClientRect();
    if (box.left < frame.left) list.scrollLeft -= frame.left - box.left + 16;
    else if (box.right > frame.right) list.scrollLeft += box.right - frame.right + 16;
  }, [current]);

  return (
    <nav aria-label={t.inlineEdit.settingsSections} className="relative bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700" data-testid={testId}>
      <div className="max-w-6xl mx-auto px-2 sm:px-5">
        <ul ref={listRef} className="flex overflow-x-auto scrollbar-hide" dir={dir}>
          {items.map((item) => {
            const active = item.key === current;
            return (
              <li key={item.key} className="flex-shrink-0">
                <Link
                  ref={active ? activeRef : undefined}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'block px-4 sm:px-6 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors',
                    active
                      ? 'border-yellow-500 text-yellow-800 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/20'
                      : 'border-transparent text-gray-600 dark:text-gray-400 hover:border-yellow-500 hover:text-gray-900 dark:hover:text-gray-200'
                  )}
                  data-testid={`${testId}-${item.key}`}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}

export default SettingsTabNav;
