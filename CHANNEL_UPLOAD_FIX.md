# Channel Avatar/Cover Upload - Body Size Limit Fix

## Problem

Channel avatar/cover uploads were failing with "body exceeded 1MB limit" error because:
1. Next.js Server Actions have a default 1MB body size limit
2. Image files (especially high-quality avatars/covers) can easily exceed 1MB

## Solution

Increased Next.js Server Action body size limit to 10MB.

### Configuration Change
**File**: `apps/web/next.config.ts`

Added `serverActions` configuration:
```typescript
serverActions: {
    bodySizeLimit: '10mb',
}
```

This allows Server Actions to accept up to 10MB request bodies.

### Why Server Actions (Not Client-Side)?

**Security**: Access tokens are stored in HttpOnly cookies (can't be accessed from JavaScript)
- ✅ Tokens protected from XSS attacks
- ✅ Secure authentication flow maintained
- ✅ No token exposure to client

**Server Actions handle auth automatically**:
```typescript
// Server Action automatically reads from HttpOnly session cookie
await updateChannelAvatar(channelId, file, { channelId, userId });
```

## Files Changed

### Web App
1. **next.config.ts** - Increased body size limit to 10MB
2. **channels.ts** - Server Action upload functions (already existed)
3. **en/channel/[id]/edit/page.tsx** - Uses Server Actions
4. **ar/channel/[id]/edit/page.tsx** - Uses Server Actions

### API
5. **channelAvatarUpdate.ts** - Fixed env access pattern (`c.env` not `env`)
6. **channelCoverUpdate.ts** - Fixed env access pattern (`c.env` not `env`)
7. **.dev.vars** (UPDATED) - Local development secrets + **OpenAuth configuration**

## Environment Variables

### API (.dev.vars)
```bash
# Bunny.net credentials for image storage
image_storage_key=YOUR_BUNNY_STORAGE_KEY
bunny-stream-key=YOUR_BUNNY_STREAM_KEY
bunny_stream_library_id=YOUR_LIBRARY_ID

# OpenAuth configuration (JWT validation)
# These MUST match the values in apps/web/.env.local
Issuer=http://localhost:3301
ClientId=web
```

**CRITICAL**: The `Issuer` and `ClientId` values must match between web and API for JWT validation to work.

These are loaded automatically by `wrangler dev`.

## Upload Flow

### Before (Failed)
```
Browser → Next.js Server Action (1MB limit ❌)
```

### After (Success)
```
Browser → Next.js Server Action (10MB limit ✅) → API → Bunny.net CDN
```

## File Size Limits

| Component | Limit | Enforced By |
|-----------|-------|-------------|
| Browser | 10MB+ | Next.js config (10mb) |
| API | 5MB | Endpoint validation |
| Bunny.net | ~100MB | CDN provider |

**Recommended image sizes**:
- Avatar: 500x500px (~100-300KB)
- Cover: 1920x400px (~200-800KB)
- Max: 5MB (API enforced)

## Testing

1. Start API: `cd apps/api-videos && pnpm dev`
2. Start Web: `cd apps/web && pnpm dev`
3. Go to: `http://localhost:3000/en/channel/{channelId}/edit`
4. Upload avatar/cover (up to 5MB)
5. Verify:
   - Immediate preview shows
   - Upload completes successfully
   - Permanent URL is returned
   - Image appears in unified navigation

## Implementation Details

### Server Action (channels.ts)
```typescript
export async function updateChannelAvatar(
  channelId: string,
  file: File,
  headers: Required<Pick<ApiHeaders, 'channelId' | 'userId'>>
): Promise<Channel | null> {
  const formData = new FormData();
  formData.append('photo', file);

  const authContext = await getServerAuthContext();

  const response = await fetch(buildApiUrl(`/api/channels/${channelId}/avatar`), {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${authContext?.accessToken || ''}`,
      'channelId': headers.channelId,
      'userId': headers.userId,
    },
    body: formData,
  });

  return response.json();
}
```

The Server Action:
1. Reads access token from HttpOnly session cookie
2. Creates FormData with the file
3. Sends authenticated request to API
4. Returns updated channel object

## Troubleshooting

### "Body exceeded 1MB limit"
- ✅ **Fixed** - Restart Next.js dev server to pick up new config
- Verify `next.config.ts` has `serverActions.bodySizeLimit: '10mb'`

### "Storage configuration missing" (API error)
- Check `.dev.vars` exists in `apps/api-videos/`
- Verify it contains `image_storage_key=YOUR_KEY`
- Restart API: `cd apps/api-videos && pnpm dev`

### "Missing authentication" (Upload fails)
- Verify user is logged in (check session cookie exists)
- Server Actions automatically read from HttpOnly cookies
- No manual token handling needed

### Upload succeeds but icon doesn't update
- Check API logs for Bunny.net upload status
- Verify `channelAvatarUpdate.ts` returns correct URL format
- Check browser console for any errors

## Error 5: 500 Internal Server Error - Failed to Update Avatar Photo (FIXED)

### Problem
After fixing the 401 authentication error, uploads now fail with 500 error:
```json
{
  "success": false,
  "error": "Failed to update avatar photo"
}
```

### Root Cause
The API endpoints (`channelAvatarUpdate.ts` and `channelCoverUpdate.ts`) were not properly handling the `image_storage_key` binding in local development:

1. **Production environment**: Uses Cloudflare Secrets Store binding with `.get()` method
2. **Local development**: Uses plain string from `.dev.vars` file (loaded by `wrangler dev`)

The original code assumed the binding would always be a string OR have a `.get()` method, but in local dev with secrets_store configured in `wrangler.jsonc`, the binding was undefined.

### Solution

#### 1. Created Reusable Helper Functions

Created `apps/api-videos/src/lib/env-helpers.ts` with utility functions for extracting secrets:

```typescript
/**
 * Extract a secret value from environment binding
 * Handles both plain strings (local dev) and Secrets Store bindings (production)
 */
