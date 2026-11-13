import { logger } from '@/lib/logger-client';
import { PostComment } from "@al-ummah/shared-types";

import { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import Image from 'next/image';
import { createPostComment } from '@/lib/api/post-comments';

const MAX_COMMENT_LENGTH = 10000;
const SHOW_COUNTER_THRESHOLD = 500;

interface ReplyFormProps {
  postChannelId: string;
  postId: string;
  parentCommentId: string;
  replyToUsername: string;
  userAvatar?: string;
  userDisplayName: string;
  isRTL?: boolean;
  locale?: string;
  channelId?: string;
  userId?: string;
  onReplyCreated?: (reply: PostComment) => void;
  onCancel?: () => void;
}

export default function ReplyForm({
  postChannelId,
  postId,
  parentCommentId,
  replyToUsername,
  userAvatar,
  userDisplayName,
  isRTL = false,
  channelId,
  userId,
  onReplyCreated,
  onCancel,
}: ReplyFormProps) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const remainingChars = MAX_COMMENT_LENGTH - content.length;
  const showCounter = remainingChars < SHOW_COUNTER_THRESHOLD;

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!content.trim()) {
      setError(isRTL ? 'الرجاء إدخال رد' : 'Please enter a reply');
      return;
    }

    if (content.length > MAX_COMMENT_LENGTH) {
      setError(
        isRTL
          ? `الرد طويل جداً (${MAX_COMMENT_LENGTH} حرف كحد أقصى)`
          : `Reply is too long (${MAX_COMMENT_LENGTH} characters max)`
      );
      return;
    }

    if (!userId) {
      setError(isRTL ? 'يجب تسجيل الدخول للرد' : 'You must be logged in to reply');
      return;
    }

    setLoading(true);

    try {
      const result = await createPostComment(
        postChannelId,
        postId,
        {
          content: content.trim(),
          parentCommentId,
        },
        { channelId }
      );

      if (result?.success && result.comment) {
        setContent('');
        if (onReplyCreated) {
          onReplyCreated(result.comment);
        }
      } else {
        setError(isRTL ? 'فشل نشر الرد' : 'Failed to post reply');
      }
    } catch (err) {
      logger.error('Failed to create reply:', err);
      setError(isRTL ? 'حدث خطأ أثناء نشر الرد' : 'An error occurred while posting your reply');
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    setContent('');
    setError('');
    if (onCancel) {
      onCancel();
    }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value;
    if (newContent.length <= MAX_COMMENT_LENGTH) {
      setContent(newContent);
      setError('');
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className={cn(
        'flex gap-3 mt-4 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg',
        isRTL && 'flex-row-reverse'
      )}
    >
      {/* User Avatar */}
      <div className="relative w-8 h-8 flex-shrink-0">
        {userAvatar ? (
          <Image
            src={userAvatar}
            alt={userDisplayName}
            fill
            className="rounded-full object-cover"
          />
        ) : (
          <div className="w-full h-full rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-xs">
            {userDisplayName.charAt(0).toUpperCase()}
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="flex-1">
        {/* Reply To Indicator */}
        <div className={cn('mb-2 text-sm text-gray-600 dark:text-gray-400', isRTL && 'text-right')}>
          {isRTL ? (
            <>
              رد على <span className="font-medium text-blue-600 dark:text-blue-400">@{replyToUsername}</span>
            </>
          ) : (
            <>
              Replying to <span className="font-medium text-blue-600 dark:text-blue-400">@{replyToUsername}</span>
            </>
          )}
        </div>

        <div className="relative">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={handleTextareaChange}
            placeholder={isRTL ? 'اكتب ردك...' : 'Write your reply...'}
            className={cn(
              'w-full px-3 py-2 rounded-lg resize-none transition-all',
              'border border-gray-300 dark:border-gray-600',
              'bg-white dark:bg-gray-800',
              'focus:outline-none focus:ring-2 focus:ring-blue-500',
              'text-gray-900 dark:text-gray-100',
              'placeholder:text-gray-500 dark:placeholder:text-gray-400',
              isRTL && 'text-right'
            )}
            rows={3}
            disabled={loading}
          />

          {/* Character Counter */}
          {showCounter && (
            <div
              className={cn(
                'absolute -bottom-5 text-xs',
                remainingChars < 0
                  ? 'text-red-600 dark:text-red-400'
                  : remainingChars < 100
                  ? 'text-brand-ink dark:text-brand-ink'
                  : 'text-gray-500 dark:text-gray-400',
                isRTL ? 'left-0' : 'right-0'
              )}
            >
              {remainingChars < 0 ? (
                <span className="font-semibold">
                  {isRTL ? `${Math.abs(remainingChars)} حرف زيادة` : `${Math.abs(remainingChars)} characters over`}
                </span>
              ) : (
                `${remainingChars} ${isRTL ? 'حرف متبقي' : 'characters remaining'}`
              )}
            </div>
          )}
        </div>

        {/* Error Message */}
        {error && (
          <div className={cn('mt-2 text-sm text-red-600 dark:text-red-400', isRTL && 'text-right')}>
            {error}
          </div>
        )}

        {/* Action Buttons */}
        <div className={cn('flex items-center gap-2 mt-3', isRTL && 'flex-row-reverse')}>
          <button
            type="button"
            onClick={handleCancel}
            disabled={loading}
            className={cn(
              'px-3 py-1.5 rounded-full text-sm font-medium transition-colors',
              'text-gray-700 dark:text-gray-300',
              'hover:bg-gray-200 dark:hover:bg-gray-700',
              'disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          >
            {isRTL ? 'إلغاء' : 'Cancel'}
          </button>

          <button
            type="submit"
            disabled={loading || !content.trim() || remainingChars < 0 || !userId}
            className={cn(
              'px-3 py-1.5 rounded-full text-sm font-medium transition-colors',
              'bg-blue-600 text-white',
              'hover:bg-blue-700',
              'disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          >
            {loading ? (isRTL ? 'جارٍ النشر...' : 'Posting...') : isRTL ? 'رد' : 'Reply'}
          </button>
        </div>
      </div>
    </form>
  );
}
