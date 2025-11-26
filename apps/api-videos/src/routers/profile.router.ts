import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { authMiddleware } from '../middleware/auth';

// Import profile endpoints
import { ProfileCreate } from '../endpoints/profile/profileCreate';
import { ProfileDelete } from '../endpoints/profile/profileDelete';
import { ProfileFetch } from '../endpoints/profile/profileFetch';
import { ProfilesList } from '../endpoints/profile/profileList';
import { ProfileUpdate } from '../endpoints/profile/profileUpdate';
import { WatchHistoryAdd } from '../endpoints/profile/watchHistoryAdd';
import { WatchHistoryList } from '../endpoints/profile/watchHistoryList';
import handleAvatarUpdate from '../endpoints/profile/profileAvatarUpdate';
import handleCoverUpdate from '../endpoints/profile/profileCoverUpdate';

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

// Auth required: Update current user's profile
profileRouter.put('/profile', ProfileUpdate);

// Auth required: Delete current user's profile
profileRouter.delete('/profile', ProfileDelete);

// Auth required: Profile photo/cover uploads (non-OpenAPI handlers)
app.put('/profile/avatar', authMiddleware, handleAvatarUpdate);
app.put('/profile/cover', authMiddleware, handleCoverUpdate);

// WATCH HISTORY ROUTES (legacy system)

// Auth required: Add to watch history
profileRouter.post('/profiles/watch-history', WatchHistoryAdd);

// Auth required: Get watch history
profileRouter.get('/profiles/watch-history', WatchHistoryList);

export default profileRouter;
