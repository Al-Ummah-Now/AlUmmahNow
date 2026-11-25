'use client';

import { useCallback, useEffect, useRef } from 'react';

/**
 * A function that resolves with `value` as soon as it is there (at once when it already is).
 * For work the person can start before the page has loaded its data: a photo picked on a
 * server-rendered form waits for the profile instead of being dropped.
 */
export function useWhenReady<T>(value: T | null | undefined): () => Promise<T> {
  const current = useRef<T | null | undefined>(value);
  const waiting = useRef<Array<(v: T) => void>>([]);
  useEffect(() => {
    current.current = value;
    if (value == null) return;
    for (const resolve of waiting.current.splice(0)) resolve(value);
  }, [value]);
  return useCallback(
    () => (current.current != null ? Promise.resolve(current.current) : new Promise<T>((resolve) => waiting.current.push(resolve))),
    [],
  );
}
