/**
 * Watch History Domain Router
 *
 * Centralizes all watch history related endpoints.
 * All routes require authentication.
 *
 * Routes (relative to base /api/watch-history):
 * - POST /              - Record a video view in watch history
 * - GET /               - List user's watch history (paginated)
 * - DELETE /            - Clear all watch history
 * - DELETE /:videoId    - Delete specific watch history entry
 * - POST /:videoId/progress   - Update watch progress for a video
 * - GET /:videoId/progress    - Get watch progress for a video
 * - GET /settings             - { paused }
 * - PUT /settings             - pause / resume recording
 */

import { Hono } from 'hono';
import { fromHono } from 'chanfana';

// Import watch history endpoints
import { RecordWatchHistory } from '../endpoints/watch-history/record';
import { ListWatchHistory } from '../endpoints/watch-history/list';
import { DeleteWatchHistory } from '../endpoints/watch-history/delete';
import { ClearWatchHistory } from '../endpoints/watch-history/clear';
import { UpdateWatchProgress } from '../endpoints/watch-history/update-progress';
import { GetWatchProgress } from '../endpoints/watch-history/get-progress';
import { GetWatchHistorySettings, UpdateWatchHistorySettings } from '../endpoints/watch-history/settings';

const app = new Hono();

export const watchHistoryRouter = fromHono(app, { base: '/api/watch-history' });

// Register routes with paths RELATIVE to base (/api/watch-history)

// Watch History Management
// Pause / resume (registered before '/:videoId' routes)
watchHistoryRouter.get('/settings', GetWatchHistorySettings);
watchHistoryRouter.put('/settings', UpdateWatchHistorySettings);

watchHistoryRouter.post('/', RecordWatchHistory);          // Record video view
watchHistoryRouter.get('/', ListWatchHistory);             // List watch history
watchHistoryRouter.delete('/', ClearWatchHistory);         // Clear all history
watchHistoryRouter.delete('/:videoId', DeleteWatchHistory); // Delete specific entry

// Watch Progress Tracking
watchHistoryRouter.post('/:videoId/progress', UpdateWatchProgress); // Update progress
watchHistoryRouter.get('/:videoId/progress', GetWatchProgress);     // Get progress

export default watchHistoryRouter;
