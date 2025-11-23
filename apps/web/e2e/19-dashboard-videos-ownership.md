# Dashboard Videos Page - Ownership Validation Test Plan

## Overview

This document provides a comprehensive test plan for the dashboard videos page ownership validation feature. The dashboard allows users to view and manage videos across multiple channels they own, with strict ownership verification.

## Implementation Analysis

### Frontend Implementation (`/apps/web/src/app/[locale]/dashboard/videos/page.tsx`)

**Key Features:**
- Single API call for all user channels (lines 62-75)
- Ownership validation via `isOwner: true` parameter (line 66)
- Duration filtering (short/medium/long) via `durationFilter` parameter (line 67)
- Client-side privacy filtering (lines 81-85)
- Support for multiple channels through `channelIds` parameter (line 65)

**API Call Pattern:**
```typescript
const result = await searchVideos(
  '', // Empty query to get all videos
  {
    channelIds,              // Array of all user's channel IDs
    isOwner: true,           // Mark as owner request
    durationFilter,          // Filter by duration
    sortBy: 'date',
    sortOrder: 'desc',
  },
  { limit: 100 },
  { userId: user.id, channelId: channelIds[0] || user.id }
);
```

### Backend Implementation (`/apps/api-videos/src/endpoints/video/videoSearch.ts`)

**Ownership Validation Logic (lines 112-138):**
1. When `isOwner=true`, validates userId is present (lines 113-119)
2. For each channelId in the request, validates ownership (lines 121-137):
   - Fetches channel from R2 storage
   - Checks `channel.userId === userId`
   - Returns 403 Forbidden if ownership check fails

**Privacy Filtering (lines 200-206):**
- Public videos: shown to everyone
- Private videos: only shown to owner (checked via `video.userId === userId`)

**Duration Filtering (lines 173-182):**
- `short`: duration ≤ 180 seconds (3 minutes)
- `standard`: duration > 180 seconds AND not live
- `live`: isLive === true
- `all`: no duration filter

## Test Scenarios

### Test Case 1: Dashboard with Single Channel

**Given:**
- User has 1 channel
- Channel contains 10 videos (5 public, 5 private)
- Videos have various durations (short, medium, long)

**Tests:**
1. **All videos displayed:**
   - Verify API called with `isOwner=true`
   - Verify API called with user's channelId
   - Verify all 10 videos returned (public + private)

2. **Duration filter - All:**
   - Select "All Videos" filter
   - Verify all 10 videos shown

3. **Duration filter - Short:**
   - Select "Short (≤3 min)" filter
   - Verify only videos with duration ≤ 180 seconds shown
   - Verify API called with `durationFilter=short`

4. **Duration filter - Standard:**
   - Select "Standard (3-20 min)" filter
   - Verify only videos with duration > 180 AND not live shown
   - Verify API called with `durationFilter=medium`

5. **Duration filter - Long:**
   - Select "Long (>20 min)" filter
   - Verify only videos with duration > 1200 shown
   - Verify API called with `durationFilter=long`

6. **Privacy filter - Public:**
   - Select "Public" privacy filter
   - Verify only public videos shown (client-side filtering)

7. **Privacy filter - Private:**
   - Select "Private" privacy filter
   - Verify only private videos shown (client-side filtering)

**Expected Results:**
- Single API call made
- All user's videos (public + private) returned
- Filters work correctly

---

### Test Case 2: Dashboard with Multiple Channels

**Given:**
- User has 3 channels (channelA, channelB, channelC)
- channelA: 5 videos
- channelB: 8 videos
- channelC: 3 videos
- Total: 16 videos

**Tests:**
1. **Single API call for all channels:**
   - Navigate to dashboard/videos
   - Intercept network requests
   - Verify exactly 1 API call made (not 3)
   - Verify API called with `channelIds=[channelA, channelB, channelC]`
   - Verify `isOwner=true` parameter present

2. **All videos from all channels displayed:**
   - Verify total 16 videos shown
   - Verify videos from all 3 channels present

3. **No duplicate videos:**
   - Verify each video ID appears exactly once
   - Verify no duplicate entries

4. **Duration filter with multiple channels:**
   - Select "Short" filter
   - Verify short videos from ALL channels shown
   - Verify API called once (not per channel)

