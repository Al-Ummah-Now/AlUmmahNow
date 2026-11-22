'use client';

import { useState } from 'react';
import { CommunityPost, PostType, formatTimeAgo } from '@al-ummah/shared-types';
import { cn } from '@/lib/utils';
import PostEngagement from './PostEngagement';
import CommentsSection from './CommentsSection';
import TextPost from './types/TextPost';
import ImagePost from './types/ImagePost';
import PollPost from './types/PollPost';
import QuizPost from './types/QuizPost';
import VideoPost from './types/VideoPost';
import GifPost from './types/GifPost';
import ArticlePost from './types/ArticlePost';
import CardsPost from './types/CardsPost';
import LinkPost from './types/LinkPost';
import Image from 'next/image';
import Link from '@/components/common/AppLink';
import { channelLabel } from '@/lib/channel-name';
import { avatarInitial } from '@/lib/avatar-initial';
import { PostStatus } from '@al-ummah/shared-types';
import PostActionsMenu from './PostActionsMenu';
import { formatScheduledAt } from './management/PostSchedulePicker';
import { useLanguage } from '@/hooks/useLanguage';

interface PostCardProps {
  post: CommunityPost;
  isRTL?: boolean;
  locale?: string;
  userAvatar?: string;
  userDisplayName?: string;
  channelId?: string;
  userId?: string;
  /** Open with the comments shown (the post's own page) */
  initialShowComments?: boolean;
  /** The label of the time link that opens the post's own page */
  openPostLabel?: string;
  /** The viewer owns the post's channel and acts as it: Edit and Delete (Story 29.4) */
  canManage?: boolean;
  /** After the owner deleted it */
  onDeleted?: (postId: string) => void;
  /** Undo brought a deleted post back */
  onRestored?: (postId: string) => void | Promise<void>;
}

/** "3 minutes ago" / «قبل ٣ دقائق» (Intl plural and dual forms, ٠–٩ digits); under a minute "just now" / «الآن». */
function getTimeAgo(date: Date, isRTL: boolean): string {
  if (Date.now() - date.getTime() < 60_000) return isRTL ? 'الآن' : 'just now';
  return formatTimeAgo(isRTL ? 'ar' : 'en', date, { numeric: 'always' });
}

