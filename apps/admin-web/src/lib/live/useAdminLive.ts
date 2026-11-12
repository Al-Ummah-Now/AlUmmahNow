'use client';

/**
 * Live updates in admin pages (docs/admin/LIVE_OPS.md §B.5).
 *
 *   const { live } = useAdminLive(['jobs'], (update) => …, { poll: refetch, pollMs: 3000 });
 *
 * `onUpdate` gets each coalesced update of the topics (at most one per second
 * per topic). While any topic is not live (connecting, socket down, role not
 * allowed) `poll` runs every `pollMs`, the behaviour before WebSockets; when
 * the socket comes back after being down, `poll` runs once to catch up.
 */
import { useEffect, useRef, useState } from 'react';
import type { AdminLiveTopic, AdminLiveUpdate } from '@al-ummah/shared-types';
import { logger } from '@/lib/logger-client';
import { AdminLiveClient, type RealtimeTicket, type SocketLike } from './admin-live-client';

let shared: AdminLiveClient | null = null;

async function fetchTicket(): Promise<RealtimeTicket | null> {
  const res = await fetch('/api/realtime/token', { cache: 'no-store', credentials: 'same-origin' });
  if (!res.ok) return null;
  const body = (await res.json()) as Partial<RealtimeTicket>;
  return body.url && body.token ? { url: body.url, token: body.token, expiresAt: body.expiresAt } : null;
}

/** The tab's client (created on first use, in the browser only). */
export function adminLiveClient(): AdminLiveClient {
  if (!shared) {
    shared = new AdminLiveClient({
      createSocket: (url) => new WebSocket(url) as unknown as SocketLike,
      fetchTicket,
      setTimeout: (fn, ms) => window.setTimeout(fn, ms),
      clearTimeout: (handle) => window.clearTimeout(handle as number),
      now: () => Date.now(),
      random: Math.random,
      log: (level, message, context) => (level === 'warn' ? logger.warn(message, context) : logger.debug(message, context)),
    });
    const client = shared;
    document.addEventListener('visibilitychange', () => client.setVisible(document.visibilityState !== 'hidden'));
  }
  return shared;
}

export interface UseAdminLiveOptions {
  /** Refetch: runs every `pollMs` while the socket is not live, and once after it comes back. */
  poll?: () => void;
  pollMs?: number;
  /** false: follow nothing and never poll (e.g. no job running). Default true. */
  enabled?: boolean;
  /**
   * Also run `poll` once when the topics first become live: for followers that
   * start after the work they follow (a job queued a moment ago), so an update
   * sent before the subscription is not missed. Pages rendered fresh leave it off.
   */
  catchUpOnFirstLive?: boolean;
}

export function useAdminLive(
  topics: readonly AdminLiveTopic[],
  onUpdate: (update: AdminLiveUpdate) => void,
  { poll, pollMs, enabled = true, catchUpOnFirstLive = false }: UseAdminLiveOptions = {},
): { live: boolean } {
  const [live, setLive] = useState(false);
  const onUpdateRef = useRef(onUpdate);
  const pollRef = useRef(poll);
  useEffect(() => {
    onUpdateRef.current = onUpdate;
    pollRef.current = poll;
  });
  const key = [...topics].sort().join(',');

  useEffect(() => {
    if (!enabled || !key) return;
    const client = adminLiveClient();
    const names = key.split(',') as AdminLiveTopic[];
    const liveBy = new Map<AdminLiveTopic, boolean>();
    let wasLive = false;
    let everLive = catchUpOnFirstLive;
    const update = () => {
      const all = names.every((t) => liveBy.get(t));
      setLive(all);
      // Back after a drop: one refetch covers what was missed meanwhile
      if (all && !wasLive && everLive) pollRef.current?.();
      if (all) everLive = true;
      wasLive = all;
    };
    const offs = names.map((topic) =>
      client.subscribe(
        topic,
        (u) => onUpdateRef.current(u),
        (isLive) => {
          liveBy.set(topic, isLive);
          update();
        },
      ),
    );
    return () => offs.forEach((off) => off());
  }, [key, enabled, catchUpOnFirstLive]);

  useEffect(() => {
    if (!enabled || live || !pollMs) return;
    const timer = window.setInterval(() => pollRef.current?.(), pollMs);
    return () => window.clearInterval(timer);
  }, [enabled, live, pollMs]);

  return { live: enabled && live };
}
