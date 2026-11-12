'use client';

/**
 * Re-renders a server page when its admin topic changes (docs/admin/LIVE_OPS.md):
 * drop `<LiveRefresh topics={['errors']} />` into the page. Updates arrive at
 * most once a second per topic. Without the socket nothing polls unless
 * `pollMs` is given (these pages used to need a reload).
 */
import { useRouter } from 'next/navigation';
import type { AdminLiveTopic } from '@al-ummah/shared-types';
import { useAdminLive } from '@/lib/live/useAdminLive';

export function LiveRefresh({
  topics,
  pollMs,
  queues,
}: {
  topics: AdminLiveTopic[];
  pollMs?: number;
  /** admin:moderation: refresh only for these queues (default: any event). A resync always refreshes. */
  queues?: string[];
}) {
  const router = useRouter();
  useAdminLive(
    topics,
    (update) => {
      if (update.resync || !queues || update.events.some((e) => queues.includes(String(e.queue)))) router.refresh();
    },
    { poll: () => router.refresh(), pollMs },
  );
  return null;
}