**Expected Results:**
- Exactly 1 API call (performance optimization)
- Videos from all channels combined
- No duplicates
- Ownership validated for all channels

---

### Test Case 3: Ownership Validation - Positive Cases

**Given:**
- User owns channels: [ch1, ch2, ch3]

**Tests:**
1. **Valid single channel request:**
   - API call: `channelIds=[ch1]`, `isOwner=true`, `userId=user123`
   - Verify channel fetched from R2
   - Verify `channel.userId === user123`
   - Verify 200 OK response
   - Verify videos returned

2. **Valid multiple channels request:**
   - API call: `channelIds=[ch1, ch2, ch3]`, `isOwner=true`, `userId=user123`
   - Verify all 3 channels fetched
   - Verify ownership for each channel
   - Verify 200 OK response
   - Verify videos from all channels returned

3. **Empty channelIds with isOwner=true:**
   - API call: `channelIds=[]`, `isOwner=true`, `userId=user123`
   - Verify no ownership validation performed (no channels to validate)
   - Verify returns user's videos based on privacy filtering

**Expected Results:**
- Ownership validated successfully
- Videos returned
- No errors

---

### Test Case 4: Ownership Validation - Negative Cases (Security Tests)

**Given:**
- User owns channels: [ch1, ch2]
- User does NOT own: [ch3, ch4]

**Tests:**
1. **Request with unowned channel - Single:**
   - API call: `channelIds=[ch3]`, `isOwner=true`, `userId=user123`
   - Verify channel ch3 fetched
   - Verify `channel.userId !== user123`
   - Verify **403 Forbidden** response
   - Verify error: "User does not own channel ch3"

2. **Request with mixed owned/unowned channels:**
   - API call: `channelIds=[ch1, ch3]`, `isOwner=true`, `userId=user123`
   - Verify ch1 ownership check passes
   - Verify ch3 ownership check **fails**
   - Verify **403 Forbidden** response
   - Verify error: "User does not own channel ch3"
   - Verify **NO videos returned** (security critical)

3. **Request without userId when isOwner=true:**
   - API call: `channelIds=[ch1]`, `isOwner=true`, `userId=null`
   - Verify **403 Forbidden** response
   - Verify error: "User authentication required when isOwner is true"

4. **Attempt to access other user's private videos:**
   - User A has private video V1
   - User B requests: `channelIds=[userA_channel]`, `isOwner=true`, `userId=userB`
   - Verify **403 Forbidden** response
   - Verify private video V1 **NOT returned**

**Expected Results:**
- Ownership validation blocks unauthorized access
- 403 Forbidden for unowned channels
- No data leakage of other users' videos

---

### Test Case 5: Privacy and Data Isolation

**Given:**
- User A owns channel ch1 with:
  - Public video: V1
  - Private video: V2
- User B owns channel ch2 with:
  - Public video: V3
  - Private video: V4

**Tests:**
1. **User A dashboard:**
   - User A navigates to dashboard
   - Verify sees V1 (public) and V2 (private)
   - Verify does **NOT** see V3 or V4

2. **User B dashboard:**
   - User B navigates to dashboard
   - Verify sees V3 (public) and V4 (private)
   - Verify does **NOT** see V1 or V2

3. **Public search (isOwner=false):**
   - Guest user searches without authentication
   - Verify sees V1 and V3 (public only)
   - Verify does **NOT** see V2 or V4 (private)

4. **Cross-user access attempt:**
   - User B attempts API call:
     ```
     channelIds=[ch1], isOwner=true, userId=userB
     ```
   - Verify **403 Forbidden**
   - Verify User B cannot see User A's videos

**Expected Results:**
- Perfect data isolation between users
- Private videos only visible to owners
- Public videos visible to everyone (when isOwner=false)

---

### Test Case 6: Edge Cases

**Tests:**
1. **User with no channels:**
   - User has zero channels
   - Navigate to dashboard/videos
   - Verify channelIds = []
   - Verify no API call made (early return)
   - Verify "no videos" empty state shown

2. **User with deleted channel:**
   - User had channel ch1, now deleted
   - channelIds includes non-existent ch1
   - Verify channel fetch returns null
   - Verify **403 Forbidden** (channel not found = not owned)

3. **Very large channelIds array:**
   - User has 100+ channels
   - Verify API call succeeds
   - Verify ownership validated for all channels
   - Verify performance acceptable (<5 seconds)

