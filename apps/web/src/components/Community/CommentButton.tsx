'use client';

import { cn } from '@/lib/utils';
import { getTranslations } from '@/lib/i18n';

interface CommentButtonProps {
  postId: string;
  commentCount: number;
  isRTL?: boolean;
  commentsEnabled?: boolean;
  showComments?: boolean;
  onToggle?: () => void;
}

export default function CommentButton({
  postId,
  commentCount,
  isRTL = false,
  commentsEnabled = true,
  showComments = false,
  onToggle,
}: CommentButtonProps) {
  const formatCount = (count: number) => {
    if (count >= 1000000) {
      return `${(count / 1000000).toFixed(1)}M`;
    }
    if (count >= 1000) {
      return `${(count / 1000).toFixed(1)}K`;
    }
    return count.toString();
  };

  const handleClick = () => {
    if (!commentsEnabled) return;

    if (onToggle) {
      onToggle();

      // Scroll to comments section after toggle (with a small delay for animation)
      if (!showComments) {
        setTimeout(() => {
          const commentsSection = document.getElementById(`post-${postId}-comments`);
          if (commentsSection) {
            commentsSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
        }, 100);
      }
    } else {
      // Fallback: just scroll if no toggle handler provided
      const commentsSection = document.getElementById(`post-${postId}-comments`);
      if (commentsSection) {
        commentsSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={!commentsEnabled}
      className={cn(
        'flex items-center gap-2 px-4 py-2 rounded-full transition-all group',
        showComments
          ? 'bg-blue-50 dark:bg-blue-900/20'
          : 'hover:bg-gray-100 dark:hover:bg-gray-700',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        'flex-row'
      )}
      aria-pressed={showComments}
    >
      <svg
        aria-hidden="true"
        className={cn(
          'w-5 h-5 transition-colors',
          showComments
            ? 'text-blue-600 dark:text-blue-400'
            : 'text-gray-600 dark:text-gray-400 group-hover:text-gray-900 dark:group-hover:text-gray-200'
        )}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
        />
      </svg>
      <span
        className={cn(
          'text-sm font-medium transition-colors',
          showComments
            ? 'text-blue-600 dark:text-blue-400'
            : 'text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-gray-200'
        )}
      >
        {/* Accessible name = label + visible count (label-in-name) */}
        <span className="sr-only">{getTranslations(isRTL ? 'ar' : 'en').community.commentsButton}</span>{' '}
        {formatCount(commentCount)}
      </span>
    </button>
  );
}
