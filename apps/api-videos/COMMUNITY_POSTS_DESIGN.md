# Community Posts System Design

## Overview

The Community Posts System is a YouTube-style feature that allows channel owners to share updates, polls, images, and engage with their audience outside of video content. Based on YouTube's implementation, this system supports multiple post types with engagement features like likes, comments, and poll voting.

## Research Findings from YouTube

### Post Types
1. **Text Posts** - Simple text updates (no explicit character limit found, likely 5000+)
2. **Image Posts** - Up to 10 images per post, 16 MB max each, JPG/PNG/GIF/WEBP
3. **Poll Posts** - Text polls with 2-5 options (65 chars each) or image polls (36 char captions)
4. **Quiz Posts** - Interactive quizzes with up to 80 char answers, 500 char explanations
5. **Video Link Posts** - Share existing videos from the channel or other channels
6. **GIF Posts** - Animated GIFs for engagement

### Key Features
- Posts appear in channel's Posts tab and subscriber feeds
- Anonymous voting on polls (one vote per user)
- Polls can run for up to 7 days
- Engagement metrics: likes, comments, votes
- Mentions support (@channel)
- Scheduling and batch creation
- Rate limiting: Limited posts per 24 hours

### Access Requirements
- As of June 2024, available to ALL channels (no subscriber requirement)
- Public visibility for all posts
- Only channel owner can create/edit/delete posts

## R2 Storage Structure

```
al-ummah-now-community-posts/
├── posts/
│   ├── {channelId}/
│   │   ├── {postId}.json           # Individual post data
│   │   └── index.json               # Channel's post index (for pagination)
├── votes/
│   ├── {postId}/
│   │   ├── {userId}.json            # User's vote record
│   │   └── results.json             # Aggregated results
├── likes/
│   ├── {postId}/
│   │   └── {userId}.json            # User's like record
└── media/
    └── {postId}/
        └── {filename}               # Uploaded images/GIFs
```

## Data Models

### CommunityPost
```typescript
interface CommunityPost {
  id: string;                        // UUID
  channelId: string;                 // Channel that created the post
  type: PostType;                    // text, image, poll, quiz, video, gif
  content?: string;                  // Text content (optional for image-only posts)

  // Media attachments
  images?: PostImage[];              // Up to 10 images
  videoId?: string;                  // For video link posts
  gif?: PostGif;                     // For GIF posts

  // Poll/Quiz specific
  poll?: PollData;                   // Poll configuration and options
  quiz?: QuizData;                   // Quiz configuration and questions

  // Engagement metrics
  likes: number;                      // Total likes count
  comments: number;                   // Total comments count (reference to comments system)
  shares: number;                     // Total shares count
  views: number;                      // Total views count

  // Metadata
  createdAt: string;                  // ISO timestamp
  updatedAt?: string;                 // ISO timestamp
  scheduledAt?: string;               // For scheduled posts
  expiresAt?: string;                 // For polls/quizzes
  pinned: boolean;                    // Pinned to top of feed

  // Moderation
  status: PostStatus;                 // published, scheduled, draft, deleted
  visibility: PostVisibility;         // public, subscribers, members
  commentsEnabled: boolean;           // Allow comments

  // Channel info (denormalized for performance)
  channelName: string;
  channelAvatar?: string;
  channelVerified: boolean;
}

interface PostImage {
  url: string;                       // CDN URL
  width: number;
  height: number;
  caption?: string;                   // For image polls (36 chars max)
  mimeType: string;                   // image/jpeg, image/png, etc.
  size: number;                       // File size in bytes
}

interface PostGif {
  url: string;
  width: number;
  height: number;
  duration: number;                   // Animation duration in seconds
}

interface PollData {
  question: string;
  options: PollOption[];              // 2-5 options
  totalVotes: number;
  multipleChoice: boolean;            // Allow multiple selections
  showResults: boolean;               // Show results before voting
  votingEndsAt?: string;              // ISO timestamp (up to 7 days)
}

interface PollOption {
  id: string;                        // Option ID
  text?: string;                     // Text option (65 chars max)
  image?: PostImage;                 // Image option with caption
  votes: number;                     // Vote count
  percentage: number;                // Calculated percentage
}

interface QuizData {
  question: string;
  options: QuizOption[];              // 2-4 options
  correctOptionId: string;
  explanation?: string;               // 500 chars max
  totalAttempts: number;
  correctAttempts: number;
}

interface QuizOption {
  id: string;
  text: string;                      // 80 chars max (30 if image)
  image?: PostImage;
}

enum PostType {
  TEXT = 'text',
  IMAGE = 'image',
  POLL = 'poll',
  QUIZ = 'quiz',
  VIDEO = 'video',
  GIF = 'gif'
}

enum PostStatus {
  PUBLISHED = 'published',
  SCHEDULED = 'scheduled',
  DRAFT = 'draft',
  DELETED = 'deleted'
}

enum PostVisibility {
  PUBLIC = 'public',
  SUBSCRIBERS = 'subscribers',
  MEMBERS = 'members'
}
```

