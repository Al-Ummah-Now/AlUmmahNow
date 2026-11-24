'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The request a control just sent for approval. Once the page's refresh lists it as open and a later one
 * no longer does (it was decided), the notice goes.
 */
export function useSentRequest(pendingRequest: string | undefined): [string | null, (requestId: string | null) => void] {
  const [sent, setSent] = useState<string | null>(null);
  const listed = useRef(false);
  useEffect(() => {
    if (!sent) listed.current = false;
    else if (pendingRequest === sent) listed.current = true;
    else if (listed.current) setSent(null);
  }, [pendingRequest, sent]);
  return [sent, setSent];
}
