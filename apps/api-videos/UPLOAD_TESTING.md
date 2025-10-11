# Video Upload Pipeline Testing Guide

## Overview
This guide describes how to test the new video upload pipeline that integrates with Bunny.net Stream API.

## Prerequisites
1. Bunny.net Stream account with:
   - Library ID configured in `BUNNY_STREAM_LIBRARY_ID` secret
   - Access key configured in `bunny-stream-key` secret
2. Valid authentication token (JWT)
3. Test video file (MP4, MOV, AVI, or WebM format, max 2GB)

## Backend API Endpoints

### 1. Initiate Upload
**Endpoint:** `POST /api/videos/upload/initiate`

**Headers:**
```
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json
```

**Request Body:**
```json
{
  "title": "Test Video",
  "description": "A test video upload",
  "isPublic": true,
  "tags": "test,demo"
}
```

**Expected Response:**
```json
{
  "success": true,
  "result": {
    "videoId": "uuid-here",
    "uploadUrl": "https://video.bunnycdn.com/library/{libraryId}/videos/{videoId}",
    "libraryId": 12345,
    "status": "initiated",
    "message": "Upload initiated successfully. Use the uploadUrl to upload your video file."
  }
}
```

**Using curl:**
```bash
curl -X POST http://127.0.0.1:8686/api/videos/upload/initiate \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Test Video",
    "description": "A test video upload",
    "isPublic": true,
    "tags": "test,demo"
  }'
```

### 2. Upload File to Bunny.net
**Endpoint:** Use the `uploadUrl` from step 1

**Headers:**
```
AccessKey: <BUNNY_STREAM_ACCESS_KEY>
Content-Type: application/octet-stream
```

**Body:** Raw video file binary

**Using curl:**
```bash
curl -X PUT "https://video.bunnycdn.com/library/{libraryId}/videos/{videoId}" \
  -H "AccessKey: YOUR_BUNNY_KEY" \
  -H "Content-Type: application/octet-stream" \
  --data-binary "@/path/to/video.mp4"
```

### 3. Complete Upload
**Endpoint:** `POST /api/videos/upload/complete`

**Headers:**
```
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json
```

**Request Body:**
```json
{
  "videoId": "uuid-from-step-1",
  "fileSize": 12345678,
  "duration": 120
}
```

**Expected Response:**
```json
{
  "success": true,
  "result": {
    "videoId": "uuid-here",
    "status": "processing",
    "message": "Upload completed successfully. Video is now being processed."
  }
}
```

**Using curl:**
```bash
curl -X POST http://127.0.0.1:8686/api/videos/upload/complete \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "videoId": "uuid-from-step-1",
    "fileSize": 12345678,
    "duration": 120
  }'
```

### 4. Check Upload Status
**Endpoint:** `GET /api/videos/{videoId}/upload-status`

**Headers:**
```
Authorization: Bearer <JWT_TOKEN>
```

**Expected Response:**
```json
{
  "success": true,
  "result": {
    "videoId": "uuid-here",
    "status": "processing",
    "progress": 75,
    "message": "Video is being encoded",
    "encodingStatus": {
      "isProcessing": true,
      "encodingProgress": 75,
      "availableResolutions": ["360p", "720p"]
    },
    "metadata": {
      "title": "Test Video",
      "duration": 120,
      "fileSize": 12345678,
      "originalFormat": "video/mp4"
    },
    "timestamps": {
      "uploadStarted": "2025-10-11T17:00:00.000Z",
      "uploadCompleted": "2025-10-11T17:05:00.000Z"
    }
  }
}
```

**Using curl:**
```bash
curl http://127.0.0.1:8686/api/videos/{videoId}/upload-status \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## Frontend Testing

### Web UI Upload Flow

1. **Navigate to Upload Page:**
   - English: `/en/upload`
   - Arabic: `/ar/upload`

2. **Select Video File:**
   - Drag and drop video file OR click to browse
   - File should be validated for:
     - Format: MP4, MOV, AVI, or WebM
     - Size: Max 2GB
     - Duration: Max 2 hours

3. **Enter Metadata:**
   - Title (required)
   - Description (optional)
   - Public/Private toggle
   - Tags (optional)

4. **Upload Process:**
   - Progress bar shows: 0-5% (Preparing)
   - Progress bar shows: 5-10% (Initiating)
   - Progress bar shows: 10-70% (Uploading - real-time progress)
   - Progress bar shows: 75-85% (Completing)
   - Progress bar shows: 85-100% (Processing - polls every 5 seconds)

5. **Completion:**
   - Success message displayed
   - Redirect to video page

### Error Scenarios to Test

1. **Authentication Required:**
   - Attempt upload without being logged in
   - Expected: Error message "Authentication required"

2. **Invalid File Type:**
   - Upload .txt or .pdf file
   - Expected: Error "Please upload a valid video file"

3. **File Too Large:**
   - Upload file > 2GB
   - Expected: Error "File size must be less than 2GB"

4. **Network Error:**
   - Disconnect network during upload
   - Expected: Error message and ability to retry

5. **Upload Cancellation:**
   - Click "Cancel Upload" during upload
   - Expected: Upload stops, form resets

## Queue Events Testing

Check that these events are sent to the queue:

1. **VideoUploadStarted** - When upload is initiated
2. **VideoUploadCompleted** - When upload to Bunny.net completes
3. **VideoUploadFailed** - When upload fails
4. **VideoProcessingCompleted** - When Bunny.net finishes encoding

## Video Status Flow

The video should go through these status transitions:

1. `initiated` - Video record created, waiting for file upload
2. `uploading` - File is being uploaded to Bunny.net
3. `processing` - File uploaded, Bunny.net is encoding
4. `ready` - Encoding complete, video is ready to watch
5. `failed` - Upload or processing failed

## Bunny.net Stream Status Mapping

Bunny.net status codes map to our status as follows:

- 0 (Queued) → `uploading` (progress: 10%)
- 1 (Processing) → `processing` (progress: 25-50%)
- 2 (Encoding) → `processing` (progress: 50-75%)
- 3 (Finished) → `ready` (progress: 100%)
- 4 (Error) → `failed` (progress: 0%)
- 5 (Deleted) → `deleted` (progress: 0%)

## Environment Variables

Ensure these are configured:

### Backend (api-videos)
- `bunny-stream-key` - Bunny.net Stream API access key (Cloudflare Secret)
- `bunny_stream_library_id` - Bunny.net Stream library ID (Cloudflare Secret)
- `ZONE` - Bunny.net image storage zone (env var)

### Frontend (web)
- `NEXT_PUBLIC_API_URL` - API base URL
- `BUNNY_STREAM_KEY` - Bunny.net access key (for server actions only)

## Troubleshooting

### Upload Fails at Initiation
- Check JWT token is valid
- Verify Bunny.net credentials are configured
- Check backend logs for errors

### Upload Fails During File Transfer
- Verify Bunny.net access key is correct
- Check network connectivity
- Ensure file format is supported

### Status Never Becomes "Ready"
- Check Bunny.net dashboard for encoding status
- Verify video format is supported by Bunny.net
- Check for transcoding errors in Bunny.net logs

### Progress Not Updating
- Ensure status polling is working (check network tab)
- Verify `getVideoUploadStatus` is returning correct data
- Check browser console for JavaScript errors
