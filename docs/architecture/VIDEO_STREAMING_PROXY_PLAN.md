# Video Streaming Proxy Architecture Plan

## Problem Statement

Currently, the frontend (`apps/web`) directly references Bunny.net CDN URLs for video streaming:
```typescript
const videoSources = [{
  src: `https://vz-3f3e8ae1-5c9.b-cdn.net/${videoId}/playlist.m3u8`,
  type: 'application/x-mpegURL'
}];
```

**Issues:**
1. **CORS Errors**: Bunny.net blocks requests from `localhost:3000` due to missing `Access-Control-Allow-Origin` headers
2. **Tight Coupling**: Frontend is tightly coupled to Bunny.net infrastructure
3. **No Abstraction**: Cannot easily switch CDN providers without changing frontend code
4. **Security**: Bunny.net library IDs and zone names are exposed in frontend
5. **No Control**: Cannot implement custom auth, rate limiting, or analytics on video streams

## Goal

**Hide Bunny.net completely from the frontend** by proxying all video streaming through the `api-videos` backend.

## Proposed Architecture

```
┌─────────────────┐
│   Frontend      │
│   (apps/web)    │
└────────┬────────┘
         │ GET /api/videos/{id}/stream/playlist.m3u8
         │ GET /api/videos/{id}/stream/segment-{n}.ts
         │ GET /api/videos/{id}/thumbnail.jpg
         ▼
┌─────────────────┐
│  API Videos     │
│ (apps/api-videos)│
│                 │
│  Proxy Endpoints│
└────────┬────────┘
         │ Fetch from Bunny.net
         │ https://vz-3f3e8ae1-5c9.b-cdn.net/...
         ▼
┌─────────────────┐
│   Bunny.net CDN │
│  (vz-3f3e8ae1...)│
└─────────────────┘
```

## Implementation Plan

### Phase 1: API Proxy Endpoints (api-videos)

#### 1.1 Create Streaming Proxy Endpoint

**File:** `/home/meywd/AlUmmahNow/apps/api-videos/src/endpoints/video/stream-proxy.ts`

```typescript
import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { env } from 'cloudflare:workers';

export class VideoStreamProxy extends OpenAPIRoute {
  schema = {
    tags: ["Videos", "Streaming"],
    summary: "Proxy video stream from Bunny.net CDN",
    description: "Proxies HLS playlist and segments from Bunny.net, hiding CDN infrastructure from frontend",
    request: {
      params: z.object({
        videoId: z.string().describe("Video ID"),
        path: z.string().describe("Stream path (e.g., 'playlist.m3u8' or 'segment-1.ts')"),
      }),
    },
    responses: {
      "200": {
        description: "Video stream content",
        content: {
          "application/vnd.apple.mpegurl": {},
          "video/mp2t": {},
          "application/octet-stream": {},
        },
      },
      "404": { description: "Video or stream not found" },
      "500": { description: "Proxy error" },
    },
  };

  async handle(c) {
    const { videoId, path } = await this.getValidatedData<typeof this.schema>();

    try {
      // Get Bunny.net credentials from Cloudflare secrets
      const bunnyStreamLibraryId = await env["bunny_stream_library_id"].text();

      // Construct Bunny.net URL
      const bunnyUrl = `https://vz-${bunnyStreamLibraryId}.b-cdn.net/${videoId}/${path}`;

      // Fetch from Bunny.net with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

      const response = await fetch(bunnyUrl, {
        signal: controller.signal,
        headers: {
          'Accept': '*/*',
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        if (response.status === 404) {
          return c.notFound();
        }
        throw new Error(`Bunny.net returned ${response.status}`);
      }

      // Determine content type based on file extension
      let contentType = 'application/octet-stream';
      if (path.endsWith('.m3u8')) {
        contentType = 'application/vnd.apple.mpegurl';
      } else if (path.endsWith('.ts')) {
        contentType = 'video/mp2t';
      } else if (path.endsWith('.mp4')) {
        contentType = 'video/mp4';
      }

      // Return proxied response with CORS headers
      return new Response(response.body, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Access-Control-Allow-Origin': '*', // Allow all origins (can be restricted later)
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Range',
          'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
          'Accept-Ranges': 'bytes', // Support partial content requests
        },
      });
    } catch (error) {
      console.error('[VideoStreamProxy] Error:', error);
      return c.json({ error: 'Failed to proxy video stream' }, 500);
    }
  }
}
```

#### 1.2 Create Thumbnail Proxy Endpoint

**File:** `/home/meywd/AlUmmahNow/apps/api-videos/src/endpoints/video/thumbnail-proxy.ts`

```typescript
import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { env } from 'cloudflare:workers';

