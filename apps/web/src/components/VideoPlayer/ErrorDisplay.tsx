/**
 * ErrorDisplay Component
 *
 * User-friendly error display for video player with bilingual support,
 * retry functionality, and detailed error information.
 */

'use client';

import React, { useState } from 'react';
import { VideoError } from '@/lib/video/error-handler';
import { getErrorMessage } from '@/lib/video/error-messages';

export interface ErrorDisplayProps {
  error: VideoError;
  lang: 'en' | 'ar';
  onRetry?: () => void;
  onFallback?: () => void;
  showDetails?: boolean;
  className?: string;
}

/**
 * ErrorDisplay component
 *
 * Displays user-friendly error messages with retry and fallback options
 */
export function ErrorDisplay({
  error,
  lang,
  onRetry,
  onFallback,
  showDetails = false,
  className = '',
}: ErrorDisplayProps): JSX.Element {
  const [isDetailsExpanded, setIsDetailsExpanded] = useState(false);
  const messages = getErrorMessage(error.type, lang);
  const isRTL = lang === 'ar';

  const baseClasses = `
    flex flex-col items-center justify-center
    w-full h-full min-h-[400px]
    bg-gray-900 bg-opacity-95
    text-white p-8
    ${isRTL ? 'text-right' : 'text-left'}
  `;

  const errorIcon = (
    <svg
      className="w-16 h-16 mb-4 text-red-500"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
      />
    </svg>
  );

  return (
    <div className={`${baseClasses} ${className}`} dir={isRTL ? 'rtl' : 'ltr'}>
      {errorIcon}

      <h2 className="text-2xl font-bold mb-2 text-center">
        {messages.title}
      </h2>

      <p className="text-gray-300 mb-6 text-center max-w-md">
        {messages.description}
      </p>

      <div className="flex gap-4 mb-4 flex-wrap justify-center">
        {onRetry && error.retryable && (
          <button
            onClick={onRetry}
            className="
              px-6 py-3
              bg-blue-600 hover:bg-blue-700
              text-white font-semibold
              rounded-lg
              transition-colors duration-200
              flex items-center gap-2
            "
            aria-label={messages.retryButton}
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            {messages.retryButton}
          </button>
        )}

        {onFallback && error.fallbackAvailable && (
          <button
            onClick={onFallback}
            className="
              px-6 py-3
              bg-gray-700 hover:bg-gray-600
              text-white font-semibold
              rounded-lg
              transition-colors duration-200
              flex items-center gap-2
            "
            aria-label={messages.fallbackButton}
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
              />
            </svg>
            {messages.fallbackButton}
          </button>
        )}
      </div>

      {showDetails && (
        <div className="w-full max-w-2xl mt-4">
          <button
            onClick={() => setIsDetailsExpanded(!isDetailsExpanded)}
            className="
              text-sm text-gray-400 hover:text-gray-300
              flex items-center gap-2
              transition-colors duration-200
              w-full justify-center
            "
            aria-expanded={isDetailsExpanded}
          >
            <svg
              className={`w-4 h-4 transition-transform duration-200 ${
                isDetailsExpanded ? 'rotate-180' : ''
              }`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
            {lang === 'ar' ? 'تفاصيل الخطأ' : 'Error Details'}
          </button>

          {isDetailsExpanded && (
            <div className="
              mt-4 p-4
              bg-gray-800 rounded-lg
              text-sm text-gray-300
            ">
              <div className="mb-2">
                <span className="font-semibold text-gray-200">
                  {lang === 'ar' ? 'النوع:' : 'Type:'}
                </span>{' '}
                {error.type}
              </div>

              <div className="mb-2">
                <span className="font-semibold text-gray-200">
                  {lang === 'ar' ? 'الرسالة:' : 'Message:'}
                </span>{' '}
                {error.message}
              </div>

              {error.code && (
                <div className="mb-2">
                  <span className="font-semibold text-gray-200">
                    {lang === 'ar' ? 'الكود:' : 'Code:'}
                  </span>{' '}
                  {error.code}
                </div>
              )}

              <div className="mb-2">
                <span className="font-semibold text-gray-200">
                  {lang === 'ar' ? 'الوقت:' : 'Time:'}
                </span>{' '}
                {new Date(error.timestamp).toLocaleString(lang === 'ar' ? 'ar-SA' : 'en-US')}
              </div>

              <div className="pt-2 mt-2 border-t border-gray-700">
                {messages.details}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Compact error display for inline use
 */
export function CompactErrorDisplay({
  error,
  lang,
  onRetry,
  className = '',
}: Omit<ErrorDisplayProps, 'onFallback' | 'showDetails'>): JSX.Element {
  const messages = getErrorMessage(error.type, lang);
  const isRTL = lang === 'ar';

  return (
    <div
      className={`
        flex items-center justify-between
        w-full p-4
        bg-red-900 bg-opacity-20
        border border-red-500
        rounded-lg
        ${isRTL ? 'text-right' : 'text-left'}
        ${className}
      `}
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      <div className="flex items-center gap-3">
        <svg
          className="w-6 h-6 text-red-500 flex-shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <div>
          <p className="text-sm font-semibold text-white">
            {messages.title}
          </p>
          <p className="text-xs text-gray-300">
            {messages.description}
          </p>
        </div>
      </div>

      {onRetry && error.retryable && (
        <button
          onClick={onRetry}
          className="
            px-4 py-2
            bg-red-600 hover:bg-red-700
            text-white text-sm font-semibold
            rounded
            transition-colors duration-200
            flex-shrink-0
          "
          aria-label={messages.retryButton}
        >
          {messages.retryButton}
        </button>
      )}
    </div>
  );
}

export default ErrorDisplay;
