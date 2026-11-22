/**
 * The identity a comment, reply or post goes under, shown the YouTube way: only the avatar of the
 * identity you are acting as (your photo, or the active channel's logo) next to the input. No
 * "Commenting as" text and no switch: identity is chosen only in the header's Acting as menu
 * (owner decision 2026-11-15). The avatar's accessible name is the identity's name, so screen
 * readers still say who it goes under.
 */
import React from 'react';
import { avatarInitial } from '@/lib/avatar-initial';

export interface ComposerAvatarProps {
  /** The identity's picture; without one its first letter is shown */
  src?: string | null;
  /** The identity's name: the channel's name, or the member's (display name, first + last, email) */
  name: string;
  /** 'channel' when a channel is active, otherwise 'member' */
  as: 'channel' | 'member';
  /** Tailwind size classes, e.g. "w-8 h-8" */
  className?: string;
  testId?: string;
}

export function ComposerAvatar({ src, name, as, className = 'w-8 h-8', testId = 'comment-identity' }: ComposerAvatarProps) {
  const common = { 'data-testid': testId, 'data-as': as, title: name };
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element -- a 32-40px avatar from our own image host
    return <img src={src} alt={name} className={`${className} flex-none rounded-full object-cover`} {...common} />;
  }
  return (
    <span
      role="img"
      aria-label={name}
      className={`${className} flex-none rounded-full bg-[var(--fanous-color-primary)] text-[var(--fanous-color-on-primary)] flex items-center justify-center font-bold text-sm`}
      {...common}
    >
      <span aria-hidden="true">{avatarInitial(name)}</span>
    </span>
  );
}

export default ComposerAvatar;
