'use client';

/**
 * Skip links (Story 1.4, AC 4 - WCAG 2.4.1 Bypass Blocks)
 *
 * Rendered first in the document so they are the first Tab stops. They are
 * visually hidden until focused. "Skip to main content" targets #main-content
 * (falling back to the first <main> landmark); on the watch page additional
 * links jump to the video player and the comments.
 */

import React from 'react';
import { usePathname } from 'next/navigation';
import { useLanguage } from '@/hooks/useLanguage';
import { focusElementById } from '@/lib/accessibility/focus-manager';

export const MAIN_CONTENT_ID = 'main-content';
export const VIDEO_PLAYER_ID = 'video-player';
export const COMMENTS_ID = 'comments';
/**
 * Wrapper the root layout puts around every page's content. Not every page
 * renders a <main> landmark, so it is the last-resort skip target and the
 * skip link never points at nothing.
 */
export const PAGE_CONTENT_ID = 'page-content';

interface SkipTarget {
  id: string;
  label: string;
  fallbackSelector?: string;
  /** Focus this (already focusable) element instead of the container when present */
  preferSelector?: string;
  /** Element id focused when neither the id nor the fallback selector exists */
  lastResortId?: string;
}

function isWatchPage(pathname: string | null): boolean {
  return !!pathname && /^\/[a-z]{2}\/video\/[^/]+\/?$/.test(pathname);
}

export interface SkipLinksBaseProps {
  dir: 'ltr' | 'rtl';
}

export function SkipLinksBase({ dir }: SkipLinksBaseProps) {
  const { t } = useLanguage();
  const pathname = usePathname();

  const targets: SkipTarget[] = [
    { id: MAIN_CONTENT_ID, label: t.a11y.skipToMainContent, fallbackSelector: 'main', lastResortId: PAGE_CONTENT_ID },
  ];
  if (isWatchPage(pathname)) {
    targets.push(
      // Land on the Video.js root so player keyboard shortcuts work immediately
      { id: VIDEO_PLAYER_ID, label: t.a11y.skipToVideoPlayer, preferSelector: `#${VIDEO_PLAYER_ID} .video-js` },
      { id: COMMENTS_ID, label: t.a11y.skipToComments },
    );
  }

  const handleClick = (event: React.MouseEvent<HTMLAnchorElement>, target: SkipTarget) => {
    const preferred = target.preferSelector
      ? document.querySelector<HTMLElement>(target.preferSelector)
      : null;
    if (preferred) {
      event.preventDefault();
      preferred.focus({ preventScroll: true });
      preferred.scrollIntoView({ block: 'center' });
      return;
    }
    if (
      focusElementById(target.id, target.fallbackSelector) ||
      (target.lastResortId && focusElementById(target.lastResortId))
    ) {
      event.preventDefault();
    }
  };

  return (
    <nav aria-label={t.a11y.skipLinks} dir={dir} className="skip-links">
      {targets.map((target) => (
        <a
          key={target.id}
          href={`#${target.id}`}
          className="skip-link"
          onClick={(event) => handleClick(event, target)}
        >
          {target.label}
        </a>
      ))}
    </nav>
  );
}
