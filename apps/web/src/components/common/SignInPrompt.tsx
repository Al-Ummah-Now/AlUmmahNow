'use client';

/**
 * Sign-in prompt for pages that need an account (profile, settings,
 * subscriptions). Direction comes from the active locale, so the one component
 * serves both LTR and RTL.
 */

import React from 'react';
import { login } from '@/lib/actions';
import { useLanguage } from '@/hooks/useLanguage';

export interface SignInPromptProps {
  title: string;
  message: string;
}

export function SignInPrompt({ title, message }: SignInPromptProps) {
  const { t, lang, dir } = useLanguage();

  return (
    <main dir={dir} className="flex-1 bg-gray-100 dark:bg-gray-900" data-testid="sign-in-prompt">
      <div className="container mx-auto px-4 py-16 text-center">
        <h1 className="text-3xl font-bold text-gray-800 dark:text-white mb-3">{title}</h1>
        <p className="text-gray-600 dark:text-gray-300 mb-6">{message}</p>
        <form action={login.bind(null, lang)}>
          <button
            type="submit"
            className="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
          >
            {t.navigation.signIn}
          </button>
        </form>
      </div>
    </main>
  );
}

export default SignInPrompt;
