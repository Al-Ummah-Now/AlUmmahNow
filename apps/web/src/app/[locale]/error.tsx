'use client';

import { FriendlyError } from '@/components/errors/FriendlyError';

/** Errors in any page under /[locale]: reported, then a friendly screen inside the site layout. */
export default function LocaleError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <FriendlyError error={error} reset={reset} boundary="locale" />;
}
