'use client';

/**
 * Refreshes the route once after mount. The detail page marks an unread
 * message read during its render; the admin layout (and its unread badge) is
 * not redrawn by that render, so one refresh brings the badge up to date.
 */
import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

export function RefreshOnce({ id }: { id: string }) {
  const router = useRouter();
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (done.current === id) return;
    done.current = id;
    router.refresh();
  }, [id, router]);
  return null;
}
