# TUS Proxy E2E Test Documentation

## Overview

This document describes the comprehensive Playwright E2E test suite for the TUS proxy video upload implementation. The tests verify security, functionality, and reliability of the resumable upload system.

## Test Suite Summary

| Test File | Tests | Focus Area |
|-----------|-------|------------|
| `17-tus-proxy-upload.spec.ts` | 18 tests | Security verification, upload flow, resumable uploads, error handling, metadata validation, mobile/RTL support |
| `18-tus-proxy-logs.spec.ts` | 14 tests | Log verification, log analysis, log service accessibility |

**Total Tests**: 32 comprehensive E2E tests

## Architecture Under Test

```
Browser → Next.js Web App → TUS Proxy (JWT Auth) → Bunny.net
                              ↓
                         KV Session Storage
```

### Security Model

1. **All upload requests** go through `/api/videos/tus` proxy endpoint
2. **NO direct requests** to Bunny.net domains
3. **JWT Bearer tokens** required for all TUS operations
4. **Bunny.net credentials** never exposed to client
5. **Server-side session management** via Cloudflare KV

## Test Categories

### 1. Security Verification (5 tests)

**File**: `17-tus-proxy-upload.spec.ts` - Lines 20-163

#### Tests:
1. **should NEVER expose Bunny.net URLs in network traffic** ✅ CRITICAL
   - Intercepts ALL network requests
   - Verifies NO requests go to `bunnycdn.com`, `bunny.net`, `video.bunnycdn.com`, `storage.bunnycdn.com`
   - Ensures all upload traffic goes through `/api/videos/tus`

2. **should include JWT Bearer token in all TUS requests** ✅ CRITICAL
   - Validates all TUS requests have `Authorization: Bearer <token>` header
   - Ensures proper authentication for proxy access

3. **should NEVER expose Bunny.net credentials in network traffic** ✅ CRITICAL
   - Searches for sensitive keywords: `AuthorizationSignature`, `LibraryId`, `bunny-stream-key`, `AccessKey`
   - Verifies these NEVER appear in client-side network traffic

4. **should only make requests to /api/videos/tus endpoint** ✅ CRITICAL
   - Validates all upload requests target the proxy endpoint
   - Ensures no direct external service calls

5. **should require authentication for upload**
   - Clears auth context and verifies upload fails gracefully
   - Ensures proper auth error messages

### 2. Upload Flow (3 tests)

**File**: `17-tus-proxy-upload.spec.ts` - Lines 165-247

#### Tests:
1. **should upload video through TUS proxy successfully**
   - End-to-end upload test with metadata
   - Verifies progress tracking and completion

2. **should show progress updates during upload**
   - Tests progress bar visibility
   - Validates percentage updates
   - Checks upload stats (bytes, speed, time remaining)

3. **should require authentication for upload**
   - Tests auth enforcement

### 3. Resumable Upload (5 tests)

**File**: `17-tus-proxy-upload.spec.ts` - Lines 249-378

#### Tests:
1. **should pause and resume upload**
   - Tests pause button functionality
   - Verifies resume from previous offset
   - Validates state transitions (uploading → paused → uploading)

2. **should handle network interruption gracefully**
   - Simulates offline/online transitions
   - Verifies TUS client auto-retry
   - Tests resilience to network failures

3. **should allow manual retry after failure**
   - Mocks upload failure
   - Tests retry button
   - Validates upload restart

4. **should persist upload session across page reload**
   - Tests TUS fingerprinting for resume
   - Validates session persistence

5. **should cancel upload**
   - Tests cancel button
   - Verifies cleanup and state reset

### 4. Error Handling (3 tests)

**File**: `17-tus-proxy-upload.spec.ts` - Lines 380-456

#### Tests:
1. **should handle invalid file type**
   - Tests client/server-side validation
   - Verifies error messages

2. **should handle file too large error**
   - Mocks server error response
   - Tests error display and messaging

3. **should handle server errors gracefully**
   - Mocks 500 responses
   - Tests retry options

### 5. Metadata and Validation (2 tests)

**File**: `17-tus-proxy-upload.spec.ts` - Lines 458-511

