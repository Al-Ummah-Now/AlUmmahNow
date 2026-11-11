'use client';

import { useCallback, useRef } from 'react';
import Image from 'next/image';
import Link from '@/components/common/AppLink';
import { VerifiedBadge } from '@/components/VerifiedBadge';
import { useMultiAccount } from '@/hooks/useMultiAccount';
import { removeUnwantedChars } from '@/lib/utility';
import { WatchChannelMeta } from './WatchSubscribe';
import type { PlayerOptions } from './interface';

interface VideoDetailsProps {
  title: string;
  channelName: string;
  channelHref?: string | null;
  options: PlayerOptions;
  avatarAlt?: string;
}

/**
 * Title, then one row: channel avatar, the name (linking to the channel) over
 * its subscriber count, and Subscribe. Shared by both reading directions.
 * Videos without a channel id (legacy imports) have no channel to link to or
 * subscribe to, so they show the avatar and name only.
 */
export function VideoDetails({ title, channelName, channelHref, options, avatarAlt = '' }: VideoDetailsProps) {
  const { user, loading } = useMultiAccount();
  // Kept across the remount when the account changes, so the count doesn't blank
  const lastCount = useRef<number | undefined>(undefined);
  const rememberCount = useCallback((count: number) => { lastCount.current = count; }, []);
  const name = removeUnwantedChars(channelName);
  const avatar = <Image src={options.channelAvatar || '/avatar.png'} alt={avatarAlt} sizes="40px" className="bg-gray-500 object-cover" fill />;
  const badge = options.channelVerified && <VerifiedBadge className="ms-1" />;
  const nameNode = channelHref
    ? <Link href={channelHref} data-testid="watch-channel-link" className="watch-channel-name">{name}{badge}</Link>
    : <span className="watch-channel-name">{name}{badge}</span>;
  return (
    <div className="watch-details">
      <h1 className="watch-title">{removeUnwantedChars(title)}</h1>
      <div className="watch-channel" data-testid="watch-channel">
        {channelHref ? <Link href={channelHref} className="watch-avatar" tabIndex={-1} aria-hidden={avatarAlt ? undefined : true}>{avatar}</Link> : <span className="watch-avatar">{avatar}</span>}
        {options.channelId ? (
          <WatchChannelMeta
            key={user?.id ?? 'anonymous'}
            channelId={options.channelId}
            name={nameNode}
            viewerId={user?.id ?? null}
            authLoading={loading}
            ownerUserId={options.userId}
            initialCount={lastCount.current}
            onCount={rememberCount}
          />
        ) : nameNode}
      </div>
    </div>
  );
}
