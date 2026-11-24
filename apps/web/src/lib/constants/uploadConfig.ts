import { VIDEO_FORMATS, videoFormatsText } from '@/lib/upload/video-formats';

// Video upload configuration constants
export const VIDEO_UPLOAD_CONFIG = {
  // Maximum file size: No limit (Bunny.net handles large files via TUS)
  MAX_FILE_SIZE: Infinity,

  // The type sent to the server for each accepted format (lib/upload/video-formats.ts decides what a file is)
  ALLOWED_TYPES: VIDEO_FORMATS.map((f) => f.mimeType),

  // Maximum video duration: No limit
  MAX_DURATION: Infinity,

  // File type display names for error messages
  ALLOWED_TYPES_DISPLAY: videoFormatsText('en'),

  // Human readable size limit
  MAX_FILE_SIZE_DISPLAY: 'No limit',

  // Human readable duration limit
  MAX_DURATION_DISPLAY: 'No limit',

  // Bunny.net CDN base URL - configurable via environment variable
  BUNNY_CDN_BASE_URL: process.env.NEXT_PUBLIC_BUNNY_CDN_URL || 'https://video.bunnycdn.com',

  // Upload polling configuration
  POLLING: {
    // Maximum number of status checks (6 polls * 5 seconds = 30 seconds)
    MAX_POLLS: 6,
    // Interval between polls in milliseconds
    INTERVAL_MS: 5000,
  },
};

// Error messages
export const VIDEO_UPLOAD_ERRORS = {
  INVALID_TYPE: 'Please upload a valid video file ({formats})',
  FILE_TOO_LARGE: `File size must be less than ${VIDEO_UPLOAD_CONFIG.MAX_FILE_SIZE_DISPLAY}`,
  DURATION_TOO_LONG: `Video duration must be less than ${VIDEO_UPLOAD_CONFIG.MAX_DURATION_DISPLAY}`,
  AUTH_REQUIRED: 'Authentication required. Please log in to upload videos.',
  UPLOAD_FAILED: 'Upload failed. Please try again.',
} as const;