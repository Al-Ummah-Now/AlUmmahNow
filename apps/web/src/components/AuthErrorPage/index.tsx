'use client';

import { useLanguage } from '@/hooks/useLanguage';
import { login } from '@/lib/actions';
import { ErrorScreen } from '@/components/errors/ErrorScreen';

/**
 * Shown when the sign-in flow returns without a session (the auth server
 * reported an error, the user cancelled, or the code could not be
 * exchanged). The auth server's own error text is not shown: it is
 * English-only and can be misleading (a failed password reset arrives as
 * "Incorrect email or password"). The site's error card (ErrorScreen), with
 * sign-in's own words.
 */
export default function AuthErrorPage() {
  const { t, locale } = useLanguage();
  const lang = locale === 'ar' ? 'ar' : 'en';

  return (
    <ErrorScreen
      locale={lang}
      kind="session"
      title={t.auth.callbackErrorTitle}
      body={t.auth.callbackErrorMessage}
      testId="auth-error-page"
      primary={{
        label: t.auth.tryAgain,
        icon: 'session',
        testId: 'auth-error-retry',
        form: (button) => <form action={login.bind(null, locale)}>{button}</form>,
      }}
      secondary={[{ label: t.auth.backHome, icon: 'home', href: `/${lang}`, testId: 'auth-error-home' }]}
      contactHref={`/${lang}/contact`}
    />
  );
}
