---
name: "[Phase 2.6] Fullscreen and Picture-in-Picture Modes"
about: Implement fullscreen and PiP functionality
title: "[Phase 2.6] Add Fullscreen and Picture-in-Picture Modes"
labels: phase-2, video-player, enhancement, feature
assignees: ''
---

## Overview
Implement fullscreen and Picture-in-Picture (PiP) modes with proper browser compatibility and mobile support.

## Acceptance Criteria
- [ ] Fullscreen button in control bar
- [ ] PiP button in control bar
- [ ] F key enters/exits fullscreen
- [ ] P key enters/exits PiP
- [ ] Double-click enters fullscreen
- [ ] Browser compatibility detection
- [ ] iOS fullscreen handled correctly
- [ ] PiP availability detection
- [ ] Fullscreen orientation lock (landscape)
- [ ] Exit fullscreen on video end
- [ ] Track fullscreen/PiP usage in analytics

## Implementation

```typescript
// Fullscreen configuration (already in VideoJS options)
controlBar: {
  fullscreenToggle: true,
  pictureInPictureToggle: true
}

// Double-click fullscreen
player.on('dblclick', () => {
  if (player.isFullscreen()) {
    player.exitFullscreen();
  } else {
    player.requestFullscreen();
  }
});

// Track fullscreen changes
player.on('fullscreenchange', () => {
  const isFullscreen = player.isFullscreen();
  analytics.trackFullscreenChange(isFullscreen);

  // Lock orientation on mobile
  if (isFullscreen && screen.orientation) {
    screen.orientation.lock('landscape').catch(() => {});
  }
});

// PiP support detection
player.ready(() => {
  if (!document.pictureInPictureEnabled) {
    const pipButton = player.controlBar.pictureInPictureToggle;
    if (pipButton) pipButton.hide();
  }
});

// Track PiP changes
player.on('enterpictureinpicture', () => {
  analytics.trackPictureInPicture(true);
});

player.on('leavepictureinpicture', () => {
  analytics.trackPictureInPicture(false);
});

// Exit fullscreen on video end
player.on('ended', () => {
  if (player.isFullscreen()) {
    player.exitFullscreen();
  }
});

// iOS fullscreen handling
if (/iPad|iPhone|iPod/.test(navigator.userAgent)) {
  const videoElement = player.el().querySelector('video');
  if (videoElement) {
    (videoElement as any).webkitEnterFullscreen = function() {
      player.trigger('fullscreenchange');
    };
  }
}
```

## Testing
- [ ] Fullscreen works on desktop
- [ ] Fullscreen works on mobile
- [ ] iOS fullscreen behaves correctly
- [ ] PiP works (Chrome, Safari)
- [ ] Keyboard shortcuts functional
- [ ] Double-click toggle works
- [ ] Orientation locks on mobile
- [ ] Analytics tracked correctly

## Estimated Effort
**Small** - 2-3 hours