export class VideoThumbnailProxy extends OpenAPIRoute {
  schema = {
    tags: ["Videos", "Media"],
    summary: "Proxy video thumbnail from Bunny.net CDN",
    request: {
      params: z.object({
        videoId: z.string().describe("Video ID"),
      }),
    },
    responses: {
      "200": {
        description: "Video thumbnail image",
        content: {
          "image/jpeg": {},
        },
      },
      "404": { description: "Thumbnail not found" },
    },
  };

  async handle(c) {
    const { videoId } = await this.getValidatedData<typeof this.schema>();

    try {
      const bunnyStreamLibraryId = await env["bunny_stream_library_id"].text();
      const bunnyUrl = `https://vz-${bunnyStreamLibraryId}.b-cdn.net/${videoId}/thumbnail.jpg`;

      const response = await fetch(bunnyUrl);

      if (!response.ok) {
        return c.notFound();
      }

      return new Response(response.body, {
        headers: {
          'Content-Type': 'image/jpeg',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=86400', // Cache for 24 hours
        },
      });
    } catch (error) {
      console.error('[VideoThumbnailProxy] Error:', error);
      return c.json({ error: 'Failed to proxy thumbnail' }, 500);
    }
  }
}
```

#### 1.3 Register Routes in api-videos

**File:** `/home/meywd/AlUmmahNow/apps/api-videos/src/index.ts`

Add these routes:
```typescript
import { VideoStreamProxy } from "./endpoints/video/stream-proxy";
import { VideoThumbnailProxy } from "./endpoints/video/thumbnail-proxy";

// Video streaming endpoints (public - no auth required for playback)
openapi.get("/api/videos/:videoId/stream/:path", VideoStreamProxy);
openapi.get("/api/videos/:videoId/thumbnail.jpg", VideoThumbnailProxy);
```

### Phase 2: Update Frontend (apps/web)

#### 2.1 Update VideoPlayer Component

**File:** `/home/meywd/AlUmmahNow/apps/web/src/components/videoPlayer/index.tsx`

```typescript
// OLD (direct Bunny.net reference):
const videoSources = [{
  src: `https://vz-3f3e8ae1-5c9.b-cdn.net/${options.id}/playlist.m3u8`,
  type: 'application/x-mpegURL'
}];
const posterUrl = `https://vz-3f3e8ae1-5c9.b-cdn.net/${options.id}/thumbnail.jpg`;

// NEW (proxied through API):
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3086';
const videoSources = [{
  src: `${API_BASE_URL}/api/videos/${options.id}/stream/playlist.m3u8`,
  type: 'application/x-mpegURL'
}];
const posterUrl = `${API_BASE_URL}/api/videos/${options.id}/thumbnail.jpg`;
```

#### 2.2 Update RTL VideoPlayer

**File:** `/home/meywd/AlUmmahNow/apps/web/src/components/videoPlayer/rtl/index.tsx`

Apply the same changes as above.

#### 2.3 Add Environment Variable

**File:** `/home/meywd/AlUmmahNow/apps/web/.env.local`

```bash
# API Base URL for video streaming
NEXT_PUBLIC_API_URL=http://127.0.0.1:3086
```

**File:** `/home/meywd/AlUmmahNow/apps/web/.env.example`

```bash
# API Base URL for video streaming
# Development: http://127.0.0.1:3086
# Production: https://api.alummahnow.net
NEXT_PUBLIC_API_URL=https://api.alummahnow.net
```

### Phase 3: Testing

#### 3.1 Test Checklist

- [ ] HLS playlist loads through API proxy
- [ ] Video segments load through API proxy
- [ ] Thumbnail loads through API proxy
- [ ] CORS headers are present and correct
- [ ] Cache headers are set appropriately
- [ ] Video playback works smoothly
- [ ] Quality selector works (if applicable)
- [ ] Seeking works correctly
- [ ] Error handling works for missing videos
- [ ] Performance is acceptable (latency < 200ms)

#### 3.2 Test Commands

```bash
# 1. Start all dev servers
pnpm dev

