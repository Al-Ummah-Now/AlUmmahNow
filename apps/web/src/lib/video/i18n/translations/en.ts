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

  gestures: {
    hint: 'Double-tap the sides to seek 10 seconds. Swipe up or down to change the volume.',
    dismiss: 'Dismiss',
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
    currentTime: 'Current time',
    duration: 'Total duration',
    qualityButton: 'Video quality',
    keyboardHelpButton: 'Show keyboard shortcuts',
    keyboardHelpButtonTitle: 'Keyboard shortcuts (?)',
    announcements: {
      playing: 'Playing',
      paused: 'Paused',
      muted: 'Muted',
      volume: 'Volume {volume}%',
      fullscreenOn: 'Fullscreen mode',
      fullscreenOff: 'Exited fullscreen',
      playbackError: 'Video playback error',
      buffering: 'Buffering...',
      readyToPlay: 'Ready to play',
    },
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
    pictureInPicture: 'Picture-in-Picture',
    exitPictureInPicture: 'Exit Picture-in-Picture',
    pipNotAvailable: 'Picture-in-Picture not available',
    pipNotSupported: 'Picture-in-Picture not supported',
    settings: 'Settings',
    captions: 'Captions',
    quality: 'Quality',
    speed: 'Speed',
    volume: 'Volume',
  },

  chrome: {
    next: 'Next video',
    theatre: 'Theatre mode',
    exitTheatre: 'Exit theatre mode',
    off: 'Off',
    back: 'Back',
    audioTrack: 'Audio track',
    shortcuts: 'Keyboard shortcuts',
    captionStyle: 'Caption style',
    live: 'Live',
    goToLive: 'Go to live',
    behind: '{time} behind',
    upNext: 'Up next',
    playNow: 'Play now',
    watchAgain: 'Watch again',
    cancel: 'Cancel',
    autoAdvance: 'Next video in {seconds} seconds',
    playTitle: 'Play {title}',
    closeMiniPlayer: 'Close mini player',
    backToVideo: 'Back to video',
    reportProblem: 'Report a problem',
    seekValue: '{current} of {total}',
    tapToUnmute: 'Tap to unmute',
    autoplayNext: 'Autoplay next',
    autoplay: 'Autoplay',
    autoplayOn: 'Autoplay is on',
    autoplayOff: 'Autoplay is off',
    moreVideos: 'More videos',
    replayPlaylist: 'Replay playlist',
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

  keyboard: {
    title: 'Keyboard Shortcuts',
    description: 'Control the video player with your keyboard',
    sections: {
      playback: 'Playback',
      seeking: 'Seeking',
      volume: 'Volume',
      display: 'Display',
      speed: 'Speed',
      navigation: 'Navigation',
    },
    shortcuts: {
      playPause: {
        keys: 'Space, K',
        description: 'Play/Pause',
      },
      rewind5: {
        keys: '←',
        description: 'Rewind 5 seconds',
      },
      rewind10: {
        keys: 'J',
        description: 'Rewind 10 seconds',
      },
      forward5: {
        keys: '→',
        description: 'Forward 5 seconds',
      },
      forward10: {
        keys: 'L',
        description: 'Forward 10 seconds',
      },
      volumeUp: {
        keys: '↑',
        description: 'Increase volume',
      },
      volumeDown: {
        keys: '↓',
        description: 'Decrease volume',
      },
      mute: {
        keys: 'M',
        description: 'Mute/Unmute',
      },
      fullscreen: {
        keys: 'F',
        description: 'Toggle fullscreen',
      },
      pip: {
        keys: 'P',
        description: 'Picture-in-Picture',
      },
      speedDecrease: {
        keys: '<',
        description: 'Decrease speed',
      },
      speedIncrease: {
        keys: '>',
        description: 'Increase speed',
      },
      seekPercent: {
        keys: '0-9',
        description: 'Jump to 0%-90%',
      },
      help: {
        keys: '?',
        description: 'Show this list of shortcuts',
      },
      tabNavigation: {
        keys: 'Tab, Shift+Tab',
        description: 'Move between player controls',
      },
      activate: {
        keys: 'Enter, Space',
        description: 'Activate the focused control',
      },
      closeDialog: {
        keys: 'Esc',
        description: 'Close menus and dialogs',
      },
      captions: {
        keys: 'C',
        description: 'Turn captions on or off',
      },
      theatre: {
        keys: 'T',
        description: 'Theatre mode',
      },
      next: {
        keys: 'N',
        description: 'Next video',
      },
    },
    closeButton: 'Close',
  },

  resume: {
    startOverButton: 'Start from beginning',
    resumingAt: 'Resuming at {time}',
    resumeAtButton: 'Resume at {time}',
  },

  pluralization: {
    videos: { zero: 'no videos', one: '1 video', other: '{{count}} videos' },
    comments: { zero: 'no comments', one: '1 comment', other: '{{count}} comments' },
    views: { zero: 'no views', one: '1 view', other: '{{count}} views' },
    hours: { one: '1 hour', other: '{{count}} hours' },
    minutes: { one: '1 minute', other: '{{count}} minutes' },
    seconds: { one: '1 second', other: '{{count}} seconds' },
  },
};
