'use client';

import { useLanguage } from '@/hooks/useLanguage';
import type { Channel } from '@al-ummah/shared-types';

const boxClass =
  'mx-auto my-3 max-w-5xl rounded-lg border border-destructive border-s-4 bg-card px-4 py-3 text-card-foreground shadow-sm';

/** Shown to a signed-in user an admin banned on the videos platform. */
export function VideosBannedNotice({ reason }: { reason: string | null }) {
  const { t } = useLanguage();
  return (
    <div role="alert" data-testid="videos-banned-notice" className={boxClass}>
      <p className="font-semibold">{t.profile.videosBannedTitle}</p>
      <p className="mt-1 text-sm">{t.profile.videosBannedBody}</p>
      {reason && <p className="mt-1 text-sm">{t.profile.videosBannedReason.replace('{reason}', reason)}</p>}
    </div>
  );
}

/** Shown to the owner of each channel an admin suspended (their own channels only reach them). */
export function SuspendedChannelNotice({ channels }: { channels: Channel[] }) {
  const { t, lang } = useLanguage();
  const suspended = channels.filter((ch) => ch.isSuspended);
  if (suspended.length === 0) return null;
  return (
    <>
      {suspended.map((ch) => (
        <div key={ch.id} role="status" data-testid="channel-suspended-notice" data-channel-id={ch.id} className={boxClass}>
          <p className="font-semibold">
            {t.profile.channelSuspendedTitle.replace('{name}', ch.nameLocalized?.[lang] || ch.name)}
          </p>
          <p className="mt-1 text-sm">{t.profile.channelSuspendedBody}</p>
          {ch.suspension?.reason && (
            <p className="mt-1 text-sm">{t.profile.channelSuspendedReason.replace('{reason}', ch.suspension.reason)}</p>
          )}
        </div>
      ))}
    </>
  );
}
