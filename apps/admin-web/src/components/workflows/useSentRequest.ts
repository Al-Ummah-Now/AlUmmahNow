'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { sentNoticeEnds, type PendingRequest } from '@/lib/workflows';

/**
 * The request a control just sent for approval: shows its notice and refreshes the page. The notice ends
 * once the page knows the request is not open (it was decided, even before the refresh came back), and
 * stays while the page doesn't know.
 */
export function useSentRequest(pendingRequest: PendingRequest): [string | null, (requestId: string) => void] {
  const router = useRouter();
  const [sent, setSent] = useState<string | null>(null);
  const [refreshing, startRefresh] = useTransition();
  // The page was read again after the change was sent (until then, "not listed" is the page from before it)
  const readAgain = useRef(false);
  const started = useRef(false);
  useEffect(() => {
    if (refreshing) started.current = true;
    else if (started.current) readAgain.current = true;
    if (sent && sentNoticeEnds(sent, pendingRequest, readAgain.current)) setSent(null);
  }, [pendingRequest, refreshing, sent]);
  const send = useCallback(
    (requestId: string) => {
      started.current = false;
      readAgain.current = false;
      setSent(requestId);
      startRefresh(() => router.refresh());
    },
    [router],
  );
  return [sent, send];
}
