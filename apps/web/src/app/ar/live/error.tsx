'use client';

import { FriendlyError } from '@/components/errors/FriendlyError';

/** Errors in /ar/live: reported, then the friendly screen (no raw message, reference to quote). */
export default function LiveError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <FriendlyError error={error} reset={reset} boundary="live" locale="ar" />;
}
