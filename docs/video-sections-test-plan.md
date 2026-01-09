# Video Sections Feature - Test Plan

## Overview
This document provides a comprehensive testing plan for the video sections feature, which includes five public API endpoints for displaying categorized video content on the Al Ummah Now platform.

**Feature Status**: Implementation complete, ready for testing
**Date**: 2025-11-22
**Author**: Test Automation Engineer

## Endpoints Implemented

| Endpoint | Method | Purpose | Authentication |
|----------|--------|---------|----------------|
| `/api/videos/sections/recent` | GET | Recently uploaded videos | Optional |
| `/api/videos/sections/popular` | GET | Popular videos by views/engagement | Optional |
| `/api/videos/sections/trending` | GET | Trending videos with velocity algorithm | Optional |
| `/api/videos/sections/recommended` | GET | Recommended videos (personalized) | Optional |
| `/api/videos/sections/by-category/:category` | GET | Videos filtered by category | Optional |

## Test Environment Setup

### Backend API
- **URL**: http://127.0.0.1:3086
- **OpenAPI Docs**: http://127.0.0.1:3086/
- **Start Command**: `cd /home/meywd/AlUmmahNow/apps/api-videos && pnpm dev`

### Frontend Web App
- **URL**: http://localhost:3001
- **Start Command**: `cd /home/meywd/AlUmmahNow/apps/web && pnpm dev`

### Prerequisites
1. Build shared types: `pnpm --filter @al-ummah/shared-types build`
2. Ensure R2 buckets exist (development uses preview buckets)
3. Verify no other services are using ports 3001, 3086

## Manual Testing Plan

### 1. Recent Videos Section

#### 1.1 Basic Functionality
```bash
# Test 1: Get recent videos with default parameters
curl http://127.0.0.1:3086/api/videos/sections/recent | jq

# Expected: 200 OK with 12 videos sorted by dateCreated (newest first)
# Response structure:
# {
#   "success": true,
#   "data": [...],  // Array of video objects
#   "cursor": "...",  // Optional pagination cursor
#   "metadata": {
#     "totalCount": 12,
#     "lastUpdated": "2025-11-22T...",
#     "fromIndex": true  // or false
#   }
# }
```

#### 1.2 Pagination
```bash
# Test 2: Get recent videos with custom limit
curl "http://127.0.0.1:3086/api/videos/sections/recent?limit=5" | jq

# Expected: 200 OK with 5 videos
# Expected: cursor field for pagination if more videos exist

# Test 3: Use cursor for next page
# Copy cursor from previous response
curl "http://127.0.0.1:3086/api/videos/sections/recent?cursor=BASE64_CURSOR" | jq

# Expected: 200 OK with next batch of videos
```

#### 1.3 Filtering
```bash
# Test 4: Filter by channel
curl "http://127.0.0.1:3086/api/videos/sections/recent?channelId=CHANNEL_ID" | jq

# Expected: 200 OK with videos only from specified channel

# Test 5: Filter by category
curl "http://127.0.0.1:3086/api/videos/sections/recent?category=quran_recitation" | jq

# Expected: 200 OK with videos in quran_recitation category

# Test 6: Exclude specific channels
curl "http://127.0.0.1:3086/api/videos/sections/recent?excludeChannels=CH1&excludeChannels=CH2" | jq

# Expected: 200 OK with videos excluding specified channels
```

#### 1.4 Edge Cases
```bash
# Test 7: Invalid limit (boundary testing)
curl "http://127.0.0.1:3086/api/videos/sections/recent?limit=0" | jq
# Expected: Uses default limit (12)

curl "http://127.0.0.1:3086/api/videos/sections/recent?limit=100" | jq
# Expected: Respects max limit (50) or returns available videos

# Test 8: Invalid cursor
curl "http://127.0.0.1:3086/api/videos/sections/recent?cursor=invalid_cursor" | jq
# Expected: 200 OK, starts from beginning (logged warning)

# Test 9: No videos in R2
# (Requires empty R2 bucket for testing)
# Expected: 200 OK with empty data array
```

### 2. Popular Videos Section

