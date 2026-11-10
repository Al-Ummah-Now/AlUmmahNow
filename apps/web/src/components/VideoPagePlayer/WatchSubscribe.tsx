'use client';

import { useEffect, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell } from 'lucide-react';
import { useChannelSubscription } from '@/hooks/useChannelSubscription';
import { useLanguage } from '@/hooks/useLanguage';
import { formatSubscribers } from '@/lib/format/videoMeta';
import { loginRoutePath } from '@/lib/auth/silent-sign-in';

interface WatchChannelMetaProps {
  channelId: string;
  /** The channel name, already a link to the channel page */
  name: ReactNode;
  /** The viewer's user id; null when signed out */
  viewerId: string | null;
  /** The session is still loading: neither signed in nor signed out yet */
  authLoading: boolean;
  /** Owner of the video's channel: the owner sees the count but no Subscribe */
  ownerUserId?: string;
  /** Count shown until the status answers (the last one, across an account change) */
  initialCount?: number;
  onCount?: (count: number) => void;
}

/**
 * The watch page's channel name with its subscriber count, then Subscribe.
 * The status endpoint answers anonymous requests too, so signed-out viewers get
 * the real count without waiting for the session. VideoDetails keys this by
 * account, so signing in or switching accounts checks the status again.
 */
export function WatchChannelMeta({ channelId, name, viewerId, authLoading, ownerUserId, initialCount, onCount }: WatchChannelMetaProps) {
  const { t, lang } = useLanguage();
  const pathname = usePathname();
  const { isSubscribed, subscriberCount, isChecking, isUpdating, error, toggle } = useChannelSubscription({
    channelId,
    enabled: true,
    initialSubscriberCount: initialCount,
  });
  useEffect(() => {
    if (subscriberCount !== undefined) onCount?.(subscriberCount);
  }, [subscriberCount, onCount]);
  const isOwner = !!viewerId && !!ownerUserId && viewerId === ownerUserId;

  let action: ReactNode = null;
  if (isOwner) {
    // No subscribing to your own channel (the channel page hides it too)
  } else if (!authLoading && !viewerId) {
    // A plain link, not a button or next/link: a full navigation to the login
    // route, which starts sign-in and comes back to this video
    action = (
      <a
        href={loginRoutePath(pathname || `/${lang}`, lang)}
        className="b b-primary b-sm watch-sub"
        data-testid="watch-subscribe"
        data-state="signed-out"
      >
        {t.channel.subscribe}
      </a>
    );
  } else {
    const busy = authLoading || isChecking || isUpdating;
    action = (
      <div className="watch-sub-wrap">
        <button
          type="button"
          onClick={() => { void toggle(); }}
          disabled={busy}
          aria-pressed={isSubscribed}
          aria-busy={busy || undefined}
          className={`b b-sm watch-sub ${isSubscribed ? 'b-secondary' : 'b-primary'}`}
          data-testid="watch-subscribe"
          data-state={isSubscribed ? 'subscribed' : 'not-subscribed'}
        >
          {isSubscribed && <Bell aria-hidden="true" />}
          {isSubscribed ? t.channel.subscribed : t.channel.subscribe}
        </button>
        {error && (
          <p className="watch-sub-error" role="alert" data-testid="watch-subscribe-error">
            {error === 'channel' ? (
              <>
                {t.errors.channelRequired}{' '}
                <Link href={`/${lang}/profile`}>{t.navigation.createChannel}</Link>
              </>
            ) : error === 'auth' ? t.errors.loginRequired : t.errors.failedToUpdate}
          </p>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="watch-channel-meta">
        {name}
        <span className="watch-subs" data-testid="watch-subscriber-count" aria-busy={subscriberCount === undefined || undefined}>
          {subscriberCount === undefined ? ' ' : formatSubscribers(subscriberCount, lang === 'ar' ? 'ar' : 'en')}
        </span>
      </div>
      {action}
    </>
  );
}
