# Video Upload Pipeline Architecture

## System Architecture

```
┌─────────────────┐
│   Web Client    │
│  (Next.js App)  │
└────────┬────────┘
         │
         │ 1. initiateVideoUpload()
         │    (Server Action)
         ▼
┌─────────────────┐
│  Next.js Server │
│  (Server Action)│
└────────┬────────┘
         │
         │ 2. POST /api/videos/upload/initiate
         │    + JWT Token
         ▼
┌─────────────────────────────┐
│   API Videos Service        │
│  (Cloudflare Worker)        │
│                             │
│  ┌───────────────────────┐  │
│  │ uploadInitiate.ts     │  │
│  │ - Create video in     │  │
│  │   Bunny.net           │  │
│  │ - Store metadata in R2│  │
│  │ - Return upload URL   │  │
│  └───────────────────────┘  │
└──────┬──────────┬───────────┘
       │          │
       │          │ 3. Store video metadata
       │          ▼
       │     ┌─────────┐
       │     │ R2      │
       │     │ Videos  │
       │     │ Bucket  │
       │     └─────────┘
       │
       │ 4. Create video record
       ▼
┌──────────────┐
│  Bunny.net   │
│   Stream     │
│   API        │
└──────┬───────┘
       │
       │ 5. Return videoId & uploadUrl
       │
       ▼
┌─────────────────┐
│  Next.js Server │
│  Returns to     │
│  Client         │
└────────┬────────┘
         │
         │ 6. Client receives:
         │    - videoId
         │    - uploadUrl
         │    - libraryId
         ▼
┌─────────────────┐
│   Web Client    │
│  Gets Bunny     │
│  Access Key     │
└────────┬────────┘
         │
         │ 7. Direct upload to Bunny.net
         │    PUT {uploadUrl}
         │    Header: AccessKey
         │    Body: Video file binary
         ▼
┌──────────────┐
│  Bunny.net   │
│   Stream     │
│  (File       │
│   Upload)    │
└──────┬───────┘
       │
       │ 8. Upload complete
       │
       ▼
┌─────────────────┐
│   Web Client    │
│  Calls          │
│  completeUpload │
└────────┬────────┘
         │
         │ 9. POST /api/videos/upload/complete
         │    + videoId, fileSize, duration
         ▼
┌─────────────────────────────┐
│   API Videos Service        │
│                             │
│  ┌───────────────────────┐  │
│  │ uploadComplete.ts     │  │
│  │ - Update status to    │  │
│  │   'processing'        │  │
│  │ - Queue event         │  │
│  └───────────────────────┘  │
└──────────────┬──────────────┘
               │
               │ 10. Queue analytics event
               ▼
         ┌──────────┐
         │ Queue    │
         │ (Events) │
         └──────────┘
               │
               ▼
         ┌──────────────┐
         │  Processor   │
         │  (Analytics) │
         └──────────────┘

┌─────────────────┐
│   Web Client    │
│  Polls status   │
│  every 5 sec    │
└────────┬────────┘
         │
         │ 11. GET /api/videos/{id}/upload-status
         │     (Loop until status = 'ready')
         ▼
┌─────────────────────────────┐
│   API Videos Service        │
│                             │
│  ┌───────────────────────┐  │
│  │ videoUploadStatus.ts  │  │
│  │ - Get from R2         │  │
│  │ - Get from Bunny.net  │  │
│  │ - Return combined     │  │
│  └───────────────────────┘  │
└──────┬──────────┬───────────┘
       │          │
       │          │ Fetch metadata
       ▼          ▼
  ┌─────────┐  ┌──────────┐
  │ R2      │  │ Bunny.net│
  │ Bucket  │  │ Stream   │
  └─────────┘  └──────────┘
       │          │
       │          │ encoding status,
       │          │ progress, resolutions
       ▼          ▼
┌─────────────────────────────┐
│   Combined Status Response  │
│   - status: processing/ready│
│   - progress: 0-100         │
│   - encodingProgress        │
│   - availableResolutions    │
└─────────────────────────────┘
```

## Upload Flow Sequence

### 1. Initiation Phase (0-10%)
```
Client                Server Action           API Backend            Bunny.net
  |                         |                      |                     |
  |--initiateUpload()------>|                      |                     |
  |                         |--JWT from cookies--->|                     |
  |                         |                      |                     |
  |                         |                      |--createVideo()----->|
  |                         |                      |                     |
  |                         |                      |<---videoId, GUID----|
  |                         |                      |                     |
  |                         |                      |--Store R2---------->|
  |                         |<--uploadUrl, videoId-|                     |
  |<--uploadUrl, videoId----|                      |                     |
```

