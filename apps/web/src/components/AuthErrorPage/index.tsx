'use client';

import React from 'react';
import Link from 'next/link';
import { useLanguage } from '@/hooks/useLanguage';
import { login } from '@/lib/actions';

/**
 * Shown when the sign-in flow returns without a session (the auth server
 * reported an error, the user cancelled, or the code could not be
 * exchanged). The auth server's own error text is not shown: it is
 * English-only and can be misleading (a failed password reset arrives as
 * "Incorrect email or password").
 */
export default function AuthErrorPage() {
  const { t, isRTL, locale } = useLanguage();

  return (
    <main
      data-testid="auth-error-page"
      className="flex flex-col items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900 px-4"
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      <div className="text-center max-w-md space-y-4 mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">{t.auth.callbackErrorTitle}</h1>
        <p className="text-gray-600 dark:text-gray-400 text-lg leading-relaxed">{t.auth.callbackErrorMessage}</p>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 w-full max-w-md">
        <form action={login.bind(null, locale)} className="flex-1">
          <button
            type="submit"
            data-testid="auth-error-retry"
            className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg"
          >
            {t.auth.tryAgain}
          </button>
        </form>
        <Link
          href={`/${locale}`}
          data-testid="auth-error-home"
          className="flex-1 px-6 py-3 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-900 dark:text-white font-medium rounded-lg text-center"
        >
          {t.auth.backHome}
        </Link>
      </div>
    </main>
  );
}