### Vote Records
```typescript
interface VoteRecord {
  userId: string;
  postId: string;
  optionIds: string[];                // Support for multiple choice
  votedAt: string;                    // ISO timestamp
  ipAddress?: string;                 // For anonymous vote tracking
}

interface VoteResults {
  postId: string;
  totalVotes: number;
  options: {
    [optionId: string]: {
      count: number;
      percentage: number;
      voters?: string[];              // Only for non-anonymous polls
    }
  };
  lastUpdated: string;
}
```

## API Endpoints

### List Posts for Channel
```http
GET /community/posts?channelId={channelId}&page={page}&limit={limit}&type={type}
```
**Query Parameters:**
- `channelId` (required): Channel ID
- `page` (default: 1): Page number
- `limit` (default: 20, max: 50): Posts per page
- `type` (optional): Filter by post type
- `status` (optional): Filter by status (admin only)

**Response:**
```json
{
  "posts": [...],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "hasNext": true
  }
}
```

### Get Single Post
```http
GET /community/posts/{postId}
```
**Response:** Single `CommunityPost` object with full details

### Create Post
```http
POST /community/posts
Authorization: Bearer {token}
```
**Request Body:**
```json
{
  "type": "poll",
  "content": "What type of content do you want to see next?",
  "poll": {
    "question": "What type of content do you want to see next?",
    "options": [
      { "text": "Tutorials" },
      { "text": "Reviews" },
      { "text": "Live Streams" }
    ],
    "multipleChoice": false,
    "votingEndsAt": "2024-12-25T00:00:00Z"
  },
  "visibility": "public",
  "commentsEnabled": true
}
```

### Update Post
```http
PUT /community/posts/{postId}
Authorization: Bearer {token}
```
**Note:** Only content, visibility, and scheduling can be updated. Poll/quiz options cannot be changed after creation.

### Delete Post
```http
DELETE /community/posts/{postId}
Authorization: Bearer {token}
```
**Note:** Soft delete - marks as deleted but preserves data

### Like/Unlike Post
```http
POST /community/posts/{postId}/like
Authorization: Bearer {token}
```
```http
DELETE /community/posts/{postId}/like
Authorization: Bearer {token}
```

### Vote on Poll
```http
POST /community/posts/{postId}/vote
Authorization: Bearer {token}
```
**Request Body:**
```json
{
  "optionIds": ["option-1"]
}
```
**Response:**
```json
{
  "success": true,
  "results": {
    "totalVotes": 150,
    "options": [
      {
        "id": "option-1",
        "votes": 75,
        "percentage": 50
      },
      {
        "id": "option-2",
        "votes": 50,
        "percentage": 33.33
      },
      {
        "id": "option-3",
        "votes": 25,
        "percentage": 16.67
      }
    ]
  }
}
```

### Get Poll Results
```http
GET /community/posts/{postId}/results
```
**Response:** Current poll/quiz results (public after voting or if showResults is true)

### Upload Media
```http
POST /community/media/upload
Authorization: Bearer {token}
Content-Type: multipart/form-data
```
**Request:** Form data with file(s)
**Response:**
```json
{
  "files": [
    {
      "id": "media-123",
      "url": "https://cdn.example.com/media-123.jpg",
      "width": 1920,
      "height": 1080,
      "size": 245678,
      "mimeType": "image/jpeg"
    }
  ]
}
```

## Implementation Code Examples

