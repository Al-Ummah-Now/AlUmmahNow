'use client';

/**
 * The owner's open offer to hand the channel to one of its admins (wiki AUN-CHANNEL-CLAIM §5, CC-7b),
 * with Stop. Super admins only (admin-api checks channels:transfer too). Nothing shows while there is
 * no offer, whatever the switch: one made before it was turned off can still be stopped.
 */
import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AdminChannelMoveOffer, AdminUserRow } from '@al-ummah/shared-types';
import Link from '@/components/AppLink';
import { LocalTime } from '@/components/LocalTime';
import type { ActionResult } from '@/lib/api/errors';
import { useLanguage } from '@/i18n/I18nProvider';
import { ErrorAlert, linkClass } from '@/components/ui';
import { ActionFeedback, ConfirmButton, useContentAction } from '@/components/content/actions';
import { SectionCard } from '@/components/content/parts';
import { bidiIsolate } from '@/components/content/transfer-model';
import { adminUserName } from '@/lib/user-name';

interface Props {
  channelId: string;
  /** null: could not be read */
  offers: AdminChannelMoveOffer[] | null;
  stop: (channelId: string, offerId: string, reason: string) => Promise<ActionResult<unknown>>;
}

export function ChannelMoveOffers({ channelId, offers, stop }: Props) {
  const { t } = useLanguage();
  const ids = useId();
  const router = useRouter();
  const { run, busy, error, message } = useContentAction();
  const [stopping, setStopping] = useState<string | null>(null);
  // A stopped offer leaves the list; its outcome stays here
  if (offers?.length === 0 && !error && !message) return null;
  const name = (user: AdminUserRow) => adminUserName(user, t('auditLog.unknownUser'));

  async function stopOffer(offer: AdminChannelMoveOffer, reason: string) {
    setStopping(offer.id);
    const stopped = await run(`stop:${offer.id}`, () => stop(channelId, offer.id, reason), { success: t('channels.moveOffer.stopped') });
    setStopping(null);
    // Refused: answered, withdrawn or expired meanwhile. Show it as it is now
    if (!stopped) router.refresh();
  }

  return (
    <SectionCard title={t('channels.moveOffer.title')} id={`${ids}-move-offer`} testId="channel-move-offers">
      <ActionFeedback error={error} message={message} testId="channel-move-offers-feedback" />
      {offers === null && <ErrorAlert testId="channel-move-offers-failed">{t('channels.moveOffer.loadFailed')}</ErrorAlert>}
      {offers && offers.length > 0 && (
        <>
          <p className="text-sm text-fg-muted mb-3">{t('channels.moveOffer.hint')}</p>
          <ul className="space-y-4">
            {offers.map((offer) => (
              <li key={offer.id} className={`flex flex-col gap-3 ${offer.status === 'offered' ? 'sm:flex-row sm:items-end sm:justify-between' : ''}`} data-testid="channel-move-offer" data-offer-id={offer.id} data-status={offer.status}>
                <dl className="grid min-w-0 flex-1 grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                  <Person label={t('channels.moveOffer.from')} user={offer.from} name={name(offer.from)} testId="channel-move-offer-from" />
                  <Person label={t('channels.moveOffer.to')} user={offer.to} name={name(offer.to)} testId="channel-move-offer-to" />
                  <div>
                    <dt className="text-fg-muted">{t('channels.moveOffer.made')}</dt>
                    <dd className="text-fg"><LocalTime value={offer.createdAt} withTime /></dd>
                  </div>
                  <div>
                    <dt className="text-fg-muted">{t('channels.moveOffer.expires')}</dt>
                    <dd className="text-fg"><LocalTime value={offer.expiresAt} withTime /></dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-fg-muted">{t('channels.moveOffer.contact')}</dt>
                    <dd className="text-fg">{t(offer.keepContactEmail ? 'channels.moveOffer.contactKept' : 'channels.moveOffer.contactCleared')}</dd>
                  </div>
                </dl>
                {offer.status === 'accepting' ? (
                  <p className="text-sm text-fg-muted" data-testid="channel-move-offer-starting">{t('channels.moveOffer.starting')}</p>
                ) : (
                  <div className="shrink-0">
                    <ConfirmButton
                      label={t('channels.moveOffer.stop')}
                      title={t('channels.moveOffer.stopTitle')}
                      body={t('channels.moveOffer.stopBody', { to: bidiIsolate(name(offer.to)) })}
                      bullets={[t('channels.moveOffer.stopTold'), t('channels.moveOffer.stopAgain')]}
                      confirmLabel={t('channels.moveOffer.stop')}
                      withReason
                      reasonHint={t('channels.handleTools.reasonHint')}
                      reasonMinLength={10}
                      reasonMaxLength={500}
                      danger
                      disabled={!!busy}
                      busy={stopping === offer.id}
                      testId="channel-move-offer-stop"
                      onConfirm={(reason) => stopOffer(offer, reason)}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </SectionCard>
  );
}

function Person({ label, user, name, testId }: { label: string; user: AdminUserRow; name: string; testId: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-fg-muted">{label}</dt>
      <dd>
        <Link href={`/users/${encodeURIComponent(user.id)}`} className={`${linkClass} break-words`} data-testid={testId}>
          <bdi>{name}</bdi>
        </Link>
        {user.email && user.email !== name && <span className="block break-all text-fg-muted"><bdi dir="ltr">{user.email}</bdi></span>}
      </dd>
    </div>
  );
}
