'use client';

import { useEffect } from 'react';

/**
 * The error screen's tab title ("Something went wrong | Al Ummah Now", "This was removed | …") for as
 * long as the screen is up, on whatever route it shows. The route's metadata <title> can stream in
 * after the screen mounts (and a 410's HTML title is the Worker's, which hydration may put back), so
 * one document.title write or a rendered <title> loses to it: the head is watched and the title set
 * again whenever something else changes it. When the screen goes (Try again, navigation), the route's
 * last title comes back. apps/web/src/components/errors/useErrorTabTitle.ts is the same hook.
 */
export function useErrorTabTitle(title: string | null): void {
  useEffect(() => {
    if (!title) return;
    let routeTitle = document.title;
    const apply = () => {
      if (document.title === title) return;
      routeTitle = document.title;
      document.title = title;
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      if (document.title === title) document.title = routeTitle;
    };
  }, [title]);
}
