/**
 * English Translations for Video Player
 *
 * Complete set of English UI strings for the video player.
 */

import type { VideoPlayerTranslations } from '../types';

export const EN_TRANSLATIONS: VideoPlayerTranslations = {
  player: {
    loading: 'Loading video player...',
    ready: 'Video player loaded and ready',
    buffering: 'Buffering...',
    error: 'Error loading video',
  },

  accessibility: {
    videoPlayer: 'Video player',
    playButton: 'Play video',
    pauseButton: 'Pause video',
    muteButton: 'Mute audio',
    unmuteButton: 'Unmute audio',
    fullscreenButton: 'Enter fullscreen',
    exitFullscreenButton: 'Exit fullscreen',
    volumeSlider: 'Volume control',
    progressBar: 'Video progress',
    seekSlider: 'Seek video',
  },

  errors: {
    title: {
      network: 'Network Error',
      format: 'Format Error',
      permission: 'Permission Error',
      unknown: 'Unknown Error',
      timeout: 'Timeout Error',
      quota: 'Storage Quota Exceeded',
      initialization: 'Initialization Error',
      drm: 'DRM Error',
      playback: 'Playback Error',
      buffer: 'Buffer Error',
    },

    description: {
      network:
        'Unable to load the video. Please check your internet connection and try again.',
      format:
        'This video format is not supported by your browser. Try using a different browser or updating your current one.',
      permission:
        'Permission denied to access the video. Please check your browser settings.',
      unknown:
        'An unexpected error occurred while playing the video. Please try again.',
      timeout:
        'The video took too long to load. Please check your connection and try again.',
      quota:
        'Storage quota exceeded. Please free up some space and reload the page.',
      initialization:
        'Failed to initialize the video player. Please reload the page.',
      drm: 'Unable to access protected content. Please verify your subscription status.',
      playback:
        'An error occurred during video playback. Please try reloading the video.',
      buffer:
        'Video buffering error. Please check your internet connection.',
    },

    retryButton: 'Try Again',

    fallbackButton: {
      network: 'Reload Video',
      format: 'Try Different Browser',
      permission: 'Check Permissions',
      unknown: 'Reload Page',
      timeout: 'Reload Video',
      quota: 'Reload Page',
      initialization: 'Reload Page',
      drm: 'Verify Subscription',
      playback: 'Reload Video',
      buffer: 'Reload Video',
    },

    details: {
      network:
        'The video could not be loaded due to a network issue. This might be caused by:\n\n• Poor internet connection\n• Server is temporarily unavailable\n• Video file is not accessible\n\nTry refreshing the page or check your network settings.',
      format:
        'Your browser does not support this video format. Possible solutions:\n\n• Use a modern browser (Chrome, Firefox, Safari, Edge)\n• Update your current browser to the latest version\n• Try a different video quality setting\n\nSupported formats: MP4 (H.264), WebM (VP8/VP9)',
      permission:
        'The video player does not have permission to access required resources. To fix this:\n\n• Check your browser security settings\n• Allow video playback for this site\n• Disable browser extensions that might block media\n• Try using incognito/private mode',
      unknown:
        'An unexpected error occurred. This could be due to:\n\n• Temporary browser issue\n• Corrupted cache\n• Browser extension conflict\n\nTry clearing your browser cache, disabling extensions, or using a different browser.',
      timeout:
        'The video took too long to load. This might be caused by:\n\n• Slow internet connection\n• Large video file size\n• Server response delay\n\nTry using a lower quality setting or check your internet speed.',
      quota:
        'Your browser has run out of storage space. To resolve:\n\n• Clear browser cache and cookies\n• Remove downloaded files\n• Free up disk space on your device\n\nAfter freeing space, reload the page.',
      initialization:
        'Failed to start the video player. Possible causes:\n\n• Browser compatibility issue\n• Missing required features\n• Page loading error\n\nTry reloading the page or using a different browser.',
      drm: 'This video is protected and requires verification. Issues might include:\n\n• Expired subscription\n• Invalid credentials\n• Unsupported device\n\nVerify your subscription status and try again.',
      playback:
        'An error occurred while playing the video. This could be due to:\n\n• Corrupted video data\n• Playback interruption\n• Hardware acceleration issues\n\nTry disabling hardware acceleration in browser settings.',
      buffer:
        'Video buffering failed. Possible reasons:\n\n• Unstable internet connection\n• Insufficient bandwidth\n• Server congestion\n\nTry lowering the video quality or checking your connection.',
    },

    detailLabels: {
      type: 'Type:',
      message: 'Message:',
      code: 'Code:',
      time: 'Time:',
      severity: 'Severity:',
      detailsTitle: 'Error Details',
    },
  },

  controls: {
    play: 'Play',
    pause: 'Pause',
    mute: 'Mute',
    unmute: 'Unmute',
    fullscreen: 'Fullscreen',
    exitFullscreen: 'Exit Fullscreen',
    settings: 'Settings',
    captions: 'Captions',
    quality: 'Quality',
    speed: 'Speed',
    volume: 'Volume',
  },

  quality: {
    auto: 'Auto',
    high: 'High',
    medium: 'Medium',
    low: 'Low',
    labels: {
      '2160p': '4K (2160p)',
      '1080p': 'Full HD (1080p)',
      '720p': 'HD (720p)',
      '480p': 'SD (480p)',
      '360p': 'Low (360p)',
      '240p': 'Very Low (240p)',
    },
  },

  speed: {
    normal: 'Normal',
    labels: {
      '0.25': '0.25x',
      '0.5': '0.5x',
      '0.75': '0.75x',
      '1': 'Normal',
      '1.25': '1.25x',
      '1.5': '1.5x',
      '1.75': '1.75x',
      '2': '2x',
    },
  },

  time: {
    hours: 'hours',
    minutes: 'minutes',
    seconds: 'seconds',
    live: 'Live',
    elapsed: 'Elapsed',
    remaining: 'Remaining',
  },
};
