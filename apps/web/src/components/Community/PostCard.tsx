'use client';

import { useState } from 'react';
import { CommunityPost, PostType } from '@al-ummah/shared-types';
import { cn } from '@/lib/utils';
import PostEngagement from './PostEngagement';
import CommentsSection from './CommentsSection';
import TextPost from './types/TextPost';
import ImagePost from './types/ImagePost';
import PollPost from './types/PollPost';
import QuizPost from './types/QuizPost';
import VideoPost from './types/VideoPost';
import GifPost from './types/GifPost';
import Image from 'next/image';

interface PostCardProps {
  post: CommunityPost;
  isRTL?: boolean;
  locale?: string;
  userAvatar?: string;
  userDisplayName?: string;
  channelId?: string;
  userId?: string;
}

function getTimeAgo(date: Date, isRTL: boolean): string {
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  const intervals = {
    year: 31536000,
    month: 2592000,
    week: 604800,
    day: 86400,
    hour: 3600,
    minute: 60,
  };

  for (const [unit, secondsInUnit] of Object.entries(intervals)) {
    const interval = Math.floor(seconds / secondsInUnit);
    if (interval >= 1) {
      if (isRTL) {
        const units: Record<string, string> = {
          year: interval === 1 ? 'سنة' : interval === 2 ? 'سنتان' : 'سنوات',
          month: interval === 1 ? 'شهر' : interval === 2 ? 'شهران' : 'أشهر',
          week: interval === 1 ? 'أسبوع' : interval === 2 ? 'أسبوعان' : 'أسابيع',
          day: interval === 1 ? 'يوم' : interval === 2 ? 'يومان' : 'أيام',
          hour: interval === 1 ? 'ساعة' : interval === 2 ? 'ساعتان' : 'ساعات',
          minute: interval === 1 ? 'دقيقة' : interval === 2 ? 'دقيقتان' : 'دقائق',
        };
        return `منذ ${interval} ${units[unit]}`;
      } else {
        return `${interval} ${unit}${interval > 1 ? 's' : ''} ago`;
      }
    }
  }

  return isRTL ? 'الآن' : 'just now';
}

export default function PostCard({
  post,
  isRTL = false,
  locale = 'en',
  userAvatar,
  userDisplayName,
  channelId,
  userId,
}: PostCardProps) {
  const [showComments, setShowComments] = useState(false);
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
      default:
        return null;
    }
  };

  return (
    <article className="bg-white dark:bg-gray-800 rounded-lg shadow-sm hover:shadow-md transition-shadow">
      {/* Post Header */}
      <div className={cn(
        'flex items-start gap-3 p-4 border-b border-gray-100 dark:border-gray-700',
        // Direction comes from the RTL container (dir=rtl); no manual reversal
      )}>
        {/* Channel Avatar */}
        <div className="relative w-10 h-10 flex-shrink-0">
          {post.channelAvatar ? (
            <Image
              src={post.channelAvatar}
              alt={post.channelName}
              fill
              className="rounded-full object-cover"
            />
          ) : (
            <div className="w-full h-full rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold">
              {post.channelName.charAt(0).toUpperCase()}
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
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 truncate">
              {post.channelName}
            </h3>
            {post.pinned && (
              <svg className="w-4 h-4 text-gray-500 dark:text-gray-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path d="M10 2a1 1 0 011 1v1.323l3.954 1.582 1.599-.8a1 1 0 01.894 1.79l-1.233.616 1.738 5.42a1 1 0 01-.285 1.05A3.989 3.989 0 0115 15a3.989 3.989 0 01-2.667-1.019 1 1 0 01-.285-1.05l1.738-5.42-1.233-.617a1 1 0 01.894-1.788l1.599.799L11 4.323V3a1 1 0 011-1h-2z" />
              </svg>
            )}
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {timeAgo}
          </p>
        </div>

        {/* Three-dot Menu */}
        <button
          className={cn(
            'p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors',
            'shrink-0'
          )}
          aria-label={isRTL ? 'المزيد من الخيارات' : 'More options'}
        >
          <svg className="w-5 h-5 text-gray-500 dark:text-gray-400" fill="currentColor" viewBox="0 0 20 20">
            <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
          </svg>
        </button>
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
