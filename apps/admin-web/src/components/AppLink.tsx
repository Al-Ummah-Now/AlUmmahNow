'use client';

import NextLink from 'next/link';
import { useState, type FocusEvent, type MouseEvent, type TouchEvent } from 'react';

// Exactly the props next/link accepts, typed by next's own React types (taken from
// its call signature: ComponentProps resolves to {} where two @types/react meet)
type LinkProps = Parameters<typeof NextLink>[0];

/**
 * next/link that prefetches on intent (hover, focus, touch) instead of whenever
 * the link scrolls into view. Viewport prefetch rendered every visible nav link
 * and video card on the server for each page view, about 20 extra Worker
 * requests per page, most of them for pages nobody opened (2026-11-11: ~10x
 * the page views on QA, most of the account's Workers requests and CPU).
 *
 * A link that passes `prefetch` explicitly keeps exactly that behaviour.
 * Import this instead of `next/link` (lint enforces it). React 19: `ref` is a plain prop.
 */
export default function Link({ prefetch, onMouseEnter, onFocus, onTouchStart, ref, ...props }: LinkProps) {
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
}