4. **Special characters in channelIds:**
   - channelIds includes malformed ID: `"ch1'; DROP TABLE--"`
   - Verify no SQL injection (not applicable - R2 storage)
   - Verify channel fetch fails gracefully
   - Verify **403 Forbidden**

5. **Concurrent filter changes:**
   - Rapidly change duration filter 5 times
   - Verify multiple API calls made (one per filter)
   - Verify each call has correct `durationFilter` parameter
   - Verify UI shows correct results for final filter

**Expected Results:**
- Graceful handling of edge cases
- No crashes or errors
- Appropriate error messages

---

### Test Case 7: Performance and Optimization

**Tests:**
1. **API call count:**
   - User with 10 channels
   - Navigate to dashboard
   - Verify exactly **1 API call** (not 10)
   - Verify `channelIds` array includes all 10

2. **Response time:**
   - User with 5 channels, 100 total videos
   - Measure time from page load to videos displayed
   - Verify < 2 seconds for API response
   - Verify < 3 seconds for full page render

3. **Pagination (if implemented):**
   - User with 500+ videos
   - Verify limit=100 in API call
   - Verify cursor-based pagination works
   - Verify smooth scroll loading

**Expected Results:**
- Single API call optimization works
- Acceptable performance
- Smooth user experience

---

### Test Case 8: Filter Combinations

**Given:**
- User has mixed videos across channels

**Tests:**
1. **Duration + Privacy filters:**
   - Select "Short" + "Public"
   - Verify only public short videos shown
   - Verify API called with `durationFilter=short`
   - Verify privacy filter applied client-side

2. **Duration + Sort:**
   - Select "Standard" + "Sort by views"
   - Verify standard videos sorted by view count
   - Verify API called with `durationFilter=medium`, `sortBy=views`

3. **Search + Duration + Privacy:**
   - Enter search query "islamic"
   - Select "Short" + "Private"
   - Verify filtered and sorted correctly

**Expected Results:**
- Filter combinations work correctly
- API receives server-side filters
- Client applies client-side filters

---

## API Contract Validation

### Request Schema
```typescript
GET /api/videos?channelIds=ch1,ch2&isOwner=true&durationFilter=short

Headers:
  userId: string
  channelId: string

Query Parameters:
  channelIds: string (comma-separated)
  isOwner: boolean
  durationFilter: 'all' | 'short' | 'standard' | 'live'
  sortBy: 'date' | 'views' | 'relevance'
  sortOrder: 'asc' | 'desc'
  limit: number
```

### Response Schema (Success)
```typescript
{
  totalResults: number,
  searchTime: number,
  cursor: string,
  limit: number,
  data: VideoObject[]
}
```

### Response Schema (Error)
```typescript
// 403 Forbidden
{
  success: false,
  error: "User does not own channel {channelId}"
}

// 403 Forbidden (no userId)
{
  success: false,
  error: "User authentication required when isOwner is true"
}
```

---

## Security Checklist

