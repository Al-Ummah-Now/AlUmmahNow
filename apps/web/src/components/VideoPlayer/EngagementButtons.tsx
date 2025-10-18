/**
 * Engagement Buttons Component
 *
 * Interactive like, dislike, and share buttons for video engagement.
 *
 * Features:
 * - Optimistic UI updates
 * - Loading states
 * - Animated interactions
 * - Bilingual support (English/Arabic)
 * - Accessible ARIA labels
 * - Keyboard navigation
 */

'use client';

import { useState } from 'react';
import { useVideoEngagement } from '@/hooks/useVideoEngagement';
import { SharePlatform } from '@/services/api/engagement.service';

export interface EngagementButtonsProps {
  videoId: string;
  channelId?: string;
  userId?: string;
  liked?: boolean;
  disliked?: boolean;
  likeCount?: number;
  dislikeCount?: number;
  lang?: 'en' | 'ar';
  onError?: (message: string) => void;
  onSuccess?: (message: string) => void;
  className?: string;
}

/**
 * Engagement Buttons Component
 */
export function EngagementButtons({
  videoId,
  channelId,
  userId,
  liked: initialLiked = false,
  disliked: initialDisliked = false,
  likeCount = 0,
  dislikeCount = 0,
  lang = 'en',
  onError,
  onSuccess,
  className = ''
}: EngagementButtonsProps) {
  const [showShareMenu, setShowShareMenu] = useState(false);

  const {
    liked,
    disliked,
    pending,
    handleLike,
    handleDislike,
    handleShare
  } = useVideoEngagement({
    videoId,
    channelId,
    userId,
    initialLiked,
    initialDisliked,
    onError,
    onSuccess
  });

  // Translations
  const t = {
    like: lang === 'ar' ? 'إعجاب' : 'Like',
    dislike: lang === 'ar' ? 'لا يعجبني' : 'Dislike',
    share: lang === 'ar' ? 'مشاركة' : 'Share',
    shareOn: lang === 'ar' ? 'مشاركة على' : 'Share on',
    copyLink: lang === 'ar' ? 'نسخ الرابط' : 'Copy link',
    twitter: lang === 'ar' ? 'تويتر' : 'Twitter',
    facebook: lang === 'ar' ? 'فيسبوك' : 'Facebook',
    email: lang === 'ar' ? 'البريد الإلكتروني' : 'Email'
  };

  const dir = lang === 'ar' ? 'rtl' : 'ltr';

  /**
   * Format count for display (e.g., 1.2K, 3.4M)
   */
  const formatCount = (count: number): string => {
    if (count < 1000) return count.toString();
    if (count < 1000000) return `${(count / 1000).toFixed(1)}K`;
    return `${(count / 1000000).toFixed(1)}M`;
  };

  /**
   * Handle share menu item click
   */
  const handleShareClick = async (platform: SharePlatform) => {
    await handleShare(platform);
    setShowShareMenu(false);
  };

  return (
    <div className={`engagement-buttons ${className}`} dir={dir}>
      <div className="flex items-center gap-2">
        {/* Like Button */}
        <button
          type="button"
          onClick={handleLike}
          disabled={pending}
          className={`
            engagement-button group
            inline-flex items-center gap-2 px-4 py-2 rounded-lg
            transition-all duration-200
            ${liked
              ? 'bg-blue-600 text-white hover:bg-blue-700'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
            }
            ${pending ? 'opacity-50 cursor-not-allowed' : 'hover:scale-105'}
            focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
            disabled:pointer-events-none
          `}
          aria-label={`${t.like}${likeCount > 0 ? ` (${formatCount(likeCount)})` : ''}`}
          aria-pressed={liked}
        >
          {/* Like Icon */}
          <svg
            className={`w-5 h-5 transition-transform ${liked ? 'scale-110' : 'group-hover:scale-110'}`}
            fill={liked ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth={liked ? 0 : 2}
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M14 9V5a3 3 0 00-3-3l-4 9v11h11.28a2 2 0 002-1.7l1.38-9a2 2 0 00-2-2.3zM7 22H4a2 2 0 01-2-2v-7a2 2 0 012-2h3"
            />
          </svg>

          {/* Like Count */}
          <span className="text-sm font-medium">
            {likeCount > 0 ? formatCount(likeCount) : t.like}
          </span>
        </button>

        {/* Dislike Button */}
        <button
          type="button"
          onClick={handleDislike}
          disabled={pending}
          className={`
            engagement-button group
            inline-flex items-center gap-2 px-4 py-2 rounded-lg
            transition-all duration-200
            ${disliked
              ? 'bg-red-600 text-white hover:bg-red-700'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
            }
            ${pending ? 'opacity-50 cursor-not-allowed' : 'hover:scale-105'}
            focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2
            disabled:pointer-events-none
          `}
          aria-label={`${t.dislike}${dislikeCount > 0 ? ` (${formatCount(dislikeCount)})` : ''}`}
          aria-pressed={disliked}
        >
          {/* Dislike Icon (thumbs down) */}
          <svg
            className={`w-5 h-5 transition-transform ${disliked ? 'scale-110' : 'group-hover:scale-110'}`}
            fill={disliked ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth={disliked ? 0 : 2}
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M10 15v4a3 3 0 003 3l4-9V2H5.72a2 2 0 00-2 1.7l-1.38 9a2 2 0 002 2.3zm7-13h2.67A2.31 2.31 0 0122 4v7a2.31 2.31 0 01-2.33 2H17"
            />
          </svg>

          {/* Dislike Count (optional, many platforms hide this) */}
          <span className="text-sm font-medium sr-only">
            {t.dislike}
          </span>
        </button>

        {/* Share Button */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowShareMenu(!showShareMenu)}
            className={`
              engagement-button group
              inline-flex items-center gap-2 px-4 py-2 rounded-lg
              bg-gray-100 text-gray-700 hover:bg-gray-200
              dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700
              transition-all duration-200 hover:scale-105
              focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2
            `}
            aria-label={t.share}
            aria-expanded={showShareMenu}
            aria-haspopup="menu"
          >
            {/* Share Icon */}
            <svg
              className="w-5 h-5 transition-transform group-hover:scale-110"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
              />
            </svg>

            <span className="text-sm font-medium">{t.share}</span>
          </button>

          {/* Share Menu */}
          {showShareMenu && (
            <>
              {/* Backdrop */}
              <div
                className="fixed inset-0 z-10"
                onClick={() => setShowShareMenu(false)}
                aria-hidden="true"
              />

              {/* Menu */}
              <div
                className={`
                  absolute ${dir === 'rtl' ? 'left-0' : 'right-0'} mt-2 z-20
                  w-48 rounded-lg shadow-lg bg-white dark:bg-gray-800
                  ring-1 ring-black ring-opacity-5
                `}
                role="menu"
                aria-orientation="vertical"
              >
                <div className="py-1">
                  {/* Copy Link */}
                  <button
                    type="button"
                    onClick={() => handleShareClick('copy')}
                    className="flex items-center w-full px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    role="menuitem"
                  >
                    <svg className={`w-4 h-4 ${dir === 'rtl' ? 'ml-3' : 'mr-3'}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    {t.copyLink}
                  </button>

                  {/* Twitter */}
                  <button
                    type="button"
                    onClick={() => handleShareClick('twitter')}
                    className="flex items-center w-full px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    role="menuitem"
                  >
                    <svg className={`w-4 h-4 ${dir === 'rtl' ? 'ml-3' : 'mr-3'}`} fill="currentColor" viewBox="0 0 24 24">
                      <path d="M23.953 4.57a10 10 0 01-2.825.775 4.958 4.958 0 002.163-2.723c-.951.555-2.005.959-3.127 1.184a4.92 4.92 0 00-8.384 4.482C7.69 8.095 4.067 6.13 1.64 3.162a4.822 4.822 0 00-.666 2.475c0 1.71.87 3.213 2.188 4.096a4.904 4.904 0 01-2.228-.616v.06a4.923 4.923 0 003.946 4.827 4.996 4.996 0 01-2.212.085 4.936 4.936 0 004.604 3.417 9.867 9.867 0 01-6.102 2.105c-.39 0-.779-.023-1.17-.067a13.995 13.995 0 007.557 2.209c9.053 0 13.998-7.496 13.998-13.985 0-.21 0-.42-.015-.63A9.935 9.935 0 0024 4.59z"/>
                    </svg>
                    {t.twitter}
                  </button>

                  {/* Facebook */}
                  <button
                    type="button"
                    onClick={() => handleShareClick('facebook')}
                    className="flex items-center w-full px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    role="menuitem"
                  >
                    <svg className={`w-4 h-4 ${dir === 'rtl' ? 'ml-3' : 'mr-3'}`} fill="currentColor" viewBox="0 0 24 24">
                      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                    </svg>
                    {t.facebook}
                  </button>

                  {/* Email */}
                  <button
                    type="button"
                    onClick={() => handleShareClick('email')}
                    className="flex items-center w-full px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    role="menuitem"
                  >
                    <svg className={`w-4 h-4 ${dir === 'rtl' ? 'ml-3' : 'mr-3'}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                    {t.email}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
