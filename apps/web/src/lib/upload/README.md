# Batch Upload System

This directory contains the core utilities for handling batch video uploads with resumable TUS protocol support.

## Implemented Files ✅

### 1. `TusParallelManager.ts`
**Purpose**: Manages concurrent TUS uploads with concurrency control (1-5 parallel uploads)

**Key Features**:
- Creates and manages TUS upload instances
- Respects concurrency limits with automatic queueing
- Pause/resume/cancel individual uploads
- Automatic resume from previous uploads (if browser crashed/closed)
- Event callbacks for progress, success, and errors

**Usage**:
```typescript
import { TusParallelManager } from '@/lib/upload/TusParallelManager';

const manager = new TusParallelManager(3); // Max 3 concurrent uploads

// Create upload
const upload = manager.createUpload(
  'video-id-123',
  file,
  tusConfig,
  {
    onProgress: (id, uploaded, total) => {
      console.log(`Progress: ${(uploaded/total*100).toFixed(2)}%`);
    },
    onSuccess: (id) => {
      console.log('Upload complete!');
    },
    onError: (id, error) => {
      console.error('Upload failed:', error);
    }
  }
);

// Start upload (queues if concurrency limit reached)
await manager.start('video-id-123');

// Pause/resume/cancel
manager.pause('video-id-123');
await manager.resume('video-id-123');
manager.cancel('video-id-123');

// Adjust concurrency on-the-fly
manager.setConcurrencyLimit(5); // Increase to 5 parallel uploads
```

### 2. `UploadOptimizer.ts`
**Purpose**: Dynamically optimizes upload settings based on device capabilities and network conditions

**Key Features**:
- Device capability detection (desktop/tablet/mobile)
- Memory monitoring (uses Performance Memory API when available)
- Bandwidth estimation (network connection type + real measurements)
- Optimal concurrency calculation (1-5 based on device + network)
- Optimal chunk size calculation (1MB-10MB)
- Batch size recommendations

**Usage**:
```typescript
import { UploadOptimizer } from '@/lib/upload/UploadOptimizer';

const optimizer = new UploadOptimizer();

// Get optimal settings
const concurrency = optimizer.getOptimalConcurrency(); // 1-5
const chunkSize = optimizer.getOptimalChunkSize(); // 1MB-10MB
const batchSize = optimizer.getRecommendedBatchSize(); // Max videos to upload

// Check if device can handle batch upload
if (!optimizer.canHandleBatchUpload(10)) {
  alert('Your device may not have enough memory for 10 concurrent uploads');
}

// Monitor during upload
optimizer.updateBandwidth(bytesTransferred);
const bandwidth = optimizer.getCurrentBandwidth(); // bytes/sec

// Get device info
const capabilities = optimizer.getDeviceCapabilities();
console.log({
  isDesktop: capabilities.isDesktop,
  isMobile: capabilities.isMobile,
  cores: capabilities.cores,
  hasWebWorker: capabilities.hasWebWorker
});

// Get memory usage
const memory = optimizer.getMemoryUsage();
console.log({
  used: memory.used,
  available: memory.available,
  usagePercent: memory.usagePercent
});
```

## Files to Be Implemented 🚧

### 3. `BatchUploadManager.ts` (TODO)
**Purpose**: High-level manager for batch upload queue

**Responsibilities**:
- Upload queue state management (Map of UploadQueueItems)
- File validation (type, size, count)
- Metadata management (shared/individual)
- Integration with TusParallelManager and UploadOptimizer
- Progress tracking and aggregation
- Error handling and retry logic
- Event emission for UI updates

**Planned API**:
```typescript
import { BatchUploadManager } from '@/lib/upload/BatchUploadManager';

const manager = new BatchUploadManager({
  maxConcurrent: 3,
  maxRetries: 3,
  autoProceed: true
});

// Add files to queue
await manager.addFiles(files, sharedMetadata);

// Start processing queue
await manager.startProcessing();

// Listen to events
manager.on('progress', (progress) => {
  console.log(`Total: ${progress}%`);
});

manager.on('item-complete', (videoId) => {
  console.log(`Video ${videoId} uploaded!`);
});

manager.on('all-complete', () => {
  console.log('All uploads complete!');
});

// Pause/resume individual items
manager.pauseItem(itemId);
await manager.resumeItem(itemId);

// Get queue state
const items = manager.getQueueItems();
const progress = manager.getTotalProgress();
```

## Integration with Backend

### API Endpoint: `POST /api/videos/upload/batch/initiate`
**Location**: `apps/api-videos/src/endpoints/video/uploadBatchInitiate.ts`

**Request**:
```typescript
{
  videos: Array<{
    title: string;
    description?: string;
    fileSize: number;
    mimeType: string;
    isPublic: boolean;
    tags?: string;
  }>;
  sharedMetadata?: {
    channelId?: string;
    category?: string;
    isPublic?: boolean;
  };
}
```

**Response**:
```typescript
{
  success: true;
  result: Array<{
    videoId: string;
    tusEndpoint: string;
    tusHeaders: {
      AuthorizationSignature: string;
      AuthorizationExpire: string;
      LibraryId: string;
      VideoId: string;
    };
    expiresAt: string;
    chunkSize: number;
    resumable: boolean;
  }>;
}
```

## Type Definitions

All types are defined in `@al-ummah/shared-types/src/upload.ts`:

- `UploadStatus`: Upload states (pending, initiating, uploading, paused, processing, completed, failed, cancelled)
- `UploadQueueItem`: Individual upload item in queue
- `UploadQueueState`: Complete queue state
- `QueueSettings`: User preferences for queue management
- `TusConfig`: TUS upload configuration
- `TusCallbacks`: Event callbacks for TUS uploads
- `DeviceCapabilities`: Device capability information
- `BatchUploadConfig`: Configuration options

## Performance Considerations

### Memory Management
- Each upload uses chunked reading (default 5MB chunks)
- Total memory usage: ~50MB per concurrent upload
- Mobile devices limited to 1-3 concurrent uploads
- Desktop/tablets support up to 5 concurrent uploads

### Network Optimization
- Chunk size adapts to bandwidth (1MB on slow networks, 10MB on fast)
- Concurrent upload count adapts to network quality
- Automatic retry with exponential backoff
- TUS protocol supports resumption from any point

### Browser Compatibility
- Requires modern browser with TUS support
- Uses Performance Memory API when available
- Falls back to conservative estimates on older browsers
- Web Worker support enhances performance but is optional

## Testing

### Unit Tests (TODO)
```
__tests__/TusParallelManager.test.ts
__tests__/UploadOptimizer.test.ts
__tests__/BatchUploadManager.test.ts
```

### Integration Tests (TODO)
```
__tests__/integration.test.ts
```

## Next Steps

1. Implement `BatchUploadManager.ts`
2. Create React components in `apps/web/src/components/upload/`:
   - `MultiFileSelector.tsx`
   - `BatchMetadataEditor.tsx`
   - `UploadQueueView.tsx`
   - `UploadQueueItem.tsx`
3. Create React hook: `apps/web/src/hooks/useBatchUpload.ts`
4. Write comprehensive tests
5. Update upload config constants

## References

- **Implementation Plan**: `/docs/features/03-batch-upload.md`
- **Implementation Status**: `/docs/features/03-batch-upload-IMPLEMENTATION-STATUS.md`
- **TUS Protocol**: https://tus.io/protocols/resumable-upload.html
- **Bunny.net Stream API**: https://docs.bunny.net/reference/video_createvideo
