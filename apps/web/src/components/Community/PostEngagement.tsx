import { logger } from '@/lib/logger-client';

import { CommunityPost } from '@al-ummah/shared-types';
import { cn } from '@/lib/utils';
import LikeButton from './LikeButton';
import CommentButton from './CommentButton';
import { SavePostButton } from '@/components/library/SavePostButton';
import { useState } from 'react';

interface PostEngagementProps {
  post: CommunityPost;
  isRTL?: boolean;
  locale?: string;
  showComments?: boolean;
  onToggleComments?: () => void;
  /** Viewer's active channel (acting identity for likes) */
  channelId?: string;
  /** Viewer's user ID */
  userId?: string;
}

export default function PostEngagement({
  post,
  isRTL = false,
  showComments = false,
  onToggleComments,
  channelId,
  userId,
  locale = 'en',
}: PostEngagementProps) {
  const [showShareMenu, setShowShareMenu] = useState(false);
  // Posts live on the channel's Community tab; there is no standalone post route
  const getShareUrl = () =>
    `${window.location.origin}/${locale}/channels/${post.channelId}?tab=community`;

  const formatCount = (count: number) => {
    if (count >= 1000000) {
      return `${(count / 1000000).toFixed(1)}M`;
    }
    if (count >= 1000) {
      return `${(count / 1000).toFixed(1)}K`;
    }
    return count.toString();
  };

  const handleShare = async () => {
    const shareUrl = getShareUrl();
    const shareText = isRTL
      ? `شاهد هذا المنشور من ${post.channelName}`
      : `Check out this post from ${post.channelName}`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: shareText,
          url: shareUrl,
        });
      } catch (error) {
        logger.debug('Error sharing:', error);
      }
    } else {
      setShowShareMenu(!showShareMenu);
    }
  };

  const copyLink = () => {
    const shareUrl = getShareUrl();
    navigator.clipboard.writeText(shareUrl);
    setShowShareMenu(false);
  };

  return (
    <div className={cn(
      'border-t border-gray-100 dark:border-gray-700 px-4 py-2',
      'flex-row'
    )}>
      <div className={cn(
        'flex items-center gap-1',
        'flex-row'
      )}>
        {/* Like Button */}
        <LikeButton
          postChannelId={post.channelId}
          postId={post.id}
          initialLikes={post.likes}
          initialLiked={Boolean(post.viewerHasLiked)}
          isRTL={isRTL}
          channelId={channelId}
          userId={userId}
        />

        {/* Comment Button */}
        <CommentButton
          postId={post.id}
          commentCount={post.comments}
          isRTL={isRTL}
          commentsEnabled={post.commentsEnabled}
          showComments={showComments}
          onToggle={onToggleComments}
        />

        {/* Save to Library (Story 29.6) */}
        <SavePostButton postId={post.id} postChannelId={post.channelId} userId={userId} />

        {/* Share Button */}
        <div className="relative">
          <button
            onClick={handleShare}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-full transition-all group',
              'hover:bg-gray-100 dark:hover:bg-gray-700',
              'flex-row'
            )}
            aria-label={isRTL ? 'مشاركة' : 'Share'}
          >
            <svg
              className="w-5 h-5 text-gray-600 dark:text-gray-400 group-hover:text-gray-900 dark:group-hover:text-gray-200"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
              />
            </svg>
            {post.shares > 0 && (
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-gray-200">
                {formatCount(post.shares)}
              </span>
            )}
          </button>

          {/* Share Menu */}
          {showShareMenu && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setShowShareMenu(false)}
              />
              <div className={cn(
                'absolute bottom-full mb-2 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-2 z-50 min-w-[200px]',
                isRTL ? 'left-0' : 'right-0'
              )}>
                <button
                  onClick={copyLink}
                  className={cn(
                    'w-full px-4 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-3',
                    'text-start'
                  )}
                >
                  <svg className="w-5 h-5 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  <span className="text-gray-900 dark:text-gray-100">
                    {isRTL ? 'نسخ الرابط' : 'Copy link'}
                  </span>
                </button>
              </div>
            </>
          )}
        </div>

        {/* Views (if available) */}
        {post.views > 0 && (
          <div className={cn(
            'flex items-center gap-2 px-4 py-2 ms-auto',
            'flex-row'
          )}>
            <svg
              className="w-5 h-5 text-gray-500 dark:text-gray-400"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
              />
            </svg>
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {formatCount(post.views)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
