# API Error Handling

This document explains the comprehensive error handling system implemented in the Al Ummah Now Videos API.

## Overview

The API now includes a global error handler that provides:
- **Detailed debug information in development** - Full stack traces, error details, and context
- **Safe, minimal errors in production** - Generic error messages without exposing internals
- **Automatic environment detection** - Based on URL (localhost) or environment variables
- **Consistent error response format** - All errors follow the same structure

## Error Response Format

### Development Mode
In development (localhost, `NODE_ENV=development`, or `ENVIRONMENT=dev/preview`), errors include detailed debugging information:

```json
{
  "success": false,
  "error": "Error message",
  "debug": {
    "message": "Detailed error message",
    "name": "ErrorType",
    "stack": [
      "Error: message",
      "at function (file.js:line:column)",
      "..."
    ],
    "customField1": "any custom data",
    "customField2": { "nested": "object" },
    "timestamp": "2025-11-19T22:46:25.442Z",
    "environment": "development"
  }
}
```

### Production Mode
In production, errors return minimal safe information:

```json
{
  "success": false,
  "error": "Generic error message"
}
```

## HTTP Status Codes

The error handler automatically determines the appropriate HTTP status code based on the error type:

| Error Type/Name | Status Code | Description |
|----------------|-------------|-------------|
| `ValidationError`, `ZodError` | 400 | Bad request - invalid input |
| `UnauthorizedError` | 401 | Missing or invalid authentication |
| `ForbiddenError` | 403 | Insufficient permissions |
| `NotFoundError` | 404 | Resource not found |
| `ConflictError` | 409 | Resource already exists |
| Custom `error.status` | Variable | Explicit status code on error object |
| All others | 500 | Internal server error |

## Setting Custom Status Codes

You can set custom HTTP status codes by adding a `status` or `statusCode` property to your error:

```typescript
const error = new Error("Resource not found");
error.name = "NotFoundError";
(error as any).status = 404;  // Will return 404 status code
throw error;
```

## Adding Custom Error Context

You can add any custom properties to errors for debugging:

```typescript
const error = new Error("Failed to process video");
(error as any).videoId = videoId;
(error as any).userId = userId;
(error as any).attemptCount = 3;
throw error;
```

These custom properties will be included in the `debug` object in development mode.

## Implementation

### 1. Global Error Handler

The error handler is registered in `src/index.ts`:

```typescript
import { errorHandler } from "./middleware/error-handler";

const app = new Hono();
app.onError(errorHandler);
```

This catches ALL unhandled errors in the application.

### 2. Environment Detection

The system automatically detects the environment:

```typescript
function isDevelopmentMode(c: Context): boolean {
  // Check 1: URL-based detection (localhost)
  if (url.includes('localhost') || url.includes('127.0.0.1')) {
    return true;
  }

  // Check 2: NODE_ENV environment variable
  if (c.env?.NODE_ENV === 'development' || c.env?.NODE_ENV === 'dev') {
    return true;
  }

  // Check 3: ENVIRONMENT variable
  if (c.env?.ENVIRONMENT === 'development' ||
      c.env?.ENVIRONMENT === 'dev' ||
      c.env?.ENVIRONMENT === 'preview') {
    return true;
  }

  // Default to production (safe mode)
  return false;
}
```

### 3. Try-Catch in Endpoints

Critical endpoints have try-catch blocks to add context before errors bubble up:

```typescript
async handle(c) {
  try {
    // ... endpoint logic
    return result;
  } catch (error) {
    // Add context to error
    const enrichedError = error instanceof Error ? error : new Error(String(error));
    enrichedError.message = `[EndpointName] ${enrichedError.message}`;
    (enrichedError as any).resourceId = id;
    throw enrichedError;  // Re-throw for global handler
  }
}
```

## Testing

### Test Error Endpoint

A dedicated test endpoint is available at `/test-error` for development:

```bash
# Test generic error
curl "http://127.0.0.1:3086/test-error?type=generic"

# Test validation error (400)
curl "http://127.0.0.1:3086/test-error?type=validation"

# Test not found error (404)
curl "http://127.0.0.1:3086/test-error?type=notfound"

# Test unauthorized error (401)
curl "http://127.0.0.1:3086/test-error?type=unauthorized"

# Test custom error with extra fields
curl "http://127.0.0.1:3086/test-error?type=custom&message=Custom%20error"

# Test nested errors
curl "http://127.0.0.1:3086/test-error?type=nested"
```

