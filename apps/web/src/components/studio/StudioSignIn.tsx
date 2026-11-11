'use client';

import { useEffect } from 'react';
import { login } from '@/lib/actions';
import { signInAndReturnHere } from '@/lib/auth/silent-sign-in';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/hooks/useLanguage';

export function StudioSignIn({ locale, returnTo }: { locale: string; returnTo: string }) {
  const { t } = useLanguage();
  // A signed-out Studio link goes straight to sign-in and comes back here, as
  // the creator pages before Studio did; the button stays for when that can't run
  useEffect(() => {
    signInAndReturnHere(locale);
  }, [locale]);
  return (
    <main id="main-content" className="mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="mb-3 text-2xl font-bold text-foreground">{t.studio.signIn.title}</h1>
      <p className="mb-6 text-muted-foreground">{t.studio.signIn.body}</p>
      <form action={login.bind(null, locale, returnTo)}>
        <Button type="submit">{t.navigation.signIn}</Button>
      </form>
    </main>
  );
}