#### 2.1 Basic Functionality
```bash
# Test 10: Get popular videos (default: all time)
curl http://127.0.0.1:3086/api/videos/sections/popular | jq

# Expected: 200 OK with videos sorted by view count (highest first)
# Expected: engagementRate field in each video
```

#### 2.2 Time Period Filtering
```bash
# Test 11: Popular videos - daily
curl "http://127.0.0.1:3086/api/videos/sections/popular?period=daily" | jq

# Expected: 200 OK with videos uploaded in last 24 hours

# Test 12: Popular videos - weekly
curl "http://127.0.0.1:3086/api/videos/sections/popular?period=weekly" | jq

# Expected: 200 OK with videos uploaded in last 7 days

# Test 13: Popular videos - monthly
curl "http://127.0.0.1:3086/api/videos/sections/popular?period=monthly" | jq

# Expected: 200 OK with videos uploaded in last 30 days

# Test 14: Popular videos - all time
curl "http://127.0.0.1:3086/api/videos/sections/popular?period=all" | jq

# Expected: 200 OK with all videos sorted by views
```

#### 2.3 Additional Filtering
```bash
# Test 15: Minimum views threshold
curl "http://127.0.0.1:3086/api/videos/sections/popular?minViews=1000" | jq

# Expected: 200 OK with videos having >= 1000 views

# Test 16: Category filter
curl "http://127.0.0.1:3086/api/videos/sections/popular?category=islamic_history" | jq

# Expected: 200 OK with popular videos in islamic_history category
```

### 3. Trending Videos Section

#### 3.1 Basic Functionality
```bash
# Test 17: Get trending videos (default: hybrid algorithm, 24h window)
curl http://127.0.0.1:3086/api/videos/sections/trending | jq

# Expected: 200 OK with trending videos
# Expected: trendingMetadata with rank, score, viewsVelocity, percentageIncrease
```

#### 3.2 Algorithm Selection
```bash
# Test 18: Velocity algorithm
curl "http://127.0.0.1:3086/api/videos/sections/trending?algorithm=velocity" | jq

# Expected: 200 OK with videos sorted by view velocity

# Test 19: Engagement algorithm
curl "http://127.0.0.1:3086/api/videos/sections/trending?algorithm=engagement" | jq

# Expected: 200 OK with videos sorted by engagement rate

# Test 20: Hybrid algorithm
curl "http://127.0.0.1:3086/api/videos/sections/trending?algorithm=hybrid" | jq

# Expected: 200 OK with videos sorted by combined scoring
```

#### 3.3 Time Window Selection
```bash
# Test 21: 6-hour window
curl "http://127.0.0.1:3086/api/videos/sections/trending?timeWindow=6h" | jq

# Expected: 200 OK with videos from last 6 hours

# Test 22: 12-hour window
curl "http://127.0.0.1:3086/api/videos/sections/trending?timeWindow=12h" | jq

# Expected: 200 OK with videos from last 12 hours

# Test 23: 48-hour window
curl "http://127.0.0.1:3086/api/videos/sections/trending?timeWindow=48h" | jq

# Expected: 200 OK with videos from last 48 hours
```

#### 3.4 Metadata Validation
```bash
# Test 24: Verify trending metadata
curl http://127.0.0.1:3086/api/videos/sections/trending | jq '.data[0].trendingMetadata'

# Expected: Object with:
# - rank: number (position in trending list)
# - score: number (trending score)
# - viewsVelocity: number (views per hour)
# - percentageIncrease: number (percentage growth)
# - peakTime: string | undefined (future enhancement)
```

### 4. Recommended Videos Section

#### 4.1 Basic Functionality
```bash
# Test 25: Get recommended videos (default: popular strategy)
curl http://127.0.0.1:3086/api/videos/sections/recommended | jq

# Expected: 200 OK with recommended videos
# Expected: metadata.strategy = "popular"
# Expected: metadata.basedOn describes recommendation source
```

#### 4.2 Strategy Selection
```bash
# Test 26: Category-based recommendations
curl "http://127.0.0.1:3086/api/videos/sections/recommended?strategy=category-based" | jq

# Expected: 200 OK with category-similar videos

# Test 27: Random recommendations
curl "http://127.0.0.1:3086/api/videos/sections/recommended?strategy=random" | jq

# Expected: 200 OK with randomized video selection

# Test 28: Popular recommendations
curl "http://127.0.0.1:3086/api/videos/sections/recommended?strategy=popular" | jq

# Expected: 200 OK with weekly popular videos
```

