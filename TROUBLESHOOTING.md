# Troubleshooting Guide

## Video Playback Issues

### SSL Certificate Error (ERR_CERT_DATE_INVALID)

**Symptom**: Video player loads but video doesn't play. Console shows:
```
Failed to load resource: net::ERR_CERT_DATE_INVALID
https://stream.alummahnow.net/[video-id]/playlist.m3u8
```

**Root Cause**: The SSL certificate for `stream.alummahnow.net` is expired or invalid.

**Solution**:
1. Log into your DNS/CDN provider (Cloudflare Dashboard)
2. Navigate to SSL/TLS settings for `alummahnow.net`
3. Ensure SSL certificate is valid and covers the `stream` subdomain
4. If using Cloudflare:
   - Go to SSL/TLS → Edge Certificates
   - Verify certificate is active and not expired
   - If needed, disable and re-enable Universal SSL
   - Or purchase/upload a new SSL certificate
5. Wait for DNS propagation (can take up to 24-48 hours)

**Temporary Workaround** (Development Only):
- Use Bunny.net's CDN URL directly instead of custom domain
- Check Bunny.net dashboard for the default `.b-cdn.net` URL

**Verification**:
```bash
# Check SSL certificate expiry
curl -vI https://stream.alummahnow.net 2>&1 | grep -i "expire\|certificate"

# Or use online tools
# https://www.ssllabs.com/ssltest/analyze.html?d=stream.alummahnow.net
```

### Video Player Not Rendering

**Symptom**: Video page shows only comments and related videos, no player.

**Possible Causes**:
1. API returns no video data (`videoDetails` is null)
2. JavaScript errors in production build
3. Missing video ID in query string

**Solution**:
1. Check browser console for errors
2. Verify API endpoint is accessible: `https://api.alummahnow.net/videos/[video-id]`
3. Ensure video ID exists in URL: `/video?vid=[video-id]`
4. Check network tab for failed API requests

## Build Issues

### TypeScript Project References Warning

**Warning**: `TypeScript project references are not fully supported. Attempting to build in incremental mode.`

**Impact**: Low - Build still succeeds, but may be slower

**Solution**: This is a known Next.js limitation with monorepos. Can be safely ignored.

### Missing Dependencies After Pull

**Symptom**: Build fails with module not found errors

**Solution**:
```bash
# Clean install
pnpm install

# Rebuild shared types
pnpm --filter @al-ummah/shared-types build

# Restart dev server
pnpm dev
```

## WebSocket Connection Issues

### Connection Fails or Disconnects Frequently

**Check**:
1. WebSocket server is deployed and running
2. Correct WebSocket URL in environment variables
3. JWT token is valid and not expired
4. Browser console for connection errors

**Solution**:
```bash
# Check WebSocket server status
curl https://ws.alummahnow.net/health

# Verify in browser console
# Should see: "📡 WebSocket connected"
```

## Authentication Issues

### Login Redirects but User Not Authenticated

**Check**:
1. OpenAuth callback URL is correctly configured
2. JWT token is being stored in cookies
3. Token expiry time is valid

**Solution**:
- Clear browser cookies and try again
- Check OpenAuth service logs
- Verify `auth.alummahnow.net` is accessible

---

**Last Updated**: 2025-10-12
