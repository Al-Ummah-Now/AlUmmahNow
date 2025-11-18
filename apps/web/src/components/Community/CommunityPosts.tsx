'use client';

import { useState, useEffect } from 'react';
import { CommunityPost } from '@al-ummah/shared-types';
import { listCommunityPosts } from '@/lib/api/community-posts';
import PostCard from './PostCard';
import { cn } from '@/lib/utils';

interface CommunityPostsProps {
  channelId: string;
  isRTL?: boolean;
  locale?: string;
}

export default function CommunityPosts({ channelId, isRTL = false, locale = 'en' }: CommunityPostsProps) {
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    loadPosts(1);
  }, [channelId]);

  const loadPosts = async (pageNumber: number) => {
    try {
      if (pageNumber === 1) {
        setLoading(true);
      } else {
        setLoadingMore(true);
      }

      const response = await listCommunityPosts({
        channelId,
        page: pageNumber,
        limit: 20,
      });

      if (response) {
        if (pageNumber === 1) {
          setPosts(response.posts);
        } else {
          setPosts((prev) => [...prev, ...response.posts]);
        }
        setHasMore(response.pagination.hasNext);
        setPage(pageNumber);
      } else {
        setError(isRTL ? 'فشل تحميل المنشورات' : 'Failed to load posts');
      }
    } catch (err) {
      console.error('Error loading community posts:', err);
      setError(isRTL ? 'حدث خطأ أثناء تحميل المنشورات' : 'An error occurred while loading posts');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  const handleLoadMore = () => {
    if (!loadingMore && hasMore) {
      loadPosts(page + 1);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6 animate-pulse">
            <div className="flex items-center gap-3 mb-4">
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
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-6 text-center">
        <p className="text-red-600 dark:text-red-400">{error}</p>
      </div>
    );
  }

  if (posts.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-12 text-center">
        <div className="max-w-md mx-auto space-y-4">
          <svg
            className="w-24 h-24 mx-auto text-gray-300 dark:text-gray-600"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z" />
          </svg>
          <h2 className={cn(
            'text-2xl font-semibold text-gray-900 dark:text-gray-100',
            isRTL ? 'text-right' : 'text-left'
          )}>
            {isRTL ? 'المجتمع' : 'Community'}
          </h2>
          <p className={cn(
            'text-gray-600 dark:text-gray-400',
            isRTL ? 'text-right' : 'text-left'
          )}>
            {isRTL
              ? 'لا توجد منشورات مجتمعية حاليًا'
              : 'No community posts available at this time'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {posts.map((post) => (
        <PostCard key={post.id} post={post} isRTL={isRTL} locale={locale} />
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
            {loadingMore
              ? (isRTL ? 'جاري التحميل...' : 'Loading...')
              : (isRTL ? 'تحميل المزيد' : 'Load More')}
          </button>
        </div>
      )}
    </div>
  );
}
