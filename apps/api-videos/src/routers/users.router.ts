/**
 * Public profiles (Story 29.5), relative to base /api/users; anyone may read:
 * - GET /by-handle/:handle                 the profile (name, picture, bio, public channels, which lists show)
 * - GET /by-handle/:handle/subscriptions   public channels the user subscribes to (404 when hidden)
 * - GET /by-handle/:handle/playlists       public personal playlists (404 when hidden)
 * The owner's settings are PUT /api/profile/public (profile.router.ts).
 * Never indexed (owner, 2026-11-14: "searching users? nope"): every response says noindex, nofollow.
 */

import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { UserByHandleFetch, UserPlaylistsPublicList, UserSubscriptionsPublicList } from '../endpoints/profile/publicProfile';

const app = new Hono();
app.use('*', async (c, next) => {
	await next();
	c.header('X-Robots-Tag', 'noindex, nofollow');
});

export const usersRouter = fromHono(app);

usersRouter.get('/by-handle/:handle', UserByHandleFetch);
usersRouter.get('/by-handle/:handle/subscriptions', UserSubscriptionsPublicList);
usersRouter.get('/by-handle/:handle/playlists', UserPlaylistsPublicList);

export default usersRouter;