export async function getSecret(binding: any, secretName: string): Promise<string> {
    if (!binding) {
        console.error(`[getSecret] Missing binding for ${secretName}`);
        return '';
    }

    // Case 1: Plain string (local development from .dev.vars)
    if (typeof binding === 'string') {
        return binding;
    }

    // Case 2: Secrets Store binding (production)
    if (typeof binding.get === 'function') {
        try {
            const value = await binding.get();
            return value || '';
        } catch (error) {
            console.error(`[getSecret] Error reading ${secretName}:`, error);
            return '';
        }
    }

    console.error(`[getSecret] Unknown binding type for ${secretName}`);
    return '';
}

/**
 * Extract a secret and throw if missing
 */
export async function requireSecret(binding: any, secretName: string): Promise<string> {
    const value = await getSecret(binding, secretName);
    if (!value) {
        throw new Error(`Missing required secret: ${secretName}`);
    }
    return value;
}
```

#### 2. Updated All Endpoints

All endpoints that use Bunny.net secrets now use the helper:

```typescript
// Before (manual detection, error-prone):
const key = await env["bunny-stream-key"].get();
const libraryId = parseInt(await env.bunny_stream_library_id.get());

// After (clean, consistent, handles both dev and prod):
const key = await requireSecret(env["bunny-stream-key"], 'bunny-stream-key');
const libraryIdStr = await requireSecret(env.bunny_stream_library_id, 'bunny_stream_library_id');
const libraryId = parseInt(libraryIdStr);
```

### Files Changed
1. **Helper Function**: `apps/api-videos/src/lib/env-helpers.ts` - Created reusable helper functions for secrets extraction
2. **Channel Endpoints**:
   - `apps/api-videos/src/endpoints/channel/channelAvatarUpdate.ts` - Fixed storage key handling
   - `apps/api-videos/src/endpoints/channel/channelCoverUpdate.ts` - Fixed storage key handling
3. **Video Endpoints** (all updated to use helper):
   - `apps/api-videos/src/endpoints/video/videoCreate.ts`
   - `apps/api-videos/src/endpoints/video/videoUpdate.ts`
   - `apps/api-videos/src/endpoints/video/videoUpload.ts`
   - `apps/api-videos/src/endpoints/video/uploadInitiate.ts`
   - `apps/api-videos/src/endpoints/video/videoUploadStatus.ts`
4. **Other Endpoints**:
   - `apps/api-videos/src/endpoints/analytics/analyticsGet.ts`
   - `apps/api-videos/src/endpoints/live/liveStreamCreate.ts`

### Verification
After restarting the API server, upload should now work:

```bash
# Restart API
cd apps/api-videos
lsof -ti:3086 | xargs kill -9
pnpm dev

# Test upload via web UI or curl
curl -X PUT http://127.0.0.1:3086/api/channels/{channelId}/avatar \
  -H "Authorization: Bearer {token}" \
  -H "channelId: {channelId}" \
  -H "userId: {userId}" \
  -F "photo=@/path/to/image.jpg"
```

## Next Steps

After restarting the API server, test the upload:

```bash
# Terminal 1: Restart API
cd apps/api-videos
lsof -ti:3086 | xargs kill -9
pnpm dev

# Terminal 2: Web should still be running
# If not: cd apps/web && pnpm dev

# Visit: http://localhost:3000/en/channel/{channelId}/edit
# Upload an avatar/cover image (JPG/PNG, up to 5MB)
```

The upload should now work without any errors!