### Example Test Responses

**Generic Error (Development):**
```json
{
  "success": false,
  "error": "Test generic error",
  "debug": {
    "message": "Test generic error",
    "name": "Error",
    "stack": ["..."],
    "timestamp": "2025-11-19T22:46:25.442Z",
    "environment": "development"
  }
}
```

**Validation Error with Details:**
```json
{
  "success": false,
  "error": "Test validation error",
  "debug": {
    "message": "Test validation error",
    "name": "ValidationError",
    "stack": ["..."],
    "details": {
      "field": "testField",
      "value": "invalidValue",
      "constraint": "Must be a valid UUID"
    },
    "timestamp": "2025-11-19T22:46:30.436Z",
    "environment": "development"
  }
}
```

**Not Found Error (404):**
```json
{
  "success": false,
  "error": "Test notfound error",
  "debug": {
    "message": "Test notfound error",
    "name": "NotFoundError",
    "stack": ["..."],
    "status": 404,
    "resourceId": "test-resource-id-123",
    "timestamp": "2025-11-19T22:46:35.303Z",
    "environment": "development"
  }
}
```

## Best Practices

### 1. Use Descriptive Error Messages
```typescript
// ❌ Bad
throw new Error("Error");

// ✅ Good
throw new Error("Failed to fetch channel: Invalid channel ID format");
```

### 2. Add Context to Errors
```typescript
// ❌ Bad
throw new Error("Not found");

// ✅ Good
const error = new Error("Channel not found");
(error as any).channelId = channelId;
(error as any).requestedBy = userId;
throw error;
```

### 3. Use Appropriate Error Types
```typescript
// ❌ Generic error
throw new Error("Invalid input");

// ✅ Validation error with proper type
const error = new Error("Invalid channel name");
error.name = "ValidationError";
(error as any).field = "name";
(error as any).value = providedName;
throw error;
```

### 4. Re-throw with Context
```typescript
async handle(c) {
  try {
    await repository.getObject(id);
  } catch (error) {
    // Add context before re-throwing
    const enrichedError = error instanceof Error ? error : new Error(String(error));
    enrichedError.message = `[ChannelFetch] ${enrichedError.message}`;
    (enrichedError as any).channelId = id;
    throw enrichedError;
  }
}
```

### 5. Use Nested Errors for Chaining
```typescript
try {
  await processVideo();
} catch (originalError) {
  const error = new Error("Failed to process video upload");
  (error as any).cause = originalError;  // Chain errors
  (error as any).videoId = videoId;
  throw error;
}
```

## Files Modified

### New Files
- `src/middleware/error-handler.ts` - Global error handler middleware
- `src/endpoints/monitoring/test-error.ts` - Test endpoint for error handling

### Modified Files
- `src/index.ts` - Registered error handler
- `src/endpoints/channel/channelFetch.ts` - Added try-catch with context
- `src/endpoints/profile/profileFetch.ts` - Added try-catch with context

## Future Improvements

1. **Error reporting service** - Send errors to external monitoring (Sentry, etc.)
2. **Error rate limiting** - Prevent error spam from bad requests
3. **Structured logging** - Enhanced logging with error correlation IDs
4. **Custom error classes** - Create typed error classes for common scenarios
5. **Error recovery** - Automatic retry logic for transient errors

## Migration Guide

### For Existing Endpoints

If you have existing endpoints without try-catch blocks, you can optionally add them for better debugging:

```typescript
// Before
async handle(c) {
  const data = await repository.getObject(id);
  return transformToView(data);
}

// After
async handle(c) {
  try {
    const data = await repository.getObject(id);
    return transformToView(data);
  } catch (error) {
    const enrichedError = error instanceof Error ? error : new Error(String(error));
    enrichedError.message = `[MyEndpoint] ${enrichedError.message}`;
    (enrichedError as any).resourceId = id;
    throw enrichedError;
  }
}
```

**Note:** The global error handler will catch errors even without try-catch blocks in endpoints. Try-catch blocks are optional and only add extra context for debugging.

## Logging

All errors are automatically logged by the error handler:

```typescript
logger.error(`[ERROR HANDLER] ${err.name}: ${err.message}`, {
  error: getErrorDetails(err),
  statusCode,
  method: c.req.method,
  path: c.req.path,
  isDevelopment: isDev,
});
```

Check the API logs for detailed error information even in production mode.
