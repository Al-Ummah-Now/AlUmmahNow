# Task 2.3: Step 2 - Thumbnail Upload to Bunny.net

**Phase**: 2 - Go Live Creator Tools
**Type**: Architecture Specification
**Estimated Time**: 5 hours
**Dependencies**: Task 2.1 (GoLive Wizard)
**Status**: 📝 Not Started

---

## Goal

Implement secure thumbnail upload with client-side optimization, real-time preview, drag-and-drop support, and integration with Bunny.net CDN for optimal image delivery.

## Architecture Pattern

**Pattern**: Progressive Upload with Optimistic UI and Client-Side Optimization
**Strategy**: Compress locally, upload to CDN, generate multiple resolutions

## Component Structure

```typescript
// File: /apps/web/src/components/GoLiveForm/ThumbnailStep.tsx
interface ThumbnailStepProps {
  streamId?: string;
  initialThumbnail?: string;
  onNext: (data: ThumbnailData) => void;
  onBack: () => void;
  onSkip: () => void;
}

interface ThumbnailData {
  thumbnailUrl?: string;
  thumbnailFile?: File;
  autoGenerate: boolean;
  generationTimestamp?: number; // For auto-generation from stream
}

interface UploadState {
  status: 'idle' | 'uploading' | 'processing' | 'complete' | 'error';
  progress: number;
  error?: string;
  preview?: string;
  variants?: ImageVariants;
}

interface ImageVariants {
  original: string;
  large: string;  // 1920x1080
  medium: string; // 1280x720
  small: string;  // 640x360
  blur: string;   // 20x11 base64
}
```

## Data Flow

```
File Selection → Client Validation → Image Optimization
       ↓               ↓                    ↓
   Generate Preview → Compress Image → Upload to Bunny.net
       ↓                                     ↓
   Show Progress → Process on Server → Generate Variants
       ↓                                     ↓
   Update UI ← Return URLs ← Store in Database
```

## Dependencies

- **react-dropzone** - Drag & drop file upload
- **browser-image-compression** - Client-side image optimization
- **tus-js-client** - Resumable uploads for large files
- **react-image-crop** - Optional thumbnail cropping/editing

## Integration Points

- Bunny.net Storage API for upload
- Image processing service for variants
- Stream preview API for auto-generation
- CDN for serving optimized images

## Performance Considerations

```typescript
// Client-side image optimization
const optimizeImage = async (file: File): Promise<File> => {
  const options = {
    maxSizeMB: 1,
    maxWidthOrHeight: 1920,
    useWebWorker: true,
    fileType: 'image/webp',
    onProgress: (progress: number) => {
      console.log('Compression progress:', progress);
    }
  };

  try {
    const compressedFile = await imageCompression(file, options);
    console.log(`Original: ${(file.size / 1024 / 1024).toFixed(2)}MB`);
    console.log(`Compressed: ${(compressedFile.size / 1024 / 1024).toFixed(2)}MB`);
    return compressedFile;
  } catch (error) {
    console.error('Compression failed:', error);
    return file; // Return original if compression fails
  }
};

// Progressive loading with blur-up
const ThumbnailPreview = ({ url, blur }: { url: string; blur?: string }) => {
  const [loaded, setLoaded] = useState(false);

  return (
    <div className="relative aspect-video overflow-hidden rounded-lg">
      {blur && (
        <img
          src={blur}
          className="absolute inset-0 w-full h-full filter blur-lg scale-110"
          aria-hidden="true"
        />
      )}
      <img
        src={url}
        className={cn(
          "relative w-full h-full object-cover transition-opacity duration-300",
          loaded ? "opacity-100" : "opacity-0"
        )}
        onLoad={() => setLoaded(true)}
        loading="lazy"
      />
    </div>
  );
};

// Resumable uploads for slow connections
const uploadWithResume = async (file: File, onProgress: (p: number) => void) => {
  const upload = new tus.Upload(file, {
    endpoint: BUNNY_UPLOAD_ENDPOINT,
    retryDelays: [0, 1000, 3000, 5000],
    metadata: {
      filename: file.name,
      filetype: file.type
    },
    onProgress: (bytesUploaded, bytesTotal) => {
      const percentage = (bytesUploaded / bytesTotal) * 100;
      onProgress(percentage);
    },
    onSuccess: () => {
      console.log('Upload complete!');
    }
  });

  upload.start();
  return upload;
};
```

## Security Considerations

