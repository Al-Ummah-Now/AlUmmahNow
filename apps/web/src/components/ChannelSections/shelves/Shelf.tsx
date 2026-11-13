'use client';

import type { ReactNode } from 'react';

interface ShelfProps<T> {
  items: T[];
  getKey: (item: T) => string;
  renderItem: (item: T, index: number) => ReactNode;
  /** Item width classes (the themes size Shorts tiles) */
  itemClassName?: string;
}

/**
 * A horizontal row that scrolls on its own axis. The themes style
 * `section[data-section] .flex.gap-4 > *`, so keep that structure.
 */
export function Shelf<T>({ items, getKey, renderItem, itemClassName = 'w-64 sm:w-72 md:w-80' }: ShelfProps<T>) {
  return (
    <div className="overflow-x-auto scrollbar-hide">
      <ul className="flex gap-4 pb-2" role="list">
        {items.map((item, index) => (
          <li key={getKey(item)} className={`flex-shrink-0 ${itemClassName}`}>
            {renderItem(item, index)}
          </li>
        ))}
      </ul>
    </div>
  );
}