export default function PostCard({
  post,
  isRTL = false,
  locale = 'en',
  userAvatar,
  userDisplayName,
  channelId,
  userId,
  initialShowComments = false,
  openPostLabel,
  canManage = false,
  onDeleted,
  onRestored,
}: PostCardProps) {
  // Only its channel sees a scheduled post before its time (the API hides it from everyone else)
  const upcoming = post.status === PostStatus.SCHEDULED && !!post.scheduledAt && Date.parse(post.scheduledAt) > Date.now();
  const [showComments, setShowComments] = useState(initialShowComments);
  const timeAgo = getTimeAgo(new Date(post.createdAt), isRTL);

  const handleToggleComments = () => {
    setShowComments((prev) => !prev);
  };

  const renderPostContent = () => {
    switch (post.type) {
      case PostType.TEXT:
        return <TextPost post={post} isRTL={isRTL} />;
      case PostType.IMAGE:
        return <ImagePost post={post} isRTL={isRTL} />;
      case PostType.POLL:
        return <PollPost post={post} isRTL={isRTL} locale={locale} channelId={channelId} userId={userId} />;
      case PostType.QUIZ:
        return <QuizPost post={post} isRTL={isRTL} locale={locale} />;
      case PostType.VIDEO:
        return <VideoPost post={post} isRTL={isRTL} />;
      case PostType.GIF:
        return <GifPost post={post} isRTL={isRTL} />;
      case PostType.ARTICLE:
        return <ArticlePost post={post} />;
      case PostType.CARDS:
        return <CardsPost post={post} />;
      case PostType.LINK:
        return <LinkPost post={post} />;
      default:
        return null;
    }
  };

  return (
    <article id={`post-${post.id}`} data-post-id={post.id} className="aun-row-glass scroll-mt-24">
      {/* Post Header */}
      <div className={cn(
        'flex items-start gap-3 p-4 border-b border-[var(--fanous-color-divider)]',
        // Direction comes from the RTL container (dir=rtl); no manual reversal
      )}>
        {/* Channel Avatar */}
        <div className="relative w-10 h-10 flex-shrink-0">
          {post.channelAvatar ? (
            <Image
              src={post.channelAvatar}
              alt={channelLabel(post, locale)}
              fill
              className="rounded-full object-cover"
            />
          ) : (
            <div className="w-full h-full rounded-full bg-[var(--aun-btn-filled-bg)] flex items-center justify-center text-[var(--aun-btn-filled-fg)] font-bold">
              {avatarInitial(channelLabel(post, locale))}
            </div>
          )}
          {post.channelVerified && (
            <div className={cn(
              'absolute -bottom-1 bg-white dark:bg-gray-800 rounded-full p-0.5',
              isRTL ? '-left-1' : '-right-1'
            )}>
              <svg className="w-4 h-4 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
            </div>
          )}
        </div>

        {/* Channel Info and Timestamp */}
        <div className={cn('flex-1 min-w-0', isRTL && 'text-right')}>
          <div className={cn('flex items-center gap-2')}>
            <h3 className="min-w-0 font-semibold text-gray-900 dark:text-gray-100 [overflow-wrap:break-word] [text-wrap:balance]">
              {channelLabel(post, locale)}
            </h3>
            {post.pinned && (
              <svg className="w-4 h-4 text-gray-500 dark:text-gray-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path d="M10 2a1 1 0 011 1v1.323l3.954 1.582 1.599-.8a1 1 0 01.894 1.79l-1.233.616 1.738 5.42a1 1 0 01-.285 1.05A3.989 3.989 0 0115 15a3.989 3.989 0 01-2.667-1.019 1 1 0 01-.285-1.05l1.738-5.42-1.233-.617a1 1 0 01.894-1.788l1.599.799L11 4.323V3a1 1 0 011-1h-2z" />
              </svg>
            )}
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {/* The time opens the post's own page (its permalink, wiki AUN-SEO) */}
            <Link
              href={`/${locale === 'ar' ? 'ar' : 'en'}/post/${encodeURIComponent(post.id)}`}
              className="hover:underline focus-visible:underline focus-visible:outline-none"
              title={openPostLabel}
              data-testid="post-permalink"
            >
              <time dateTime={post.createdAt}>{timeAgo}</time>
            </Link>
          </p>
          {upcoming && <ScheduledLabel at={post.scheduledAt!} locale={locale} />}
        </div>

        {/* ⋮ for everyone: Copy link and Report; the post's channel also gets Edit and Delete (#1515) */}
        <PostActionsMenu post={post} canManage={canManage} onDeleted={onDeleted} onRestored={onRestored} />
      </div>

      {/* Post Content */}
      <div className="p-4">
        {renderPostContent()}
      </div>

      {/* Post Engagement */}
      <PostEngagement
        post={post}
        isRTL={isRTL}
        locale={locale}
        showComments={showComments}
        onToggleComments={handleToggleComments}
        channelId={channelId}
        userId={userId}
      />

      {/* Comments Section - Smooth expand/collapse animation */}
      <div
        className={cn(
          'transition-all duration-300 ease-in-out overflow-hidden',
          showComments ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'
        )}
      >
        {showComments && (
          <CommentsSection
            postChannelId={post.channelId}
            postId={post.id}
            postOwnerId={post.userId}
            commentsCount={post.comments}
            commentsEnabled={post.commentsEnabled}
            userAvatar={userAvatar}
            userDisplayName={userDisplayName}
            isRTL={isRTL}
            locale={locale}
            channelId={channelId}
            userId={userId}
          />
        )}
      </div>
    </article>
  );
}

/** "Scheduled for …" on a post its channel sees before it goes live. */
function ScheduledLabel({ at, locale }: { at: string; locale: string }) {
  const { t } = useLanguage();
  return (
    <p className="mt-1 inline-flex items-center rounded-full bg-[var(--fanous-color-surface-raised)] px-2 py-0.5 text-xs font-medium text-[var(--fanous-color-text-secondary)]" data-testid="post-scheduled-label">
      {t.community.scheduledFor.replace('{date}', formatScheduledAt(at, locale))}
    </p>
  );
}
