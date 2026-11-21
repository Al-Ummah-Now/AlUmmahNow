'use client';

import { useCallback, useRef } from 'react';
import Image from 'next/image';
import Link from '@/components/common/AppLink';
import { VerifiedBadge } from '@/components/VerifiedBadge';
import { useMultiAccount } from '@/hooks/useMultiAccount';
import { removeUnwantedChars } from '@/lib/utility';
import { WatchChannelMeta } from './WatchSubscribe';
import { useLanguage } from '@/hooks/useLanguage';
import { useViewerTranslation } from '@/hooks/useViewerTranslation';
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
 * subscribe to, so they show the avatar and name only. A viewer of another
 * language may see a machine translation of the title (admin switch, off by
 * default), labelled, with "Show original".
 */
export function VideoDetails({ title, channelName, channelHref, options, avatarAlt = '' }: VideoDetailsProps) {
  const { user, loading } = useMultiAccount();
  const { t, lang } = useLanguage();
  const viewer = useViewerTranslation(options, lang);
  // Kept across the remount when the account changes, so the count doesn't blank
  const lastCount = useRef<number | undefined>(undefined);
  const rememberCount = useCallback((count: number) => { lastCount.current = count; }, []);
  const name = removeUnwantedChars(channelName);
  // No logo: the channel's first letter, as on its channel page and tiles (never a stock silhouette)
  const avatar = options.channelAvatar
    ? <Image src={options.channelAvatar} alt={avatarAlt} sizes="40px" className="bg-gray-500 object-cover" fill />
    : <span role={avatarAlt ? 'img' : undefined} aria-label={avatarAlt || undefined} data-testid="watch-avatar-letter" className="absolute inset-0 flex items-center justify-center bg-gray-200 dark:bg-gray-700 text-lg font-semibold text-gray-600 dark:text-gray-300"><span aria-hidden="true">{Array.from(name.trim())[0]?.toUpperCase() ?? ''}</span></span>;
  const badge = options.channelVerified && <VerifiedBadge className="ms-1" />;
  const nameNode = channelHref
    ? <Link href={channelHref} data-testid="watch-channel-link" className="watch-channel-name">{name}{badge}</Link>
    : <span className="watch-channel-name">{name}{badge}</span>;
  return (
    <div className="watch-details">
      <h1 className="watch-title" {...(viewer.showing ? { lang: viewer.translation!.lang, dir: 'auto' } : {})} data-testid="watch-title" data-machine-translation={viewer.showing || undefined}>
        {removeUnwantedChars(viewer.showing ? viewer.translation!.title : title)}
      </h1>
      {viewer.translation && (
        <p className="watch-mt" data-testid="watch-machine-translation">
          {viewer.showing && <span>{t.captions.viewer.translatedTitle}</span>}
          <button type="button" className="watch-mt-toggle" onClick={viewer.toggle} aria-pressed={!viewer.showing} data-testid="watch-translation-toggle">
            {viewer.showing ? t.captions.viewer.showOriginal : t.captions.viewer.showTranslation}
          </button>
        </p>
      )}
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
