'use client';

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/hooks/useLanguage';
import { MAIN_CONTENT_ID } from '@/components/SkipLinks';

/**
 * Localized 404 page, rendered by app/not-found.tsx (unmatched URLs) and
 * app/[locale]/not-found.tsx (notFound() inside a locale route). The language
 * comes from the URL, so /ar/... gets Arabic + RTL.
 *
 * Features:
 * - Bilingual support (English/Arabic) with RTL
 * - Full dark mode support
 * - Responsive design (mobile-first)
 * - Smooth animations
 * - Accessible (semantic HTML, ARIA labels)
 * - Two navigation options: Go Home and Go Back
 */
export default function NotFoundPage() {
  const { t, isRTL, locale } = useLanguage();
  const router = useRouter();

  const handleGoBack = () => {
    if (window.history.length > 1) {
      router.back();
    } else {
      router.push(`/${locale}`);
    }
  };

  return (
    <main
      id={MAIN_CONTENT_ID}
      data-testid="not-found-page"
      className="flex flex-col items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900 px-4 transition-colors duration-300"
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      {/* 404 Illustration Container */}
      <div className="relative mb-8">
        {/* Animated 404 Number */}
        <div className="relative">
          <p
            className="text-9xl md:text-[12rem] font-bold text-gray-300 dark:text-gray-700 select-none animate-pulse"
            aria-hidden="true"
          >
            404
          </p>

          {/* Decorative Elements */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" aria-hidden="true">
            <div className="w-32 h-32 bg-blue-500/10 dark:bg-blue-400/10 rounded-full animate-ping" />
          </div>
        </div>
      </div>

      {/* Error Message */}
      <div className="text-center max-w-md space-y-4 mb-8">
        <h1 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white transition-colors">
          {t.errors.notFound}
        </h1>

        <p className="text-gray-600 dark:text-gray-400 text-lg leading-relaxed transition-colors">
          {t.errors.notFoundDescription}
        </p>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row gap-4 w-full max-w-md">
        {/* Go Home Button */}
        <Link
          href={`/${locale}`}
          className="flex-1 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 text-center"
        >
          {t.errors.notFoundGoHome}
        </Link>

        {/* Go Back Button */}
        <button
          onClick={handleGoBack}
          className="flex-1 px-6 py-3 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-900 dark:text-white font-medium rounded-lg shadow hover:shadow-md transform hover:scale-105 transition-all duration-200"
        >
          {t.errors.notFoundGoBack}
        </button>
      </div>

      {/* Additional Help Text */}
      <p className="mt-8 text-sm text-gray-600 dark:text-gray-400 text-center transition-colors">
        {t.errors.notFoundNeedHelp}{' '}
        <Link
          href={`/${locale}`}
          className="text-blue-700 dark:text-blue-400 underline hover:no-underline"
        >
          {t.errors.notFoundContactUs}
        </Link>
      </p>

      {/* Decorative Background Pattern */}
      <div className="fixed inset-0 -z-10 opacity-30 dark:opacity-10" aria-hidden="true">
        <div className="absolute top-10 left-10 w-72 h-72 bg-blue-400 rounded-full mix-blend-multiply filter blur-xl animate-blob" />
        <div className="absolute top-10 right-10 w-72 h-72 bg-purple-400 rounded-full mix-blend-multiply filter blur-xl animate-blob animation-delay-2000" />
        <div className="absolute bottom-10 left-1/2 w-72 h-72 bg-pink-400 rounded-full mix-blend-multiply filter blur-xl animate-blob animation-delay-4000" />
      </div>

      {/* Custom Animations */}
      <style jsx>{`
        @keyframes blob {
          0%, 100% {
            transform: translate(0, 0) scale(1);
          }
          33% {
            transform: translate(30px, -50px) scale(1.1);
          }
          66% {
            transform: translate(-20px, 20px) scale(0.9);
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
    </main>
  );
}
