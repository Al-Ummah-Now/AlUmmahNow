# ADR 0001: Use TUS Protocol for Resumable Video Uploads

## Status
Accepted

## Context

Al Ummah Now platform needs reliable video upload functionality that can handle:
- Large video files (up to 5GB)
- Unreliable network connections (mobile, slow connections)
- Interrupted uploads that need resumption
- Direct client-to-CDN uploads without proxying through our servers
- Progress tracking and user experience requirements

Initially, we considered implementing custom chunked upload logic with manual state management. However, this would require significant development effort and ongoing maintenance.

## Decision

We will use the **TUS (Tus Resumable Upload Protocol)** for video uploads, leveraging Bunny.net's native TUS endpoint support. This involves:

1. Using `tus-js-client` library on the frontend for upload handling
2. Generating signed TUS authorization signatures on our API server
3. Having clients upload directly to Bunny.net's TUS endpoint
4. Implementing pause/resume controls in the UI

## Rationale

### 1. Industry Standard Protocol
- TUS is an open protocol used by major platforms (Vimeo, Cloudflare Stream)
- Battle-tested with millions of uploads daily
- Well-documented specification with clear semantics

### 2. Native Bunny.net Support
- Bunny.net provides a dedicated TUS endpoint: `https://video.bunnycdn.com/tusupload`
- No need for custom chunk assembly or storage
- Automatic encoding pipeline trigger upon completion

### 3. Reduced Implementation Complexity
- ~75% less code compared to custom chunking solution
- No need for queue workers to assemble chunks
- No temporary storage requirements for chunks
- Built-in retry logic with exponential backoff

### 4. Superior User Experience
- Automatic resume after network interruptions
- Pause/resume functionality out of the box
- Accurate progress tracking
- Faster recovery from failures

### 5. Better Resource Utilization
- Direct client-to-CDN upload reduces server load
- No proxy bandwidth costs
- Lower latency (direct connection)
- Reduced Cloudflare Workers compute time

### 6. Maintenance Benefits
- Well-maintained client libraries
- Protocol updates handled by library maintainers
- Large community for support

## Consequences

### Positive

1. **Faster Implementation**: 1.5 weeks saved vs custom chunking
2. **Better Reliability**: Industry-tested protocol with proven track record
3. **Lower Operational Costs**: No server bandwidth for proxying uploads
4. **Reduced Maintenance**: Less custom code to maintain
5. **Better UX**: Automatic resume, better progress tracking
6. **Scalability**: Can handle unlimited concurrent uploads without server impact

### Negative

1. **External Dependency**: Relies on `tus-js-client` library (~50KB gzipped)
   - *Mitigation*: Library is well-maintained with 3M+ weekly downloads

2. **Limited Customization**: Must follow TUS protocol constraints
   - *Mitigation*: Protocol is flexible enough for our needs

3. **Signature Generation Overhead**: Server must generate TUS signatures
   - *Mitigation*: Minimal overhead (single SHA-256 hash operation)

4. **Learning Curve**: Team needs to understand TUS protocol
   - *Mitigation*: Good documentation and examples available

## Alternatives Considered

### 1. Custom Chunked Upload (Rejected)
**Approach**: Implement custom chunking logic with state management
**Pros**: Full control, no external dependencies
**Cons**:
- 2000+ lines of code to maintain
- Complex state management for resume
- Custom retry logic needed
- Queue workers for chunk assembly
- Higher bug risk

### 2. Direct Upload (Current, Being Replaced)
**Approach**: Single PUT request to Bunny.net
**Pros**: Simple implementation
**Cons**:
- No resume capability
- Fails on network interruption
- Poor UX for large files
- No progress tracking

### 3. Multipart Form Upload (Rejected)
**Approach**: Traditional form upload through API
**Pros**: Simple, well-understood
**Cons**:
- Server bandwidth costs
- Worker timeout limits (30s)
- No resume capability
- Poor performance for large files

### 4. S3 Multipart Upload Pattern (Rejected)
**Approach**: Implement S3-style multipart upload
**Pros**: Familiar pattern
**Cons**:
- Bunny.net doesn't support S3 multipart API
- Would require custom implementation
- Complex state management

## Implementation Notes

### Security Model
- Server generates time-limited TUS signatures (1 hour expiry)
- Signatures are SHA-256 hashes of: `libraryId + apiKey + expirationTime + videoId`
- API key never exposed to client
- Each upload gets unique video ID and signature

### Migration Strategy
1. Implement TUS alongside existing upload (feature flag)
2. Gradual rollout: 10% → 25% → 50% → 100%
3. Monitor error rates and performance
4. Remove old implementation after 2 weeks at 100%

### Key Files
- `/apps/api-videos/src/lib/bunny/tus.ts` - TUS signature generation
- `/apps/api-videos/src/endpoints/video/uploadInitiate.ts` - Enhanced endpoint
- `/apps/web/src/components/videoUpload/index.tsx` - TUS-enabled component

## References

- [TUS Protocol Specification](https://tus.io/protocols/resumable-upload.html)
- [Bunny.net TUS Documentation](https://docs.bunny.net/reference/tus-resumable-uploads)
- [tus-js-client Documentation](https://github.com/tus/tus-js-client)
- Implementation PR: [TBD]

## Decision Date
2025-11-20

## Last Updated
2025-11-20