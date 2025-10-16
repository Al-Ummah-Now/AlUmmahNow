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
      playback: 'Playback Error',
      timeout: 'Timeout Error',
      unknown: 'Unknown Error',
    },

    description: {
      network:
        'Unable to load the video. Please check your internet connection and try again.',
      format:
        'This video format is not supported by your browser. Try using a different browser or updating your current one.',
      playback:
        'An error occurred during video playback. Please try reloading the video.',
      timeout:
        'The video took too long to load. Please check your connection and try again.',
      unknown:
        'An unexpected error occurred while playing the video. Please try again.',
    },

    retryButton: 'Try Again',

    fallbackButton: {
      network: 'Reload Video',
      format: 'Try Different Browser',
      playback: 'Reload Video',
      timeout: 'Reload Video',
      unknown: 'Reload Page',
    },

    details: {
      network:
        'The video could not be loaded due to a network issue. This might be caused by:\n\n• Poor internet connection\n• Server is temporarily unavailable\n• Video file is not accessible\n\nTry refreshing the page or check your network settings.',
      format:
        'Your browser does not support this video format. Possible solutions:\n\n• Use a modern browser (Chrome, Firefox, Safari, Edge)\n• Update your current browser to the latest version\n• Try a different video quality setting\n\nSupported formats: MP4 (H.264), WebM (VP8/VP9)',
      playback:
        'An error occurred while playing the video. This could be due to:\n\n• Corrupted video data\n• Playback interruption\n• Hardware acceleration issues\n\nTry disabling hardware acceleration in browser settings.',
      timeout:
        'The video took too long to load. This might be caused by:\n\n• Slow internet connection\n• Large video file size\n• Server response delay\n\nTry using a lower quality setting or check your internet speed.',
      unknown:
        'An unexpected error occurred. This could be due to:\n\n• Temporary browser issue\n• Corrupted cache\n• Browser extension conflict\n\nTry clearing your browser cache, disabling extensions, or using a different browser.',
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