### Create Post Endpoint
```typescript
// apps/api-videos/src/endpoints/community/create-post.ts
import { OpenAPIRoute } from 'chanfana';
import { z } from 'zod';
import { CommunityPost, PostType, PostStatus, PostVisibility } from '@al-ummah/shared-types';
import { requireAuth, addAuthToSchema } from '../../middleware/auth';
import { validateCreatePost } from '../../validation/community-posts';

const createPostSchema = z.object({
  type: z.nativeEnum(PostType),
  content: z.string().max(5000).optional(),
  images: z.array(z.object({
    url: z.string().url(),
    width: z.number(),
    height: z.number(),
    caption: z.string().max(36).optional(),
    mimeType: z.string(),
    size: z.number()
  })).max(10).optional(),
  videoId: z.string().optional(),
  poll: z.object({
    question: z.string(),
    options: z.array(z.object({
      text: z.string().max(65).optional(),
      image: z.object({
        url: z.string().url(),
        caption: z.string().max(36)
      }).optional()
    })).min(2).max(5),
    multipleChoice: z.boolean().default(false),
    votingEndsAt: z.string().datetime().optional()
  }).optional(),
  visibility: z.nativeEnum(PostVisibility).default(PostVisibility.PUBLIC),
  commentsEnabled: z.boolean().default(true),
  scheduledAt: z.string().datetime().optional()
});

export class CreateCommunityPost extends OpenAPIRoute {
  static schema = addAuthToSchema({
    tags: ['Community'],
    summary: 'Create a community post',
    request: {
      body: {
        content: {
          'application/json': {
            schema: createPostSchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Post created successfully',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean(),
              post: z.any(), // CommunityPost schema
            }),
          },
        },
      },
    },
  });

  async handle(c: Context) {
    const auth = await requireAuth(c);
    const data = await this.getValidatedData<z.infer<typeof createPostSchema>>();

    // Validate request
    const validation = await validateCreatePost(data, auth.user);
    if (!validation.valid) {
      return c.json({ error: validation.error }, 400);
    }

    // Get channel info
    const channelKey = `channels/${auth.user.channelId}/channel.json`;
    const channelData = await c.env.R2_BUCKET.get(channelKey);
    if (!channelData) {
      return c.json({ error: 'Channel not found' }, 404);
    }
    const channel = await channelData.json();

    // Create post object
    const post: CommunityPost = {
      id: crypto.randomUUID(),
      channelId: auth.user.channelId,
      type: data.type,
      content: data.content,
      images: data.images,
      videoId: data.videoId,
      poll: data.poll ? {
        ...data.poll,
        totalVotes: 0,
        showResults: false,
        options: data.poll.options.map((opt, idx) => ({
          id: `option-${idx}`,
          ...opt,
          votes: 0,
          percentage: 0
        }))
      } : undefined,
      likes: 0,
      comments: 0,
      shares: 0,
      views: 0,
      createdAt: new Date().toISOString(),
      scheduledAt: data.scheduledAt,
      pinned: false,
      status: data.scheduledAt ? PostStatus.SCHEDULED : PostStatus.PUBLISHED,
      visibility: data.visibility,
      commentsEnabled: data.commentsEnabled,
      channelName: channel.name,
      channelAvatar: channel.avatar,
      channelVerified: channel.verified || false
    };

    // Save to R2
    const postKey = `posts/${auth.user.channelId}/${post.id}.json`;
    await c.env.R2_BUCKET.put(postKey, JSON.stringify(post));

    // Update channel index
    await this.updateChannelIndex(c, auth.user.channelId, post.id);

    // Send to processor queue for notifications
    if (post.status === PostStatus.PUBLISHED) {
      await c.env.QUEUE.send({
        type: 'community_post_created',
        postId: post.id,
        channelId: auth.user.channelId,
        timestamp: post.createdAt
      });
    }

    return c.json({ success: true, post });
  }

  private async updateChannelIndex(c: Context, channelId: string, postId: string) {
    const indexKey = `posts/${channelId}/index.json`;
    const existing = await c.env.R2_BUCKET.get(indexKey);

    let index = { postIds: [], lastUpdated: new Date().toISOString() };
    if (existing) {
      index = await existing.json();
    }

    // Add to beginning (newest first)
    index.postIds.unshift(postId);

    // Keep max 1000 post IDs in index
    if (index.postIds.length > 1000) {
      index.postIds = index.postIds.slice(0, 1000);
    }

    index.lastUpdated = new Date().toISOString();
    await c.env.R2_BUCKET.put(indexKey, JSON.stringify(index));
  }
}
```

