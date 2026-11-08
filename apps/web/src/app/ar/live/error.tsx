'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { logger } from '@/lib/logger-client';

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * Error Boundary for /ar/live route (Arabic/RTL)
 *
 * Handles runtime errors in the live streaming pages with:
 * - User-friendly Arabic error message display
 * - Right-to-left (RTL) layout
 * - Retry functionality
 * - Navigation back to home
 * - Error logging
 * - Full accessibility support
 */
export default function LiveErrorAR({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    // Log the error for debugging
    logger.error('Live page error (AR)', {
      message: error.message,
      digest: error.digest,
      stack: error.stack,
    });
  }, [error]);

  return (
    <div
      className="flex flex-col items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900 px-4 transition-colors duration-300"
      dir="rtl"
      role="alert"
      aria-live="assertive"
      aria-labelledby="error-title"
      aria-describedby="error-description"
    >
      {/* Error Icon */}
      <div className="relative mb-8">
        <div className="relative">
          <div
            className="w-24 h-24 md:w-32 md:h-32 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center"
            aria-hidden="true"
          >
            <svg
              className="w-12 h-12 md:w-16 md:h-16 text-red-600 dark:text-red-400"
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
          </div>
          {/* Decorative pulse effect */}
          <div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 bg-red-500/10 dark:bg-red-400/10 rounded-full animate-ping"
            aria-hidden="true"
          />
        </div>
      </div>

      {/* Error Message */}
      <div className="text-center max-w-md space-y-4 mb-8">
        <h1
          id="error-title"
          className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white transition-colors"
        >
          حدث خطأ ما
        </h1>

        <p
          id="error-description"
          className="text-gray-600 dark:text-gray-400 text-lg leading-relaxed transition-colors"
        >
          واجهنا خطأ أثناء تحميل صفحة البث المباشر. يرجى المحاولة مرة أخرى أو العودة إلى الصفحة الرئيسية.
        </p>

        {/* Error details in development */}
        {process.env.NODE_ENV === 'development' && error.message && (
          <details className="mt-4 text-right">
            <summary className="cursor-pointer text-sm text-gray-600 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300">
              تفاصيل الخطأ
            </summary>
            <pre
              className="mt-2 p-4 bg-gray-100 dark:bg-gray-800 rounded-lg text-xs overflow-auto max-h-40 text-gray-800 dark:text-gray-200"
              dir="ltr"
            >
              {error.message}
              {error.digest && `\nDigest: ${error.digest}`}
            </pre>
          </details>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row-reverse gap-4 w-full max-w-md">
        {/* Try Again Button */}
        <button
          onClick={reset}
          className="flex-1 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 text-center focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
          aria-label="حاول تحميل الصفحة مرة أخرى"
        >
          حاول مرة أخرى
        </button>

        {/* Go Home Button */}
        <Link
          href="/ar"
          className="flex-1 px-6 py-3 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-900 dark:text-white font-medium rounded-lg shadow hover:shadow-md transform hover:scale-105 transition-all duration-200 text-center focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
          aria-label="الذهاب إلى الصفحة الرئيسية"
        >
          العودة للرئيسية
        </Link>
      </div>

      {/* Additional Help Text */}
      <p className="mt-8 text-sm text-gray-600 dark:text-gray-400 text-center transition-colors">
        إذا استمرت المشكلة، يرجى{' '}
        <Link
          href="/ar"
          className="text-blue-600 dark:text-blue-400 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
        >
          التواصل معنا
        </Link>{' '}
        للحصول على المساعدة.
      </p>

      {/* Decorative Background Pattern */}
      <div className="fixed inset-0 -z-10 opacity-30 dark:opacity-10" aria-hidden="true">
        <div className="absolute top-10 right-10 w-72 h-72 bg-red-400 rounded-full mix-blend-multiply filter blur-xl animate-blob" />
        <div className="absolute top-10 left-10 w-72 h-72 bg-orange-400 rounded-full mix-blend-multiply filter blur-xl animate-blob animation-delay-2000" />
        <div className="absolute bottom-10 left-1/2 w-72 h-72 bg-yellow-400 rounded-full mix-blend-multiply filter blur-xl animate-blob animation-delay-4000" />
      </div>

      {/* Custom Animations */}
      <style jsx>{`
        @keyframes blob {
          0%,
          100% {
            transform: translate(0, 0) scale(1);
          }
          33% {
            transform: translate(-30px, -50px) scale(1.1);
          }
          66% {
            transform: translate(20px, 20px) scale(0.9);
          }
        }

        .animate-blob {
          animation: blob 7s infinite;
        }

        .animation-delay-2000 {
          animation-delay: 2s;
        }

        .animation-delay-4000 {
          animation-delay: 4s;
        }
      `}</style>
    </div>
  );
}
