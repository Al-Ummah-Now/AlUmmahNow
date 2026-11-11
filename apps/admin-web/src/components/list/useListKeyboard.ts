'use client';

/**
 * Keyboard support for a list (lib/list/keyboard.ts is the model): j / k move
 * the current row and focus its main link (so a screen reader reads it and
 * Enter opens it), x selects the current row, Enter opens it when focus is on
 * the row itself, and / focuses the search box. Never while typing in a field.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { listKeyAction, moveIndex } from '@/lib/list/keyboard';

export interface ListKeyboardOptions {
  rowIds: readonly string[];
  /** The table or list element holding rows marked `data-row-id`. */
  containerRef: React.RefObject<HTMLElement | null>;
  onToggle?: (id: string) => void;
  onOpen?: (id: string) => void;
  /** The search box (or a function that focuses it). */
  focusSearch?: () => void;
  enabled?: boolean;
}

const rowSelector = (id: string) => `[data-row-id="${CSS.escape(id)}"]`;

export function useListKeyboard({ rowIds, containerRef, onToggle, onOpen, focusSearch, enabled = true }: ListKeyboardOptions) {
  const [current, setCurrent] = useState<string | null>(null);
  const latest = useRef({ rowIds, current, onToggle, onOpen, focusSearch });
  latest.current = { rowIds, current, onToggle, onOpen, focusSearch };

  const focusRow = useCallback(
    (id: string) => {
      const row = containerRef.current?.querySelector<HTMLElement>(rowSelector(id));
      if (!row) return;
      const target = row.querySelector<HTMLElement>('[data-row-primary]') ?? row;
      target.focus({ preventScroll: true });
      row.scrollIntoView?.({ block: 'nearest' });
    },
    [containerRef],
  );

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const { rowIds: ids, current: cur, onToggle: toggle, onOpen: open, focusSearch: search } = latest.current;
      const active = document.activeElement as HTMLElement | null;
      const inList = !!active && !!containerRef.current?.contains(active);
      const onControl = !!active && active !== document.body && (active.tagName === 'A' || active.tagName === 'BUTTON' || active.tagName === 'INPUT');
      const action = listKeyAction(e, active, { focusOnRowControl: onControl });
      if (!action || action === 'undo') return;
      if (action === 'search') {
        if (!search) return;
        e.preventDefault();
        search();
        return;
      }
      if (ids.length === 0) return;
      // Enter and x act on the current row only when focus is in the list or on nothing in particular
      if ((action === 'open' || action === 'toggle') && !inList && active && active !== document.body) return;
      e.preventDefault();
      if (action === 'next' || action === 'prev') {
        const index = moveIndex(cur ? ids.indexOf(cur) : -1, ids.length, action);
        const id = ids[index];
        setCurrent(id);
        focusRow(id);
        return;
      }
      if (!cur || !ids.includes(cur)) return;
      if (action === 'toggle') toggle?.(cur);
      if (action === 'open') open?.(cur);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [containerRef, enabled, focusRow]);

  // A row that left the page is no longer current
  useEffect(() => {
    if (current && !rowIds.includes(current)) setCurrent(null);
  }, [current, rowIds]);

  return { current, setCurrent };
}