### Vote on Poll Endpoint
```typescript
// apps/api-videos/src/endpoints/community/vote-poll.ts
import { OpenAPIRoute } from 'chanfana';
import { z } from 'zod';
import { requireAuth, addAuthToSchema } from '../../middleware/auth';

const voteSchema = z.object({
  optionIds: z.array(z.string()).min(1).max(5)
});

export class VoteOnPoll extends OpenAPIRoute {
  static schema = addAuthToSchema({
    tags: ['Community'],
    summary: 'Vote on a community poll',
    request: {
      params: z.object({
        postId: z.string(),
      }),
      body: {
        content: {
          'application/json': {
            schema: voteSchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Vote recorded successfully',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean(),
              results: z.any(),
            }),
          },
        },
      },
    },
  });

  async handle(c: Context) {
    const auth = await requireAuth(c);
    const { postId } = c.req.param();
    const data = await this.getValidatedData<z.infer<typeof voteSchema>>();

    // Check if already voted
    const voteKey = `votes/${postId}/${auth.user.id}.json`;
    const existingVote = await c.env.R2_BUCKET.get(voteKey);
    if (existingVote) {
      return c.json({ error: 'Already voted on this poll' }, 400);
    }

    // Get post
    const post = await this.getPost(c, postId);
    if (!post || post.type !== 'poll' || !post.poll) {
      return c.json({ error: 'Poll not found' }, 404);
    }

    // Check if voting ended
    if (post.poll.votingEndsAt && new Date(post.poll.votingEndsAt) < new Date()) {
      return c.json({ error: 'Voting has ended' }, 400);
    }

    // Validate option IDs
    const validOptionIds = post.poll.options.map(opt => opt.id);
    const invalidOptions = data.optionIds.filter(id => !validOptionIds.includes(id));
    if (invalidOptions.length > 0) {
      return c.json({ error: 'Invalid option IDs' }, 400);
    }

    // Check multiple choice
    if (!post.poll.multipleChoice && data.optionIds.length > 1) {
      return c.json({ error: 'Multiple selections not allowed' }, 400);
    }

    // Record vote
    const voteRecord = {
      userId: auth.user.id,
      postId,
      optionIds: data.optionIds,
      votedAt: new Date().toISOString(),
    };
    await c.env.R2_BUCKET.put(voteKey, JSON.stringify(voteRecord));

    // Update results
    const results = await this.updateResults(c, postId, post.poll, data.optionIds);

    // Update post with new totals
    post.poll.totalVotes = results.totalVotes;
    post.poll.options = post.poll.options.map(opt => ({
      ...opt,
      votes: results.options[opt.id]?.count || 0,
      percentage: results.options[opt.id]?.percentage || 0
    }));

    // Save updated post
    await this.savePost(c, post);

    return c.json({
      success: true,
      results: {
        totalVotes: results.totalVotes,
        options: post.poll.options.map(opt => ({
          id: opt.id,
          votes: opt.votes,
          percentage: opt.percentage
        }))
      }
    });
  }

  private async getPost(c: Context, postId: string) {
    // Search across all channels (could optimize with an index)
    const list = await c.env.R2_BUCKET.list({ prefix: 'posts/' });
    for (const object of list.objects) {
      if (object.key.endsWith(`/${postId}.json`)) {
        const data = await c.env.R2_BUCKET.get(object.key);
        return data ? await data.json() : null;
      }
    }
    return null;
  }

  private async savePost(c: Context, post: any) {
    const postKey = `posts/${post.channelId}/${post.id}.json`;
    await c.env.R2_BUCKET.put(postKey, JSON.stringify(post));
  }

  private async updateResults(c: Context, postId: string, poll: any, optionIds: string[]) {
    const resultsKey = `votes/${postId}/results.json`;
    const existing = await c.env.R2_BUCKET.get(resultsKey);

    let results = {
      postId,
      totalVotes: 0,
      options: {},
      lastUpdated: new Date().toISOString()
    };

    if (existing) {
      results = await existing.json();
    }

    // Update vote counts
    results.totalVotes++;
    for (const optionId of optionIds) {
      if (!results.options[optionId]) {
        results.options[optionId] = { count: 0, percentage: 0 };
      }
      results.options[optionId].count++;
    }

    // Recalculate percentages
    for (const optionId in results.options) {
      results.options[optionId].percentage =
        (results.options[optionId].count / results.totalVotes) * 100;
    }

    results.lastUpdated = new Date().toISOString();
    await c.env.R2_BUCKET.put(resultsKey, JSON.stringify(results));

    return results;
  }
}
```

