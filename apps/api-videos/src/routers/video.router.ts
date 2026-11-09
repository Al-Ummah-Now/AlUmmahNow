import { Hono } from 'hono';
import { fromHono } from 'chanfana';

// Video CRUD endpoints
import { VideoCreate } from '../endpoints/video/videoCreate';
import { VideoUpdate } from '../endpoints/video/videoUpdate';
import { VideoDelete } from '../endpoints/video/videoDelete';
import { VideoBulkDelete } from '../endpoints/video/videoBulkDelete';
import { VideoBulkUpdate } from '../endpoints/video/videoBulkUpdate';
import { VideoFetch } from '../endpoints/video/videoFetch';
import { CategorySuggestionGet, CategorySuggestionRequest } from '../endpoints/video/categorySuggestions';
import { VideosList } from '../endpoints/video/videoList';
import { VideoSearch } from '../endpoints/video/videoSearch';
import { VideoView } from '../endpoints/video/videoView';
import { VideoWatchTime } from '../endpoints/video/videoWatchTime';
import { VideoRetention } from '../endpoints/video/videoRetention';
import { VideoBulkPlaylist, VideoBulkSchedule } from '../endpoints/video/videoBulkStudio';
import { VideoUploadStatus } from '../endpoints/video/videoUploadStatus';
import { VideoThumbnailUpload } from '../endpoints/video/videoThumbnailUpload';

// Video upload endpoints
import { VideoUpload } from '../endpoints/video/videoUpload';
import { UploadInitiateEndpoint } from '../endpoints/video/uploadInitiate';
import { UploadCompleteEndpoint } from '../endpoints/video/uploadComplete';
import { UploadFailedEndpoint } from '../endpoints/video/uploadFailed';
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
import { SubtitlesSetDefault } from '../endpoints/video/subtitlesSetDefault';

// Video scheduling endpoints
import { VideoScheduleCreate } from '../endpoints/video/scheduleCreate';
import { VideoScheduleUpdate } from '../endpoints/video/scheduleUpdate';
import { VideoScheduleDelete } from '../endpoints/video/scheduleDelete';
import { VideoScheduleFetch } from '../endpoints/video/scheduleFetch';
import { VideoScheduleList } from '../endpoints/video/scheduleList';
import { VideoSchedulePublishNow } from '../endpoints/video/schedulePublishNow';

// Video comment endpoints
import { CommentCreate } from '../endpoints/video/commentCreate';
import { CommentUpdate } from '../endpoints/video/commentUpdate';
import { CommentDelete } from '../endpoints/video/commentDelete';
import { CommentList } from '../endpoints/video/commentList';
import { CommentRepliesList } from '../endpoints/video/commentRepliesList';
import { CommentApprove } from '../endpoints/video/commentApprove';

// Video like/dislike endpoints
import { LikeCreate } from '../endpoints/video/videoLikeCreate';
import { LikeDelete } from '../endpoints/video/videoLikeDelete';
import { DislikeCreate } from '../endpoints/video/videoDislikeCreate';
import { DislikeDelete } from '../endpoints/video/videoDislikeDelete';

// Comment like/dislike endpoints
import { CommentLikeCreate } from '../endpoints/video/commentLikeCreate';
import { CommentLikeDelete } from '../endpoints/video/commentLikeDelete';
import { CommentDislikeCreate } from '../endpoints/video/commentDislikeCreate';
import { CommentDislikeDelete } from '../endpoints/video/commentDislikeDelete';

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

// AI category suggestions for the upload/edit forms (before /:id, which would match it)
videoRouter.post('/category-suggestions', CategorySuggestionRequest);
videoRouter.get('/category-suggestions', CategorySuggestionGet);

// Get single video (public)
videoRouter.get('/:id', VideoFetch);

// Update video (authenticated)
videoRouter.put('/:id', VideoUpdate);

// Delete video (authenticated)
videoRouter.delete('/:id', VideoDelete);

// Bulk delete videos (authenticated)
videoRouter.post('/bulk-delete', VideoBulkDelete);
videoRouter.post('/bulk-update', VideoBulkUpdate);
videoRouter.post('/bulk-schedule', VideoBulkSchedule);
videoRouter.post('/bulk-playlist', VideoBulkPlaylist);

// Get video upload status (authenticated)
videoRouter.get('/:id/upload-status', VideoUploadStatus);

// Upload custom thumbnail (authenticated, owner only)
videoRouter.post('/:id/thumbnail', VideoThumbnailUpload);

// ==========================================
// VIDEO UPLOAD OPERATIONS
// ==========================================

// Upload video (authenticated)
videoRouter.post('/upload', VideoUpload);

// Initiate upload (authenticated)
videoRouter.post('/upload/initiate', UploadInitiateEndpoint);

// Complete upload (authenticated)
videoRouter.post('/upload/complete', UploadCompleteEndpoint);

// Resume upload (authenticated)
videoRouter.get('/upload/resume/:videoId', UploadResumeEndpoint);

// Report an upload that cannot finish (authenticated): flags it for a re-upload
videoRouter.post('/upload/failed/:videoId', UploadFailedEndpoint);

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

// Set default subtitle track (authenticated, owner only)
videoRouter.put('/:videoId/subtitles/:language/default', SubtitlesSetDefault);

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

// Publish video immediately (authenticated)
videoRouter.post('/:id/publish-now', VideoSchedulePublishNow);

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

// List comments (public; reaction flags when authenticated)
videoRouter.get('/:id/comments', CommentList);

// Create comment or reply (authenticated; parentCommentId for replies)
videoRouter.post('/:id/comments', CommentCreate);

// List replies of a comment (public; one level deep)
videoRouter.get('/:id/comments/:cid/replies', CommentRepliesList);

// Approve a held comment (video owner)
videoRouter.post('/:id/comments/:cid/approve', CommentApprove);

// Update comment (authenticated)
videoRouter.put('/:id/comments/:cid', CommentUpdate);

// Delete comment (authenticated)
videoRouter.delete('/:id/comments/:cid', CommentDelete);

// Like comment (authenticated)
videoRouter.post('/:id/comments/:cid/likes', CommentLikeCreate);

// Remove like from comment (authenticated)
videoRouter.delete('/:id/comments/:cid/likes', CommentLikeDelete);

// Dislike comment (authenticated)
videoRouter.post('/:id/comments/:cid/dislikes', CommentDislikeCreate);

// Remove dislike from comment (authenticated)
videoRouter.delete('/:id/comments/:cid/dislikes', CommentDislikeDelete);

// ==========================================
// VIDEO ANALYTICS
// ==========================================

// Track video view (public - for analytics)
videoRouter.post('/:id/view', VideoView);
videoRouter.post('/:id/watch-time', VideoWatchTime);
videoRouter.post('/:id/retention', VideoRetention);

// Export as default and named export
export default videoRouter;
