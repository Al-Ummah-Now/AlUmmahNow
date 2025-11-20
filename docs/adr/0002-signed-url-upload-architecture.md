# ADR 0002: Signed URL Upload Architecture

## Status
Accepted

## Context

Video uploads require secure handling of large files while preventing:
- Exposure of API keys to client-side code
- Unauthorized uploads consuming storage/bandwidth
- Server overload from proxying large files
- Man-in-the-middle attacks or tampering

We need an architecture that balances security with performance and scalability.

## Decision

We will use a **signed URL architecture** where:

1. **Client requests upload authorization** from our API (authenticated)
2. **API generates time-limited signed URLs** using server-side secrets
3. **Client uploads directly to CDN** using the signed URL
4. **CDN validates signature** before accepting upload
5. **API never handles the actual file data** (zero proxy overhead)

### Implementation Details

#### Signature Generation
```
signature = SHA256(libraryId + apiKey + expirationTime + videoId)
```

#### Authorization Flow
```
Client → API: Request upload (JWT auth)
API → Client: Signed URL + headers (1 hour expiry)
Client → Bunny.net: Direct upload with signature
Bunny.net: Validates signature and accepts upload
```

## Rationale

### 1. Security Benefits
- **API keys never exposed**: Signatures generated server-side only
- **Time-limited access**: URLs expire after 1 hour
- **Per-video authorization**: Each upload gets unique signature
- **Tamper-proof**: SHA-256 signatures prevent modification

### 2. Performance Benefits
- **Zero proxy overhead**: Files go directly to CDN
- **Reduced latency**: Direct connection to nearest CDN edge
- **Parallel uploads**: Multiple users can upload simultaneously
- **No Worker timeouts**: Bypasses Cloudflare's 30-second limit

### 3. Scalability Benefits
- **Unlimited concurrent uploads**: No server bottleneck
- **CDN handles load**: Bunny.net manages all upload infrastructure
- **Minimal server resources**: Only signature generation needed
- **Cost-effective**: No egress bandwidth charges

### 4. Developer Experience
- **Clear separation of concerns**: Auth vs upload logic separated
- **Standard pattern**: Similar to AWS S3 presigned URLs
- **Easy to debug**: Clear error messages from CDN

## Consequences

### Positive

1. **Enhanced Security**: API keys remain server-side only
2. **Better Performance**: Direct uploads reduce latency by 40-60%
3. **Lower Costs**: No server bandwidth or compute for file transfer
4. **Higher Reliability**: CDN infrastructure handles failures
5. **Simplified Architecture**: No complex proxy or streaming logic

### Negative

1. **Client Complexity**: Must handle signed URL flow
   - *Mitigation*: Well-documented client SDK/component

2. **Clock Sync Issues**: Client/server time differences can cause failures
   - *Mitigation*: 5-minute grace period in signature validation

3. **Limited Control**: Can't inspect file contents during upload
   - *Mitigation*: Post-upload validation via webhooks

4. **Debugging Challenges**: Errors happen on CDN, not our servers
   - *Mitigation*: Comprehensive error codes and logging

## Alternatives Considered

### 1. Server-Side Proxy (Rejected)
**Approach**: Upload through API, proxy to CDN
**Pros**: Full control, can validate files in-stream
**Cons**:
- High bandwidth costs
- Worker timeout limitations (30s)
- Server becomes bottleneck
- Complex streaming implementation

### 2. Direct API Key to Client (Rejected - Security Risk)
**Approach**: Send Bunny.net API key to client
**Pros**: Simple implementation
**Cons**:
- **CRITICAL SECURITY RISK**: Exposed API keys
- Anyone can upload unlimited content
- No way to revoke individual access
- Violates security best practices

### 3. Temporary Credentials (Considered)
**Approach**: Generate temporary API keys per user
**Pros**: More secure than permanent keys
**Cons**:
- Bunny.net doesn't support temporary credentials
- Would require custom credential management
- Complex rotation logic

### 4. Webhook-Based Validation (Complementary)
**Approach**: Validate uploads via Bunny.net webhooks
**Pros**: Server-side validation of completed uploads
**Cons**:
- Not a complete solution (post-upload only)
- Adds complexity to architecture
**Note**: Can be used alongside signed URLs for additional validation

## Implementation Notes

### Security Considerations

1. **Signature Expiration**: 1 hour default, configurable
2. **Rate Limiting**: Applied at API level before signature generation
3. **User Quotas**: Enforced via KV storage tracking
4. **Audit Trail**: All signature generations logged
5. **IP Validation**: Optional IP-based restrictions

### Error Handling

```typescript
// Common error scenarios and responses
- 401: Invalid/missing JWT token
- 403: User quota exceeded
- 410: Expired signature
- 422: Invalid video metadata
- 429: Rate limit exceeded
- 500: Signature generation failed
```

### Monitoring

- Track signature generation rate
- Monitor upload success/failure ratio
- Alert on unusual patterns (potential abuse)
- Log all authorization requests

## Code Examples

### API Endpoint (Signature Generation)
```typescript
// Generate TUS signature
const signature = await generateTUSSignature(
  libraryId,
  apiKey, // Server-side secret
  expirationTime,
  videoId
);

return {
  tusEndpoint: 'https://video.bunnycdn.com/tusupload',
  tusHeaders: {
    AuthorizationSignature: signature,
    AuthorizationExpire: expirationTime,
    LibraryId: libraryId,
    VideoId: videoId
  },
  expiresAt: new Date(expirationTime * 1000).toISOString()
};
```

### Client Usage
```typescript
// Request signed URL from API
const { tusEndpoint, tusHeaders } = await api.initiateUpload(metadata);

// Upload directly to CDN with signed headers
const upload = new tus.Upload(file, {
  endpoint: tusEndpoint,
  headers: tusHeaders,
  // ... TUS configuration
});
```

## Migration Path

1. **Phase 1**: Implement alongside existing upload (feature flag)
2. **Phase 2**: Enable for internal testing
3. **Phase 3**: Gradual rollout to users
4. **Phase 4**: Deprecate old upload method
5. **Phase 5**: Remove legacy code

## References

- [OWASP: Secure File Upload](https://owasp.org/www-community/vulnerabilities/Unrestricted_File_Upload)
- [AWS S3 Presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/PresignedUrlUploadObject.html)
- [Cloudflare: Direct Creator Upload](https://developers.cloudflare.com/stream/uploading-videos/direct-creator-uploads/)
- Bunny.net TUS Authentication Documentation

## Decision Date
2025-11-20

## Last Updated
2025-11-20