'use client';

import { useSyncExternalStore } from 'react';

const noop = () => () => {};

/**
 * False on the server and while the page hydrates, true from the next render on. Text that depends
 * on the browser (its time zone) renders the server's form first, so the server-rendered HTML
 * hydrates without a mismatch, then switches to the viewer's own.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(noop, () => true, () => false);
}
