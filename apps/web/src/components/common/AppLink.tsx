'use client';

import NextLink, { type LinkProps as NextLinkProps } from 'next/link';
import { forwardRef, useState, type AnchorHTMLAttributes, type FocusEvent, type MouseEvent, type ReactNode, type TouchEvent } from 'react';

// The same props next/link accepts
type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof NextLinkProps> &
  NextLinkProps & { children?: ReactNode };

/**
 * next/link that prefetches on intent (hover, focus, touch) instead of whenever
 * the link scrolls into view. Viewport prefetch rendered every visible nav link
 * and video card on the server for each page view, about 20 extra Worker
 * requests per page, most of them for pages nobody opened (2026-11-11: ~10x
 * the page views on QA, most of the account's Workers requests and CPU).
 *
 * A link that passes `prefetch` explicitly keeps exactly that behaviour.
 * Import this instead of `next/link` (lint enforces it).
 */
const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  { prefetch, onMouseEnter, onFocus, onTouchStart, ...props },
  ref,
) {
  const [intent, setIntent] = useState(false);
  return (
    <NextLink
      ref={ref}
      {...props}
      // false: no prefetch at all; null ("auto"): Next's default prefetch, which
      // starts as soon as this link instance mounts with prefetch on
      prefetch={prefetch !== undefined ? prefetch : intent ? null : false}
      onMouseEnter={(e: MouseEvent<HTMLAnchorElement>) => {
        setIntent(true);
        onMouseEnter?.(e);
      }}
      onFocus={(e: FocusEvent<HTMLAnchorElement>) => {
        setIntent(true);
        onFocus?.(e);
      }}
      onTouchStart={(e: TouchEvent<HTMLAnchorElement>) => {
        setIntent(true);
        onTouchStart?.(e);
      }}
    />
  );
});

export default Link;
