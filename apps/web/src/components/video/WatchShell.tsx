'use client';

import React from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import WatchPageContent from '@/components/video/WatchPageContent';

/** /<locale>/video/<id> or /<locale>/shorts/<id>: the watch page (not /edit) */
const WATCH_PATH = /^\/[^/]+\/(?:video|shorts)\/([^/?#]+)\/?$/;
/** /<locale>/video?vid=<id>: the legacy watch route video cards still link to */
const LEGACY_PATH = /^\/[^/]+\/video\/?$/;

/** The video a watch URL shows, either form; null for any other page under /video */
export function watchIdFromPath(pathname: string | null | undefined, vid?: string | null): string | null {
  if (!pathname) return null;
  const match = WATCH_PATH.exec(pathname);
  if (match) return decodeURIComponent(match[1]);
  return LEGACY_PATH.test(pathname) && vid ? vid : null;
}

/**
 * Seamless next (owner, 2026-11-13: "YouTube-style, no flicker"): the watch page lives in the
 * /[locale]/video layout, above the [id] segment, so moving to another video (Next, up next,
 * a playlist item, Back) keeps this component and its player element. Only the video id from the
 * URL changes: the player swaps its source in place, and the details, comments and queue update
 * where they are. The [id] page renders the server's skeleton for the first load (SSR) and the
 * [id] layout still sets each video's title and Open Graph tags.
 */
export function WatchShell({ children }: { children: React.ReactNode }) {
  // Both URL forms render the same component in the same place, so moving between a
  // /video/<id> link and a /video?vid= card link keeps the player too
  const videoId = watchIdFromPath(usePathname(), useSearchParams()?.get('vid'));
  if (!videoId) return <>{children}</>;
  return <WatchPageContent videoId={videoId} skeleton={children} />;
}