- [ ] Ownership validation prevents accessing other users' channels
- [ ] Private videos only visible to owners
- [ ] Missing userId with isOwner=true returns 403
- [ ] Unowned channels in request return 403
- [ ] No data leakage in error messages (don't reveal channel contents)
- [ ] channelIds validation prevents injection attacks
- [ ] API enforces server-side ownership checks (not client-side only)
- [ ] Multiple channels validated individually (no batch bypass)

---

## Test Execution Checklist

### Manual Testing
- [ ] Test all duration filters (all/short/standard/long)
- [ ] Test privacy filters (all/public/private)
- [ ] Test with single channel
- [ ] Test with multiple channels (2+)
- [ ] Test with no channels
- [ ] Test ownership validation errors
- [ ] Test filter combinations
- [ ] Verify single API call for multiple channels

### Automated E2E Testing (Playwright)
- [ ] Create test fixtures for users and channels
- [ ] Mock API responses for ownership scenarios
- [ ] Test positive ownership validation
- [ ] Test negative ownership validation (403 errors)
- [ ] Test privacy filtering
- [ ] Test duration filtering
- [ ] Test performance (API call count)
- [ ] Test edge cases

### API Testing (Direct)
- [ ] Test ownership validation with valid channels
- [ ] Test ownership validation with invalid channels
- [ ] Test missing userId with isOwner=true
- [ ] Test channelIds parameter parsing
- [ ] Test duration filter values
- [ ] Test response schema compliance

---

## Known Issues and Recommendations

### Current Implementation Strengths
✅ Single API call optimization (performance)
✅ Server-side ownership validation (security)
✅ Proper error handling (403 Forbidden)
✅ Privacy filtering (private videos)
✅ Duration filtering support

### Potential Issues Identified

1. **No authentication token validation:**
   - Frontend passes `userId` in headers (line 74)
   - Backend trusts this header without token validation
   - **Recommendation:** Use JWT tokens, validate in middleware

2. **Client-side privacy filtering:**
   - Privacy filter applied client-side (lines 81-85)
   - API returns all videos, then frontend filters
   - **Recommendation:** Move privacy filtering to API for security

3. **No rate limiting visible:**
   - Multiple rapid filter changes trigger multiple API calls
   - **Recommendation:** Implement debouncing or rate limiting

4. **Error handling:**
   - API errors logged but not shown to user (line 89)
   - **Recommendation:** Show user-friendly error messages

5. **Channel deletion race condition:**
   - User deletes channel while dashboard page open
   - May cause 403 errors on next API call
   - **Recommendation:** Handle gracefully with refresh

### Security Recommendations

1. **Implement JWT authentication:**
   - Don't rely on userId header
   - Validate JWT token in middleware
   - Extract userId from verified token

2. **Move privacy filtering to API:**
   - API should respect privacy filter parameter
   - Don't return private videos in API response
   - Reduce data transfer

3. **Add request validation:**
   - Validate channelIds format (UUID, max length)
   - Sanitize inputs
   - Prevent injection attacks

4. **Add audit logging:**
   - Log ownership validation failures
   - Track who accessed which channels
   - Monitor for suspicious patterns

5. **Implement rate limiting:**
   - Limit dashboard API calls per user
   - Prevent abuse and DoS attacks

---

## Test Data Setup

### User 1 (has 1 channel)
```json
{
  "userId": "user-001",
  "channels": [
    {
      "id": "ch-001",
      "userId": "user-001",
      "name": "Channel One"
    }
  ],
  "videos": [
    { "id": "v-001", "channelId": "ch-001", "isPublic": true, "duration": 120, "title": "Short Public" },
    { "id": "v-002", "channelId": "ch-001", "isPublic": false, "duration": 600, "title": "Long Private" },
    { "id": "v-003", "channelId": "ch-001", "isPublic": true, "duration": 1800, "title": "Long Public" }
  ]
}
```

### User 2 (has 3 channels)
```json
{
  "userId": "user-002",
  "channels": [
    { "id": "ch-002", "userId": "user-002", "name": "Channel Two" },
    { "id": "ch-003", "userId": "user-002", "name": "Channel Three" },
    { "id": "ch-004", "userId": "user-002", "name": "Channel Four" }
  ],
  "videos": [
    { "id": "v-004", "channelId": "ch-002", "isPublic": true, "duration": 90 },
    { "id": "v-005", "channelId": "ch-002", "isPublic": false, "duration": 300 },
    { "id": "v-006", "channelId": "ch-003", "isPublic": true, "duration": 450 },
    { "id": "v-007", "channelId": "ch-004", "isPublic": false, "duration": 2400 }
  ]
}
```

### User 3 (has 0 channels)
```json
{
  "userId": "user-003",
  "channels": [],
  "videos": []
}
```

---

## Conclusion

This test plan provides comprehensive coverage of the dashboard videos ownership validation feature. The implementation shows good security practices with server-side ownership validation, but could be improved with JWT authentication and API-level privacy filtering.

**Priority Test Scenarios:**
1. ✅ Test Case 4 (Security - Negative Cases) - **CRITICAL**
2. ✅ Test Case 5 (Privacy and Data Isolation) - **CRITICAL**
3. ✅ Test Case 2 (Multiple Channels) - **HIGH** (performance)
4. Test Case 1 (Single Channel) - **MEDIUM** (basic functionality)
5. Test Case 6 (Edge Cases) - **MEDIUM** (robustness)

**Next Steps:**
1. Implement automated E2E tests (Playwright)
2. Add API integration tests
3. Review security recommendations
4. Consider JWT authentication implementation