### Validation Module
```typescript
// apps/api-videos/src/validation/community-posts.ts
import { PostType } from '@al-ummah/shared-types';

export async function validateCreatePost(data: any, user: any) {
  const errors = [];

  // Check channel ownership
  if (!user.channelId) {
    return { valid: false, error: 'User does not own a channel' };
  }

  // Validate by type
  switch (data.type) {
    case PostType.TEXT:
      if (!data.content || data.content.trim().length === 0) {
        errors.push('Text posts must have content');
      }
      break;

    case PostType.IMAGE:
      if (!data.images || data.images.length === 0) {
        errors.push('Image posts must have at least one image');
      }
      if (data.images?.length > 10) {
        errors.push('Maximum 10 images allowed');
      }
      // Validate each image
      data.images?.forEach((img, idx) => {
        if (img.size > 16 * 1024 * 1024) {
          errors.push(`Image ${idx + 1} exceeds 16MB limit`);
        }
        if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(img.mimeType)) {
          errors.push(`Image ${idx + 1} has invalid format`);
        }
      });
      break;

    case PostType.POLL:
      if (!data.poll) {
        errors.push('Poll data is required for poll posts');
      }
      if (!data.poll?.question) {
        errors.push('Poll must have a question');
      }
      if (data.poll?.options?.length < 2 || data.poll?.options?.length > 5) {
        errors.push('Polls must have 2-5 options');
      }
      // Validate poll options
      data.poll?.options?.forEach((opt, idx) => {
        if (!opt.text && !opt.image) {
          errors.push(`Poll option ${idx + 1} must have text or image`);
        }
        if (opt.text && opt.text.length > 65) {
          errors.push(`Poll option ${idx + 1} text exceeds 65 characters`);
        }
        if (opt.image?.caption && opt.image.caption.length > 36) {
          errors.push(`Poll option ${idx + 1} caption exceeds 36 characters`);
        }
      });
      // Validate voting end time
      if (data.poll?.votingEndsAt) {
        const endTime = new Date(data.poll.votingEndsAt);
        const maxTime = new Date();
        maxTime.setDate(maxTime.getDate() + 7);
        if (endTime > maxTime) {
          errors.push('Poll voting period cannot exceed 7 days');
        }
        if (endTime <= new Date()) {
          errors.push('Poll voting end time must be in the future');
        }
      }
      break;

    case PostType.QUIZ:
      if (!data.quiz) {
        errors.push('Quiz data is required for quiz posts');
      }
      if (!data.quiz?.question) {
        errors.push('Quiz must have a question');
      }
      if (data.quiz?.options?.length < 2 || data.quiz?.options?.length > 4) {
        errors.push('Quizzes must have 2-4 options');
      }
      if (!data.quiz?.correctOptionId) {
        errors.push('Quiz must have a correct answer');
      }
      // Validate quiz options
      data.quiz?.options?.forEach((opt, idx) => {
        if (!opt.text) {
          errors.push(`Quiz option ${idx + 1} must have text`);
        }
        const maxLength = opt.image ? 30 : 80;
        if (opt.text && opt.text.length > maxLength) {
          errors.push(`Quiz option ${idx + 1} text exceeds ${maxLength} characters`);
        }
      });
      if (data.quiz?.explanation && data.quiz.explanation.length > 500) {
        errors.push('Quiz explanation exceeds 500 characters');
      }
      break;

    case PostType.VIDEO:
      if (!data.videoId) {
        errors.push('Video posts must reference a video');
      }
      break;

    case PostType.GIF:
      if (!data.gif) {
        errors.push('GIF posts must have a GIF');
      }
      break;

    default:
      errors.push(`Invalid post type: ${data.type}`);
  }

  // Check rate limiting (example: max 10 posts per day)
  // This would need to track posts per channel in R2 or KV

  if (errors.length > 0) {
    return { valid: false, error: errors.join(', ') };
  }

  return { valid: true };
}

export async function validateUpdatePost(data: any, existingPost: any, user: any) {
  // Only certain fields can be updated
  const allowedFields = ['content', 'visibility', 'commentsEnabled', 'scheduledAt', 'pinned'];

  // Cannot update polls/quizzes after creation
  if (existingPost.type === PostType.POLL && data.poll) {
    return { valid: false, error: 'Cannot modify poll options after creation' };
  }

  if (existingPost.type === PostType.QUIZ && data.quiz) {
    return { valid: false, error: 'Cannot modify quiz after creation' };
  }

  // Cannot update if voting has started
  if (existingPost.poll?.totalVotes > 0) {
    return { valid: false, error: 'Cannot modify post after voting has started' };
  }

  return { valid: true };
}
```

## Security Considerations

1. **Authentication**: All write operations require JWT authentication
2. **Authorization**: Only channel owner can create/edit/delete their posts
3. **Rate Limiting**: Limit posts per channel per 24 hours (e.g., 10 posts/day)
4. **Input Validation**: Strict validation on all inputs, especially file uploads
5. **File Size Limits**: 16MB per image, max 10 images per post
6. **Character Limits**: Enforce all character limits from YouTube's implementation
7. **Vote Fraud Prevention**: One vote per authenticated user, IP tracking for anonymous
8. **Content Moderation**: Consider implementing content scanning for inappropriate material

## Performance Optimizations

1. **Pagination**: Use cursor-based pagination for large post lists
2. **Caching**: Cache popular posts and poll results in KV with TTL
3. **CDN**: Serve all media through CDN (Bunny.net)
4. **Lazy Loading**: Load images on-demand, not all at once
5. **Aggregation**: Pre-calculate poll percentages and store in results
6. **Indexes**: Maintain channel post indexes for fast retrieval
7. **Batch Operations**: Process multiple votes/likes in batches

## Testing Strategy