```typescript
// Comprehensive file validation
const validateImage = async (file: File): Promise<ValidationResult> => {
  // File type validation
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowedTypes.includes(file.type)) {
    return { valid: false, error: 'Invalid file type. Only JPEG, PNG, and WebP allowed.' };
  }

  // Size validation
  const maxSize = 5 * 1024 * 1024; // 5MB
  if (file.size > maxSize) {
    return { valid: false, error: 'File too large. Maximum size is 5MB.' };
  }

  // Minimum dimensions
  const minWidth = 640;
  const minHeight = 360;
  const dimensions = await getImageDimensions(file);
  if (dimensions.width < minWidth || dimensions.height < minHeight) {
    return {
      valid: false,
      error: `Image too small. Minimum ${minWidth}x${minHeight} required.`
    };
  }

  // Magic bytes validation (prevent file type spoofing)
  const buffer = await file.arrayBuffer();
  const magicBytes = new Uint8Array(buffer.slice(0, 4));

  const signatures: Record<string, number[]> = {
    'image/jpeg': [0xFF, 0xD8, 0xFF],
    'image/png': [0x89, 0x50, 0x4E, 0x47],
    'image/webp': [0x52, 0x49, 0x46, 0x46]
  };

  const signature = signatures[file.type];
  if (signature && !signature.every((byte, i) => byte === magicBytes[i])) {
    return { valid: false, error: 'File type mismatch. File may be corrupted.' };
  }

  // Strip EXIF data for privacy
  const cleaned = await stripExif(file);

  return { valid: true, file: cleaned };
};

// Helper to get image dimensions
const getImageDimensions = (file: File): Promise<{ width: number; height: number }> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.width, height: img.height });
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
};
```

## Error Handling

- **Upload Failures**: Retry with exponential backoff (max 3 retries)
- **Network Issues**: Resume upload from last checkpoint
- **Invalid Files**: Clear error message with format requirements
- **Processing Errors**: Fallback to default thumbnail
- **CDN Errors**: Temporary local storage with background retry

```typescript
const handleUploadError = (error: Error) => {
  if (error.message.includes('network')) {
    return {
      title: 'Upload Failed',
      message: 'Network error. Upload will resume when connection is restored.',
      retry: true
    };
  }

  if (error.message.includes('size')) {
    return {
      title: 'File Too Large',
      message: 'Please compress the image or choose a smaller file.',
      retry: false
    };
  }

  if (error.message.includes('format')) {
    return {
      title: 'Invalid Format',
      message: 'Only JPEG, PNG, and WebP images are supported.',
      retry: false
    };
  }

  return {
    title: 'Upload Error',
    message: 'An unexpected error occurred. Please try again.',
    retry: true
  };
};
```

## Type Safety

```typescript
// Upload progress tracking
type UploadProgress = {
  bytesUploaded: number;
  bytesTotal: number;
  percentage: number;
  timeRemaining: number; // seconds
  speed: number; // bytes/second
  estimatedCompletion: Date;
};

// Validation result
interface ValidationResult {
  valid: boolean;
  error?: string;
  file?: File;
  warnings?: string[];
}

// Upload options
interface UploadOptions {
  maxRetries: number;
  chunkSize: number;
  timeout: number;
  onProgress: (progress: UploadProgress) => void;
  onComplete: (variants: ImageVariants) => void;
  onError: (error: Error) => void;
}
```

## Testing Criteria

- [ ] Drag and drop works correctly
- [ ] File selection via button works
- [ ] Client-side validation rejects invalid files
- [ ] Image compression reduces file size
- [ ] Upload progress shows accurately
- [ ] Preview generates before upload
- [ ] Upload resumes after network interruption
- [ ] Multiple image variants generated
- [ ] EXIF data stripped from images
- [ ] Skip button works (auto-generate option)

## Acceptance Criteria

- [ ] Drag and drop zone with file selection
- [ ] Instant preview after file selection
- [ ] Client-side compression (<1MB target)
- [ ] Upload progress bar with percentage
- [ ] Error handling with retry mechanism
- [ ] Generate 5 image variants (original, large, medium, small, blur)
- [ ] Upload to Bunny.net CDN
- [ ] EXIF stripping for privacy
- [ ] Max 5MB file size validation
- [ ] Min 640x360 resolution validation
- [ ] Skip option for auto-generated thumbnail

## Related Tasks

- **Depends On**: Task 2.1 (GoLive Wizard)
- **Blocks**: Task 2.5 (Review Step)
- **Related**: Task 2.13 (Error Handling)

## References

- [ADR-002: Phase 2 Architecture](/docs/architecture/ADR-002-phase2-golive-architecture.md#task-3-step-2-thumbnail-upload)
- [Bunny.net Storage API](https://docs.bunny.net/docs/storage-api)
- [browser-image-compression](https://github.com/Donaldcwl/browser-image-compression)

---

**Last Updated**: 2025-11-06
**Reviewed By**: N/A
**Implementation Status**: Not Started
