'use client';

import { FriendlyError } from '@/components/errors/FriendlyError';

/** Upload page: a crash there is reported with its own boundary name (uploads are the riskiest flow). */
export default function UploadError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <FriendlyError error={error} reset={reset} boundary="upload" />;
}
