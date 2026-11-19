import { logger } from '@/lib/logger-client';

import { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { ComposerAvatar } from '@/components/comments-shared/ComposerAvatar';
import { createPostComment } from '@/lib/api/post-comments';
import { PostComment, formatNumber } from '@al-ummah/shared-types';
import { useLanguage } from '@/hooks/useLanguage';
import { useHumanCheck } from '@/hooks/useHumanCheck';

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
  const { t, lang } = useLanguage();
  const { ensureHuman } = useHumanCheck();
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
      setError(t.comments.enterComment);
      return;
    }

    if (content.length > MAX_COMMENT_LENGTH) {
      setError(t.comments.tooLong.replace('{max}', formatNumber(lang, MAX_COMMENT_LENGTH)));
      return;
    }

    // No active channel: the member comments as themselves (the API reads no header as no channel)
    if (!userId) {
      setError(t.comments.signInToComment);
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
        setError(t.comments.postFailed);
      }
    } catch (err) {
      logger.error('Failed to create comment:', err);
      setError(t.comments.postFailed);
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
      className="flex gap-3"
    >
      {/* The identity you act as (header Acting as menu): its avatar only, named for screen readers */}
      <ComposerAvatar src={userAvatar} name={userDisplayName} as={channelId ? 'channel' : 'member'} className="w-10 h-10" />

      {/* Input Area */}
      <div className="flex-1">
        <div className="relative">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={handleTextareaChange}
            onFocus={() => setIsFocused(true)}
            placeholder={t.comments.addPublicComment}
            // The shared field (theme/system.css .f-input: the theme's control surface, edge and
            // focus ring), not a fill or underline of its own
            className="f-input w-full resize-none py-2 text-start"
            data-testid="post-comment-input"
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
                  {t.comments.charsOver.replace('{count}', formatNumber(lang, Math.abs(remainingChars)))}
                </span>
              ) : (
                t.comments.charsRemaining.replace('{count}', formatNumber(lang, remainingChars))
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
              'flex items-center gap-2 mt-4'
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
              {t.comments.cancel}
            </button>

            <button
              type="submit"
              disabled={loading || !content.trim() || remainingChars < 0 || !userId}
              className={cn(
                'px-4 py-2 rounded-full text-sm font-medium transition-colors',
                'bg-blue-600 text-white',
                'hover:bg-blue-700',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              {loading ? t.comments.commenting : t.comments.comment}
            </button>
          </div>
        )}
      </div>
    </form>
  );
}
