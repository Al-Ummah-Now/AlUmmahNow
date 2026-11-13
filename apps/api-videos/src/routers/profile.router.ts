import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { authMiddleware } from '../middleware/auth';

// Import profile endpoints
import { ProfileCreate } from '../endpoints/profile/profileCreate';
import { ProfileDelete } from '../endpoints/profile/profileDelete';
import { ProfileFetch } from '../endpoints/profile/profileFetch';
import { ProfileCurrentFetch } from '../endpoints/profile/profileCurrentFetch';
import { ProfilesList } from '../endpoints/profile/profileList';
import { ProfileUpdate } from '../endpoints/profile/profileUpdate';
import { PlaybackSettingsGet, PlaybackSettingsUpdate } from '../endpoints/profile/playbackSettings';
import { OnboardingGet, OnboardingUpdate } from '../endpoints/profile/onboarding';
import { WatchHistoryAdd } from '../endpoints/profile/watchHistoryAdd';
import { WatchHistoryList } from '../endpoints/profile/watchHistoryList';
import handleAvatarUpdate from '../endpoints/profile/profileAvatarUpdate';
import handleCoverUpdate from '../endpoints/profile/profileCoverUpdate';
import { SubscriptionsList } from '../endpoints/channel/SubscriptionsList';
import { SubscriptionFeed } from '../endpoints/channel/SubscriptionFeed';

const app = new Hono();

// Apply authentication middleware to routes that require login
// GET endpoints for profiles are public, CUD operations require auth
app.use('/profiles', (c, next) => {
	if (c.req.method !== 'GET') {
		return authMiddleware(c, next);
	}
	return next();
});

// Profile routes (current user - requires auth)
app.use('/profile', authMiddleware);
app.use('/profile/*', authMiddleware);

export const profileRouter = fromHono(app, { base: '/api' });

// PROFILE ROUTES

// Public: List all profiles
profileRouter.get('/profiles', ProfilesList);

// Public: Get profile by ID
profileRouter.get('/profiles/:id', ProfileFetch);

// Auth required: Create new profile
profileRouter.post('/profiles', ProfileCreate);

// Auth required: Get current user's profile (includes account details)
profileRouter.get('/profile', ProfileCurrentFetch);

// Auth required: Update current user's profile
profileRouter.put('/profile', ProfileUpdate);

// Auth required: Delete current user's profile
profileRouter.delete('/profile', ProfileDelete);

// Auth required: Get current user's subscriptions
// Auth required: playback settings (autoplay next), synced across the viewer's devices
profileRouter.get('/profile/playback', PlaybackSettingsGet);
profileRouter.put('/profile/playback', PlaybackSettingsUpdate);

// Auth required: first-run guides seen (the identity tour shows once per account)
profileRouter.get('/profile/onboarding', OnboardingGet);
profileRouter.put('/profile/onboarding', OnboardingUpdate);

profileRouter.get('/profile/subscriptions', SubscriptionsList);
profileRouter.get('/profile/subscriptions/feed', SubscriptionFeed);

// Auth required: Profile photo/cover uploads (non-OpenAPI handlers)
app.put('/profile/avatar', authMiddleware, handleAvatarUpdate);
app.put('/profile/cover', authMiddleware, handleCoverUpdate);

// WATCH HISTORY ROUTES (legacy system)

// Auth required: Add to watch history
profileRouter.post('/profiles/watch-history', WatchHistoryAdd);

// Auth required: Get watch history
profileRouter.get('/profiles/watch-history', WatchHistoryList);

export default profileRouter;
