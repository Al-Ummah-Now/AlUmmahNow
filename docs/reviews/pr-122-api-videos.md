# PR #122 Code Review: API Videos Changes

**Branch:** `channel` -> `main`
**Reviewer:** Claude Code Review Agent
**Date:** 2025-11-27
**Scope:** `apps/api-videos/` (Approximately 200+ files changed)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [API Changes](#2-api-changes)
3. [Authentication & Authorization](#3-authentication--authorization)
4. [Data Validation](#4-data-validation)
5. [Security Concerns](#5-security-concerns)
6. [Performance Issues](#6-performance-issues)
7. [Error Handling](#7-error-handling)
8. [Code Quality](#8-code-quality)
9. [OpenAPI/Swagger](#9-openapiswagger)
10. [Recommendations](#10-recommendations)

---

## 1. Executive Summary

This PR introduces significant architectural improvements and new features to the API Videos service:

### Major Changes

1. **Base Route Class Architecture** - New `AuthenticatedRoute`, `OptionalAuthRoute`, and `PublicRoute` base classes that eliminate repetitive auth checks
2. **Router Modularization** - Routes organized into domain-specific routers (`video.router.ts`, `channel.router.ts`, etc.)
3. **Community Posts Feature** - Complete community posts system with polls, quizzes, images, GIFs
4. **Channel Sections/Tabs** - YouTube-style channel customization
5. **TUS Protocol Proxy** - Secure resumable file uploads proxying to Bunny.net
6. **Rate Limiting** - Tiered rate limiting for upload endpoints
7. **i18n API** - Internationalization endpoints for translations
8. **Video Scheduling** - Schedule/reschedule/cancel video publishing
9. **Subtitle Management** - Upload/delete/manage subtitles
10. **Global Error Handler** - Centralized error handling middleware

### Overall Assessment

| Category | Rating | Notes |
|----------|--------|-------|
| Security | Good | Strong auth patterns, but some gaps identified |
| Code Quality | Excellent | Base class pattern is well-designed |
| Performance | Needs Review | Potential N+1 issues in list endpoints |
| Error Handling | Good | Centralized handler, consistent patterns |
| Documentation | Excellent | Comprehensive OpenAPI schemas |

---

## 2. API Changes

### 2.1 New Endpoints

#### Community Posts (10+ endpoints)
- `POST /api/community/:channelId/posts` - Create community post
- `GET /api/community/:channelId/posts` - List channel posts
- `GET /api/community/:channelId/posts/:postId` - Get single post
- `PUT /api/community/:channelId/posts/:postId` - Update post
- `DELETE /api/community/:channelId/posts/:postId` - Delete post
- `POST /api/community/:channelId/posts/:postId/like` - Like post
- `DELETE /api/community/:channelId/posts/:postId/like` - Unlike post
- `POST /api/community/:channelId/posts/:postId/vote` - Vote on poll
- `GET /api/community/:channelId/posts/:postId/poll-results` - Get poll results
- `POST /api/community/:channelId/posts/:postId/comments` - Create comment
- `DELETE /api/community/:channelId/posts/:postId/comments/:commentId` - Delete comment
- `POST /api/community/media/upload/images` - Upload images
- `POST /api/community/media/upload/gif` - Upload GIF

#### Channel Sections
- `POST /api/channels/:channelId/sections` - Create section
- `GET /api/channels/:channelId/sections` - List sections
- `GET /api/channels/:channelId/sections/:sectionId` - Get section
- `PUT /api/channels/:channelId/sections/:sectionId` - Update section
- `DELETE /api/channels/:channelId/sections/:sectionId` - Delete section
- `PATCH /api/channels/:channelId/sections/reorder` - Reorder sections
- `GET /api/channels/:channelId/sections/populated` - List with populated content

#### Channel Tabs/Content
- `GET /api/channels/:channelId/tabs` - Get channel tabs config
- `PUT /api/channels/:channelId/tabs` - Update tabs config
- `GET /api/channels/:channelId/videos` - List channel videos
- `GET /api/channels/:channelId/shorts` - List channel shorts
- `GET /api/channels/:channelId/live` - List channel live streams
- `GET /api/channels/:channelId/playlists` - List channel playlists

#### Video Features
- `POST /api/videos/tus` - TUS resumable upload (new proxy)
- `POST /api/videos/:id/schedule` - Schedule video
- `PUT /api/videos/:id/schedule` - Reschedule video
- `DELETE /api/videos/:id/schedule` - Cancel schedule
- `GET /api/videos/:id/chapters` - Get chapters
- `PUT /api/videos/:id/chapters` - Update chapters
- `POST /api/videos/:id/subtitles` - Upload subtitle
- `DELETE /api/videos/:id/subtitles/:language` - Delete subtitle

#### Upload Defaults/Templates
- `GET /api/upload-defaults` - List templates
- `POST /api/upload-defaults` - Create template
- `GET /api/upload-defaults/:id` - Get template
- `PUT /api/upload-defaults/:id` - Update template
- `DELETE /api/upload-defaults/:id` - Delete template

#### Content Sections
- `GET /api/videos/sections/recent` - Recent videos
- `GET /api/videos/sections/popular` - Popular videos
- `GET /api/videos/sections/trending` - Trending videos
- `GET /api/videos/sections/recommended` - Recommended videos
- `GET /api/videos/sections/category/:category` - Videos by category

#### i18n
- `GET /api/i18n/config` - Get i18n configuration
- `GET /api/i18n/metadata` - Get translation metadata
- `GET /api/i18n/translations/:locale` - Get translations
- `POST /api/i18n/sync` - Sync translations (admin)

### 2.2 Modified Endpoints

| Endpoint | Change | Breaking? |
|----------|--------|-----------|
| All video endpoints | Migrated to base classes | No |
| `/api/videos/:id` | Added soft delete/hidden checks | No |
| `/api/videos/:id` | Now fetches channel data for response | No |
| All profile endpoints | Migrated to base classes | No |
| All channel endpoints | Migrated to base classes | No |
| All playlist endpoints | Migrated to base classes | No |

### 2.3 Breaking Changes

**None identified** - All changes are backward compatible additions or internal refactoring.

---

## 3. Authentication & Authorization

### 3.1 Strengths

#### Well-Designed Base Classes
```typescript
// apps/api-videos/src/base/AuthenticatedRoute.ts
export abstract class AuthenticatedRoute extends OpenAPIRoute {
  async execute(...args: any[]): Promise<Response> {
    const c = args[0] as AppContext;
    const auth = c.get('auth');
    if (!auth) {
      throw new HTTPException(401, { message: 'Authentication required' });
    }
    return super.execute(...args);
  }

  protected getUserId(c: AppContext): string {
    return this.getAuth(c).userId;
  }
}
```

This eliminates repetitive auth checks and guarantees type safety.

#### Channel ID Validation Middleware
```typescript
// apps/api-videos/src/middleware/auth.ts
export async function channelIdMiddleware(c: Context, next: Next) {
  const channelId = c.req.header('channelId');
  if (!channelId) return await next();

  const auth = getAuthContext(c);
  if (!auth) return c.json({ error: 'Authentication required' }, 401);

  // Verify channel ownership
  const channelData = await channelObject.json() as { userId: string };
  if (channelData.userId !== auth.userId) {
    return c.json({ error: 'You do not have permission...' }, 403);
  }
}
```

Prevents IDOR attacks on channel operations.

#### Consistent Ownership Checks
All mutation endpoints verify ownership before allowing changes:
```typescript
// apps/api-videos/src/endpoints/channel-section/channelSectionCreate.ts
if (channel.userId !== userId) {
  return c.json({
    success: false,
    error: 'You can only create sections for your own channel',
  }, 403);
}
```

### 3.2 Issues

#### Issue: Missing Auth on GET Sections Endpoint

**Severity:** Minor (informational data)

**Location:** `apps/api-videos/src/endpoints/channel-section/channelSectionList.ts`

The channel sections list endpoint appears to be public, which may leak section configuration. Consider whether this should be authenticated.

#### Issue: Rate Limiting Disabled in Dev/Preview

**Severity:** Low (development only)

**Location:** `apps/api-videos/src/middleware/rate-limit.ts:312-316`

```typescript
if (environment === 'development' || environment === 'preview') {
  logger.info('[SECURITY] Skipping rate limit check in development/preview mode');
  return next();
}
```

This is acceptable for development but ensure preview deployments are not publicly accessible.

---

## 4. Data Validation

### 4.1 Strengths

#### Comprehensive Zod Schemas
All endpoints use Zod for input validation:

```typescript
// apps/api-videos/src/endpoints/community/create-post.ts
const createPostSchema = z.object({
  type: z.nativeEnum(PostType),
  content: z.string().max(5000).optional(),
  images: z.array(z.object({
    width: z.number(),
    height: z.number(),
    caption: z.string().max(36).optional(),
    mimeType: z.string(),
    size: z.number()
  })).max(10).optional(),
  poll: z.object({
    question: z.string(),
    options: z.array(z.object({
      text: z.string().max(65).optional(),
    })).min(2).max(5),
  }).optional(),
});
```

#### Custom Validation Layer
Community posts have additional business logic validation:

```typescript
// apps/api-videos/src/validation/community-posts.ts
export async function validateCreatePost(data: any, user: any) {
  // Validates post type-specific requirements
  // Validates size limits
  // Validates poll voting periods
}
```

#### HTML Sanitization
**Excellent** - XSS prevention for user content:

```typescript
// apps/api-videos/src/endpoints/community/create-post.ts
import sanitizeHtml from 'sanitize-html';

const sanitizeOptions = {
  allowedTags: ['b', 'i', 'em', 'strong', 'a', 'p', 'br'],
  allowedAttributes: { 'a': ['href'] },
  allowedSchemes: ['http', 'https'],
  disallowedTagsMode: 'discard'
};

// Applied to all user text input
content: body.content ? sanitizeHtml(body.content, sanitizeOptions) : undefined,
```

### 4.2 Issues

#### Issue: Missing Sanitization for Section Titles

**Severity:** Minor

**Location:** `apps/api-videos/src/endpoints/channel-section/channelSectionCreate.ts`

Section titles are not sanitized:
```typescript
title: input.title,  // Not sanitized
```

**Recommendation:** Apply `sanitizeHtml()` or at minimum escape special characters.

#### Issue: Poll/Quiz Option Text Not Validated for Harmful Patterns

**Severity:** Low

Poll options accept URLs in text but don't validate they aren't malicious (e.g., `javascript:` URLs in link text).

---

## 5. Security Concerns

### 5.1 Critical Issues

**None identified.**

### 5.2 Major Issues

#### Issue: Rate Limit KV Placeholder IDs

**Severity:** Major

**Location:** `apps/api-videos/wrangler.jsonc:121-122`

```json
{
  "binding": "RATE_LIMIT_KV",
  "id": "PLACEHOLDER_RATE_LIMIT_KV_ID",
  "preview_id": "PLACEHOLDER_RATE_LIMIT_KV_PREVIEW_ID"
}
```

Rate limiting is configured with placeholder IDs that won't work in production.

**Impact:** Rate limiting will fail silently due to graceful degradation, leaving upload endpoints unprotected.

**Recommendation:** Replace with actual KV namespace IDs before merge.

#### Issue: TUS Session Not Bound to IP

**Severity:** Major

**Location:** `apps/api-videos/src/endpoints/video/tus/tusProxy.ts`

TUS upload sessions are bound only to userId, not to IP address. This means a stolen session ID could be used from any location.

**Current check:**
```typescript
if (session.userId !== this.authContext?.userId) {
  return c.json({ error: 'Unauthorized' }, 403);
}
```

**Recommendation:** Store and validate client IP as well:
```typescript
if (session.userId !== this.authContext?.userId || session.clientIp !== c.req.header('CF-Connecting-IP')) {
  return c.json({ error: 'Unauthorized' }, 403);
}
```

### 5.3 Minor Issues

#### Issue: Secrets Exposed in Logs During Development

**Severity:** Minor (dev only)

**Location:** `apps/api-videos/src/endpoints/video/tus/tusProxy.ts:188-191`

```typescript
logger.info('[TUS Proxy] Forwarding POST to Bunny.net', {
  endpoint: storedSession.tusEndpoint,
  headers: requestHeaders,  // May contain auth headers
  storedHeaders: storedSession.tusHeaders,
});
```

**Recommendation:** Filter sensitive headers before logging:
```typescript
const safeHeaders = Object.fromEntries(
  Object.entries(requestHeaders).filter(([k]) =>
    !['AuthorizationSignature', 'AuthorizationExpire'].includes(k)
  )
);
```

#### Issue: JSON.parse Without Try-Catch in Some Locations

**Severity:** Minor

**Location:** Multiple endpoints parsing R2 data

```typescript
// apps/api-videos/src/endpoints/sections/recent.ts:130
const decodedCursor = JSON.parse(atob(cursor));
```

Malformed cursors could cause unhandled exceptions.

**Recommendation:** Wrap in try-catch:
```typescript
try {
  const decodedCursor = JSON.parse(atob(cursor));
} catch {
  return c.json({ error: 'Invalid cursor' }, 400);
}
```

#### Issue: CORS Allows All Origins

**Severity:** Minor (by design)

**Location:** `apps/api-videos/src/index.ts:20`

```typescript
app.use('*', cors({ origin: '*' }));
```

This is acceptable for a public API but should be documented as intentional.

---

## 6. Performance Issues

### 6.1 Major Issues

#### Issue: N+1 Query Pattern in Community Posts List

**Severity:** Major

**Location:** `apps/api-videos/src/endpoints/community/list-posts.ts:93-104`

```typescript
const posts = await Promise.all(
  paginatedPostIds.map(async (postId) => {
    const postKey = `posts/${channelId}/${postId}.json`;
    const postData = await c.env.community_posts.get(postKey);
    if (postData) {
      return postData.json();
    }
    return null;
  })
);
```

While `Promise.all` runs in parallel, this still issues N separate R2 requests. For 20 posts, that's 20 API calls.

**Recommendation:** Consider denormalizing posts into index or implementing R2 batch get if available.

#### Issue: Channel Sections Fetch All to Calculate Position

**Severity:** Minor

**Location:** `apps/api-videos/src/endpoints/channel-section/channelSectionCreate.ts:196-201`

```typescript
const listResult = await c.env.channel_sections.list({
  prefix: `${channelId}/`,
  limit: 1000, // Get all to determine position
});
const nextPosition = listResult.objects.length;
```

This could be slow for channels with many objects. Consider storing section count in channel metadata.

### 6.2 Minor Issues

#### Issue: Video Fetch Makes Extra Channel Request

**Severity:** Minor

**Location:** `apps/api-videos/src/endpoints/video/videoFetch.ts:121-141`

Every video fetch now makes an additional R2 request to get channel data:
```typescript
if (video.channelId) {
  channel = await channelRepository.getObject(video.channelId);
}
```

**Recommendation:** Consider caching channel data or denormalizing frequently needed fields into video object.

---

## 7. Error Handling

### 7.1 Strengths

#### Centralized Error Handler
```typescript
// apps/api-videos/src/middleware/error-handler.ts
export function errorHandler(err: Error, c: Context) {
  const isDev = isDevelopmentMode(c);
  const statusCode = getErrorStatusCode(err);

  // Safe error in production, detailed in development
  const response = formatErrorResponse(err, isDev);
  return c.json(response, statusCode);
}
```

#### Smart Status Code Detection
```typescript
export function getErrorStatusCode(error: any): number {
  if (error?.name === 'ValidationError' || error?.name === 'ZodError') return 400;
  if (error?.name === 'UnauthorizedError') return 401;
  if (error?.name === 'ForbiddenError') return 403;
  if (error?.name === 'NotFoundError') return 404;
  return 500;
}
```

#### Consistent Error Response Format
All endpoints use the same structure:
```typescript
{
  success: false,
  error: "Human-readable error message"
}
```

### 7.2 Issues

#### Issue: Inconsistent Error Response Schema

**Severity:** Minor

Some endpoints return `{ error: "..." }` while others return `{ success: false, error: "..." }`.

**Location:** Compare:
```typescript
// create-post.ts
return c.json({ error: 'Request body is required' }, 400);

// channelSectionCreate.ts
return c.json({ success: false, error: 'Channel not found' }, 404);
```

**Recommendation:** Standardize on `{ success: false, error: "..." }` for all errors.

---

## 8. Code Quality

### 8.1 Strengths

#### Excellent Base Class Pattern
The base class hierarchy (`AuthenticatedRoute`, `OptionalAuthRoute`, `PublicRoute`) is well-designed:

- Eliminates boilerplate auth checks
- Provides type-safe helper methods
- Makes endpoint intent explicit
- Centralizes auth error handling

#### Well-Organized Router Structure
Routes are logically grouped by domain:
```
routers/
├── video.router.ts
├── channel.router.ts
├── playlist.router.ts
├── community.router.ts
├── sections.router.ts
└── ...
```

#### Comprehensive Logging
Structured logging throughout:
```typescript
logger.info(`Creating section for channel ${channelId} by user ${userId}`, {
  type: input.type,
  title: input.title,
});
```

### 8.2 Issues

#### Issue: TODO Comments in Rate Limiting

**Severity:** Minor (violates project conventions)

**Location:** `apps/api-videos/src/middleware/rate-limit.ts:108-114`

```typescript
/**
 * Get user's rate limit tier
 *
 * TODO: Implement tier detection from user profile/subscription
 * For now, defaults to FREE tier for all users
 */
function getUserTier(userId: string): RateLimitTier {
  // TODO: Query user's subscription tier from database
  return RateLimitTier.FREE;
}
```

Per project conventions, TODO comments are prohibited. Create a GitHub issue instead.

#### Issue: Duplicate Schema Definition Pattern

**Severity:** Suggestion

The `static schema` vs instance `schema` pattern is inconsistent:

```typescript
// Some endpoints use instance property
export class ChannelSectionCreate extends AuthenticatedRoute {
  schema = addAuthToSchema({...}, 'required');
}

// Some use static
export class CreateCommunityPost extends AuthenticatedRoute {
  static schema = addAuthToSchema({...}, 'required');
}
```

**Recommendation:** Standardize on one pattern (prefer instance for chanfana compatibility).

#### Issue: Mixed `c.req.param()` and `request.params` Usage

**Severity:** Suggestion

**Location:** `apps/api-videos/src/endpoints/community/create-post.ts:121-122`

```typescript
const request: any = await this.getValidatedData<typeof this.schema>();
const { channelId: postChannelId } = c.req.param();  // Using c.req directly
```

Should use validated data consistently:
```typescript
const { channelId } = request.params;  // Using validated data
```

---

## 9. OpenAPI/Swagger

### 9.1 Strengths

#### Comprehensive Schema Definitions
All new endpoints have full OpenAPI schemas with:
- Tags for grouping
- Summary and description
- Request parameters/body schemas
- Response schemas for all status codes

#### Auth Documentation
The `addAuthToSchema()` helper properly documents auth requirements:
```typescript
schema = addAuthToSchema({
  // ...endpoint schema
}, 'required');  // Documents as requiring auth
```

### 9.2 Issues

#### Issue: `z.any()` Used for Complex Types

**Severity:** Minor

**Location:** Multiple endpoints

```typescript
// channelSectionCreate.ts
result: z.object({
  section: z.any(), // Will be ChannelSectionView
}),
```

This reduces OpenAPI documentation quality.

**Recommendation:** Define proper Zod schemas for response types.

#### Issue: Response Status Codes Not Always Documented

**Severity:** Minor

Some endpoints don't document all possible error responses:
```typescript
responses: {
  '200': { /* ... */ },
  '400': { /* ... */ },
  // Missing 401, 403, 404 documentation
}
```

---

## 10. Recommendations

### 10.1 Critical (Block Merge)

None identified.

### 10.2 High Priority (Fix Before Production)

| Issue | Severity | Location | Action |
|-------|----------|----------|--------|
| Rate Limit KV Placeholder IDs | Major | `wrangler.jsonc:121-122` | Replace with actual KV namespace IDs |
| TUS Session IP Binding | Major | `tusProxy.ts` | Add IP validation to session checks |

### 10.3 Medium Priority (Fix Soon)

| Issue | Severity | Location | Action |
|-------|----------|----------|--------|
| N+1 in Posts List | Major | `list-posts.ts` | Consider denormalization or batch fetch |
| TODO Comments | Minor | `rate-limit.ts` | Create GitHub issues, remove TODOs |
| Sensitive Headers in Logs | Minor | `tusProxy.ts` | Filter auth headers before logging |
| Section Title Sanitization | Minor | `channelSectionCreate.ts` | Add sanitization |

### 10.4 Low Priority (Cleanup)

| Issue | Severity | Location | Action |
|-------|----------|----------|--------|
| Inconsistent Error Format | Minor | Multiple | Standardize on `{success, error}` |
| `z.any()` in Schemas | Minor | Multiple | Define proper response schemas |
| Mixed Param Access | Suggestion | `create-post.ts` | Use validated data consistently |
| Static vs Instance Schema | Suggestion | Multiple | Standardize pattern |
| JSON.parse Without Try-Catch | Minor | Sections endpoints | Add error handling |

### 10.5 Pre-Production Checklist

- [ ] Create RATE_LIMIT_KV namespace and update wrangler.jsonc
- [ ] Review all new R2 buckets are created in Cloudflare dashboard
- [ ] Test TUS upload flow end-to-end
- [ ] Verify community posts work with different post types
- [ ] Test channel sections CRUD operations
- [ ] Validate rate limiting works in staging environment
- [ ] Run security scan on new endpoints
- [ ] Load test list endpoints for N+1 issues
- [ ] Verify i18n endpoints return correct data
- [ ] Test video scheduling workflow

---

## Appendix A: New R2 Buckets Required

| Bucket Name | Binding | Purpose |
|-------------|---------|---------|
| `channel-sections` | `channel_sections` | Channel section configurations |
| `community-posts` | `community_posts` | Community posts and comments |
| `channel-tabs` | `channel_tabs` | Channel tab configurations |
| `upload-defaults` | `upload-defaults` | Upload default templates |
| `subtitles` | `subtitles` | Video subtitle files |
| `scheduled-videos` | `scheduled-videos` | Scheduled video metadata |
| `global-settings` | `global_settings` | i18n translations and settings |

## Appendix B: New KV Namespaces Required

| Namespace | Binding | Purpose |
|-----------|---------|---------|
| Rate Limit KV | `RATE_LIMIT_KV` | Rate limiting state |
| TUS Sessions | `TUS_SESSIONS` | TUS upload session storage |

## Appendix C: Files Reviewed

Key files examined in this review:
- `apps/api-videos/src/index.ts` - Main application setup
- `apps/api-videos/src/base/*.ts` - Base route classes
- `apps/api-videos/src/middleware/auth.ts` - Authentication middleware
- `apps/api-videos/src/middleware/rate-limit.ts` - Rate limiting
- `apps/api-videos/src/middleware/error-handler.ts` - Error handling
- `apps/api-videos/src/endpoints/community/*.ts` - Community posts
- `apps/api-videos/src/endpoints/channel-section/*.ts` - Channel sections
- `apps/api-videos/src/endpoints/video/tus/*.ts` - TUS upload proxy
- `apps/api-videos/src/endpoints/i18n/*.ts` - Internationalization
- `apps/api-videos/src/routers/*.ts` - Route registration
- `apps/api-videos/src/validation/community-posts.ts` - Validation logic
- `apps/api-videos/wrangler.jsonc` - Cloudflare configuration

---

*Review completed by Claude Code Review Agent*
*Generated: 2025-11-27*
