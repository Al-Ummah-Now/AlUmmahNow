'use client';

/**
 * Names for ids shown by client components (issue #745). Every id asked for in the same tick
 * goes in one names request (GET /api/names → admin-api); answers are kept for the
 * life of the page, so a list of rows naming the same people asks once.
 */
import { useEffect, useState } from 'react';
import type { AdminNames } from '@al-ummah/shared-types';
import { logger } from '@/lib/logger-client';

type Ref = { kind: string; id: string };
const keyOf = (r: Ref) => `${r.kind}:${r.id}`;

const known: AdminNames = { users: {}, items: {} };
const asked = new Set<string>();
let queue: Ref[] = [];
let flushing: Promise<void> | null = null;
const listeners = new Set<() => void>();

function flush(): Promise<void> {
  if (!flushing) {
    flushing = Promise.resolve().then(async () => {
      const batch = queue;
      queue = [];
      flushing = null;
      if (!batch.length) return;
      // The names route takes up to 100 users and 100 items a call
      for (let at = 0; at < batch.length; at += 100) {
        const chunk = batch.slice(at, at + 100);
        try {
          const params = new URLSearchParams();
          for (const r of chunk) params.append(r.kind === 'user' ? 'u' : 'i', r.kind === 'user' ? r.id : `${r.kind}:${r.id}`);
          const res = await fetch(`/api/names?${params}`, { headers: { Accept: 'application/json' }, cache: 'no-store' });
          const body = (await res.json().catch(() => ({}))) as { result?: AdminNames };
          if (!res.ok || !body.result) throw new Error(`Names answered ${res.status}`);
          Object.assign(known.users, body.result.users);
          Object.assign(known.items, body.result.items);
        } catch (error) {
          logger.warn('[names] Lookup failed; showing ids', { count: chunk.length, error: error instanceof Error ? error.message : String(error) });
        }
      }
      listeners.forEach((l) => l());
    });
  }
  return flushing;
}

/** The names known for these ids; re-renders when more arrive. Ids without a name stay ids. */
export function useNames(refs: Ref[]): AdminNames {
  const [, setTick] = useState(0);
  const signature = refs.map(keyOf).sort().join('|');
  useEffect(() => {
    const listener = () => setTick((n) => n + 1);
    listeners.add(listener);
    let added = false;
    for (const r of refs) {
      if (!r.id || asked.has(keyOf(r))) continue;
      asked.add(keyOf(r));
      queue.push(r);
      added = true;
    }
    if (added) void flush();
    return () => {
      listeners.delete(listener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the signature is the refs' identity
  }, [signature]);
  return known;
}
