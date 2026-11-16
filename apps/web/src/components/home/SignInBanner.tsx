'use client';

/**
 * The invitation at the top of the videos home page for signed-out visitors: sign in to
 * comment, like, subscribe and save. Upgrades (creator access) are offered only in the header
 * button and on the Upgrade page after sign-in, never here.
 *
 * - Signed in: nothing, and nothing flashes. The viewer is known on the server
 *   (AuthProvider in the root layout), so the server HTML already has or lacks the banner.
 * - Dismissed: the close button hides it for 30 days in this browser (lib/home/sign-in-banner.ts).
 *   The page's pre-paint script hides a dismissed banner before the first paint (CLS 0);
 *   after hydration the component drops it from the tree, and client-side navigations
 *   read the stored dismissal while rendering.
 * - Theme: the shape and depth come from the active theme's materials, and the art is the theme
 *   package's own header graphic (theme/signin-banner.css, theme/theme-art.css).
 */

import React, { useState, useSyncExternalStore } from 'react';
import { ArrowRight, Bell, Bookmark, MessageCircle, ThumbsUp, X } from 'lucide-react';
import { login } from '@/lib/actions';
import { useLanguage } from '@/hooks/useLanguage';
import { useOptionalAuth } from '@/components/AuthProvider/authContext';
import { browserStorage, isSignInBannerDismissed, rememberSignInBannerDismissed } from '@/lib/home/sign-in-banner';
import '@/theme/signin-banner.css';

const PERKS = [
  { key: 'comment', Icon: MessageCircle },
  { key: 'like', Icon: ThumbsUp },
  { key: 'subscribe', Icon: Bell },
  { key: 'save', Icon: Bookmark },
] as const;

/** Another tab dismissed it: follow along */
function subscribeToStorage(onChange: () => void) {
  window.addEventListener('storage', onChange);
  return () => window.removeEventListener('storage', onChange);
}
const readDismissed = () => isSignInBannerDismissed(browserStorage());
/** The server cannot read localStorage; hydration starts from "shown" (the pre-paint script already hid a dismissed one) */
const serverDismissed = () => false;

export function SignInBanner() {
  const { user } = useOptionalAuth();
  const { t, lang, dir } = useLanguage();
  // Read in render after hydration, so a client-side navigation back home never flashes a dismissed banner
  const storedDismissal = useSyncExternalStore(subscribeToStorage, readDismissed, serverDismissed);
  // This page view only: covers storage that is blocked
  const [dismissedNow, setDismissedNow] = useState(false);

  if (user || storedDismissal || dismissedNow) return null;

  const copy = t.signInBanner;
  const dismiss = () => {
    rememberSignInBannerDismissed(browserStorage());
    setDismissedNow(true);
  };

  return (
    <section className="sib" aria-label={copy.regionLabel} dir={dir} data-testid="signin-banner">
      {/* The active theme's own artwork (its package's imagery.headerGraphic), painted by the theme CSS
          (--fanous-header-graphic, theme/theme-art.css): switching theme or mode switches it, and the
          file is fetched only when the banner is shown. A fixed box, so nothing moves when it arrives. */}
      <div className="sib-art" aria-hidden="true" data-testid="signin-banner-art" />
      <div className="sib-body">
        <p className="sib-eyebrow">{copy.eyebrow}</p>
        <h2 className="sib-title">{copy.title}</h2>
        <p className="sib-text">{copy.body}</p>
        <ul className="sib-perks" aria-label={copy.perksLabel}>
          {PERKS.map(({ key, Icon }) => (
            <li key={key} className="sib-perk">
              <Icon aria-hidden="true" />
              <span>{copy.perks[key]}</span>
            </li>
          ))}
        </ul>
      </div>
      {/* Back to this home page in this language (lib/auth/sign-in-return.ts safeSignInReturn) */}
      <form className="sib-actions" action={login.bind(null, lang, `/${lang}`)}>
        <button type="submit" className="b b-primary sib-cta" data-testid="signin-banner-signin">
          <span>{copy.signIn}</span>
          <ArrowRight className="sib-cta-arrow" aria-hidden="true" />
        </button>
      </form>
      <button type="button" className="sib-x" onClick={dismiss} aria-label={copy.dismiss} title={copy.dismiss} data-testid="signin-banner-dismiss">
        <X aria-hidden="true" />
      </button>
    </section>
  );
}

export default SignInBanner;
