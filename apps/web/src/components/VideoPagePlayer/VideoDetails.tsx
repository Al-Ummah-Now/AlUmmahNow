'use client';

import Image from 'next/image';
import Link from 'next/link';
import { VerifiedBadge } from '@/components/VerifiedBadge';
import { SubscribeButton } from '@/components/subscription';
import { removeUnwantedChars } from '@/lib/utility';
import type { PlayerOptions } from './interface';

interface VideoDetailsProps {
  title: string;
  channelName: string;
  channelHref?: string | null;
  options: PlayerOptions;
  avatarAlt?: string;
}

/** Title, then one row of channel identity and Subscribe. Shared by both reading directions. */
export function VideoDetails({ title, channelName, channelHref, options, avatarAlt = '' }: VideoDetailsProps) {
  const name = removeUnwantedChars(channelName);
  const avatar = <Image src={options.channelAvatar || '/avatar.png'} alt={avatarAlt} sizes="40px" className="bg-gray-500 object-cover" fill />;
  return (
    <div className="watch-details">
      <h1 className="watch-title">{removeUnwantedChars(title)}</h1>
      <div className="watch-channel">
        {channelHref ? <Link href={channelHref} className="watch-avatar" tabIndex={-1} aria-hidden={avatarAlt ? undefined : true}>{avatar}</Link> : <span className="watch-avatar">{avatar}</span>}
        {channelHref
          ? <Link href={channelHref} data-testid="watch-channel-link" className="watch-channel-name">{name}{options.channelVerified && <VerifiedBadge className="ms-1" />}</Link>
          : <span className="watch-channel-name">{name}{options.channelVerified && <VerifiedBadge className="ms-1" />}</span>}
        {options.channelId && <SubscribeButton channelId={options.channelId} channelName={name} />}
      </div>
    </div>
  );
}
