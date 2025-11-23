# E2E Video Search API Testing Plan

**Date**: 2025-11-23
**Component**: Video Search API (`/api/videos/search`)
**Frontend Pages**: `scheduled-videos`, `search`

## Overview

This document outlines comprehensive E2E testing for the video search API filtering functionality, covering scheduled video filtering, ownership validation, duration filters, and schedule filters.

## Test Environment

- **API Base URL**: http://127.0.0.1:3086 (development)
- **Frontend Base URL**: http://localhost:3001 (development)
- **API Implementation**: `/home/meywd/AlUmmahNow/apps/api-videos/src/endpoints/video/videoSearch.ts`
- **Frontend Pages**:
  - Scheduled Videos: `/home/meywd/AlUmmahNow/apps/web/src/app/[locale]/scheduled-videos/page.tsx`
  - Search: `/home/meywd/AlUmmahNow/apps/web/src/app/[locale]/search/page.tsx`
- **API Client**: `/home/meywd/AlUmmahNow/apps/web/src/lib/api/videos.ts`

---

## Issues Discovered (Pre-Testing)

### CRITICAL Issue #1: Query Parameter Mismatch
**Location**: `apps/web/src/lib/api/videos.ts:598`
**Description**: Frontend sends `search` parameter, but backend expects `q` parameter
**Impact**: Search queries will not work
**Fix Required**: Change line 598 from:
```typescript
queryParams.append('search', query);
```
to:
```typescript
queryParams.append('q', query);
```

### Issue #2: Schedule Filter Not Implemented
**Location**: `apps/api-videos/src/endpoints/video/videoSearch.ts:184-198`
**Description**: Schedule filter logic is commented out (placeholder)
**Impact**: Schedule filtering will not work until `scheduledPublishStatus` field is added to Video schema
**Status**: Documented, needs schema update

---

## Test Cases

### Test Case 4: Scheduled Videos Page

**Objective**: Verify the scheduled-videos page correctly uses searchVideos() API with proper filters.

**Frontend Implementation** (line 58-74 in scheduled-videos/page.tsx):
```typescript
const result = await searchVideos(
  '', // Empty query to get all videos
  {
    channelIds, // Filter by user's channels
    isOwner: true, // Only show videos owned by the user
    scheduleFilter, // Filter by schedule status (scheduled/published)
    sortBy: 'date', // Sort by date (most recent first)
    sortOrder: 'desc',
  },
  {
    limit: 100, // Fetch up to 100 scheduled videos
  },
  {
    userId: auth.user.id,
    channelId: auth.user.id, // Use user ID as fallback channel
  }
);
```

