import { Hono } from 'hono';
import { fromHono } from 'chanfana';

// Import playlist endpoints
import { PlaylistCreate } from '../endpoints/playlist/playlistCreate';
import { PlaylistFetch } from '../endpoints/playlist/playlistFetch';
import { PlaylistUpdate } from '../endpoints/playlist/playlistUpdate';
import { PlaylistDelete } from '../endpoints/playlist/playlistDelete';
import { PlaylistsList } from '../endpoints/playlist/playlistsList';
import { PlaylistAddVideo } from '../endpoints/playlist/playlistAddVideo';
import { PlaylistRemoveVideo } from '../endpoints/playlist/playlistRemoveVideo';
import { PlaylistUploadAddsCreate, PlaylistUploadAddsStatus } from '../endpoints/playlist/playlistUploadAdds';
import {
    PlaylistJobFetch,
    PlaylistJobRetry,
    PlaylistManageItems,
    PlaylistVideosBulkAdd,
    PlaylistVideosBulkRemove,
    PlaylistVideosReorder,
} from '../endpoints/playlist/playlistBulk';

const app = new Hono();

export const playlistRouter = fromHono(app, { base: '/api/playlists' });

// Register routes with paths RELATIVE to base (/api/playlists)
// CRUD operations
playlistRouter.get('/', PlaylistsList);           // GET /api/playlists - List all playlists
playlistRouter.post('/', PlaylistCreate);          // POST /api/playlists - Create playlist
// New uploads → playlists (queued; registered before /:id)
playlistRouter.post('/upload-adds', PlaylistUploadAddsCreate);  // POST /api/playlists/upload-adds
playlistRouter.get('/upload-adds', PlaylistUploadAddsStatus);   // GET /api/playlists/upload-adds?videoIds=
playlistRouter.get('/:id', PlaylistFetch);         // GET /api/playlists/:id - Get playlist
playlistRouter.patch('/:id', PlaylistUpdate);      // PATCH /api/playlists/:id - Update playlist
playlistRouter.delete('/:id', PlaylistDelete);     // DELETE /api/playlists/:id - Delete playlist

// Video management
playlistRouter.post('/:id/videos', PlaylistAddVideo);               // POST /api/playlists/:id/videos - Add video to playlist
playlistRouter.delete('/:id/videos/:videoId', PlaylistRemoveVideo); // DELETE /api/playlists/:id/videos/:videoId - Remove video from playlist

// Bulk management (channel playlists: owner or playlist.manage on the channel)
playlistRouter.post('/:id/videos/bulk', PlaylistVideosBulkAdd);     // POST /api/playlists/:id/videos/bulk - Add many videos (ordered, idempotent)
playlistRouter.post('/:id/videos/remove', PlaylistVideosBulkRemove); // POST /api/playlists/:id/videos/remove - Remove many videos
playlistRouter.put('/:id/videos/order', PlaylistVideosReorder);     // PUT /api/playlists/:id/videos/order - Reorder videos
playlistRouter.get('/:id/items', PlaylistManageItems);              // GET /api/playlists/:id/items - Entries with their videos, for managers
playlistRouter.get('/:id/jobs/:jobId', PlaylistJobFetch);           // GET /api/playlists/:id/jobs/:jobId - Background add progress
playlistRouter.post('/:id/jobs/:jobId/retry', PlaylistJobRetry);    // POST /api/playlists/:id/jobs/:jobId/retry - Retry a failed background add

export default playlistRouter;
