'use client';

import { useState, useEffect, useCallback } from 'react';
import { PostComment } from '@al-ummah/shared-types';
import { cn } from '@/lib/utils';
import CommentForm from './CommentForm';
import Comment from './Comment';
import { listPostComments } from '@/lib/api/post-comments';

interface CommentsSectionProps {
  postId: string;
  postOwnerId: string;
  commentsCount: number;
  commentsEnabled: boolean;
  userAvatar?: string;
  userDisplayName?: string;
  isRTL?: boolean;
  locale?: string;
  channelId?: string;
  userId?: string;
}

type SortBy = 'top' | 'newest';

export default function CommentsSection({
  postId,
  postOwnerId,
  commentsCount,
  commentsEnabled,
  userAvatar,
  userDisplayName = 'Guest',
  isRTL = false,
  locale = 'en',
  channelId,
  userId,
}: CommentsSectionProps) {
  const [comments, setComments] = useState<PostComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>('top');
  const [cursor, setCursor] = useState<string | undefined>();
  const [hasMore, setHasMore] = useState(false);
  const [totalComments, setTotalComments] = useState(commentsCount);

  const isPostOwner = userId === postOwnerId;

  const loadComments = useCallback(async (reset = false) => {
    if (reset) {
      setLoading(true);
      setComments([]);
      setCursor(undefined);
    } else {
      setLoadingMore(true);
    }

    try {
      const result = await listPostComments(postId, {
        limit: 20,
        cursor: reset ? undefined : cursor,
        sortBy,
      });

      if (result?.success) {
        if (reset) {
          setComments(result.comments);
        } else {
          setComments((prev) => [...prev, ...result.comments]);
        }
        setCursor(result.pagination.cursor);
        setHasMore(result.pagination.hasNext);
      }
    } catch (error) {
      console.error('Failed to load comments:', error);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [postId, sortBy, cursor]);

  useEffect(() => {
    loadComments(true);
  }, [loadComments]);

  const handleCommentCreated = (comment: PostComment) => {
    setComments((prev) => [comment, ...prev]);
    setTotalComments((prev) => prev + 1);
  };

  const handleCommentUpdated = (updatedComment: PostComment) => {
    setComments((prev) =>
      prev.map((c) => (c.id === updatedComment.id ? updatedComment : c))
    );
  };

  const handleCommentDeleted = (commentId: string) => {
    setComments((prev) => prev.filter((c) => c.id !== commentId));
    setTotalComments((prev) => prev - 1);
  };

  const handleReplyCreated = () => {
    setTotalComments((prev) => prev + 1);
  };

  const handleSortChange = (newSort: SortBy) => {
    if (newSort !== sortBy) {
      setSortBy(newSort);
    }
  };

  // Find pinned comment
  const pinnedComment = comments.find((c) => c.isPinned && !c.parentCommentId);
  const regularComments = comments.filter((c) => !c.isPinned || c.parentCommentId);

  return (
    <div
      id={`post-${postId}-comments`}
      className={cn(
        'border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4',
        isRTL && 'text-right'
      )}
    >
      {/* Header */}
      <div className={cn('flex items-center justify-between mb-4', isRTL && 'flex-row-reverse')}>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {totalComments > 0
            ? isRTL
              ? `${totalComments} ${totalComments === 1 ? 'تعليق' : 'تعليقات'}`
              : `${totalComments} ${totalComments === 1 ? 'Comment' : 'Comments'}`
            : isRTL
            ? 'التعليقات'
            : 'Comments'}
        </h3>

        {/* Sort Selector */}
        {comments.length > 0 && (
          <div className={cn('flex items-center gap-2', isRTL && 'flex-row-reverse')}>
            <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" />
            </svg>
            <select
              value={sortBy}
              onChange={(e) => handleSortChange(e.target.value as SortBy)}
              className={cn(
                'px-3 py-1.5 rounded-lg bg-transparent border border-gray-300 dark:border-gray-600',
                'text-sm font-medium text-gray-900 dark:text-gray-100',
                'focus:outline-none focus:ring-2 focus:ring-blue-500',
                'cursor-pointer'
              )}
            >
              <option value="top">{isRTL ? 'الأكثر إعجاباً' : 'Top comments'}</option>
              <option value="newest">{isRTL ? 'الأحدث أولاً' : 'Newest first'}</option>
            </select>
          </div>
        )}
      </div>

      {/* Comment Form */}
      {commentsEnabled && (
        <div className="mb-6">
          <CommentForm
            postId={postId}
            userAvatar={userAvatar}
            userDisplayName={userDisplayName}
            isRTL={isRTL}
            locale={locale}
            channelId={channelId}
            userId={userId}
            onCommentCreated={handleCommentCreated}
          />
        </div>
      )}

      {!commentsEnabled && (
        <div className={cn('text-center py-8 text-gray-500 dark:text-gray-400', isRTL && 'text-right')}>
          {isRTL ? 'التعليقات معطلة لهذا المنشور' : 'Comments are disabled for this post'}
        </div>
      )}

      {/* Loading Skeleton */}
      {loading && (
        <div className="space-y-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className={cn('flex gap-3 animate-pulse', isRTL && 'flex-row-reverse')}>
              <div className="w-10 h-10 bg-gray-300 dark:bg-gray-600 rounded-full flex-shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-gray-300 dark:bg-gray-600 rounded w-1/4" />
                <div className="h-3 bg-gray-300 dark:bg-gray-600 rounded w-3/4" />
                <div className="h-3 bg-gray-300 dark:bg-gray-600 rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty State */}
      {!loading && comments.length === 0 && commentsEnabled && (
        <div className="text-center py-12">
          <svg
            className="w-16 h-16 mx-auto text-gray-300 dark:text-gray-600 mb-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
          </svg>
          <p className="text-gray-500 dark:text-gray-400 text-lg font-medium">
            {isRTL ? 'كن أول من يعلق!' : 'Be the first to comment!'}
          </p>
          <p className="text-gray-400 dark:text-gray-500 text-sm mt-1">
            {isRTL
              ? 'شارك أفكارك حول هذا المنشور'
              : 'Share your thoughts about this post'}
          </p>
        </div>
      )}

      {/* Comments List */}
      {!loading && comments.length > 0 && (
        <div className="space-y-6">
          {/* Pinned Comment */}
          {pinnedComment && (
            <div className="pb-6 border-b border-gray-200 dark:border-gray-700">
              <Comment
                key={pinnedComment.id}
                comment={pinnedComment}
                postId={postId}
                isRTL={isRTL}
                locale={locale}
                channelId={channelId}
                userId={userId}
                isPostOwner={isPostOwner}
                onCommentUpdated={handleCommentUpdated}
                onCommentDeleted={handleCommentDeleted}
                onReplyCreated={handleReplyCreated}
              />
            </div>
          )}

          {/* Regular Comments */}
          {regularComments.map((comment) => (
            <Comment
              key={comment.id}
              comment={comment}
              postId={postId}
              isRTL={isRTL}
              locale={locale}
              channelId={channelId}
              userId={userId}
              isPostOwner={isPostOwner}
              onCommentUpdated={handleCommentUpdated}
              onCommentDeleted={handleCommentDeleted}
              onReplyCreated={handleReplyCreated}
            />
          ))}

          {/* Load More Button */}
          {hasMore && (
            <div className="flex justify-center pt-4">
              <button
                onClick={() => loadComments(false)}
                disabled={loadingMore}
                className={cn(
                  'px-6 py-2.5 rounded-full text-sm font-medium transition-colors',
                  'border-2 border-blue-600 text-blue-600',
                  'hover:bg-blue-50 dark:hover:bg-blue-900/20',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                  'flex items-center gap-2'
                )}
              >
                {loadingMore ? (
                  <>
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    {isRTL ? 'جارٍ التحميل...' : 'Loading...'}
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                    {isRTL ? 'عرض المزيد من التعليقات' : 'Show more comments'}
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
