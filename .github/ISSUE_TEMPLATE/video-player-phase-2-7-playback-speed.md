---
name: "[Phase 2.2] Playback Speed Control"
about: Add playback rate selector (0.25x - 2x)
title: "[Phase 2.2] Implement Playback Speed Control"
labels: phase-2, video-player, enhancement, feature
assignees: ''
---

## Overview
Add playback speed control allowing users to adjust video speed from 0.25x to 2x with common presets.

## Acceptance Criteria
- [ ] Speed selector in control bar
- [ ] Speeds: 0.25x, 0.5x, 0.75x, 1x, 1.25x, 1.5x, 1.75x, 2x
- [ ] Current speed indicator
- [ ] Speed preference persisted
- [ ] Keyboard shortcuts (< and > keys)
- [ ] Speed affects audio pitch correctly
- [ ] No audio quality degradation
- [ ] Track speed changes in analytics
- [ ] RTL menu support

## Implementation

```typescript
// Already configured in VIDEO_JS_OPTIONS
playbackRates: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]

// Persist speed preference
player.on('ratechange', () => {
  const rate = player.playbackRate();
  localStorage.setItem('videoPlaybackRate', rate.toString());
  analytics.trackSpeedChange(rate);
});

// Restore saved speed
const savedRate = localStorage.getItem('videoPlaybackRate');
if (savedRate) {
  player.playbackRate(parseFloat(savedRate));
}

// Keyboard shortcuts in setupKeyboardShortcuts()
case '<':
  const currentRate = player.playbackRate();
  const slower = rates.find(r => r < currentRate) || rates[0];
  player.playbackRate(slower);
  break;
case '>':
  const faster = rates.find(r => r > currentRate) || rates[rates.length - 1];
  player.playbackRate(faster);
  break;
```

## Testing
- [ ] All speed options work
- [ ] Audio pitch preserved
- [ ] Preference persists
- [ ] Keyboard shortcuts functional
- [ ] No sync issues with subtitles

## Estimated Effort
**Small** - 2 hours
