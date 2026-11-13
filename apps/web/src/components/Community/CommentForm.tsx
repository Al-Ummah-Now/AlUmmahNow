import { logger } from '@/lib/logger-client';

import { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import Image from 'next/image';
import { createPostComment } from '@/lib/api/post-comments';
import { PostComment } from '@al-ummah/shared-types';
import { useLanguage } from '@/hooks/useLanguage';
import { useHumanCheck } from '@/hooks/useHumanCheck';
import { useMultiAccount } from '@/hooks/useMultiAccount';
import { requestAccountMenu } from '@/lib/navigation/account-menu-events';

const MAX_COMMENT_LENGTH = 10000;
const SHOW_COUNTER_THRESHOLD = 500;

interface CommentFormProps {
  postChannelId: string;
  postId: string;
  userAvatar?: string;
  userDisplayName: string;
  isRTL?: boolean;
  locale?: string;
  channelId?: string;
  userId?: string;
  onCommentCreated?: (comment: PostComment) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
}

export default function CommentForm({
  postChannelId,
  postId,
  userAvatar,
  userDisplayName,
  isRTL = false,
  channelId,
  userId,
  onCommentCreated,
  onCancel,
  autoFocus = false,
}: CommentFormProps) {
  const { t } = useLanguage();
  const { ensureHuman } = useHumanCheck();
  const { user: account } = useMultiAccount();
  const hasChannels = (account?.channels?.length ?? 0) > 0;
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const remainingChars = MAX_COMMENT_LENGTH - content.length;
  const showCounter = remainingChars < SHOW_COUNTER_THRESHOLD;

  useEffect(() => {
    if (autoFocus && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [autoFocus]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!content.trim()) {
      setError(isRTL ? 'الرجاء إدخال تعليق' : 'Please enter a comment');
      return;
    }

    if (content.length > MAX_COMMENT_LENGTH) {
      setError(
        isRTL
          ? `التعليق طويل جداً (${MAX_COMMENT_LENGTH} حرف كحد أقصى)`
          : `Comment is too long (${MAX_COMMENT_LENGTH} characters max)`
      );
      return;
    }

    // No active channel: the member comments as themselves (the API reads no header as no channel)
    if (!userId) {
      setError(isRTL ? 'يجب تسجيل الدخول للتعليق' : 'You must be logged in to comment');
      return;
    }

    setLoading(true);

    try {
      // An account's first comment needs the Turnstile check (normally invisible)
      const human = await ensureHuman('comment');
      if (!human.ok) {
        setError(t.humanCheck.failed);
        return;
      }
      const result = await createPostComment(
        postChannelId,
        postId,
        { content: content.trim() },
        { channelId },
        human.token
      );

      if (result?.success && result.comment) {
        setContent('');
        setIsFocused(false);
        if (onCommentCreated) {
          onCommentCreated(result.comment);
        }
      } else {
        setError(isRTL ? 'فشل نشر التعليق' : 'Failed to post comment');
      }
    } catch (err) {
      logger.error('Failed to create comment:', err);
      setError(isRTL ? 'حدث خطأ أثناء نشر التعليق' : 'An error occurred while posting your comment');
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    setContent('');
    setError('');
    setIsFocused(false);
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
      className={cn('flex gap-3', isRTL && 'flex-row-reverse')}
    >
      {/* User Avatar */}
      <div className="relative w-10 h-10 flex-shrink-0">
        {userAvatar ? (
          <Image
            src={userAvatar}
            alt={userDisplayName}
            fill
            className="rounded-full object-cover"
          />
        ) : (
          <div className="w-full h-full rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm">
            {userDisplayName.charAt(0).toUpperCase()}
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="flex-1">
        {userId && userDisplayName && (
          <p className="mb-1 text-xs opacity-80" data-testid="comment-identity" data-as={channelId ? 'channel' : 'member'}>
            {t.comments.commentingAs.split('{name}')[0]}<bdi>{userDisplayName}</bdi>{t.comments.commentingAs.split('{name}')[1] ?? ''}
            {hasChannels && (
              <>
                {' · '}
                <button
                  type="button"
                  className="font-medium underline underline-offset-2"
                  aria-label={t.navigation.switchChannel}
                  data-testid="comment-identity-switch"
                  onClick={() => requestAccountMenu({ open: true, view: 'channels', focus: true })}
                >
                  {t.comments.switchIdentity}
                </button>
              </>
            )}
          </p>
        )}
        <div className="relative">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={handleTextareaChange}
            onFocus={() => setIsFocused(true)}
            placeholder={
              isRTL
                ? 'أضف تعليقاً عاماً...'
                : 'Add a public comment...'
            }
            className={cn(
              'w-full px-4 py-2 rounded-lg resize-none transition-all',
              'border-b-2 bg-transparent',
              'focus:outline-none',
              isFocused
                ? 'border-gray-900 dark:border-gray-100'
                : 'border-gray-300 dark:border-gray-600',
              'text-gray-900 dark:text-gray-100',
              'placeholder:text-gray-500 dark:placeholder:text-gray-400',
              isRTL && 'text-right'
            )}
            rows={isFocused ? 4 : 1}
            disabled={loading}
          />

          {/* Character Counter */}
          {showCounter && (
            <div
              className={cn(
                'absolute -bottom-6 text-xs',
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
          <div
            className={cn(
              'mt-2 text-sm text-red-600 dark:text-red-400',
              isRTL && 'text-right'
            )}
          >
            {error}
          </div>
        )}

        {/* Action Buttons */}
        {isFocused && (
          <div
            className={cn(
              'flex items-center gap-2 mt-4',
              isRTL && 'flex-row-reverse'
            )}
          >
            <button
              type="button"
              onClick={handleCancel}
              disabled={loading}
              className={cn(
                'px-4 py-2 rounded-full text-sm font-medium transition-colors',
                'text-gray-700 dark:text-gray-300',
                'hover:bg-gray-100 dark:hover:bg-gray-700',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              {isRTL ? 'إلغاء' : 'Cancel'}
            </button>

            <button
              type="submit"
              disabled={loading || !content.trim() || remainingChars < 0 || !channelId || !userId}
              className={cn(
                'px-4 py-2 rounded-full text-sm font-medium transition-colors',
                'bg-blue-600 text-white',
                'hover:bg-blue-700',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              {loading
                ? isRTL
                  ? 'جارٍ النشر...'
                  : 'Posting...'
                : isRTL
                ? 'تعليق'
                : 'Comment'}
            </button>
          </div>
        )}
      </div>
    </form>
  );
}
