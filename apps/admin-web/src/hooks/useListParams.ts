'use client';

/**
 * A list's filters, sort, page or cursor and saved view, read from and written
 * to the URL (lib/list/params.ts is the codec).
 *
 * Writes replace the current history entry without a reload or a server
 * round trip: the App Router syncs history.replaceState into useSearchParams
 * (router.replace would render the server page again for every filter).
 * So Back from an item returns to the list exactly as it was filtered, and a
 * copied URL opens the same list. Text (the search box) is written after a
 * short pause in typing.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { activeView, mergeListParams, parseListParams, selectView, serializeListParams, type ListChanges, type ListSpec, type ListValues, type SavedView } from '@/lib/list/params';

export const TEXT_DEBOUNCE_MS = 300;

export function useListParams(spec: ListSpec, views: readonly SavedView[] = []) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const values = useMemo(() => parseListParams(spec, new URLSearchParams(search)), [spec, search]);
  const latest = useRef(values);
  latest.current = values;
  const timer = useRef<number | null>(null);

  const write = useCallback(
    (next: ListValues) => {
      const query = serializeListParams(spec, next);
      const url = query ? `${pathname}?${query}` : pathname;
      if (typeof window === 'undefined' || `${window.location.pathname}${window.location.search}` === url) return;
      window.history.replaceState(window.history.state, '', url);
    },
    [pathname, spec],
  );

  const cancelPending = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);

  /** Sets or clears keys at once (filters reset the page). */
  const update = useCallback(
    (changes: ListChanges) => {
      cancelPending();
      write(mergeListParams(spec, latest.current, changes));
    },
    [cancelPending, spec, write],
  );

  /** Sets a text key after the admin pauses typing. */
  const updateText = useCallback(
    (key: string, text: string) => {
      cancelPending();
      timer.current = window.setTimeout(() => {
        timer.current = null;
        write(mergeListParams(spec, latest.current, { [key]: text }));
      }, TEXT_DEBOUNCE_MS);
    },
    [cancelPending, spec, write],
  );

  /** Clears every filter (keeps the sort). */
  const clear = useCallback(() => {
    cancelPending();
    write(latest.current.sort ? { sort: latest.current.sort } : {});
  }, [cancelPending, write]);

  const view = useMemo(() => activeView(views, values), [views, values]);
  const setView = useCallback(
    (id: string) => {
      cancelPending();
      write(selectView(spec, views, latest.current, id));
    },
    [cancelPending, spec, views, write],
  );

  useEffect(() => cancelPending, [cancelPending]);

  return { values, query: serializeListParams(spec, values), update, updateText, clear, view, setView };
}
