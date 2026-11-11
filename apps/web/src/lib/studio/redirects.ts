/**
 * Creator pages that came before Studio, moved into it for good (301). Studio
 * is the creator home: one canonical page per job. Links that name no channel
 * go through /studio/go/… (the active channel) or /studio/video/{id}/… (the
 * video's channel). Query strings are kept.
 *
 * Channel settings pages Studio hasn't rebuilt stay where they are and Studio
 * links to them (lib/studio/nav.ts LEGACY_PAGES).
 */
export interface StudioRedirect {
  source: string;
  destination: string;
  statusCode: 301;
}

const L = ':locale(en|ar)';

export const STUDIO_REDIRECTS: StudioRedirect[] = [
  { source: `/${L}/dashboard`, destination: '/:locale/studio', statusCode: 301 },
  { source: `/${L}/dashboard/videos`, destination: '/:locale/studio/go/content/videos', statusCode: 301 },
  { source: `/${L}/settings/channel/:id/videos`, destination: '/:locale/studio/:id/content/videos', statusCode: 301 },
  { source: `/${L}/video/:id/edit`, destination: '/:locale/studio/video/:id/edit', statusCode: 301 },
  { source: `/${L}/analytics`, destination: '/:locale/studio/go/analytics', statusCode: 301 },
  { source: `/${L}/analytics/videos/:id`, destination: '/:locale/studio/video/:id/analytics', statusCode: 301 },
  { source: `/${L}/scheduled-videos`, destination: '/:locale/studio/go/content/videos?status=scheduled&view=calendar', statusCode: 301 },
];
