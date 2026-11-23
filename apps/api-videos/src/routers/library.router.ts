/**
 * Library Domain Router (Story 29.6)
 *
 * Routes (relative to base /api/library), all authenticated:
 * - GET    /watch-later              Watch later videos (ordered, paginated)
 * - POST   /watch-later              Add { videoId } (idempotent)
 * - PUT    /watch-later/order        Reorder { videoIds }
 * - GET    /watch-later/:videoId     { saved }
 * - DELETE /watch-later/:videoId     Remove (idempotent)
 * - GET    /liked                    Liked videos from the per-user index
 * - GET    /saved-posts              Saved community posts
 * - POST   /saved-posts              Save { postId, channelId } (idempotent)
 * - GET    /saved-posts/:postId      { saved }
 * - DELETE /saved-posts/:postId      Unsave (idempotent)
 * - /notes…                          Private video notes (E21-D9, endpoints/library/notes.ts)
 */

import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { WatchLaterAdd, WatchLaterList, WatchLaterRemove, WatchLaterReorder, WatchLaterStatus } from '../endpoints/library/watchLater';
import { NoteCreate, NoteDelete, NoteUpdate, NotesDeleteAll, NotesExport, NotesList } from '../endpoints/library/notes';
import { LikedVideosList, SavedPostAdd, SavedPostRemove, SavedPostStatus, SavedPostsList } from '../endpoints/library/liked';

const app = new Hono();

export const libraryRouter = fromHono(app);

libraryRouter.get('/watch-later', WatchLaterList);
libraryRouter.post('/watch-later', WatchLaterAdd);
libraryRouter.put('/watch-later/order', WatchLaterReorder);
libraryRouter.get('/watch-later/:videoId', WatchLaterStatus);
libraryRouter.delete('/watch-later/:videoId', WatchLaterRemove);
libraryRouter.get('/liked', LikedVideosList);
libraryRouter.get('/saved-posts', SavedPostsList);
libraryRouter.post('/saved-posts', SavedPostAdd);
libraryRouter.get('/saved-posts/:postId', SavedPostStatus);
libraryRouter.delete('/saved-posts/:postId', SavedPostRemove);
libraryRouter.get('/notes', NotesList);
libraryRouter.get('/notes/export.md', NotesExport);
libraryRouter.post('/notes', NoteCreate);
libraryRouter.delete('/notes', NotesDeleteAll);
libraryRouter.put('/notes/:id', NoteUpdate);
libraryRouter.delete('/notes/:id', NoteDelete);

export default libraryRouter;
