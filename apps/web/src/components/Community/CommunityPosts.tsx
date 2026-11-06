'use client';

import { logger } from '@/lib/logger-client';

import { useState, useEffect, useCallback } from 'react';
import { CommunityPost } from '@al-ummah/shared-types';
import { listCommunityPosts } from '@/lib/api/community-posts';
import { useAuth } from '@/components/AuthProvider/authContext';
import { useActiveChannel } from '@/contexts/ActiveChannelContext';
import { useLanguage } from '@/hooks/useLanguage';
import PostCard from './PostCard';
import { cn } from '@/lib/utils';

interface CommunityPostsProps {
  channelId: string;
  isRTL?: boolean;
  locale?: string;
}

const PAGE_SIZE = 20;

export default function CommunityPosts({ channelId, isRTL = false, locale = 'en' }: CommunityPostsProps) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const { activeChannel } = useActiveChannel();
  const viewerUserId = user?.id;
  const viewerChannelId = activeChannel?.channelId;

  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadPosts = useCallback(async (pageNumber: number) => {
    if (pageNumber === 1) {
      setLoading(true);
      setError(false);
    } else {
      setLoadingMore(true);
    }

    try {
      const response = await listCommunityPosts(
        { channelId, page: pageNumber, limit: PAGE_SIZE },
        viewerChannelId ? { channelId: viewerChannelId } : undefined
      );

      if (response && Array.isArray(response.posts)) {
        setPosts((prev) => (pageNumber === 1 ? response.posts : [...prev, ...response.posts]));
        setHasMore(Boolean(response.pagination?.hasNext));
        setPage(pageNumber);
      } else if (pageNumber === 1) {
        logger.warn('[CommunityPosts] Empty or invalid posts response', { channelId });
        setError(true);
      }
    } catch (err) {
      logger.error('[CommunityPosts] Failed to load community posts', { channelId, pageNumber, error: err });
      if (pageNumber === 1) {
        setError(true);
      }
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [channelId, viewerChannelId]);

  useEffect(() => {
    loadPosts(1);
  }, [loadPosts]);

  const handleLoadMore = () => {
    if (!loadingMore && hasMore) {
      loadPosts(page + 1);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6" aria-busy="true" aria-label={t.community.loading} data-testid="community-posts-loading">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6 animate-pulse">
            <div className={cn('flex items-center gap-3 mb-4', isRTL && 'flex-row-reverse')}>
              <div className="w-10 h-10 bg-gray-200 dark:bg-gray-700 rounded-full" />
              <div className="flex-1">
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/4 mb-2" />
                <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/6" />
              </div>
            </div>
            <div className="space-y-2">
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-full" />
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-5/6" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div
        role="alert"
        className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-6 text-center space-y-3"
      >
        <p className="text-red-600 dark:text-red-400">{t.community.loadPostsFailed}</p>
        <button
          onClick={() => loadPosts(1)}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 hover:bg-red-700 text-white"
        >
          {t.community.retry}
        </button>
      </div>
    );
  }

  if (posts.length === 0) {
    return (
      <div className="text-center py-12">
        <svg
          className="w-16 h-16 mx-auto mb-4 text-gray-400 dark:text-gray-600"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z"
          />
        </svg>
        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
          {t.community.noPostsYet}
        </h3>
        <p className="text-gray-600 dark:text-gray-400">
          {t.community.noPostsDescription}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {posts.map((post) => (
        <PostCard
          key={post.id}
          post={post}
          isRTL={isRTL}
          locale={locale}
          channelId={viewerChannelId}
          userId={viewerUserId}
          userAvatar={activeChannel?.avatarUrl}
          userDisplayName={activeChannel?.name}
        />
      ))}

      {hasMore && (
        <div className="flex justify-center pt-4">
          <button
            onClick={handleLoadMore}
            disabled={loadingMore}
            className={cn(
              'px-6 py-3 rounded-lg font-medium transition-colors',
              'bg-blue-600 hover:bg-blue-700 text-white',
              'disabled:bg-gray-300 disabled:cursor-not-allowed',
              'dark:bg-blue-500 dark:hover:bg-blue-600',
              'dark:disabled:bg-gray-700'
            )}
          >
            {loadingMore ? t.community.loading : t.community.loadMore}
          </button>
        </div>
      )}
    </div>
  );
}
