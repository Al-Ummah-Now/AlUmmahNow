'use client';

/**
 * The Contact messages nav badge, live on every admin page: on a contact
 * event (admin:moderation, queue "contact") or a resync it re-reads the unread
 * count, and only the count. It never refreshes the page: a layout-wide
 * router.refresh() on every contact event raced the page's own live refresh
 * (the Jobs page missed its update and once reloaded, 16-live-updates).
 * The server-rendered count stays the starting point and wins whenever the
 * layout renders again.
 */
import { useEffect, useRef, useState } from 'react';
import { getContactCounts } from '@/lib/api/admin';
import { useAdminLive } from '@/lib/live/useAdminLive';
import { logger } from '@/lib/logger-client';

export function useLiveContactBadge(serverCount: number | null | undefined): number | null | undefined {
  const [count, setCount] = useState(serverCount);
  // A newer server render (navigation refresh, an action's refresh) replaces the live value
  const [fromServer, setFromServer] = useState(serverCount);
  if (fromServer !== serverCount) {
    setFromServer(serverCount);
    setCount(serverCount);
  }
  const reading = useRef(0);
  const enabled = serverCount !== null && serverCount !== undefined;

  useAdminLive(
    ['moderation'],
    (update) => {
      if (!update.resync && !update.events.some((e) => e.queue === 'contact')) return;
      const ticket = ++reading.current;
      getContactCounts()
        .then((counts) => {
          // Only the newest read lands (reads can finish out of order)
          if (ticket === reading.current) setCount(counts.unread);
        })
        .catch((error: unknown) => logger.debug('[shell] Contact badge not refreshed', { error: error instanceof Error ? error.message : String(error) }));
    },
    { enabled },
  );

  useEffect(() => () => {
    reading.current++;
  }, []);
  return count;
}