# 2. Test playlist endpoint
curl -v "http://127.0.0.1:3086/api/videos/0a3a5049-0999-4ca4-9003-d507a13d39b4/stream/playlist.m3u8"

# 3. Test thumbnail endpoint
curl -v "http://127.0.0.1:3086/api/videos/0a3a5049-0999-4ca4-9003-d507a13d39b4/thumbnail.jpg" > /tmp/test-thumb.jpg

# 4. Open video page
# Navigate to: http://localhost:3000/en/video?vid=0a3a5049-0999-4ca4-9003-d507a13d39b4

# 5. Check browser console for errors
# Should see no CORS errors
# Should see requests to http://127.0.0.1:3086/api/videos/...
```

## Benefits

1. **✅ CORS Fixed**: API proxy adds proper CORS headers, no Bunny.net configuration needed
2. **✅ Abstraction**: Can switch CDN providers by only changing API proxy code
3. **✅ Security**: Bunny.net credentials and infrastructure hidden from frontend
4. **✅ Control**: Can add auth, rate limiting, analytics, and caching at proxy level
5. **✅ Flexibility**: Can serve from multiple sources (Bunny.net, R2, etc.) transparently
6. **✅ Monitoring**: Can track video streaming performance and errors centrally

## Performance Considerations

### Latency

**Concern**: Adding a proxy layer increases latency.

**Mitigation:**
1. Use Cloudflare Workers' edge network (requests are proxied at the edge, not centrally)
2. Set appropriate `Cache-Control` headers (1 hour for segments, 24 hours for thumbnails)
3. Use Cloudflare's cache (free caching at edge locations)
4. Consider enabling HLS.js client-side caching for segments

### Bandwidth

**Concern**: All video traffic goes through Workers, consuming more bandwidth.

**Mitigation:**
1. Cloudflare Workers on Free plan: 100,000 requests/day (sufficient for development)
2. Cloudflare Workers on Paid plan: Unlimited requests (production)
3. Bunny.net bandwidth is already paid for, proxy just routes traffic
4. Can implement request de-duplication at proxy level

## Migration Path

### Development (Immediate)
1. Implement proxy endpoints in `api-videos`
2. Update frontend to use `NEXT_PUBLIC_API_URL`
3. Test thoroughly with local development

### Staging
1. Deploy `api-videos` with proxy endpoints
2. Deploy `web` with updated URLs pointing to staging API
3. Run integration tests

### Production
1. Update `NEXT_PUBLIC_API_URL` to production API URL
2. Deploy both apps
3. Monitor performance and errors

## Future Enhancements

1. **Signed URLs**: Generate time-limited signed URLs for premium content
2. **Rate Limiting**: Throttle video requests per user/IP
3. **Analytics**: Track video streaming metrics (bandwidth, quality, errors)
4. **Multi-CDN**: Automatically failover between multiple CDN providers
5. **Adaptive Streaming**: Dynamically adjust quality based on network conditions
6. **Geo-Routing**: Route to nearest CDN based on user location
7. **DRM Support**: Add encryption and key management for protected content

## Implementation Order

1. ✅ Create plan document (this file)
2. ⏳ Implement streaming proxy endpoint (`stream-proxy.ts`)
3. ⏳ Implement thumbnail proxy endpoint (`thumbnail-proxy.ts`)
4. ⏳ Register routes in api-videos
5. ⏳ Update VideoPlayer component (LTR)
6. ⏳ Update VideoPlayer component (RTL)
7. ⏳ Add environment variables
8. ⏳ Test video playback
9. ⏳ Verify CORS headers
10. ⏳ Performance testing

## Notes

- This approach completely hides Bunny.net from the frontend
- Frontend only knows about the API endpoints
- Can easily migrate to different CDN providers later
- Maintains all existing features (quality selector, analytics, etc.)
- No breaking changes to existing analytics or watch progress tracking
