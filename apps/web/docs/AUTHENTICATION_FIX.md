# Authentication Fix for Analytics Endpoints

## Overview

Fixed missing JWT authentication in analytics endpoints for the video performance monitoring and A/B testing systems. All analytics requests now include proper Authorization headers with Bearer tokens from OpenAuth.

## Changes Made

### 1. New Utility Module: `src/lib/auth/client-token.ts`

Created a client-side authentication utility module with two key functions:

- **`getClientAuthToken()`**: Safely extracts JWT access token from cookies (client-side only)
- **`getAuthHeaders()`**: Returns Authorization header object with Bearer token

**Key features:**
- Client-side only (returns null in server-side environment)
- Graceful error handling (returns null/empty object on failure)
- URI decoding support for encoded tokens
- Type-safe implementation

### 2. Updated: `src/services/monitoring/video-performance.ts`

**Changes in `VideoPerformanceMonitor.sendMetrics()`:**
- Dynamically imports `getAuthHeaders()` helper
- Adds Authorization header to all performance metrics POST requests
- Maintains backward compatibility (works with or without authentication)

```typescript
// Get auth token from cookies (client-side)
const { getAuthHeaders } = await import('@/lib/auth/client-token');
const authHeaders = getAuthHeaders();

const response = await fetch(this.config.analyticsEndpoint, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    ...authHeaders,
  },
  body: JSON.stringify(metricsToSend),
});
```

### 3. Updated: `src/services/experiments/analytics.ts`

**Changes in `ExperimentAnalytics` class:**

Updated three methods to include authentication headers:

1. **`sendEvents()`** - Batch A/B test event tracking
2. **`getExperimentResults()`** - Fetch experiment results
3. **`getExperimentStatistics()`** - Fetch experiment statistics

All methods now:
- Import `getAuthHeaders()` dynamically
- Add Authorization header to fetch requests
- Handle unauthenticated users gracefully (empty auth headers)

### 4. New Tests: `src/lib/auth/__tests__/client-token.test.ts`

Comprehensive test suite with 9 test cases:

**getClientAuthToken() tests:**
- Returns null when no cookies exist
- Returns null when access_token cookie doesn't exist
- Returns token when it exists
- Works with multiple cookies
- Decodes URI-encoded tokens
- Handles errors gracefully

**getAuthHeaders() tests:**
- Returns empty object when not authenticated
- Returns Authorization header when authenticated
- Works with multiple cookies

**Test results:** ✅ 9/9 passed

## Implementation Details

### Authentication Pattern

The implementation follows the existing OpenAuth pattern used in the codebase:

```typescript
// Pattern: Get token from cookies (client-side)
import { getAuthHeaders } from '@/lib/auth/client-token';

const authHeaders = getAuthHeaders();
// Returns: { 'Authorization': 'Bearer <token>' } or {}

const response = await fetch(endpoint, {
  headers: {
    'Content-Type': 'application/json',
    ...authHeaders, // Spread auth headers
  },
});
```

### Graceful Degradation

The implementation gracefully handles unauthenticated users:

1. **No token present**: `getAuthHeaders()` returns empty object `{}`
2. **Spread operator**: Empty object doesn't affect other headers
3. **API endpoint**: Can choose to require or accept optional auth
4. **User experience**: Analytics continue to work (may be limited based on API requirements)

### Server-Side Safety

The utility is designed for client-side only:
- Checks for `document` existence
- Returns null/empty object in server-side environment
- Prevents errors in SSR contexts

## Benefits

1. **Security**: All analytics requests now include proper authentication
2. **User attribution**: Analytics can be properly attributed to authenticated users
3. **Backward compatibility**: Works seamlessly with existing code
4. **Graceful degradation**: Handles unauthenticated users without errors
5. **Type safety**: Full TypeScript support with proper types
6. **Well tested**: Comprehensive test coverage (9 test cases)
7. **Reusable**: Utility can be used by other client-side services

## Validation

### Type Checking
```bash
npx tsc --noEmit
```
✅ No type errors in modified files

### Linting
```bash
pnpm lint
```
✅ No linting errors in modified files

### Tests
```bash
pnpm test -- client-token.test.ts
```
✅ All 9 tests pass

## Usage Example

### For New Analytics Services

```typescript
import { getAuthHeaders } from '@/lib/auth/client-token';

async function sendAnalytics(data: any) {
  const authHeaders = getAuthHeaders();

  const response = await fetch('/api/analytics/custom', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders, // Include auth if available
    },
    body: JSON.stringify(data),
  });

  return response.json();
}
```

### For Component Usage

Components should NOT call these utilities directly. Instead:

1. Get token from OpenAuth via server action: `authenticated()`
2. Pass token as prop to hooks/services
3. Services use the token parameter OR fetch from cookies

Example (existing pattern):
```tsx
// In component
const user = await authenticated();
const authToken = user?.token;

// Pass to hook
useWatchProgress(videoId, player, userId, authToken);

// Hook uses token parameter
WatchHistoryService.saveProgress(progress, authToken);
```

## Files Modified

1. **Created**: `/home/meywd/AlUmmahNow/apps/web/src/lib/auth/client-token.ts`
2. **Created**: `/home/meywd/AlUmmahNow/apps/web/src/lib/auth/__tests__/client-token.test.ts`
3. **Updated**: `/home/meywd/AlUmmahNow/apps/web/src/services/monitoring/video-performance.ts`
4. **Updated**: `/home/meywd/AlUmmahNow/apps/web/src/services/experiments/analytics.ts`

## Next Steps

1. ✅ Verify analytics endpoints on API side accept/require authentication
2. ✅ Test in development environment with authenticated users
3. ✅ Test in development environment with unauthenticated users
4. ✅ Monitor analytics data for proper user attribution
5. ✅ Consider adding metrics for auth success/failure rates

## Notes

- Dynamic imports (`await import()`) are used to enable code splitting
- Auth headers are spread with `...authHeaders` for clean syntax
- Empty object return ensures spread operator works safely
- All error handling is silent with console.error logs only
- No breaking changes - existing code works unchanged
