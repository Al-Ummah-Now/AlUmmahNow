# TUS Proxy Client Implementation Guide

## Overview

The TUS proxy enables resumable video uploads while keeping Bunny.net credentials completely hidden from the client. This guide shows how to integrate the TUS proxy with your frontend application.

## Architecture

```
Client (tus-js-client) → Your API (TUS Proxy) → Bunny.net TUS Server
                       ↑
                   JWT Auth Required
```

## Implementation Steps

### 1. Install TUS Client

```bash
npm install tus-js-client
# or
pnpm add tus-js-client
```

### 2. Initialize Upload Process

First, create a video record using the initiate endpoint:

```javascript
// Step 1: Initialize the video upload
async function initiateUpload(file, token) {
  const response = await fetch('https://api.example.com/api/videos/upload/initiate', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: 'My Video Title',
      description: 'Video description',
      fileSize: file.size,
      mimeType: file.type,
      isPublic: true,
      tags: 'education,tutorial',
    }),
  });

  if (!response.ok) {
    throw new Error('Failed to initiate upload');
  }

  const data = await response.json();
  return data.result.videoId; // This is needed for the TUS upload
}
```

### 3. Upload Using TUS Client

```javascript
import * as tus from 'tus-js-client';

async function uploadVideo(file, videoId, token, onProgress) {
  return new Promise((resolve, reject) => {
    const upload = new tus.Upload(file, {
      // Use the TUS proxy endpoint (NOT Bunny.net directly)
      endpoint: 'https://api.example.com/api/videos/tus',

      // Include JWT token for authentication
      headers: {
        'Authorization': `Bearer ${token}`,
      },

      // Pass videoId in metadata (base64 encoded automatically by tus-js-client)
      metadata: {
        videoId: videoId,
        filename: file.name,
        filetype: file.type,
      },

      // Recommended: 5MB chunks for optimal performance
      chunkSize: 5 * 1024 * 1024,

      // Retry configuration for network resilience
      retryDelays: [0, 3000, 5000, 10000, 20000],

      // Error handler
      onError: function(error) {
        console.error('Upload failed:', error);
        reject(error);
      },

      // Progress callback
      onProgress: function(bytesUploaded, bytesTotal) {
        const percentage = ((bytesUploaded / bytesTotal) * 100).toFixed(2);
        console.log(`Upload progress: ${percentage}%`);

        if (onProgress) {
          onProgress({
            bytesUploaded,
            bytesTotal,
            percentage: parseFloat(percentage),
          });
        }
      },

      // Success callback
      onSuccess: function() {
        console.log('Upload completed successfully!');
        resolve({
          videoId,
          success: true,
        });
      },

      // Optional: Handle upload creation
      onBeforeRequest: function(req) {
        console.log('Making request to:', req.getURL());
      },

      // Optional: Handle successful chunk upload
      onAfterResponse: function(req, res) {
        console.log('Chunk uploaded, new offset:', res.getHeader('Upload-Offset'));
      },
    });

    // Find previous uploads to resume (if any)
    upload.findPreviousUploads().then((previousUploads) => {
      if (previousUploads.length > 0) {
        console.log('Found previous upload, resuming...');
        upload.resumeFromPreviousUpload(previousUploads[0]);
      }

      // Start the upload
      upload.start();
    });
  });
}
```

### 4. Complete React Component Example

```jsx
import React, { useState } from 'react';
import * as tus from 'tus-js-client';

function VideoUploader({ authToken }) {
  const [file, setFile] = useState(null);
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [uploadInstance, setUploadInstance] = useState(null);

  const handleFileSelect = (event) => {
    setFile(event.target.files[0]);
    setError(null);
    setProgress(0);
  };

  const handleUpload = async () => {
    if (!file) return;

    setUploading(true);
    setError(null);

    try {
      // Step 1: Initialize video record
      const initResponse = await fetch('/api/videos/upload/initiate', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: file.name,
          fileSize: file.size,
          mimeType: file.type,
          isPublic: true,
        }),
      });

      if (!initResponse.ok) {
        throw new Error('Failed to initialize upload');
      }

      const { result } = await initResponse.json();
      const videoId = result.videoId;

      // Step 2: Upload using TUS
      const upload = new tus.Upload(file, {
        endpoint: '/api/videos/tus',
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
        metadata: {
          videoId: videoId,
          filename: file.name,
          filetype: file.type,
        },
        chunkSize: 5 * 1024 * 1024,
        retryDelays: [0, 3000, 5000, 10000, 20000],
        onError: (error) => {
          console.error('Upload error:', error);
          setError(error.message);
          setUploading(false);
        },
        onProgress: (bytesUploaded, bytesTotal) => {
          const percentage = (bytesUploaded / bytesTotal) * 100;
          setProgress(percentage);
        },
        onSuccess: () => {
          console.log('Upload complete!');
          setProgress(100);
          setUploading(false);
          alert(`Video uploaded successfully! ID: ${videoId}`);
        },
      });

      setUploadInstance(upload);

      // Check for previous uploads
      const previousUploads = await upload.findPreviousUploads();
      if (previousUploads.length > 0) {
        console.log('Resuming previous upload...');
        upload.resumeFromPreviousUpload(previousUploads[0]);
      }

      upload.start();

    } catch (err) {
      console.error('Upload failed:', err);
      setError(err.message);
      setUploading(false);
    }
  };

  const handlePause = () => {
    if (uploadInstance) {
      uploadInstance.abort();
      setUploading(false);
    }
  };

  const handleResume = () => {
    if (uploadInstance) {
      uploadInstance.start();
      setUploading(true);
    }
  };

  return (
    <div className="video-uploader">
      <input
        type="file"
        accept="video/*"
        onChange={handleFileSelect}
        disabled={uploading}
      />

      {file && (
        <div className="upload-info">
          <p>Selected: {file.name}</p>
          <p>Size: {(file.size / 1024 / 1024).toFixed(2)} MB</p>
        </div>
      )}

      {error && (
        <div className="error">
          Error: {error}
        </div>
      )}

      {file && !uploading && (
        <button onClick={handleUpload}>
          Start Upload
        </button>
      )}

      {uploading && (
        <>
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p>{progress.toFixed(2)}% uploaded</p>
          <button onClick={handlePause}>Pause Upload</button>
        </>
      )}

      {!uploading && uploadInstance && progress > 0 && progress < 100 && (
        <button onClick={handleResume}>Resume Upload</button>
      )}
    </div>
  );
}

export default VideoUploader;
```

