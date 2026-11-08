import { Hono } from 'hono';
import { fromHono } from 'chanfana';

// Community Posts - Core Operations
import { ListCommunityPosts } from '../endpoints/community/list-posts';
import { GetCommunityPost } from '../endpoints/community/get-post';
import { CreateCommunityPost } from '../endpoints/community/create-post';
import { UpdateCommunityPost } from '../endpoints/community/update-post';
import { DeleteCommunityPost } from '../endpoints/community/delete-post';

// Community Posts - Interactions
import { LikeCommunityPost } from '../endpoints/community/like-post';
import { UnlikeCommunityPost } from '../endpoints/community/unlike-post';
import { VoteOnPoll } from '../endpoints/community/vote-poll';
import { GetPollResults } from '../endpoints/community/get-poll-results';

// Community Posts - Comments
import { ListPostComments } from '../endpoints/community/post-comments-list';
import { CreatePostComment } from '../endpoints/community/post-comment-create';
import { UpdatePostComment } from '../endpoints/community/post-comment-update';
import { DeletePostComment } from '../endpoints/community/post-comment-delete';
import { LikePostComment } from '../endpoints/community/post-comment-like';
import { UnlikePostComment } from '../endpoints/community/post-comment-unlike';
import { ListPostCommentReplies } from '../endpoints/community/post-comment-replies-list';
import { PinPostComment, UnpinPostComment } from '../endpoints/community/post-comment-pin';
import { HeartPostComment, UnheartPostComment } from '../endpoints/community/post-comment-heart';

// Community Posts - Media Upload
import { UploadCommunityPostImages } from '../endpoints/community/upload-images';
import { UploadCommunityPostGif } from '../endpoints/community/upload-gif';

const app = new Hono();

export const communityRouter = fromHono(app, { base: '/api/community' });

// Posts - List and Get (public)
communityRouter.get('/channels/:channelId/posts', ListCommunityPosts);
communityRouter.get('/channels/:channelId/posts/:postId', GetCommunityPost);

// Posts - Create, Update, Delete (auth required)
communityRouter.post('/channels/:channelId/posts', CreateCommunityPost);
communityRouter.put('/channels/:channelId/posts/:postId', UpdateCommunityPost);
communityRouter.delete('/channels/:channelId/posts/:postId', DeleteCommunityPost);

// Posts - Interactions (auth required)
communityRouter.post('/channels/:channelId/posts/:postId/like', LikeCommunityPost);
communityRouter.delete('/channels/:channelId/posts/:postId/like', UnlikeCommunityPost);

// Polls (auth required for voting, public for results)
communityRouter.post('/channels/:channelId/posts/:postId/vote', VoteOnPoll);
communityRouter.get('/channels/:channelId/posts/:postId/results', GetPollResults);

// Comments - List (public)
communityRouter.get('/channels/:channelId/posts/:postId/comments', ListPostComments);

// Comments - Create, Update, Delete (auth required)
communityRouter.post('/channels/:channelId/posts/:postId/comments', CreatePostComment);
communityRouter.put('/channels/:channelId/posts/:postId/comments/:commentId', UpdatePostComment);
communityRouter.delete('/channels/:channelId/posts/:postId/comments/:commentId', DeletePostComment);

// Comments - Likes (auth required)
communityRouter.post('/channels/:channelId/posts/:postId/comments/:commentId/like', LikePostComment);
communityRouter.delete('/channels/:channelId/posts/:postId/comments/:commentId/like', UnlikePostComment);

// Comments - Replies (public list; create via POST /comments with parentCommentId)
communityRouter.get('/channels/:channelId/posts/:postId/comments/:commentId/replies', ListPostCommentReplies);

// Comments - Creator moderation (auth required, channel owner only)
communityRouter.post('/channels/:channelId/posts/:postId/comments/:commentId/pin', PinPostComment);
communityRouter.delete('/channels/:channelId/posts/:postId/comments/:commentId/pin', UnpinPostComment);
communityRouter.post('/channels/:channelId/posts/:postId/comments/:commentId/heart', HeartPostComment);
communityRouter.delete('/channels/:channelId/posts/:postId/comments/:commentId/heart', UnheartPostComment);

// Media Upload (auth required)
communityRouter.post('/media/upload/images', UploadCommunityPostImages);
communityRouter.post('/media/upload/gif', UploadCommunityPostGif);

// Default export
export default communityRouter;
