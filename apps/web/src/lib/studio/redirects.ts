/**
 * Creator pages that came before Studio, moved into it for good (301). Studio
 * is the creator home: one canonical page per job. Links that name no channel
 * go through /studio/go/… (the active channel) or /studio/video/{id}/… (the
 * video's channel). Query strings are kept.
 *
 * The channel settings pages (/settings/channel/:id/…) all moved into Studio
 * (docs/specs/CREATOR-STUDIO.md §6.2). Account settings (/settings,
 * /settings/upload-defaults, /settings/privacy, /settings/channel-invites)
 * stay where they are.
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
  { source: `/${L}/settings/channel/:id`, destination: '/:locale/studio/:id/dashboard', statusCode: 301 },
  { source: `/${L}/settings/channel/:id/videos`, destination: '/:locale/studio/:id/content/videos', statusCode: 301 },
  { source: `/${L}/settings/channel/:id/edit`, destination: '/:locale/studio/:id/customisation/profile', statusCode: 301 },
  { source: `/${L}/settings/channel/:id/sections`, destination: '/:locale/studio/:id/customisation/layout?view=sections', statusCode: 301 },
  { source: `/${L}/settings/channel/:id/tabs`, destination: '/:locale/studio/:id/customisation/layout?view=tabs', statusCode: 301 },
  { source: `/${L}/settings/channel/:id/playlists`, destination: '/:locale/studio/:id/playlists', statusCode: 301 },
  { source: `/${L}/settings/channel/:id/playlists/new`, destination: '/:locale/studio/:id/playlists/new', statusCode: 301 },
  { source: `/${L}/settings/channel/:id/playlists/:playlistId`, destination: '/:locale/studio/:id/playlists/:playlistId', statusCode: 301 },
  { source: `/${L}/settings/channel/:id/community`, destination: '/:locale/studio/:id/content/posts', statusCode: 301 },
  { source: `/${L}/settings/channel/:id/community/new`, destination: '/:locale/studio/:id/content/posts/new', statusCode: 301 },
  { source: `/${L}/settings/channel/:id/community/:postId/edit`, destination: '/:locale/studio/:id/content/posts/:postId/edit', statusCode: 301 },
  { source: `/${L}/settings/channel/:id/team`, destination: '/:locale/studio/:id/settings/permissions', statusCode: 301 },
  { source: `/${L}/settings/channel/:id/members`, destination: '/:locale/studio/:id/settings/permissions', statusCode: 301 },
  { source: `/${L}/video/:id/edit`, destination: '/:locale/studio/video/:id/edit', statusCode: 301 },
  { source: `/${L}/analytics`, destination: '/:locale/studio/go/analytics', statusCode: 301 },
  { source: `/${L}/analytics/videos/:id`, destination: '/:locale/studio/video/:id/analytics', statusCode: 301 },
  { source: `/${L}/scheduled-videos`, destination: '/:locale/studio/go/content/videos?status=scheduled&view=calendar', statusCode: 301 },
];