## Key Features

### Resumable Uploads
- Uploads automatically resume from where they left off
- Works even after browser refresh or network interruption
- No need to re-upload already transferred data

### Security
- Bunny.net credentials never exposed to client
- All requests authenticated with JWT tokens
- Upload sessions bound to authenticated user
- Automatic session expiration (1 hour)

### Performance
- Streams data directly without buffering
- 5MB chunk size for optimal throughput
- Parallel chunk uploads when possible
- Automatic retry with exponential backoff

### Error Handling
- Network interruptions handled gracefully
- Automatic retry for failed chunks
- Clear error messages for debugging
- Progress tracking and recovery

## Advanced Configuration

### Custom Chunk Size
```javascript
// Adjust based on network conditions
chunkSize: 10 * 1024 * 1024, // 10MB for fast connections
// or
chunkSize: 1 * 1024 * 1024,  // 1MB for slow/mobile connections
```

### Custom Retry Strategy
```javascript
retryDelays: [0, 1000, 3000, 5000], // Shorter delays
// or
retryDelays: null, // Disable automatic retry
```

### Parallel Uploads
```javascript
// Upload multiple files simultaneously
const uploads = files.map(file => createUpload(file));
await Promise.all(uploads.map(upload => upload.start()));
```

## Monitoring Upload Status

You can check the upload status server-side:

```javascript
// Check upload status
const statusResponse = await fetch(`/api/videos/${videoId}/upload-status`, {
  headers: {
    'Authorization': `Bearer ${token}`,
  },
});

const status = await statusResponse.json();
console.log('Upload status:', status);
```

## Troubleshooting

### Common Issues

1. **401 Unauthorized**
   - Ensure JWT token is valid and included in headers
   - Check token expiration

2. **413 Payload Too Large**
   - Reduce chunk size
   - Check Cloudflare Workers limits (100MB request body)

3. **Upload Stalls**
   - Check network connectivity
   - Verify chunk size is appropriate
   - Check browser console for errors

4. **Cannot Resume Upload**
   - Session may have expired (1 hour TTL)
   - Need to create new upload session

### Debug Mode

Enable detailed logging:

```javascript
const upload = new tus.Upload(file, {
  // ... other options
  onBeforeRequest: function(req) {
    console.log('Request:', req.getMethod(), req.getURL());
    console.log('Headers:', req.getHeaders());
  },
  onAfterResponse: function(req, res) {
    console.log('Response:', res.getStatus());
    console.log('Headers:', res.getHeaders());
  },
});
```

## Browser Support

The TUS client works in:
- Chrome 43+
- Firefox 43+
- Safari 10.1+
- Edge 12+
- iOS Safari 11+
- Chrome for Android

## Server Requirements

The TUS proxy requires:
- Cloudflare Workers environment
- KV namespace for session storage (TUS_SESSIONS)
- R2 bucket for video storage
- Valid Bunny.net Stream API credentials

## Security Best Practices

1. **Always use HTTPS** for uploads
2. **Validate file types** before upload
3. **Implement rate limiting** on the server
4. **Set reasonable file size limits**
5. **Monitor upload patterns** for abuse
6. **Rotate API keys regularly**
7. **Log upload activities** for audit

## Additional Resources

- [TUS Protocol Specification](https://tus.io/protocols/resumable-upload.html)
- [tus-js-client Documentation](https://github.com/tus/tus-js-client)
- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
- [Bunny.net Stream API](https://docs.bunny.net/reference/tus-resumable-uploads)