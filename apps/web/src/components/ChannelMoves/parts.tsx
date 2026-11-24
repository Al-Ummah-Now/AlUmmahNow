'use client';

/** Pieces the Move channel, offer and offers pages share (wiki AUN-CHANNEL-CLAIM CC-7). Logical properties only, so Arabic mirrors. */
import { useState } from 'react';
import { useLanguage } from '@/hooks/useLanguage';
import { avatarInitial } from '@/lib/avatar-initial';
import { daysUntil } from '@/lib/channels/team';
import { moveName, type MoveOffer } from '@/lib/channels/moves';
import { pluralText } from '@/lib/notifications/toast-queue';

export const CARD = 'c p-4 sm:p-6';
export const PRIMARY = 'b b-primary';
export const SECONDARY = 'b b-secondary';
export const TEXT = 'text-[var(--fanous-color-text-primary)]';
export const SOFT = 'text-[var(--fanous-color-text-secondary)]';

export function Avatar({ src, name, handle, size = 'h-12 w-12 text-lg' }: { src: string | null; name: string; handle?: string | null; size?: string }) {
  const [failed, setFailed] = useState(false);
  return src && !failed ? (
    // eslint-disable-next-line @next/next/no-img-element -- remote avatars from several CDNs
    <img src={src} alt="" onError={() => setFailed(true)} className={`${size} shrink-0 rounded-full object-cover`} />
  ) : (
    <span className={`flex ${size} shrink-0 items-center justify-center rounded-full bg-[var(--fanous-c-button-primary-bg)] font-semibold text-[var(--fanous-c-button-primary-text)]`} aria-hidden="true">
      {avatarInitial(name, handle)}
    </span>
  );
}

/** The channel of an offer: avatar, name and @handle. */
export function OfferChannel({ offer, heading: Heading = 'h2' }: { offer: MoveOffer; heading?: 'h1' | 'h2' | 'h3' }) {
  const { t, lang } = useLanguage();
  const name = moveName(offer.channel, lang, t.channelMoves.offers.channel);
  return (
    <div className="flex items-center gap-4" data-testid="move-offer-channel">
      <Avatar src={offer.channel.avatarUrl} name={name} handle={offer.channel.handle} />
      <div className="min-w-0">
        <Heading className={`break-words text-lg font-semibold ${TEXT}`}><bdi>{name}</bdi></Heading>
        {offer.channel.handle && <p className={`text-sm ${SOFT}`}><bdi dir="ltr">@{offer.channel.handle}</bdi></p>}
      </div>
    </div>
  );
}

export function Expires({ at }: { at: string }) {
  const { t, lang } = useLanguage();
  const days = daysUntil(at);
  return <p className={`text-sm ${SOFT}`} data-testid="move-offer-expires">{days > 0 ? pluralText(t.channelMoves.expiresIn, days, lang) : t.channelMoves.expiresToday}</p>;
}

export interface MoveMessage {
  kind: 'ok' | 'error';
  text: string;
}

export function Message({ message, children }: { message: MoveMessage | null; children?: React.ReactNode }) {
  if (!message) return null;
  const tone = message.kind === 'error'
    ? 'bg-[color-mix(in_srgb,var(--fanous-color-error-fill)_14%,var(--fanous-color-surface))] text-[var(--fanous-color-error-text)]'
    : 'bg-[color-mix(in_srgb,var(--fanous-color-success-fill)_14%,var(--fanous-color-surface))] text-[var(--fanous-color-text-primary)]';
  return (
    <div role={message.kind === 'error' ? 'alert' : 'status'} data-testid="move-message" data-kind={message.kind} className={`flex flex-wrap items-center gap-3 rounded-lg px-4 py-3 text-sm ${tone}`}>
      <span className="flex-1">{message.text}</span>
      {children}
    </div>
  );
}

export function Loading() {
  const { t } = useLanguage();
  return <p className={`text-sm ${SOFT}`} role="status">{t.channelMoves.loading}</p>;
}

export function LoadFailed({ onRetry }: { onRetry: () => void }) {
  const { t } = useLanguage();
  return (
    <div className="flex flex-wrap items-center gap-3" role="alert" data-testid="move-load-failed">
      <p className="text-sm text-[var(--fanous-color-error-text)]">{t.channelMoves.loadFailed}</p>
      <button type="button" onClick={onRetry} className={PRIMARY}>{t.common.retry}</button>
    </div>
  );
}
