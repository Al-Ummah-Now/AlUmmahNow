'use client';

import { useEffect, useState } from 'react';
import { AccountMenu } from './AccountMenu';
import { HeaderSignIn } from './shell/HeaderParts';
import { fetchAuthAccounts } from '@/lib/auth-accounts';

/**
 * The public pages' header account area when this app has no session of its own (docs/design/NAV.md
 * "Header"): signed in to Al Ummah Now (any account in this browser) shows the account menu, so a
 * signed-in person without an admin role sees who they are and can switch on the access-denied page;
 * signed out shows Sign in. A pulse placeholder until Auth answers, so neither flashes.
 */
export function HeaderAccount({ issuer, lang }: { issuer: string; lang: string }) {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void fetchAuthAccounts(issuer).then((accounts) => {
      if (live) setSignedIn(!!accounts && accounts.length > 0);
    });
    return () => {
      live = false;
    };
  }, [issuer]);
  if (signedIn === null) return <span className="aun-acct-btn" aria-hidden="true" data-testid="header-account-loading" />;
  return signedIn ? <AccountMenu issuer={issuer} /> : <HeaderSignIn lang={lang} href="/login" />;
}