1. **Unit Tests**: Test validation functions, data transformations
2. **Integration Tests**: Test R2 storage operations, API endpoints
3. **Load Tests**: Test with high volume of votes/likes
4. **Security Tests**: Test authentication, authorization, input validation
5. **E2E Tests**: Full flow from post creation to voting to results

## Migration & Rollout

1. **Phase 1**: Deploy basic text and image posts
2. **Phase 2**: Add polls and voting
3. **Phase 3**: Add quizzes and advanced features
4. **Phase 4**: Add scheduling and moderation tools
5. **Phase 5**: Analytics and insights dashboard

## Monitoring & Analytics

Track these metrics:
- Posts created per day/channel
- Engagement rates (likes, comments, votes)
- Poll participation rates
- Most popular post types
- Average time to first engagement
- Error rates and failures

---

## Post Comments System

### Overview

Following YouTube's community post comments implementation, this system supports **threaded comments** (one level deep) with likes, pinning, and moderation features. Comments are stored in the same R2 bucket (`community_posts`) as posts for data locality.

### YouTube Comments Architecture Research

Based on YouTube's CommentThread API structure:
- **CommentThread** = top-level comment + its replies
- **Top-level comments** stored with thread metadata
- **Replies** stored separately with `parentId` reference
- **Limited reply fetching** in initial load (subset returned)
- **Full reply expansion** requires separate API call with `parentId` filter
- **Threading depth**: Maximum 1 level (replies to replies not supported)

### Post Comment Data Model

```typescript
interface PostComment {
  id: string;                        // UUID
  postId: string;                    // Parent post ID
  channelId: string;                 // Commenter's channel ID
  userId: string;                    // Commenter's user ID
  parentCommentId?: string;          // For threaded replies (null for top-level)

  // Content
  content: string;                   // Comment text (max 10,000 chars)

  // User info (denormalized for performance)
  userDisplayName: string;
  userAvatarUrl?: string;
  channelVerified: boolean;

  // Engagement metrics
  likes: number;                     // Total likes count
  repliesCount: number;              // Count of direct replies (0 for replies)

  // Status
  isPinned: boolean;                 // Post owner can pin one comment
  isEdited: boolean;                 // Flag if edited after creation
  isHeartedByCreator: boolean;       // Post owner can "heart" comments

  // Timestamps
  createdAt: string;                 // ISO timestamp
  updatedAt?: string;                // ISO timestamp
  deletedAt?: string;                // Soft delete timestamp
}
```

### R2 Storage Structure

```
al-ummah-now-community-posts/
├── posts/
│   ├── {channelId}/
│   │   └── {postId}.json           # Post data (with comments count)
├── comments/
│   ├── {postId}/
│   │   ├── top-level/              # Top-level comments only
│   │   │   ├── {commentId}.json
│   │   │   └── index.json          # Paginated index (newest first)
│   │   └── replies/
│   │       ├── {parentCommentId}/
│   │       │   ├── {replyId}.json
│   │       │   └── index.json      # Reply index for parent
├── comment-likes/
│   ├── {postId}/
│   │   └── {commentId}/
│   │       └── {userId}.json       # User's like record
└── votes/                          # (existing for polls)
```

**Storage rationale:**
- Top-level comments separated for efficient listing
- Replies grouped by parent for efficient expansion
- Index files enable cursor-based pagination
- Comment likes stored separately (similar to post likes pattern)

### API Endpoints

#### 1. List Top-Level Comments
```http
GET /api/community/posts/{postId}/comments?limit={limit}&cursor={cursor}&sortBy={sortBy}
```

**Query Parameters:**
- `limit` (default: 20, max: 100): Comments per page
- `cursor` (optional): Pagination cursor
- `sortBy` (default: 'top'): Sort order
  - `top` - Most liked comments first
  - `newest` - Newest comments first

**Response:**
```json
{
  "success": true,
  "comments": [
    {
      "id": "comment-1",
      "postId": "post-123",
      "channelId": "channel-abc",
      "userId": "user-xyz",
      "content": "Great post!",
      "userDisplayName": "John Doe",
      "userAvatarUrl": "https://cdn.example.com/avatar.jpg",
      "channelVerified": true,
      "likes": 42,
      "repliesCount": 5,
      "isPinned": false,
      "isEdited": false,
      "isHeartedByCreator": true,
      "createdAt": "2024-12-20T10:00:00Z"
    }
  ],
  "pagination": {
    "limit": 20,
    "cursor": "comment-1",
    "hasNext": true
  }
}
```

#### 2. List Replies to Comment
```http
GET /api/community/posts/{postId}/comments/{commentId}/replies?limit={limit}&cursor={cursor}
```

**Query Parameters:**
- `limit` (default: 10, max: 50): Replies per page
- `cursor` (optional): Pagination cursor

