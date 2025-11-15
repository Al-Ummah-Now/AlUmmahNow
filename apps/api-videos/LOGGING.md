# Systematic API Logging

## Overview

All API requests and responses are logged systematically using a centralized logging middleware. This ensures consistent, comprehensive logging across all endpoints.

## Implementation

### Logging Middleware

Location: `src/middleware/logging.ts`

Registered globally in `src/index.ts`:
```typescript
app.use('*', loggingMiddleware);
```

This middleware intercepts **ALL** requests and responses, including:
- Regular Hono routes
- OpenAPI (chanfana) routes
- Authentication routes
- Error responses

## What Gets Logged

### Request Information
- ✅ Request ID (unique identifier for tracking)
- ✅ Timestamp (ISO 8601 format)
- ✅ HTTP Method (GET, POST, PUT, DELETE, etc.)
- ✅ URL Path
- ✅ Query Parameters
- ✅ User ID (from JWT or header)
- ✅ Request Headers (sanitized - tokens redacted)
- ✅ Authentication Context (userId, email, subject)
- ✅ Request Body (for POST/PUT/PATCH requests)

### Response Information
- ✅ Request ID (matches request for correlation)
- ✅ HTTP Status Code
- ✅ Execution Duration (in milliseconds)
- ✅ Response Body (for errors and mutations)
- ✅ Success/Error Indicators

### Security Features
- 🔒 Authorization headers sanitized (only first 20 chars shown)
- 🔒 Passwords and sensitive data redacted
- 🔒 Full tokens never logged

## Log Format

### Request Log Example
```
========================================
[API REQUEST] ========== START ==========
[API REQUEST] Request ID: 1731645123456-abc123
[API REQUEST] Timestamp: 2025-11-15T03:45:23.456Z
[API REQUEST] Method: POST
[API REQUEST] Path: /api/profiles
[API REQUEST] User ID: 9cc57a53c997b0308ed31596d9b5ea3a
[API REQUEST] Headers: {
  "content-type": "application/json",
  "authorization": "Bearer eyJhbGciOiJSUzI1NiIs...",
  "userId": "9cc57a53c997b0308ed31596d9b5ea3a"
}
[API REQUEST] Auth Context: {
  "userId": "9cc57a53c997b0308ed31596d9b5ea3a",
  "email": "user@example.com",
  "subject": "user:9cc57a53c997b0308ed31596d9b5ea3a"
}
[API REQUEST] Body: {
  "firstName": "John",
  "lastName": "Doe",
  "email": "user@example.com",
  "avatarUrl": "/avatar.png"
}
[API REQUEST] ========== PROCESSING ==========
```

### Response Log Example
```
[API RESPONSE] ========== END ==========
[API RESPONSE] Request ID: 1731645123456-abc123
[API RESPONSE] Status: 200
[API RESPONSE] Duration: 282ms
[API RESPONSE] Body: {
  "success": true,
  "result": {
    "profile": {
      "id": "9cc57a53c997b0308ed31596d9b5ea3a",
      "firstName": "John",
      "lastName": "Doe",
      "email": "user@example.com"
    }
  }
}
[API RESPONSE] ✅ Success
========================================
```

### Error Log Example
```
[API RESPONSE] ========== END ==========
[API RESPONSE] Request ID: 1731645123456-abc123
[API RESPONSE] Status: 404
[API RESPONSE] Duration: 127ms
[API RESPONSE] Body: {
  "success": false,
  "error": "Profile not found"
}
[API RESPONSE] ⚠️  Client Error
========================================
```

## Status Indicators

- ✅ **Success** - HTTP 2xx status codes
- ⚠️  **Client Error** - HTTP 4xx status codes
- ❌ **Server Error** - HTTP 5xx status codes

## Request Tracking

Each request is assigned a unique ID in the format:
```
{timestamp}-{random}
```

Example: `1731645123456-abc123`

This ID appears in both request and response logs, making it easy to trace the complete lifecycle of a request.

## Filtering Logs

### View only profile-related logs:
```bash
pnpm dev | grep "\[API.*profile"
```

### View only errors:
```bash
pnpm dev | grep "❌\|⚠️"
```

### View specific request by ID:
```bash
pnpm dev | grep "1731645123456-abc123"
```

### View all requests for a user:
```bash
pnpm dev | grep "User ID: 9cc57a53c997b0308ed31596d9b5ea3a"
```

## Performance Monitoring

The `Duration` field in response logs shows execution time:
```
[API RESPONSE] Duration: 282ms
```

Use this to identify slow endpoints:
```bash
pnpm dev | grep "Duration:" | sort -t: -k2 -n
```

## Debugging Workflow

1. **Reproduce the issue** - Perform the action that causes the problem
2. **Find the request** - Look for the request log in your terminal
3. **Check request data** - Verify the request body, headers, and auth context
4. **Check response** - Look at the status code, duration, and response body
5. **Track by ID** - Use the Request ID to find all related logs

## Comparison with Frontend Logging

The API logging format **matches** the frontend logging format for consistency:

**Frontend logs** (Next.js):
```
[getProfileCurrent] ========== START ==========
[getProfileCurrent] Step 1: Getting authenticated session...
[getProfileCurrent] ✅ Authenticated session: {...}
[getProfileCurrent] ========== END ==========
```

**API logs** (Hono):
```
[API REQUEST] ========== START ==========
[API REQUEST] Method: GET
[API REQUEST] Path: /api/profiles/...
[API RESPONSE] ========== END ==========
```

Both use:
- Start/end markers
- Step-by-step progression
- Visual indicators (✅, ❌, ⚠️)
- Structured JSON output
- Timestamps and IDs

## Customization

To modify logging behavior, edit `src/middleware/logging.ts`:

- **Add more fields**: Extend the log messages
- **Change format**: Modify the console.log calls
- **Filter sensitive data**: Update `sanitizeHeaders()`
- **Exclude endpoints**: Add conditionals to skip certain paths

## Best Practices

1. ✅ **Always check logs** when debugging API issues
2. ✅ **Use Request ID** to track request lifecycle
3. ✅ **Monitor Duration** for performance issues
4. ✅ **Check Auth Context** for permission problems
5. ✅ **Verify request body** matches expectations
6. ⚠️  **Never log full tokens** in production
7. ⚠️  **Redact passwords** and sensitive PII

## Future Enhancements

Potential improvements:
- [ ] Log aggregation (send to logging service)
- [ ] Structured logging (JSON format)
- [ ] Log levels (DEBUG, INFO, WARN, ERROR)
- [ ] Performance tracing (distributed tracing)
- [ ] Log rotation and archival
- [ ] Metrics collection (Prometheus/Grafana)