### 2. Upload Phase (10-70%)
```
Client                                           Bunny.net
  |                                                 |
  |--getBunnyAccessKey()--------------------------->|
  |<--accessKey-------------------------------------|
  |                                                 |
  |--PUT uploadUrl (with progress tracking)------->|
  |<--Progress events (10%, 20%, 30%...70%)--------|
  |                                                 |
  |<--Upload complete-------------------------------|
```

### 3. Completion Phase (70-85%)
```
Client                Server Action           API Backend
  |                         |                      |
  |--completeUpload()------>|                      |
  |                         |--JWT from cookies--->|
  |                         |                      |
  |                         |                      |--Update R2 status-->
  |                         |                      |--Queue event------>
  |                         |<--success------------|
  |<--success---------------|                      |
```

### 4. Processing Phase (85-100%)
```
Client                Server Action           API Backend           Bunny.net
  |                         |                      |                     |
  |                         |                      |                     |
  |--Poll every 5 sec------>|                      |                     |
  |                         |--getUploadStatus()-->|                     |
  |                         |                      |--getVideo()-------->|
  |                         |                      |<--encoding status---|
  |                         |<--status, progress---|                     |
  |<--status, progress------|                      |                     |
  |                         |                      |                     |
  | (Repeat until status = 'ready')                |                     |
```

## Data Flow

### Video Metadata (R2 Storage)
```typescript
{
  id: string;                    // UUID
  title: string;
  description?: string;
  userId: string;
  channelId: string;
  dateCreated: string;           // ISO 8601
  dateModified: string;          // ISO 8601
  uploadStatus: 'initiated' | 'uploading' | 'processing' | 'ready' | 'failed';
  fileSize?: number;
  duration?: number;
  originalFormat?: string;
  tags: string[];
  isPublic: boolean;
  isLive: boolean;
}
```

### Bunny.net Video Response
```typescript
{
  guid: string;                  // Video ID
  title: string;
  status: number;                // 0-5 (see status mapping)
  encodeProgress: number;        // 0-100
  length: number;                // Duration in seconds
  storageSize: number;           // File size in bytes
  availableResolutions: string;  // Comma-separated (e.g., "360p,720p,1080p")
  width: number;
  height: number;
  framerate: number;
}
```

## Authentication Flow

```
Client Request
    |
    ▼
Server Action (accesses httpOnly cookies)
    |
    ▼
Extract access_token
    |
    ▼
API Request with Bearer token
    |
    ▼
API Middleware validates JWT
    |
    ▼
Endpoint Handler
```

## Error Handling

### Client-Side Errors
- File validation (format, size, duration)
- Network errors during upload
- Upload cancellation

### Server-Side Errors
- Authentication failures
- Bunny.net API errors
- R2 storage errors
- Queue errors

### Recovery Strategies
1. **Upload Failure**: Retry from initiation
2. **Network Error**: Resume upload (if Bunny.net supports)
3. **Processing Failure**: Mark video as failed, allow re-upload

## Security Considerations

1. **JWT Authentication**: All endpoints require valid JWT
2. **Ownership Validation**: Users can only access their own videos
3. **Access Key Protection**: Bunny.net key never exposed to client bundle
4. **CORS Configuration**: Restricted origins in production
5. **File Validation**: Server-side and client-side validation
6. **Rate Limiting**: Consider implementing for upload endpoints

## Performance Optimizations

1. **Direct Upload**: File goes directly to Bunny.net (bypasses API server)
2. **Progress Tracking**: XMLHttpRequest for real-time progress
3. **Polling Optimization**: 5-second intervals, max 30 seconds initial check
4. **Lazy Status Updates**: Only poll when necessary
5. **Cached Bunny Key**: Server action caches key (avoid repeated env lookups)

## Monitoring & Analytics

### Queue Events
- `VideoUploadStarted`: Track upload initiations
- `VideoUploadCompleted`: Track successful uploads
- `VideoProcessingCompleted`: Track encoding completions
- `VideoUploadFailed`: Track failures for debugging

### Metrics to Track
- Upload success rate
- Average upload time by file size
- Processing time distribution
- Error types and frequencies
- User engagement with upload feature
