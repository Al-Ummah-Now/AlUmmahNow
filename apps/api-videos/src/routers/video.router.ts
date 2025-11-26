import { Hono } from 'hono';
import { fromHono } from 'chanfana';

// Video CRUD endpoints
import { VideoCreate } from '../endpoints/video/videoCreate';
import { VideoUpdate } from '../endpoints/video/videoUpdate';
import { VideoDelete } from '../endpoints/video/videoDelete';
import { VideoBulkDelete } from '../endpoints/video/videoBulkDelete';
import { VideoFetch } from '../endpoints/video/videoFetch';
import { VideosList } from '../endpoints/video/videoList';
import { VideoSearch } from '../endpoints/video/videoSearch';
import { VideoView } from '../endpoints/video/videoView';
import { VideoUploadStatus } from '../endpoints/video/videoUploadStatus';

// Video upload endpoints
import { VideoUpload } from '../endpoints/video/videoUpload';
import { UploadInitiateEndpoint } from '../endpoints/video/uploadInitiate';
import { UploadStreamEndpoint } from '../endpoints/video/uploadStream';
import { UploadCompleteEndpoint } from '../endpoints/video/uploadComplete';
import { UploadResumeEndpoint } from '../endpoints/video/uploadResume';
import { UploadBatchInitiateEndpoint } from '../endpoints/video/uploadBatchInitiate';

// Video chapters endpoints
import { VideoChaptersGet } from '../endpoints/video/chapters';
import { VideoChaptersUpdate } from '../endpoints/video/chaptersUpdate';

// Video subtitles endpoints
import { SubtitlesUpload } from '../endpoints/video/subtitlesUpload';
import { SubtitlesList } from '../endpoints/video/subtitlesList';
import { SubtitlesGet } from '../endpoints/video/subtitlesGet';
import { SubtitlesDelete } from '../endpoints/video/subtitlesDelete';

// Video scheduling endpoints
import { VideoScheduleCreate } from '../endpoints/video/scheduleCreate';
import { VideoScheduleUpdate } from '../endpoints/video/scheduleUpdate';
import { VideoScheduleDelete } from '../endpoints/video/scheduleDelete';
import { VideoScheduleFetch } from '../endpoints/video/scheduleFetch';
import { VideoScheduleList } from '../endpoints/video/scheduleList';

// Video comment endpoints
import { CommentCreate } from '../endpoints/video/commentCreate';
import { CommentUpdate } from '../endpoints/video/commentUpdate';
import { CommentDelete } from '../endpoints/video/commentDelete';

// Video like/dislike endpoints
import { LikeCreate } from '../endpoints/video/videoLikeCreate';
import { LikeDelete } from '../endpoints/video/videoLikeDelete';
import { DislikeCreate } from '../endpoints/video/videoDislikeCreate';
import { DislikeDelete } from '../endpoints/video/videoDislikeDelete';

// Comment like/dislike endpoints (re-using video like/dislike classes with different paths)
// Note: Comment likes/dislikes are handled by the same endpoint classes but with comment-specific paths

const app = new Hono();

export const videoRouter = fromHono(app, { base: '/api/videos' });

// ==========================================
// VIDEO CRUD OPERATIONS
// ==========================================

// List videos (public)
videoRouter.get('/', VideosList);

// Search videos (public)
videoRouter.get('/search', VideoSearch);

// Get scheduled videos list (authenticated)
videoRouter.get('/scheduled', VideoScheduleList);

// Create video (authenticated)
videoRouter.post('/', VideoCreate);

// Get single video (public)
videoRouter.get('/:id', VideoFetch);

// Update video (authenticated)
videoRouter.put('/:id', VideoUpdate);

// Delete video (authenticated)
videoRouter.delete('/:id', VideoDelete);

// Bulk delete videos (authenticated)
videoRouter.post('/bulk-delete', VideoBulkDelete);

// Get video upload status (authenticated)
videoRouter.get('/:id/upload-status', VideoUploadStatus);

// ==========================================
// VIDEO UPLOAD OPERATIONS
// ==========================================

// Upload video (authenticated)
videoRouter.post('/upload', VideoUpload);

// Initiate upload (authenticated)
videoRouter.post('/upload/initiate', UploadInitiateEndpoint);

// Stream upload (authenticated)
videoRouter.post('/upload/stream', UploadStreamEndpoint);

// Complete upload (authenticated)
videoRouter.post('/upload/complete', UploadCompleteEndpoint);

// Resume upload (authenticated)
videoRouter.get('/upload/resume/:videoId', UploadResumeEndpoint);

// Batch upload initiate (authenticated)
videoRouter.post('/upload/batch/initiate', UploadBatchInitiateEndpoint);

// ==========================================
// VIDEO CHAPTERS
// ==========================================

// Get video chapters (public)
videoRouter.get('/:id/chapters', VideoChaptersGet);

// Update video chapters (authenticated)
videoRouter.put('/:id/chapters', VideoChaptersUpdate);

// ==========================================
// VIDEO SUBTITLES
// ==========================================

// List subtitle tracks (public)
videoRouter.get('/:videoId/subtitles', SubtitlesList);

// Get specific subtitle track (public)
videoRouter.get('/:videoId/subtitles/:language', SubtitlesGet);

// Upload subtitle track (authenticated)
videoRouter.post('/:videoId/subtitles', SubtitlesUpload);

// Delete subtitle track (authenticated)
videoRouter.delete('/:videoId/subtitles/:language', SubtitlesDelete);

// ==========================================
// VIDEO SCHEDULING
// ==========================================

// Create schedule (authenticated)
videoRouter.post('/:id/schedule', VideoScheduleCreate);

// Get schedule status (authenticated)
videoRouter.get('/:id/schedule', VideoScheduleFetch);

// Update schedule (authenticated)
videoRouter.patch('/:id/schedule', VideoScheduleUpdate);

// Delete schedule (authenticated)
videoRouter.delete('/:id/schedule', VideoScheduleDelete);

// ==========================================
// VIDEO REACTIONS (LIKES/DISLIKES)
// ==========================================

// Like video (authenticated)
videoRouter.post('/:id/likes', LikeCreate);

// Remove like from video (authenticated)
videoRouter.delete('/:id/likes', LikeDelete);

// Dislike video (authenticated)
videoRouter.post('/:id/dislikes', DislikeCreate);

// Remove dislike from video (authenticated)
videoRouter.delete('/:id/dislikes', DislikeDelete);

// ==========================================
// VIDEO COMMENTS
// ==========================================

// Create comment (authenticated)
videoRouter.post('/:id/comments', CommentCreate);

// Update comment (authenticated)
videoRouter.put('/:id/comments/:cid', CommentUpdate);

// Delete comment (authenticated)
videoRouter.delete('/:id/comments/:cid', CommentDelete);

// Like comment (authenticated)
videoRouter.post('/:id/comments/:cid/likes', LikeCreate);

// Remove like from comment (authenticated)
videoRouter.delete('/:id/comments/:cid/likes', LikeDelete);

// Dislike comment (authenticated)
videoRouter.post('/:id/comments/:cid/dislikes', DislikeCreate);

// Remove dislike from comment (authenticated)
videoRouter.delete('/:id/comments/:cid/dislikes', DislikeDelete);

// ==========================================
// VIDEO ANALYTICS
// ==========================================

// Track video view (public - for analytics)
videoRouter.post('/:id/view', VideoView);

// Export as default and named export
export default videoRouter;
