'use client';

import Link from '@/components/common/AppLink';
import type { CommunityPost } from '@al-ummah/shared-types';
import { useAuth } from '@/components/AuthProvider/authContext';
import { useActiveChannel } from '@/contexts/ActiveChannelContext';
import { useLanguage } from '@/hooks/useLanguage';
import { useMultiAccount } from '@/hooks/useMultiAccount';
import { useProfile } from '@/hooks/useProfile';
import { userDisplayName } from '@/lib/display-name';
import PostCard from '../PostCard';

interface PostPermalinkViewProps {
  post: CommunityPost;
  locale: 'en' | 'ar';
  /** The channel's page (its @handle URL when it has one) */
  channelHref: string;
  channelName: string;
}

/**
 * A community post on its own page (/[locale]/post/[id]): a way back to the channel's posts, the
 * page heading, and the post with its comments open. The post is read on the server, so the HTML
 * carries its text; likes, votes and comments act as the signed-in viewer, as on the Community tab.
 */
export default function PostPermalinkView({ post, locale, channelHref, channelName }: PostPermalinkViewProps) {
  const { t, lang, isRTL } = useLanguage();
  const { user } = useAuth();
  const { profile } = useProfile(user ?? null);
  const { user: account } = useMultiAccount();
  const { activeChannel } = useActiveChannel();
  const activeName = account?.channel?.nameLocalized?.[lang]?.trim() || activeChannel?.name?.trim();
  const fill = (text: string) => text.replace('{channel}', channelName);
  const postsHref = `${channelHref}${channelHref.includes('?') ? '&' : '?'}tab=community`;

  return (
    <div dir={isRTL ? 'rtl' : 'ltr'} className="mx-auto w-full max-w-2xl px-4 py-6 sm:py-8">
      <nav aria-label={fill(t.community.allPostsFrom)} className="mb-3">
        <Link
          href={postsHref}
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 -ms-3 text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white transition-colors"
          data-testid="post-permalink-back"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className={`h-4 w-4${isRTL ? ' rotate-180' : ''}`}>
            <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clipRule="evenodd" />
          </svg>
          {fill(t.community.allPostsFrom)}
        </Link>
      </nav>
      <h1 className="mb-4 text-xl font-semibold text-gray-900 dark:text-gray-100">{fill(t.community.postFrom)}</h1>
      <PostCard
        post={post}
        isRTL={isRTL}
        locale={locale}
        channelId={activeChannel?.channelId}
        userId={user?.id}
        userAvatar={activeChannel ? activeChannel.avatarUrl : profile?.avatarUrl}
        userDisplayName={activeChannel ? activeName || undefined : userDisplayName(profile, lang, user?.email) || undefined}
        initialShowComments
        openPostLabel={t.community.openPost}
      />
    </div>
  );
}