**Expected Behavior**:
1. ✅ Sends empty query (`q=""`)
2. ✅ Includes `isOwner=true`
3. ✅ Includes `channelIds` (user's owned channels)
4. ✅ Includes `scheduleFilter` (scheduled/published)
5. ✅ Uses `sortBy=date` and `sortOrder=desc`
6. ✅ Sets `limit=100`
7. ✅ Includes userId and channelId headers

**API Test Request**:
```bash
curl -X GET "http://127.0.0.1:3086/api/videos?q=&isOwner=true&channelIds=test-channel-1,test-channel-2&scheduleFilter=scheduled&sortBy=date&sortOrder=desc&limit=100" \
  -H "Content-Type: application/json" \
  -H "userId: test-user-123" \
  -H "channelId: test-channel-1"
```

**Expected Response**:
- Status: 200 OK (if user owns channels) or 403 Forbidden (if ownership fails)
- Returns only videos from specified channels
- Returns only videos owned by the user

**Pass Criteria**:
- [ ] API accepts all parameters without errors
- [ ] Ownership validation works correctly
- [ ] Only returns videos from user's channels
- [ ] Schedule filter applied (when implemented)

---

### Test Case 5: Public Search Page

**Objective**: Verify the public search page shows all public videos without ownership restrictions.

**Frontend Implementation** (line 40 in search/page.tsx):
```typescript
const data = await VideosAPI.searchVideos(searchQuery, filters, { limit: 20 });
```

**Expected Behavior**:
1. ✅ Does NOT set `isOwner=true`
2. ✅ Shows all public videos
3. ✅ Does NOT show private videos from other users
4. ✅ Uses default filters (duration, category, etc.)

**API Test Request (Public Search)**:
```bash
# Search without authentication (public)
curl -X GET "http://127.0.0.1:3086/api/videos?q=islamic&limit=20" \
  -H "Content-Type: application/json"
```

**API Test Request (Authenticated Search)**:
```bash
# Search with authentication (should show user's private videos too)
curl -X GET "http://127.0.0.1:3086/api/videos?q=islamic&limit=20" \
  -H "Content-Type: application/json" \
  -H "userId: test-user-123"
```

**Expected Response**:
- Public search: Only public videos
- Authenticated search: Public videos + user's private videos

**Pass Criteria**:
- [ ] Public search returns only isPublic=true videos
- [ ] Authenticated search includes user's private videos
- [ ] Other users' private videos are NOT returned

---

### Test Case 6: API Ownership Validation

**Objective**: Verify API correctly validates channel ownership when `isOwner=true`.

#### Test 6A: Valid Ownership

**API Test Request**:
```bash
# User owns channel-1
curl -X GET "http://127.0.0.1:3086/api/videos?isOwner=true&channelIds=channel-1&limit=20" \
  -H "Content-Type: application/json" \
  -H "userId: user-123" \
  -H "channelId: channel-1"
```

**Expected Response**:
- Status: 200 OK
- Returns videos from channel-1

**Pass Criteria**:
- [ ] Status 200 when user owns all specified channels

#### Test 6B: Invalid Ownership (User doesn't own channel)

**API Test Request**:
```bash
# User does NOT own channel-999
curl -X GET "http://127.0.0.1:3086/api/videos?isOwner=true&channelIds=channel-999&limit=20" \
  -H "Content-Type: application/json" \
  -H "userId: user-123" \
  -H "channelId: channel-1"
```

**Expected Response**:
- Status: 403 Forbidden
- Error: "User does not own channel channel-999"

**Pass Criteria**:
- [ ] Status 403 when user doesn't own specified channel
- [ ] Clear error message indicating which channel failed

#### Test 6C: Missing userId with isOwner=true

**API Test Request**:
```bash
# No userId provided
curl -X GET "http://127.0.0.1:3086/api/videos?isOwner=true&channelIds=channel-1&limit=20" \
  -H "Content-Type: application/json"
```

**Expected Response**:
- Status: 403 Forbidden
- Error: "User authentication required when isOwner is true"

**Pass Criteria**:
- [ ] Status 403 when userId missing and isOwner=true

#### Test 6D: isOwner=false (No ownership validation)

**API Test Request**:
```bash
# isOwner=false, can query any channels
curl -X GET "http://127.0.0.1:3086/api/videos?isOwner=false&channelIds=channel-1,channel-999&limit=20" \
  -H "Content-Type: application/json"
```

**Expected Response**:
- Status: 200 OK
- Returns videos from all specified channels (no ownership check)

**Pass Criteria**:
- [ ] Status 200 when isOwner=false (no validation)
- [ ] Can query any channels without authentication

---

### Test Case 7: Duration Filter - Short Videos

**Objective**: Verify `durationFilter=short` returns only videos ≤ 180 seconds.

**API Implementation** (lines 174-176):
```typescript
if (durationFilter === "short" && (video.duration === undefined || video.duration > 180)) {
  return false;
}
```

**API Test Request**:
```bash
curl -X GET "http://127.0.0.1:3086/api/videos?durationFilter=short&limit=20" \
  -H "Content-Type: application/json"
```

**Expected Response**:
- All videos have `duration <= 180` seconds
- Videos without duration field are excluded

**Pass Criteria**:
- [ ] All returned videos have duration ≤ 180 seconds
- [ ] Videos with undefined duration are excluded

---

### Test Case 8: Duration Filter - Standard Videos

**Objective**: Verify `durationFilter=standard` returns only videos > 180 seconds and not live.

**API Implementation** (lines 177-180):
```typescript
if (durationFilter === "standard" && (video.duration === undefined || video.duration <= 180 || video.isLive)) {
  return false;
}
```

**API Test Request**:
```bash
curl -X GET "http://127.0.0.1:3086/api/videos?durationFilter=standard&limit=20" \
  -H "Content-Type: application/json"
```

**Expected Response**:
- All videos have `duration > 180` seconds
- No live videos (`isLive=false`)
- Videos without duration field are excluded

**Pass Criteria**:
- [ ] All returned videos have duration > 180 seconds
- [ ] No live videos in results
- [ ] Videos with undefined duration are excluded

---

### Test Case 9: Duration Filter - Live Videos

**Objective**: Verify `durationFilter=live` returns only live streaming videos.

**API Implementation** (lines 181-183):
```typescript
if (durationFilter === "live" && !video.isLive) {
  return false;
}
```

**API Test Request**:
```bash
curl -X GET "http://127.0.0.1:3086/api/videos?durationFilter=live&limit=20" \
  -H "Content-Type: application/json"
```

**Expected Response**:
- All videos have `isLive=true`

**Pass Criteria**:
- [ ] All returned videos have isLive=true

---

### Test Case 10: Schedule Filter

**Objective**: Verify schedule filter works correctly (when implemented).

**API Implementation** (lines 184-198):
```typescript
// PLACEHOLDER - Currently commented out
// Waiting for scheduledPublishStatus field in Video schema
```

#### Test 10A: Schedule Filter - Scheduled Videos

**API Test Request**:
```bash
curl -X GET "http://127.0.0.1:3086/api/videos?scheduleFilter=scheduled&limit=20" \
  -H "Content-Type: application/json"
```

**Expected Response** (when implemented):
- All videos have `scheduledPublishStatus` in ['scheduled', 'publishing']

**Current Status**: ⚠️ Not Implemented - Returns all videos

**Pass Criteria**:
- [ ] Returns only scheduled/publishing videos (when implemented)
- [ ] Currently: No-op (returns all videos)

#### Test 10B: Schedule Filter - Published Videos

**API Test Request**:
```bash
curl -X GET "http://127.0.0.1:3086/api/videos?scheduleFilter=published&limit=20" \
  -H "Content-Type: application/json"
```

**Expected Response** (when implemented):
- All videos have `scheduledPublishStatus` NOT in ['scheduled', 'publishing']

**Current Status**: ⚠️ Not Implemented - Returns all videos

**Pass Criteria**:
- [ ] Returns only published videos (when implemented)
- [ ] Currently: No-op (returns all videos)

---

## Test Execution Checklist

### Pre-Test Setup
- [ ] Start API server: `cd apps/api-videos && pnpm dev`
- [ ] Verify API is running: `curl http://127.0.0.1:3086/`
- [ ] Create test data (videos, channels, users)
- [ ] Note test data IDs for use in tests

### Test Execution Order
1. [ ] Test Case 6 (Ownership Validation) - Foundational
2. [ ] Test Case 7-9 (Duration Filters) - Independent
3. [ ] Test Case 10 (Schedule Filter) - Document current state
4. [ ] Test Case 4 (Scheduled Videos Page) - Integration
5. [ ] Test Case 5 (Public Search Page) - Integration

### Post-Test
- [ ] Document all pass/fail results
- [ ] Log all API responses
- [ ] Capture any error messages
- [ ] Create issue tickets for failures
- [ ] Update test plan with findings

---

## Test Results Summary

### Overall Status
- **Total Test Cases**: 10 (6 main + 4 sub-tests)
- **Passed**: ___
- **Failed**: ___
- **Blocked**: ___
- **Not Implemented**: ___

### Issues Found
1. **CRITICAL**: Query parameter mismatch (`search` vs `q`)
2. Schedule filter not implemented (waiting for schema update)
3. _[To be filled during testing]_

### Recommendations
1. Fix query parameter mismatch immediately
2. Add `scheduledPublishStatus` field to Video schema
3. Implement schedule filter logic
4. Add automated tests for all scenarios
5. Consider adding integration tests for frontend pages

---

## Next Steps

1. ✅ Fix query parameter mismatch in `videos.ts`
2. ⏳ Execute all test cases systematically
3. ⏳ Document test results
4. ⏳ Create GitHub issues for failures
5. ⏳ Implement missing functionality (schedule filter)
6. ⏳ Add automated test suite

---

## Notes

- All tests assume development environment with local API
- Tests require test data to be present in R2 buckets
- Some tests may need authentication tokens (JWT)
- Schedule filter tests will show "not implemented" status until schema is updated
