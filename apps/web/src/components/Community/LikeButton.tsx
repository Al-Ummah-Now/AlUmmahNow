'use client';

import { logger } from '@/lib/logger-client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { likeCommunityPost, unlikeCommunityPost } from '@/lib/api/community-posts';
import { useLanguage } from '@/hooks/useLanguage';

interface LikeButtonProps {
  postChannelId: string;
  postId: string;
  initialLikes: number;
  initialLiked?: boolean;
  isRTL?: boolean;
  channelId?: string;
  userId?: string;
}

export default function LikeButton({
  postChannelId,
  postId,
  initialLikes,
  initialLiked = false,
  channelId,
  userId,
}: LikeButtonProps) {
  const { t } = useLanguage();
  const [liked, setLiked] = useState(initialLiked);
  const [likes, setLikes] = useState(initialLikes);
  const [loading, setLoading] = useState(false);

  // The feed is re-fetched once the viewer's channel is known; adopt the
  // viewer-specific like state it returns
  useEffect(() => {
    setLiked(initialLiked);
    setLikes(initialLikes);
  }, [initialLiked, initialLikes]);

  const handleLikeClick = async () => {
    if (loading || !channelId || !userId) return;

    setLoading(true);
    const previousLiked = liked;
    const previousLikes = likes;

    setLiked(!liked);
    setLikes(liked ? likes - 1 : likes + 1);

    try {
      const result = liked
        ? await unlikeCommunityPost(postChannelId, postId, { channelId })
        : await likeCommunityPost(postChannelId, postId, { channelId });

      if (result) {
        setLikes(result.totalLikes);
        setLiked(result.liked);
      } else {
        setLiked(previousLiked);
        setLikes(previousLikes);
      }
    } catch (error) {
      logger.error('[LikeButton] Failed to toggle post like', { postId, error });
      setLiked(previousLiked);
      setLikes(previousLikes);
    } finally {
      setLoading(false);
    }
  };

  const formatCount = (count: number) => {
    if (count >= 1000000) {
      return `${(count / 1000000).toFixed(1)}M`;
    }
    if (count >= 1000) {
      return `${(count / 1000).toFixed(1)}K`;
    }
    return count.toString();
  };

  return (
    <button
      onClick={handleLikeClick}
      disabled={loading || !channelId || !userId}
      className={cn(
        'flex items-center gap-2 px-4 py-2 rounded-full transition-all group',
        'hover:bg-gray-100 dark:hover:bg-gray-700',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        'flex-row'
      )}
      aria-pressed={liked}
    >
      <svg
        aria-hidden="true"
        className={cn(
          'w-5 h-5 transition-all',
          liked
            ? 'text-blue-600 dark:text-blue-400 fill-current scale-110'
            : 'text-gray-600 dark:text-gray-400 group-hover:text-blue-600 dark:group-hover:text-blue-400'
        )}
        fill={liked ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth={liked ? 0 : 2}
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5"
        />
      </svg>
      <span className={cn(
        'text-sm font-medium',
        liked
          ? 'text-blue-600 dark:text-blue-400'
          : 'text-gray-700 dark:text-gray-300 group-hover:text-blue-600 dark:group-hover:text-blue-400'
      )}>
        {/* Accessible name = action + visible count (label-in-name) */}
        <span className="sr-only">{liked ? t.community.unlike : t.community.like}</span>{' '}
        {formatCount(likes)}
      </span>
    </button>
  );
}