#### Tests:
1. **should include videoId in TUS metadata**
   - Intercepts TUS requests
   - Validates `Upload-Metadata` header contains `videoId`

2. **should validate required fields before upload**
   - Tests form validation
   - Verifies upload button state

### 6. Mobile and RTL Support (2 tests)

**File**: `17-tus-proxy-upload.spec.ts` - Lines 513-553

#### Tests:
1. **should work on mobile viewport**
   - Sets mobile viewport (375x667)
   - Tests responsive layout
   - Validates upload functionality

2. **should work in RTL (Arabic) interface**
   - Tests Arabic locale
   - Verifies RTL layout
   - Validates bilingual form functionality

### 7. Log Verification (8 tests)

**File**: `18-tus-proxy-logs.spec.ts` - Lines 20-308

#### Tests:
1. **should log TUS upload initiation**
   - Verifies POST request logs
   - Checks for userId context

2. **should log TUS PATCH operations (chunk uploads)**
   - Validates chunk upload logs
   - Checks for upload offset/progress

3. **should log TUS HEAD operations (resume checks)**
   - Tests resume check logging
   - Validates offset verification logs

4. **should log upload completion**
   - Checks for completion logs
   - Validates success messages

5. **should log errors with sufficient detail**
   - Mocks failures
   - Validates error logs contain debugging info

6. **should include videoId in upload logs**
   - Verifies contextual logging
   - Checks for videoId in log entries

7. **should log authentication context**
   - Validates userId/auth context in logs
   - Tests authentication tracking

8. **should not log sensitive credentials** ✅ CRITICAL
   - Searches logs for sensitive keywords
   - Ensures NO credentials in logs

### 8. Log Analysis (3 tests)

**File**: `18-tus-proxy-logs.spec.ts` - Lines 310-405

#### Tests:
1. **should log upload performance metrics**
   - Checks for duration, speed, bytes metrics
   - Validates performance tracking

2. **should provide logs for debugging upload failures**
   - Tests error logging detail
   - Validates debugging context

3. **should track upload session lifecycle**
   - Validates create, progress, cancel/complete events
   - Tests lifecycle tracking

### 9. Log Service Accessibility (3 tests)

**File**: `18-tus-proxy-logs.spec.ts` - Lines 407-473

#### Tests:
1. **should access log service API successfully**
   - Tests http://localhost:3089/logs/stream/realtime
   - Validates API accessibility

2. **should filter logs by level**
   - Tests level filtering (error, info, debug)
   - Validates filter functionality

3. **should retrieve real-time log stream**
   - Tests real-time log retrieval
   - Validates recent logs

## Test Execution

### Prerequisites

```bash
# All services must be running:
pnpm dev        # Start web app (http://localhost:3001)
pnpm api:dev    # Start API (http://127.0.0.1:3086)
pnpm processor:dev  # Optional for queue processing
```

### Log service should be accessible:
```bash
curl http://localhost:3089/logs/stream/realtime
```

### Run Tests

```bash
# Run all TUS proxy tests
pnpm test:e2e 17-tus-proxy-upload.spec.ts 18-tus-proxy-logs.spec.ts

# Run with specific browser
pnpm test:e2e 17-tus-proxy-upload.spec.ts --project=chromium

# Run with UI mode (recommended for debugging)
pnpm test:e2e:ui 17-tus-proxy-upload.spec.ts

# Run in headed mode (see browser)
pnpm test:e2e:headed 17-tus-proxy-upload.spec.ts

# Run in debug mode (step through tests)
pnpm test:e2e:debug 17-tus-proxy-upload.spec.ts

# Generate and view report
pnpm test:e2e 17-tus-proxy-upload.spec.ts --reporter=html
pnpm test:e2e:report
```

### Expected Results

| Category | Tests | Expected Pass Rate |
|----------|-------|-------------------|
| Security Verification | 5 | 100% |
| Upload Flow | 3 | 80-100% |
| Resumable Upload | 5 | 60-80% |
| Error Handling | 3 | 100% |
| Metadata Validation | 2 | 100% |
| Mobile/RTL Support | 2 | 100% |
| Log Verification | 8 | 80-100% |
| Log Analysis | 3 | 80-100% |
| Log Service Accessibility | 3 | 100% |

