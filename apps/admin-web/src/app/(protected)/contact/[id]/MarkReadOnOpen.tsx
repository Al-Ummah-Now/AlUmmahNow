'use client';

/**
 * Opening an unread message reads it, once per visit: it marks it read, then
 * refreshes the route so the page and the layout's unread badge show it. A
 * later "Mark as unread" refreshes this page without remounting this
 * component, so the message stays unread until it is opened again.
 */
import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { updateContactMessage } from '@/lib/api/admin';
import { logger } from '@/lib/logger-client';
import { useContactLive } from './ContactLiveState';

export function MarkReadOnOpen({ id, read }: { id: string; read: boolean }) {
  const router = useRouter();
  const { update } = useContactLive();
  const opened = useRef<string | null>(null);
  // The read state as of this render; the effect below reads it only when a message is opened
  const latestRead = useRef(read);
  useEffect(() => {
    latestRead.current = read;
  });
  useEffect(() => {
    if (opened.current === id) return;
    opened.current = id;
    if (latestRead.current) return;
    updateContactMessage(id, { read: true })
      .then((result) => {
        if (!result.ok) return logger.warn('[contact] Could not mark the message read', { id, status: result.status });
        update({ read: true });
        router.refresh();
      })
      .catch((error: unknown) => logger.warn('[contact] Could not mark the message read', { id, error: error instanceof Error ? error.message : String(error) }));
  }, [id, router, update]);
  return null;
}
