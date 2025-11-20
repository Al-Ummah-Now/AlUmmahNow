#!/bin/bash

# Test script for TUS Upload Integration
# This demonstrates the complete TUS upload flow

API_URL="${API_URL:-http://127.0.0.1:3086}"
TOKEN="${TOKEN:-your-jwt-token-here}"

echo "========================================="
echo "TUS Upload Test Script"
echo "========================================="
echo "API URL: $API_URL"
echo ""

# Step 1: Initiate Upload
echo "Step 1: Initiating upload..."
RESPONSE=$(curl -s -X POST "$API_URL/api/videos/upload/initiate" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Test TUS Upload Video",
    "description": "Testing TUS resumable upload",
    "fileSize": 10485760,
    "mimeType": "video/mp4",
    "isPublic": true,
    "tags": "test,tus,upload"
  }')

echo "Response:"
echo "$RESPONSE" | jq .

# Extract video ID and TUS configuration
VIDEO_ID=$(echo "$RESPONSE" | jq -r '.result.videoId')
TUS_ENDPOINT=$(echo "$RESPONSE" | jq -r '.result.tusEndpoint')
AUTH_SIGNATURE=$(echo "$RESPONSE" | jq -r '.result.tusHeaders.AuthorizationSignature')
AUTH_EXPIRE=$(echo "$RESPONSE" | jq -r '.result.tusHeaders.AuthorizationExpire')
LIBRARY_ID=$(echo "$RESPONSE" | jq -r '.result.tusHeaders.LibraryId')

if [ "$VIDEO_ID" = "null" ]; then
  echo "Error: Failed to initiate upload"
  exit 1
fi

echo ""
echo "Video ID: $VIDEO_ID"
echo "TUS Endpoint: $TUS_ENDPOINT"
echo ""

# Step 2: Show how to use TUS configuration with tus-js-client
echo "Step 2: TUS Upload Configuration"
echo "========================================="
echo "Use the following headers with a TUS client:"
echo "  AuthorizationSignature: $AUTH_SIGNATURE"
echo "  AuthorizationExpire: $AUTH_EXPIRE"
echo "  LibraryId: $LIBRARY_ID"
echo "  VideoId: $VIDEO_ID"
echo ""

# Step 3: Simulate upload interruption and resume
echo "Step 3: Testing Resume Functionality..."
echo "========================================="
sleep 2

RESUME_RESPONSE=$(curl -s -X GET "$API_URL/api/videos/upload/resume/$VIDEO_ID" \
  -H "Authorization: Bearer $TOKEN")

echo "Resume Response:"
echo "$RESUME_RESPONSE" | jq .

NEW_AUTH_SIGNATURE=$(echo "$RESUME_RESPONSE" | jq -r '.result.tusHeaders.AuthorizationSignature')
if [ "$NEW_AUTH_SIGNATURE" != "null" ]; then
  echo ""
  echo "✅ Resume successful! New signature generated."
  echo "New AuthorizationSignature: $NEW_AUTH_SIGNATURE"
else
  echo ""
  echo "❌ Resume failed"
fi

echo ""
echo "========================================="
echo "JavaScript Client Example:"
echo "========================================="
cat << 'EOF'
// Install: npm install tus-js-client

import * as tus from 'tus-js-client';

// Use the TUS configuration from the API response
const upload = new tus.Upload(file, {
  endpoint: tusEndpoint,
  headers: {
    'AuthorizationSignature': tusHeaders.AuthorizationSignature,
    'AuthorizationExpire': tusHeaders.AuthorizationExpire,
    'LibraryId': tusHeaders.LibraryId,
    'VideoId': tusHeaders.VideoId,
  },
  chunkSize: chunkSize, // 5MB recommended
  retryDelays: [0, 3000, 5000, 10000, 20000],
  metadata: {
    filename: file.name,
    filetype: file.type,
  },
  onError: function (error) {
    console.log("Failed because: " + error);
  },
  onProgress: function (bytesUploaded, bytesTotal) {
    const percentage = ((bytesUploaded / bytesTotal) * 100).toFixed(2);
    console.log(bytesUploaded, bytesTotal, percentage + "%");
  },
  onSuccess: function () {
    console.log("Download %s from %s", upload.file.name, upload.url);
    // Call the complete endpoint
    fetch('/api/videos/upload/complete', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        videoId: videoId,
        fileSize: file.size,
      }),
    });
  },
});

// Check if there are any previous uploads to continue
upload.findPreviousUploads().then(function (previousUploads) {
  if (previousUploads.length) {
    upload.resumeFromPreviousUpload(previousUploads[0]);
  }

  // Start the upload
  upload.start();
});
EOF

echo ""
echo "========================================="
echo "Test complete!"