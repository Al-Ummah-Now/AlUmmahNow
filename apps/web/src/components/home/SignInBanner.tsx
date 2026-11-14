'use client';

/**
 * The invitation at the top of the videos home page for signed-out visitors: sign in to
 * comment, like, subscribe and save, and to create a channel and share videos.
 *
 * - Signed in: nothing, and nothing flashes. The viewer is known on the server
 *   (AuthProvider in the root layout), so the server HTML already has or lacks the banner.
 * - Dismissed: the close button hides it for 30 days in this browser (lib/home/sign-in-banner.ts).
 *   The page's pre-paint script hides a dismissed banner before the first paint (CLS 0);
 *   after hydration the component drops it from the tree, and client-side navigations
 *   read the stored dismissal while rendering.
 * - Theme: the shape and depth come from the active theme's materials (theme/signin-banner.css).
 */

import React, { useState, useSyncExternalStore } from 'react';
import { ArrowRight, Bell, Bookmark, Clapperboard, MessageCircle, Share2, ThumbsUp, X } from 'lucide-react';
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
  { key: 'create', Icon: Clapperboard },
  { key: 'share', Icon: Share2 },
] as const;

/** A lantern drawn in the theme's colours: the site's mark, purely decorative */
function LanternArt() {
  return (
    <svg className="sib-art-lantern" viewBox="0 0 120 180" aria-hidden="true" focusable="false">
      <path className="sib-art-chain" d="M60 0v18" />
      <path className="sib-art-ring" d="M52 26a8 8 0 1 1 16 0" />
      <path className="sib-art-cap" d="M34 44 60 26l26 18Z" />
      <path className="sib-art-body" d="M30 48h60l10 62-40 46-40-46Z" />
      <path className="sib-art-pane" d="M44 60h32l6 46-22 26-22-26Z" />
      <path className="sib-art-rib" d="M60 48v108M30 48l30 108M90 48 60 156" />
      <circle className="sib-art-flame" cx="60" cy="92" r="11" />
      <path className="sib-art-base" d="M48 160h24l-4 12H52Z" />
    </svg>
  );
}

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
      <div className="sib-art" aria-hidden="true">
        <span className="sib-art-halo" />
        <LanternArt />
      </div>
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
      <form className="sib-actions" action={login.bind(null, lang)}>
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