#### 4.3 Personalization
```bash
# Test 29: Seed-based recommendations
curl "http://127.0.0.1:3086/api/videos/sections/recommended?seedVideoId=VIDEO_ID" | jq

# Expected: 200 OK with videos similar to seed video
# Expected: metadata.basedOn includes seed video title/id

# Test 30: Exclude watched videos (requires authentication)
curl -H "Authorization: Bearer JWT_TOKEN" \
  -H "userId: USER_ID" \
  "http://127.0.0.1:3086/api/videos/sections/recommended?excludeWatched=true" | jq

# Expected: 200 OK with videos excluding user's watch history
```

#### 4.4 Recommendation Scoring
```bash
# Test 31: Verify recommendation scores
curl http://127.0.0.1:3086/api/videos/sections/recommended | jq '.data[].recommendationScore'

# Expected: Each video has recommendationScore (0-100)
# Expected: Scores based on views (40%), engagement (40%), recency (20%)
```

### 5. Category Videos Section

#### 5.1 Basic Functionality
```bash
# Test 32: Get videos by category (Quran Recitation)
curl http://127.0.0.1:3086/api/videos/sections/by-category/quran_recitation | jq

# Expected: 200 OK with quran_recitation videos
# Expected: metadata.category = "quran_recitation"

# Test 33: Get videos by category (Islamic History)
curl http://127.0.0.1:3086/api/videos/sections/by-category/islamic_history | jq

# Expected: 200 OK with islamic_history videos
```

#### 5.2 Sorting Options
```bash
# Test 34: Sort by recent
curl "http://127.0.0.1:3086/api/videos/sections/by-category/quran_recitation?sort=recent" | jq

# Expected: 200 OK with videos sorted by dateCreated (newest first)

# Test 35: Sort by popular
curl "http://127.0.0.1:3086/api/videos/sections/by-category/quran_recitation?sort=popular" | jq

# Expected: 200 OK with videos sorted by views (highest first)

# Test 36: Sort by trending
curl "http://127.0.0.1:3086/api/videos/sections/by-category/quran_recitation?sort=trending" | jq

# Expected: 200 OK with videos sorted by trending score
```

#### 5.3 Invalid Categories
```bash
# Test 37: Invalid category enum value
curl http://127.0.0.1:3086/api/videos/sections/by-category/invalid_category | jq

# Expected: 404 Not Found
# Expected: error message "Invalid category: invalid_category"

# Test 38: Missing category parameter
curl http://127.0.0.1:3086/api/videos/sections/by-category/ | jq

# Expected: 404 Not Found (route not matched)
```

### 6. Index System Testing

#### 6.1 Index Usage Verification
```bash
# Test 39: Verify index usage (recent)
curl http://127.0.0.1:3086/api/videos/sections/recent | jq '.metadata.fromIndex'

# Expected: true or false
# If true: index is being used (fast response)
# If false: direct R2 query (slower, triggers index rebuild)

# Test 40: Verify index staleness threshold
# (Check logs for "Index stale or not found" messages)
# Expected: Index rebuilt in background after staleness detected
```

#### 6.2 Admin Index Operations
```bash
# Test 41: Rebuild all indexes (requires authentication)
curl -H "Authorization: Bearer JWT_TOKEN" \
  "http://127.0.0.1:3086/api/videos/sections/admin?action=rebuild&section=all" | jq

# Expected: 200 OK with rebuild status
# Expected: All indexes (recent, popular, trending, category) rebuilt
```

### 7. Error Handling

#### 7.1 Server Errors
```bash
# Test 42: Database connection failure simulation
# (Requires R2 bucket to be unavailable)
# Expected: 500 Internal Server Error
# Expected: error message describing the issue

# Test 43: Malformed query parameters
curl "http://127.0.0.1:3086/api/videos/sections/recent?limit=abc" | jq

# Expected: 400 Bad Request
# Expected: error message about invalid parameter type
```