**Response:** Same structure as top-level comments, but `repliesCount` always 0

#### 3. Create Comment
```http
POST /api/community/posts/{postId}/comments
Authorization: Bearer {token}
```

**Request Body:**
```json
{
  "content": "This is my comment",
  "parentCommentId": null  // or "comment-id" for reply
}
```

**Response:**
```json
{
  "success": true,
  "comment": {
    "id": "comment-new",
    "postId": "post-123",
    "channelId": "channel-abc",
    "content": "This is my comment",
    "userDisplayName": "John Doe",
    "likes": 0,
    "repliesCount": 0,
    "isPinned": false,
    "isEdited": false,
    "isHeartedByCreator": false,
    "createdAt": "2024-12-20T10:00:00Z"
  }
}
```

**Side effects:**
- Increment `post.comments` count
- If reply: increment parent comment's `repliesCount`
- Send queue event for notification: `post_comment_created`

#### 4. Update Comment
```http
PUT /api/community/posts/{postId}/comments/{commentId}
Authorization: Bearer {token}
```

**Request Body:**
```json
{
  "content": "Updated comment text"
}
```

**Authorization:** Only comment author can update
**Side effects:** Set `isEdited: true`, update `updatedAt`

#### 5. Delete Comment
```http
DELETE /api/community/posts/{postId}/comments/{commentId}
Authorization: Bearer {token}
```

**Authorization:** Comment author OR post owner
**Side effects:**
- Soft delete: set `deletedAt` timestamp
- Decrement `post.comments` count
- If has replies: show "[deleted]" text instead of removing
- If no replies: remove from index
- Send queue event: `post_comment_deleted`

#### 6. Like Comment
```http
POST /api/community/posts/{postId}/comments/{commentId}/like
Authorization: Bearer {token}
```

**Response:**
```json
{
  "success": true,
  "liked": true,
  "totalLikes": 43
}
```

**Side effects:**
- Increment comment's `likes` count
- Create like record in `comment-likes/{postId}/{commentId}/{userId}.json`
- Send queue event: `post_comment_liked`

#### 7. Unlike Comment
```http
DELETE /api/community/posts/{postId}/comments/{commentId}/like
Authorization: Bearer {token}
```

**Response:**
```json
{
  "success": true,
  "liked": false,
  "totalLikes": 42
}
```

**Side effects:**
- Decrement comment's `likes` count
- Delete like record

#### 8. Pin Comment (Post Owner Only)
```http
POST /api/community/posts/{postId}/comments/{commentId}/pin
Authorization: Bearer {token}
```

**Authorization:** Only post owner
**Side effects:**
- Unpin currently pinned comment (if any)
- Set `isPinned: true` on target comment
- Move to top of comment list

#### 9. Heart Comment (Post Owner Only)
```http
POST /api/community/posts/{postId}/comments/{commentId}/heart
Authorization: Bearer {token}
```

**Authorization:** Only post owner
**Side effects:** Toggle `isHeartedByCreator` boolean

### Implementation Patterns

#### Comment Creation Flow
```typescript
// 1. Validate post exists and comments are enabled
const post = await getPost(postId);
if (!post.commentsEnabled) {
  return error('Comments disabled');
}

// 2. If reply, validate parent comment exists
if (parentCommentId) {
  const parent = await getComment(postId, parentCommentId);
  if (!parent || parent.parentCommentId) {
    return error('Invalid parent (cannot reply to reply)');
  }
}

// 3. Create comment object
const comment = {
  id: crypto.randomUUID(),
  postId,
  userId: auth.user.id,
  channelId: auth.user.channelId,
  parentCommentId,
  content,
  userDisplayName: auth.user.displayName,
  userAvatarUrl: auth.user.avatarUrl,
  channelVerified: auth.user.verified,
  likes: 0,
  repliesCount: 0,
  isPinned: false,
  isEdited: false,
  isHeartedByCreator: false,
  createdAt: new Date().toISOString()
};

// 4. Store comment
if (parentCommentId) {
  await storeReply(postId, parentCommentId, comment);
  await incrementRepliesCount(postId, parentCommentId);
} else {
  await storeTopLevelComment(postId, comment);
}

// 5. Update post comments count
await incrementPostCommentsCount(postId);

// 6. Send notification queue event
await queue.send('post_comment_created', {
  postId,
  commentId: comment.id,
  authorChannelId: comment.channelId,
  parentCommentId,
  timestamp: comment.createdAt
});
```

#### Pagination Strategy

**Top-level comments:**
1. Maintain `comments/{postId}/top-level/index.json` with comment IDs
2. Sort options:
   - `top`: Sort by `likes` DESC, then `createdAt` DESC
   - `newest`: Sort by `createdAt` DESC