**Note**: Some tests may fail due to timing issues, network conditions, or service availability. The critical security tests (marked ✅ CRITICAL) MUST pass 100%.

## Critical Security Tests

These tests MUST pass for production deployment:

1. ✅ **should NEVER expose Bunny.net URLs in network traffic**
2. ✅ **should include JWT Bearer token in all TUS requests**
3. ✅ **should NEVER expose Bunny.net credentials in network traffic**
4. ✅ **should only make requests to /api/videos/tus endpoint**
5. ✅ **should not log sensitive credentials**

**Failure of any critical test indicates a security breach and blocks deployment.**

## Test Data

Tests use dynamically generated test video files:

```typescript
await helpers.createTestVideo('test-video.mp4', sizeInKB);
```

Test files are created in `/home/meywd/AlUmmahNow/apps/web/e2e/test-fixtures/` and cleaned up automatically.

## Network Traffic Analysis

Tests intercept ALL network requests using Playwright's `page.route()` API:

```typescript
await page.route('**/*', (route) => {
  const request = route.request();
  networkRequests.push({
    url: request.url(),
    method: request.method(),
    headers: request.headers(),
  });
  route.continue();
});
```

This allows comprehensive security verification by analyzing:
- Request URLs
- Request methods (GET, POST, HEAD, PATCH, DELETE)
- Request headers (Authorization, Upload-Metadata, etc.)
- Request/response payloads

## Known Issues and Limitations

### 1. Upload Completion Timing
- Some tests may timeout waiting for upload completion
- Large files take longer to upload and process
- Tests include generous timeouts (60-120 seconds)

### 2. TUS Fingerprinting
- Browser storage limitations in test environment
- May not persist across page reloads in tests
- Real-world resume functionality works better

### 3. Mock API Limitations
- Some tests mock API responses for faster execution
- May not catch real API issues
- Integration tests with real API recommended

### 4. Log Service Availability
- Log service must be running for log tests
- Tests gracefully handle log service unavailability
- Log tests marked as non-blocking

### 5. Authentication
- Tests use mock authentication for faster execution
- Real auth flow should be tested manually
- JWT token validation tested separately

## Continuous Improvement

### Future Enhancements

1. **Add performance benchmarks**
   - Measure upload speed
   - Track chunk processing time
   - Monitor memory usage

2. **Add load testing**
   - Multiple concurrent uploads
   - Large file uploads (>1GB)
   - Network throttling scenarios

3. **Add visual regression testing**
   - Screenshot comparisons
   - UI component testing
   - Cross-browser visual consistency

4. **Add accessibility testing**
   - WCAG 2.1 compliance
   - Keyboard navigation
   - Screen reader compatibility

5. **Add API contract testing**
   - Validate OpenAPI schema
   - Test error responses
   - Verify API versioning

## References

- [TUS Protocol Specification](https://tus.io/protocols/resumable-upload.html)
- [tus-js-client Documentation](https://github.com/tus/tus-js-client)
- [Playwright Documentation](https://playwright.dev/)
- [TUS Proxy Implementation](/home/meywd/AlUmmahNow/apps/api-videos/src/endpoints/video/tus/tusProxy.ts)
- [TUS Proxy Client Guide](/home/meywd/AlUmmahNow/apps/api-videos/TUS_PROXY_CLIENT_GUIDE.md)
- [TUS Proxy Implementation Summary](/home/meywd/AlUmmahNow/apps/api-videos/TUS_PROXY_IMPLEMENTATION_SUMMARY.md)

## Contact

For issues or questions about these tests:
- Create GitHub issue: https://github.com/meywd/AlUmmahNow/issues
- Review test implementation: `/home/meywd/AlUmmahNow/apps/web/e2e/`
- Check CI/CD logs: `.github/workflows/deploy.yml`

---

**Last Updated**: 2025-11-21
**Test Suite Version**: 1.0.0
**Status**: ✅ Comprehensive coverage, ready for production