#### 7.2 CORS and Headers
```bash
# Test 44: Verify CORS headers
curl -I -H "Origin: http://localhost:3001" \
  http://127.0.0.1:3086/api/videos/sections/recent

# Expected: Access-Control-Allow-Origin: *
# Expected: Access-Control-Allow-Methods includes GET
```

### 8. Performance Testing

#### 8.1 Response Times
```bash
# Test 45: Measure response time (index hit)
time curl -s http://127.0.0.1:3086/api/videos/sections/recent > /dev/null

# Expected: < 200ms (with warm index)

# Test 46: Measure response time (index miss)
# (Clear indexes first)
time curl -s http://127.0.0.1:3086/api/videos/sections/recent > /dev/null

# Expected: < 1000ms (direct R2 query)
```

#### 8.2 Concurrent Requests
```bash
# Test 47: 10 concurrent requests
for i in {1..10}; do
  curl -s http://127.0.0.1:3086/api/videos/sections/recent > /dev/null &
done
wait

# Expected: All requests complete successfully
# Expected: No 503 Service Unavailable errors
```

### 9. Integration Testing (Frontend)

#### 9.1 Component Rendering
```
# Test 48: Access frontend sections page
Navigate to: http://localhost:3001/en/sections

# Expected: Page loads without errors
# Expected: All 5 section components render
# Expected: Videos display correctly in each section
```

#### 9.2 User Interactions
```
# Test 49: Click on video in Recent section
# Expected: Navigates to video detail page

# Test 50: Pagination in Popular section
# Expected: Load more button works, loads next batch

# Test 51: Category filter in Category section
# Expected: Dropdown shows all categories
# Expected: Selecting category updates videos
```

## API Response Schema Validation

### Common Video Object Schema
```json
{
  "id": "string",
  "title": "string",
  "description": "string?",
  "thumbnailUrl": "string?",
  "videoUrl": "string?",
  "channelId": "string",
  "channelName": "string?",
  "channelAvatarUrl": "string?",
  "dateCreated": "string (ISO 8601)",
  "views": "number",
  "likesCount": "number",
  "dislikesCount": "number",
  "commentsCount": "number",
  "duration": "number?",
  "category": "VideoCategory enum?",
  "isPublic": "boolean"
}
```

### Section-Specific Extensions
- **Popular**: Adds `engagementRate: number`
- **Trending**: Adds `trendingMetadata: TrendingMetadata`
- **Recommended**: Adds `recommendationScore: number`

## Logging Verification

### Expected Log Messages
```
# Recent videos
✓ "Using recent videos index" OR "Index stale or not found"
✓ "Starting recent index rebuild" (if stale)
✓ "Recent index rebuilt" (background task)

# Popular videos
✓ "Using popular videos index" OR "Index stale or not found"
✓ "Starting popular index rebuild" (if stale)

# Trending videos
✓ "Using trending videos index" OR "Calculating trending videos"
✓ "Starting trending index rebuild" (background task)

# Category videos
✓ "Using category videos index" OR "Category index stale or not found"
✓ "Starting category index rebuild" (background task)

# Errors
✓ "Invalid cursor provided" (warning for bad cursor)
✓ "Failed to rebuild X index" (error during background rebuild)
```

## Edge Cases and Security

### Edge Case Testing
1. **Empty R2 Buckets**: Returns empty data array, no errors
2. **Single Video**: Pagination works correctly
3. **Cursor Expiration**: Gracefully handles expired/invalid cursors
4. **Index Corruption**: Falls back to direct R2 query
5. **Large Result Sets**: Respects limit parameter, doesn't timeout

### Security Considerations
1. **Public Endpoints**: All section endpoints are public (no auth required)
2. **Private Videos**: Correctly filters out private videos (isPublic === false)
3. **Injection Protection**: Zod validates all query parameters
4. **Rate Limiting**: Should be applied in production (not in dev)
5. **CORS**: Allows cross-origin requests for frontend integration

## Known Issues and Pre-Existing Errors

### Frontend Web App (Unrelated)
- The web app has pre-existing TypeScript errors (channel pages, TUS logs, etc.)
- These are NOT related to the video sections feature
- Video sections feature implementation is TypeScript clean

