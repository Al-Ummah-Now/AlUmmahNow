// Video upload configuration constants
export const VIDEO_UPLOAD_CONFIG = {
  // Maximum file size: 2GB
  MAX_FILE_SIZE: 2 * 1024 * 1024 * 1024,
  
  // Allowed video file types
  ALLOWED_TYPES: ['video/mp4', 'video/mov', 'video/avi', 'video/webm'],
  
  // Maximum video duration: 2 hours in seconds
  MAX_DURATION: 60 * 60 * 2,
  
  // File type display names for error messages
  ALLOWED_TYPES_DISPLAY: 'MP4, MOV, AVI, or WebM',
  
  // Human readable size limit
  MAX_FILE_SIZE_DISPLAY: '2GB',
  
  // Human readable duration limit
  MAX_DURATION_DISPLAY: '2 hours',

  // Bunny.net CDN base URL - configurable via environment variable
  BUNNY_CDN_BASE_URL: process.env.NEXT_PUBLIC_BUNNY_CDN_URL || 'https://video.bunnycdn.com',

  // Upload polling configuration
  POLLING: {
    // Maximum number of status checks (6 polls * 5 seconds = 30 seconds)
    MAX_POLLS: 6,
    // Interval between polls in milliseconds
    INTERVAL_MS: 5000,
  },
} as const;

// Error messages
export const VIDEO_UPLOAD_ERRORS = {
  INVALID_TYPE: `Please upload a valid video file (${VIDEO_UPLOAD_CONFIG.ALLOWED_TYPES_DISPLAY})`,
  FILE_TOO_LARGE: `File size must be less than ${VIDEO_UPLOAD_CONFIG.MAX_FILE_SIZE_DISPLAY}`,
  DURATION_TOO_LONG: `Video duration must be less than ${VIDEO_UPLOAD_CONFIG.MAX_DURATION_DISPLAY}`,
  AUTH_REQUIRED: 'Authentication required. Please log in to upload videos.',
  UPLOAD_FAILED: 'Upload failed. Please try again.',
} as const;