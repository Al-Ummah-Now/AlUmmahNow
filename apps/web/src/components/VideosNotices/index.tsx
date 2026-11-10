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

/**
 * Uploading and creating channels are by invitation (creator tiers): shown
 * on the upload page and where "Create channel" would be, to a signed-in user
 * without a tier. `page` is the full upload-page version with a way home.
 */
export function UploadsByInvitationNotice({ page = false }: { page?: boolean }) {
  const { t, lang } = useLanguage();
  if (!page) {
    return (
      <div role="status" data-testid="uploads-by-invitation" className="rounded-lg border border-border border-s-4 border-s-primary bg-card px-4 py-3 text-card-foreground shadow-sm">
        <p className="font-semibold">{t.creator.invitationTitle}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t.creator.invitationMessage}</p>
      </div>
    );
  }
  return (
    <div className="mx-auto w-full max-w-2xl rounded-lg border border-border border-s-4 border-s-primary bg-card p-8 text-center text-card-foreground shadow-sm md:p-12" data-testid="upload-by-invitation" role="status">
      <h1 className="mb-4 text-2xl font-bold md:text-3xl">{t.creator.invitationTitle}</h1>
      <p className="mb-8 text-base text-muted-foreground md:text-lg">{t.creator.invitationMessage}</p>
      <a href={`/${lang}`} className="inline-flex items-center justify-center rounded-lg bg-primary px-6 py-3 font-medium text-primary-foreground hover:opacity-90">
        {t.upload.goHome}
      </a>
    </div>
  );
}