### Backend API
- ✅ All section endpoints pass TypeScript compilation
- ✅ Dry-run deployment successful
- ✅ No linting or type errors in sections code

## Success Criteria

### Must Pass
- ✅ All 5 endpoints return 200 OK for valid requests
- ✅ Response schemas match expected structures
- ✅ Pagination works correctly (cursor-based)
- ✅ Filtering parameters work as documented
- ✅ Index system functions (hit/miss, rebuild)
- ✅ Error responses include meaningful messages
- ✅ Frontend API client calls correct URLs
- ✅ No authentication required for public access

### Should Pass
- ✅ Response times under 200ms (index hit)
- ✅ Response times under 1000ms (index miss)
- ✅ Handles 10+ concurrent requests
- ✅ Logs provide debugging information
- ✅ Background index rebuilds don't block requests

### Nice to Have
- ⚠️ Response times under 100ms (optimized)
- ⚠️ Handles 100+ concurrent requests
- ⚠️ Cache headers for browser caching
- ⚠️ Compression enabled (gzip)

## Testing Checklist

### Pre-Test Setup
- [ ] Start backend API: `cd /home/meywd/AlUmmahNow/apps/api-videos && pnpm dev`
- [ ] Start frontend web app: `cd /home/meywd/AlUmmahNow/apps/web && pnpm dev`
- [ ] Verify OpenAPI docs accessible: http://127.0.0.1:3086/
- [ ] Populate R2 buckets with test data (at least 20+ videos)

### Backend API Testing
- [ ] Recent videos: Tests 1-9 (basic, pagination, filtering, edge cases)
- [ ] Popular videos: Tests 10-16 (basic, time periods, filtering)
- [ ] Trending videos: Tests 17-24 (basic, algorithms, time windows, metadata)
- [ ] Recommended videos: Tests 25-31 (basic, strategies, personalization, scoring)
- [ ] Category videos: Tests 32-38 (basic, sorting, invalid categories)
- [ ] Index system: Tests 39-41 (verification, admin operations)
- [ ] Error handling: Tests 42-44 (server errors, CORS)
- [ ] Performance: Tests 45-47 (response times, concurrency)

### Frontend Integration Testing
- [ ] Component rendering: Test 48
- [ ] User interactions: Tests 49-51

### Documentation
- [ ] API endpoints documented in OpenAPI (Swagger UI)
- [ ] Frontend API client JSDoc comments updated
- [ ] README or CLAUDE.md mentions video sections feature

## Deployment Readiness

### Checklist Before Production
- [ ] All manual tests pass
- [ ] Performance benchmarks meet targets
- [ ] Error handling tested and verified
- [ ] Logging provides sufficient debugging info
- [ ] Index rebuild process tested
- [ ] CORS configured correctly for production domains
- [ ] Rate limiting configured (if required)
- [ ] Monitoring and alerting set up
- [ ] Load testing performed
- [ ] Rollback plan documented

## Notes for Developers

1. **Index System**: Endpoints prioritize reading from indexes for performance. If index is stale or missing, they fall back to direct R2 queries and trigger background index rebuilds.

2. **Cursor Pagination**: All endpoints use base64-encoded JSON cursors. Format: `btoa(JSON.stringify({ offset: number }))`. Invalid cursors are handled gracefully.

3. **Buffer Replacement**: The implementation uses `atob()`/`btoa()` instead of Node.js `Buffer` for Cloudflare Workers compatibility.

4. **URL Pattern**: Frontend API client now correctly calls `/api/videos/sections/*` instead of `/api/sections/*`.

5. **Category Endpoint**: Uses path parameter `:category` instead of query parameter for REST compliance.

6. **Logging**: All endpoints use centralized logger (`@/lib/logger`). Check logs at http://localhost:3089/ for debugging.

7. **Authentication**: All endpoints support optional authentication. Authenticated users may get personalized results (e.g., exclude watched videos in recommended section).

## Revision History

- **2025-11-22**: Initial test plan created
  - Documented 51 manual test cases
  - Identified API URL mismatch (fixed)
  - Verified TypeScript compilation and build
  - Documented expected behaviors and edge cases