3. Cursor-based pagination using last comment ID
4. Fetch comment details in batch

**Replies:**
1. Maintain `comments/{postId}/replies/{parentId}/index.json`
2. Always sorted by `createdAt` ASC (chronological)
3. Limited batch size (10-20 replies per request)

#### Soft Delete Behavior

```typescript
if (comment.deletedAt) {
  // Has replies: show placeholder
  if (comment.repliesCount > 0) {
    return {
      ...comment,
      content: '[deleted]',
      userDisplayName: '[deleted]',
      userAvatarUrl: null
    };
  }

  // No replies: hide completely
  return null;
}
```

### Validation Rules

#### Content Validation
- **Length:** 1-10,000 characters
- **No empty/whitespace-only:** Trim and validate length > 0
- **Rate limiting:** Max 10 comments per minute per user
- **Spam detection:** Check for duplicate content in short time window

#### Threading Rules
- **Max depth:** 1 level (replies to replies not allowed)
- **Parent must exist:** Validate parent comment exists and is not deleted
- **Parent must be top-level:** Cannot reply to a reply

#### Authorization Rules
- **Create:** Any authenticated user (if comments enabled on post)
- **Update:** Only comment author
- **Delete:** Comment author OR post owner
- **Pin:** Only post owner
- **Heart:** Only post owner
- **Like:** Any authenticated user

### Queue Events for Processor

```typescript
// Comment created
{
  type: 'post_comment_created',
  postId: string,
  commentId: string,
  authorChannelId: string,
  parentCommentId?: string,  // If reply
  timestamp: string
}

// Comment liked
{
  type: 'post_comment_liked',
  postId: string,
  commentId: string,
  likerChannelId: string,
  timestamp: string
}

// Comment deleted
{
  type: 'post_comment_deleted',
  postId: string,
  commentId: string,
  deletedBy: string,  // userId who deleted it
  timestamp: string
}

// Comment pinned
{
  type: 'post_comment_pinned',
  postId: string,
  commentId: string,
  timestamp: string
}

// Comment hearted
{
  type: 'post_comment_hearted',
  postId: string,
  commentId: string,
  timestamp: string
}
```

### Security Considerations

1. **Authentication:** All write operations require valid JWT
2. **Authorization:** Check ownership for update/delete/pin/heart
3. **Rate Limiting:** Prevent comment spam (10/min, 100/hour)
4. **Content Moderation:** Filter profanity, hate speech, URLs
5. **Privacy:** Respect post visibility (public/subscribers/members)
6. **Soft Delete:** Never hard delete comments with replies
7. **XSS Prevention:** Sanitize comment content, escape HTML

### Performance Optimizations

1. **Denormalization:** Store user info in comment (avoid lookups)
2. **Index Maintenance:** Update indexes atomically with comment creation
3. **Batch Loading:** Fetch multiple comments in parallel
4. **Cursor Pagination:** Efficient for large comment threads
5. **Reply Lazy Loading:** Load replies on-demand, not upfront
6. **Like Caching:** Cache like status in KV for frequent checks
7. **Pinned Comment:** Cache separately for instant display

### Testing Checklist

- [ ] Create top-level comment on post
- [ ] Create reply to top-level comment
- [ ] Attempt reply to reply (should fail)
- [ ] List comments with 'top' sort (most liked first)
- [ ] List comments with 'newest' sort (newest first)
- [ ] List replies to specific comment
- [ ] Update own comment (sets isEdited flag)
- [ ] Attempt update other's comment (should fail)
- [ ] Delete own comment (soft delete)
- [ ] Delete comment as post owner (should succeed)
- [ ] Like/unlike comment (increments/decrements count)
- [ ] Pin comment as post owner (unpins previous)
- [ ] Heart comment as post owner (toggles flag)
- [ ] Pagination with cursor (forward navigation)
- [ ] Comments on private/deleted posts (should fail)
- [ ] Comments when disabled on post (should fail)
- [ ] Rate limiting (10 comments/min)
- [ ] Duplicate comment detection
- [ ] Post comments count accuracy

### Migration Plan

**Phase 1: Core Commenting** (This implementation)
- Create/read/update/delete comments
- Like/unlike comments
- Threading (1 level deep)
- Pagination and sorting

**Phase 2: Moderation**
- Pin comments
- Heart comments
- Report comments
- Spam detection

**Phase 3: Rich Features**
- Mentions (@channel)
- Timestamps (link to video time)
- Image replies (for community posts with images)
- Emoji reactions

**Phase 4: Analytics**
- Top commenters
- Comment engagement metrics
- Sentiment analysis
- Comment trends