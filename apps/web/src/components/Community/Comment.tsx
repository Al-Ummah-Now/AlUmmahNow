import { logger } from '@/lib/logger-client';

import { useState } from 'react';
import { PostComment } from '@al-ummah/shared-types';
import { cn } from '@/lib/utils';
import Image from 'next/image';
import ReplyForm from './ReplyForm';
import {
  likePostComment,
  unlikePostComment,
  deletePostComment,
  updatePostComment,
  listCommentReplies,
  heartPostComment,
  pinPostComment,
} from '@/lib/api/post-comments';

interface CommentProps {
  comment: PostComment;
  postId: string;
  isRTL?: boolean;
  locale?: string;
  channelId?: string;
  userId?: string;
  isPostOwner?: boolean;
  onCommentUpdated?: (comment: PostComment) => void;
  onCommentDeleted?: (commentId: string) => void;
  onReplyCreated?: (reply: PostComment) => void;
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

export default function Comment({
  comment,
  postId,
  isRTL = false,
  locale = 'en',
  channelId,
  userId,
  isPostOwner = false,
  onCommentUpdated,
  onCommentDeleted,
  onReplyCreated,
}: CommentProps) {
  const [liked, setLiked] = useState(false);
  const [likes, setLikes] = useState(comment.likes);
  const [showReplyForm, setShowReplyForm] = useState(false);
  const [showReplies, setShowReplies] = useState(false);
  const [replies, setReplies] = useState<PostComment[]>([]);
  const [repliesCount, setRepliesCount] = useState(comment.repliesCount);
  const [loadingReplies, setLoadingReplies] = useState(false);
  const [repliesCursor, setRepliesCursor] = useState<string | undefined>();
  const [hasMoreReplies, setHasMoreReplies] = useState(comment.repliesCount > 0);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(comment.content);
  const [showMenu, setShowMenu] = useState(false);
  const [hearted, setHearted] = useState(comment.isHeartedByCreator);
  const [pinned, setPinned] = useState(comment.isPinned);

  const isOwner = userId === comment.userId;
  const timeAgo = getTimeAgo(new Date(comment.createdAt), isRTL);

  const handleLike = async () => {
    if (!channelId || !userId) return;

    const previousLiked = liked;
    const previousLikes = likes;

    setLiked(!liked);
    setLikes(liked ? likes - 1 : likes + 1);

    try {
      const result = liked
        ? await unlikePostComment(postId, comment.id, { channelId })
        : await likePostComment(postId, comment.id, { channelId });

      if (result) {
        setLikes(result.totalLikes);
        setLiked(result.liked);
      } else {
        setLiked(previousLiked);
        setLikes(previousLikes);
      }
    } catch (error) {
      logger.error('Failed to toggle like:', error);
      setLiked(previousLiked);
      setLikes(previousLikes);
    }
  };

  const handleLoadReplies = async () => {
    if (comment.parentCommentId) return;

    setLoadingReplies(true);
    try {
      const result = await listCommentReplies(postId, comment.id, {
        limit: 10,
        cursor: repliesCursor,
      });

      if (result?.success) {
        setReplies((prev) => [...prev, ...result.comments]);
        setRepliesCursor(result.pagination.cursor);
        setHasMoreReplies(result.pagination.hasNext);
        setShowReplies(true);
      }
    } catch (error) {
      logger.error('Failed to load replies:', error);
    } finally {
      setLoadingReplies(false);
    }
  };

  const handleReplyCreated = (reply: PostComment) => {
    setReplies((prev) => [...prev, reply]);
    setRepliesCount((prev) => prev + 1);
    setShowReplyForm(false);
    setShowReplies(true);
    if (onReplyCreated) {
      onReplyCreated(reply);
    }
  };

  const handleEdit = () => {
    setIsEditing(true);
    setShowMenu(false);
  };

  const handleSaveEdit = async () => {
    if (!channelId || !userId || !editContent.trim()) return;

    try {
      const result = await updatePostComment(
        postId,
        comment.id,
        { content: editContent.trim() },
        { channelId }
      );

      if (result?.success && result.comment) {
        setIsEditing(false);
        if (onCommentUpdated) {
          onCommentUpdated(result.comment);
        }
      }
    } catch (error) {
      logger.error('Failed to update comment:', error);
    }
  };

  const handleCancelEdit = () => {
    setEditContent(comment.content);
    setIsEditing(false);
  };

  const handleDelete = async () => {
    if (!channelId || !userId) return;
    if (!confirm(isRTL ? 'هل تريد حذف هذا التعليق؟' : 'Delete this comment?')) return;

    try {
      const result = await deletePostComment(postId, comment.id, { channelId });

      if (result?.success) {
        if (onCommentDeleted) {
          onCommentDeleted(comment.id);
        }
      }
    } catch (error) {
      logger.error('Failed to delete comment:', error);
    }
  };

  const handleHeart = async () => {
    if (!isPostOwner || !channelId || !userId) return;

    try {
      const result = await heartPostComment(postId, comment.id, { channelId });

      if (result?.success) {
        setHearted(result.hearted);
      }
    } catch (error) {
      logger.error('Failed to heart comment:', error);
    }
  };

  const handlePin = async () => {
    if (!isPostOwner || !channelId || !userId) return;

    try {
      const result = await pinPostComment(postId, comment.id, { channelId });

      if (result?.success) {
        setPinned(!pinned);
        setShowMenu(false);
      }
    } catch (error) {
      logger.error('Failed to pin comment:', error);
    }
  };

  if (comment.deletedAt && repliesCount === 0) {
    return null;
  }

  return (
    <div className={cn('flex gap-3', isRTL && 'flex-row-reverse')}>
      {/* Avatar */}
      <div className="relative w-10 h-10 flex-shrink-0">
        {comment.userAvatarUrl && !comment.deletedAt ? (
          <Image
            src={comment.userAvatarUrl}
            alt={comment.userDisplayName}
            fill
            className="rounded-full object-cover"
          />
        ) : (
          <div className="w-full h-full rounded-full bg-gray-400 dark:bg-gray-600 flex items-center justify-center text-white font-bold text-sm">
            {comment.deletedAt ? '?' : comment.userDisplayName.charAt(0).toUpperCase()}
          </div>
        )}
        {comment.channelVerified && !comment.deletedAt && (
          <div className={cn('absolute -bottom-1 bg-white dark:bg-gray-800 rounded-full p-0.5', isRTL ? '-left-1' : '-right-1')}>
            <svg className="w-3 h-3 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                clipRule="evenodd"
              />
            </svg>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Header */}
        <div className={cn('flex items-start gap-2', isRTL && 'flex-row-reverse')}>
          <div className={cn('flex-1', isRTL && 'text-right')}>
            <div className={cn('flex items-center gap-2 flex-wrap', isRTL && 'flex-row-reverse')}>
              <span className="font-medium text-gray-900 dark:text-gray-100">
                {comment.deletedAt ? (isRTL ? '[محذوف]' : '[deleted]') : comment.userDisplayName}
              </span>
              {pinned && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M10 2a1 1 0 011 1v1.323l3.954 1.582 1.599-.8a1 1 0 01.894 1.79l-1.233.616 1.738 5.42a1 1 0 01-.285 1.05A3.989 3.989 0 0115 15a3.989 3.989 0 01-2.667-1.019 1 1 0 01-.285-1.05l1.738-5.42-1.233-.617a1 1 0 01.894-1.788l1.599.799L11 4.323V3a1 1 0 011-1h-2z" />
                  </svg>
                  {isRTL ? 'مثبت' : 'Pinned'}
                </span>
              )}
              <span className="text-sm text-gray-500 dark:text-gray-400">{timeAgo}</span>
              {comment.isEdited && (
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  ({isRTL ? 'معدل' : 'edited'})
                </span>
              )}
            </div>
          </div>

          {/* Menu */}
          {!comment.deletedAt && (isOwner || isPostOwner) && (
            <div className="relative">
              <button
                onClick={() => setShowMenu(!showMenu)}
                className="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <svg className="w-5 h-5 text-gray-500" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                </svg>
              </button>

              {showMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
                  <div className={cn('absolute top-full mt-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-50 min-w-[150px]', isRTL ? 'left-0' : 'right-0')}>
                    {isOwner && (
                      <button
                        onClick={handleEdit}
                        className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100"
                      >
                        {isRTL ? 'تعديل' : 'Edit'}
                      </button>
                    )}
                    {(isOwner || isPostOwner) && (
                      <button
                        onClick={handleDelete}
                        className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 text-red-600 dark:text-red-400"
                      >
                        {isRTL ? 'حذف' : 'Delete'}
                      </button>
                    )}
                    {isPostOwner && !comment.parentCommentId && (
                      <button
                        onClick={handlePin}
                        className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100"
                      >
                        {pinned ? (isRTL ? 'إلغاء التثبيت' : 'Unpin') : isRTL ? 'تثبيت' : 'Pin'}
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Comment Content */}
        {isEditing ? (
          <div className="mt-2">
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className={cn('w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100', isRTL && 'text-right')}
              rows={3}
            />
            <div className={cn('flex gap-2 mt-2', isRTL && 'flex-row-reverse')}>
              <button onClick={handleCancelEdit} className="px-3 py-1 rounded-full text-sm hover:bg-gray-100 dark:hover:bg-gray-700">
                {isRTL ? 'إلغاء' : 'Cancel'}
              </button>
              <button onClick={handleSaveEdit} className="px-3 py-1 rounded-full text-sm bg-blue-600 text-white hover:bg-blue-700">
                {isRTL ? 'حفظ' : 'Save'}
              </button>
            </div>
          </div>
        ) : (
          <p className={cn('mt-1 text-gray-900 dark:text-gray-100 whitespace-pre-wrap break-words', isRTL && 'text-right')}>
            {comment.deletedAt ? (isRTL ? '[تم حذف هذا التعليق]' : '[This comment has been deleted]') : comment.content}
          </p>
        )}

        {/* Action Buttons */}
        {!comment.deletedAt && (
          <div className={cn('flex items-center gap-4 mt-2', isRTL && 'flex-row-reverse')}>
            {/* Like Button */}
            <button onClick={handleLike} disabled={!channelId || !userId} className={cn('flex items-center gap-1 group', isRTL && 'flex-row-reverse')}>
              <svg className={cn('w-4 h-4', liked ? 'text-blue-600 dark:text-blue-400 fill-current' : 'text-gray-600 dark:text-gray-400 group-hover:text-blue-600')} fill={liked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={liked ? 0 : 2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" />
              </svg>
              {likes > 0 && <span className={cn('text-xs', liked ? 'text-blue-600 dark:text-blue-400' : 'text-gray-600 dark:text-gray-400')}>{likes}</span>}
            </button>

            {/* Reply Button */}
            {!comment.parentCommentId && (
              <button onClick={() => setShowReplyForm(!showReplyForm)} className="text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200">
                {isRTL ? 'رد' : 'Reply'}
              </button>
            )}

            {/* Heart from Creator */}
            {isPostOwner && (
              <button onClick={handleHeart} className={cn('flex items-center gap-1', hearted && 'text-red-500')}>
                <svg className="w-4 h-4" fill={hearted ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                </svg>
              </button>
            )}

            {/* Creator Heart Badge */}
            {hearted && !isPostOwner && (
              <div className="flex items-center gap-1 text-red-500">
                <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                  <path d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                </svg>
              </div>
            )}
          </div>
        )}

        {/* Show Replies Button */}
        {!comment.parentCommentId && repliesCount > 0 && !showReplies && (
          <button onClick={handleLoadReplies} disabled={loadingReplies} className={cn('flex items-center gap-2 mt-3 text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300', isRTL && 'flex-row-reverse')}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
            {loadingReplies
              ? isRTL
                ? 'جارٍ التحميل...'
                : 'Loading...'
              : isRTL
              ? `عرض ${repliesCount} ${repliesCount === 1 ? 'رد' : 'ردود'}`
              : `Show ${repliesCount} ${repliesCount === 1 ? 'reply' : 'replies'}`}
          </button>
        )}

        {/* Reply Form */}
        {showReplyForm && (
          <ReplyForm
            postId={postId}
            parentCommentId={comment.id}
            replyToUsername={comment.userDisplayName}
            userAvatar={comment.userAvatarUrl}
            userDisplayName={comment.userDisplayName}
            isRTL={isRTL}
            locale={locale}
            channelId={channelId}
            userId={userId}
            onReplyCreated={handleReplyCreated}
            onCancel={() => setShowReplyForm(false)}
          />
        )}

        {/* Replies List */}
        {showReplies && replies.length > 0 && (
          <div className={cn('mt-4 space-y-4', isRTL ? 'mr-4' : 'ml-4')}>
            {replies.map((reply) => (
              <Comment
                key={reply.id}
                comment={reply}
                postId={postId}
                isRTL={isRTL}
                locale={locale}
                channelId={channelId}
                userId={userId}
                isPostOwner={isPostOwner}
                onCommentDeleted={onCommentDeleted}
              />
            ))}

            {/* Load More Replies */}
            {hasMoreReplies && (
              <button onClick={handleLoadReplies} disabled={loadingReplies} className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700">
                {loadingReplies ? (isRTL ? 'جارٍ التحميل...' : 'Loading...') : isRTL ? 'المزيد من الردود' : 'Load more replies'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
