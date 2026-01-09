# Channel Upload 401 Error - Root Cause and Fix

## Problem Summary

Channel avatar/cover uploads were failing with **401 Unauthorized** error:
```
{
  "success": false,
  "error": "Invalid or expired authentication token"
}
```

## Root Cause Analysis

### Investigation via Log Service

Logs from `/home/meywd/AlUmmahNow/logs/web.log` showed:

```json
{
  "hasToken": true,
  "tokenLength": 530,
  "userId": "9cc57a53c997b0308ed31596d9b5ea3a",
  "channelId": "e6367c19-a759-423e-be12-b52b098bce38",
  "hasAuth": true
}
```

**Key Findings:**
- ✅ Token **IS** being retrieved from session
- ✅ Authorization header **IS** being sent
- ✅ User/Channel IDs are present
- ❌ API **rejects** the token as "invalid or expired"

### Root Cause

The API's `apps/api-videos/.dev.vars` file was **missing OpenAuth configuration**:
- `Issuer` - JWT issuer URL
- `ClientId` - OAuth client ID
- `Audience` - JWT audience

Without these values, the API's JWT validation (`VERIFY_JWT_SIGNATURE: true`) fails because:
1. It cannot verify the token signature
2. It cannot validate the issuer matches
3. It cannot validate the audience matches

## Solution

### 1. Add OpenAuth Configuration to API

Update `apps/api-videos/.dev.vars`:

```bash
# OpenAuth configuration (JWT validation)
# These MUST match the values in apps/web/.env.local
Issuer=http://localhost:3301
ClientId=web
```

### 2. Restart API Server

```bash
cd apps/api-videos
# Kill existing process
lsof -ti:3086 | xargs kill -9
# Start fresh
pnpm dev
```

The API will now:
- Load OpenAuth config from `.dev.vars`
- Validate JWT signatures using OpenAuth client
- Match issuer/audience against configured values
- Accept valid tokens from web app

## Verification

After restarting the API, upload a channel avatar/cover. Check logs:

```bash
tail -20 /home/meywd/AlUmmahNow/logs/web.log
```

You should see:
```
[INFO] [updateChannelCover] Response {"status":200,"statusText":"OK","ok":true}
```

Instead of:
```
[INFO] [updateChannelCover] Response {"status":401,"statusText":"Unauthorized","ok":false}
```

## Configuration Sync

**CRITICAL**: These values must match between web and API:

| Variable | Web (.env.local) | API (.dev.vars) |
|----------|------------------|-----------------|
| Issuer | `Issuer=http://localhost:3301` | `Issuer=http://localhost:3301` |
| ClientId | `ClientId=web` | `ClientId=web` |

If these don't match, JWT validation will fail with 401.

## Technical Details

### JWT Validation Flow

1. **Web App**:
   - User logs in → receives JWT from OpenAuth (`http://localhost:3301`)
   - JWT stored in HttpOnly cookie
   - Server Action reads JWT from cookie
   - Sends `Authorization: Bearer <jwt>` to API

2. **API**:
   - Receives request with JWT
   - Extracts token from `Authorization` header
   - Calls `validateJWTWithSignature()` (since `VERIFY_JWT_SIGNATURE: true`)
   - Uses OpenAuth client with configured `Issuer`, `ClientId`, `Audience`
   - Verifies signature and claims
   - Returns 401 if validation fails

### Why It Failed Before

```typescript
// API tried to validate JWT but had no config
const authConfig = getAuthConfig(env);
// env.Issuer = undefined
// env.ClientId = undefined
// env.Audience = undefined

// OpenAuth client initialization failed or returned invalid config
// JWT validation failed → 401 Unauthorized
```

### Why It Works Now

```typescript
// API loads config from .dev.vars
const authConfig = getAuthConfig(env);
// env.Issuer = "http://localhost:3301" ✅
// env.ClientId = "web" ✅
// env.Audience = "web" ✅

// OpenAuth client validates JWT successfully
// Returns user payload → Request proceeds
```

## Related Files

- `apps/api-videos/.dev.vars` - API environment variables (local dev)
- `apps/api-videos/src/middleware/auth-config.ts` - Auth configuration
- `apps/api-videos/src/middleware/auth.ts` - JWT validation middleware
- `apps/web/.env.local` - Web app environment variables
- `apps/web/src/lib/api/channels.ts` - Upload functions with logging
- `/home/meywd/AlUmmahNow/logs/web.log` - Server-side logs
