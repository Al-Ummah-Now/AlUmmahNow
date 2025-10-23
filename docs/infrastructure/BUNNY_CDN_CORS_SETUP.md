# Bunny.net CORS Configuration Guide

## Issue

Video streaming from Bunny.net CDN is blocked by CORS policy:

```
Access to XMLHttpRequest at 'https://vz-3f3e8ae1-5c9.b-cdn.net/...' from origin 'http://localhost:3000'
has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.
```

## Solution

You need to configure CORS settings in your Bunny.net account to allow requests from your domain(s).

### Steps to Configure CORS in Bunny.net

1. **Log in to Bunny.net Dashboard**
   - Go to https://dash.bunny.net/

2. **Navigate to Stream Library**
   - Click on "Stream" in the left sidebar
   - Select your library (ID: `3f3e8ae1-5c9`)

3. **Configure CORS Headers**
   - Go to "Settings" tab
   - Scroll to "CORS and Security Headers" section
   - Add the following allowed origins:
     - `http://localhost:3000` (for local development)
     - `http://localhost:3001` (if using different ports)
     - `https://alummahnow.net` (for production)
     - `https://*.alummahnow.net` (for subdomains)
     - `*` (to allow all origins - NOT recommended for production)

4. **Save Changes**
   - Click "Save" to apply the CORS configuration
   - Wait 1-2 minutes for the changes to propagate

### Alternative: Use Bunny.net's Built-in CORS Support

Bunny.net Stream supports automatic CORS handling. Ensure:

1. **Enable CORS in Stream Settings**
   - In Stream Library settings
   - Enable "Allow Cross-Origin Resource Sharing (CORS)"
   - Add your allowed origins

2. **Verify Pull Zone Settings** (if using Pull Zones)
   - Go to Pull Zones → Your Pull Zone
   - Navigate to "Headers" tab
   - Add custom header:
     - Header: `Access-Control-Allow-Origin`
     - Value: `http://localhost:3000` or `*`

### Testing CORS Configuration

After configuring CORS, test the video loading:

```bash
# Test direct access to playlist
curl -I 'https://vz-3f3e8ae1-5c9.b-cdn.net/0a3a5049-0999-4ca4-9003-d507a13d39b4/playlist.m3u8'

# Check for CORS headers
curl -H "Origin: http://localhost:3000" \
     -H "Access-Control-Request-Method: GET" \
     -I 'https://vz-3f3e8ae1-5c9.b-cdn.net/0a3a5049-0999-4ca4-9003-d507a13d39b4/playlist.m3u8'
```

Expected response headers:
```
Access-Control-Allow-Origin: http://localhost:3000
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

### Development Workaround (Temporary)

If you can't modify Bunny.net settings immediately, you can use a local proxy:

1. **Create Next.js API Route Proxy** (`/app/api/video-proxy/[...path]/route.ts`):

```typescript
export async function GET(request: Request) {
  const url = new URL(request.url);
  const path = url.pathname.replace('/api/video-proxy/', '');

  const bunnyUrl = `https://vz-3f3e8ae1-5c9.b-cdn.net/${path}`;

  const response = await fetch(bunnyUrl);

  return new Response(response.body, {
    status: response.status,
    headers: {
      'Content-Type': response.headers.get('Content-Type') || 'application/vnd.apple.mpegurl',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600'
    }
  });
}
```

2. **Update Video URL in VideoPlayer**:

```typescript
// Change from:
const videoSources = [{
  src: `https://vz-3f3e8ae1-5c9.b-cdn.net/${videoId}/playlist.m3u8`,
  type: 'application/x-mpegURL'
}];

// To:
const videoSources = [{
  src: `/api/video-proxy/${videoId}/playlist.m3u8`,
  type: 'application/x-mpegURL'
}];
```

**Note:** This proxy approach adds latency and should only be used for development.

## Production Considerations

For production deployment:

1. **Always configure CORS properly** in Bunny.net (don't use proxy)
2. **Use specific origins** instead of `*` for security
3. **Enable HTTPS only** for production domains
4. **Consider signed URLs** for additional security
5. **Monitor CORS errors** in production logs

## Additional Resources

- [Bunny.net CORS Documentation](https://docs.bunny.net/docs/stream-cors)
- [Bunny.net Stream API](https://docs.bunny.net/reference/stream_api)
- [MDN CORS Guide](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS)
