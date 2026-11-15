/**
 * Public profiles (Story 29.5), relative to base /api/users; anyone may read:
 * - GET /by-handle/:handle                 the profile (name, picture, bio, public channels, which lists show)
 * - GET /by-handle/:handle/subscriptions   public channels the user subscribes to (404 when hidden)
 * - GET /by-handle/:handle/playlists       public personal playlists (404 when hidden)
 * - GET /by-handle/:handle/likes           public videos the user liked (404 when hidden)
 * The owner's settings are PUT /api/profile/public (profile.router.ts).
 */

import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { UserByHandleFetch, UserLikesPublicList, UserPlaylistsPublicList, UserSubscriptionsPublicList } from '../endpoints/profile/publicProfile';

const app = new Hono();

export const usersRouter = fromHono(app, { base: '/api/users' });

usersRouter.get('/by-handle/:handle', UserByHandleFetch);
usersRouter.get('/by-handle/:handle/subscriptions', UserSubscriptionsPublicList);
usersRouter.get('/by-handle/:handle/playlists', UserPlaylistsPublicList);
usersRouter.get('/by-handle/:handle/likes', UserLikesPublicList);

export default usersRouter;
