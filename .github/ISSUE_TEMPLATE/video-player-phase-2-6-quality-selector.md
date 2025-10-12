---
name: "[Phase 2.1] Quality Selector with Adaptive Bitrate"
about: Add resolution selector with automatic quality switching
title: "[Phase 2.1] Implement Quality Selector with Adaptive Bitrate"
labels: phase-2, video-player, enhancement, feature
assignees: ''
---

## Overview
Implement quality selector allowing users to choose video resolution (auto, 240p-1080p) with adaptive bitrate switching based on network conditions.

## Acceptance Criteria
- [ ] Quality selector button in control bar
- [ ] Auto quality selection (adaptive bitrate)
- [ ] Manual quality selection (240p, 360p, 480p, 720p, 1080p)
- [ ] Quality menu with current quality indicator
- [ ] Smooth quality transitions without rebuffering
- [ ] Quality preference persisted in localStorage
- [ ] Track quality changes in analytics
- [ ] RTL support for menu layout
- [ ] Mobile-friendly touch targets
- [ ] No quality downgrade for buffering

## Implementation

**Use Video.js quality plugins:**
- `videojs-contrib-quality-levels` - Detects available qualities
- `videojs-hls-quality-selector` - UI for quality selection

```typescript
// In CustomVideoPlayer.tsx
player.hlsQualitySelector({
  displayCurrentQuality: true,
  placementIndex: 0  // Position in control bar
});

// Track quality changes
player.on('qualitychanged', (e: any) => {
  const { from, to } = e;
  analytics.trackQualityChange(from, to);
  localStorage.setItem('videoQualityPreference', to);
});

// Restore saved quality
const savedQuality = localStorage.getItem('videoQualityPreference');
if (savedQuality && savedQuality !== 'auto') {
  player.on('loadedmetadata', () => {
    const qualityLevels = player.qualityLevels();
    for (let i = 0; i < qualityLevels.length; i++) {
      qualityLevels[i].enabled = qualityLevels[i].height === parseInt(savedQuality);
    }
  });
}
```

## Testing
- [ ] All qualities selectable
- [ ] Auto mode adapts to network speed
- [ ] Preference persists across sessions
- [ ] No playback interruption on manual switch
- [ ] Works on mobile networks

## Estimated Effort
**Small** - 2-3 hours
