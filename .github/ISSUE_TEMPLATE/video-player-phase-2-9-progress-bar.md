---
name: "[Phase 2.4] Progress Bar with Hover Preview"
about: Enhanced progress bar with thumbnail preview on hover
title: "[Phase 2.4] Create Progress Bar with Hover Preview"
labels: phase-2, video-player, enhancement, feature, ux
assignees: ''
---

## Overview
Enhance the video progress bar with thumbnail previews on hover, showing users what content is at each timestamp.

## Acceptance Criteria
- [ ] Thumbnail preview appears on progress bar hover
- [ ] Timestamp tooltip shown above thumbnail
- [ ] Preview follows mouse position smoothly
- [ ] Uses Bunny.net's thumbnail sprite sheet
- [ ] Works on desktop (hover) and mobile (touch-hold)
- [ ] Precise seeking via click
- [ ] Buffered ranges visualization
- [ ] Watched segments highlighted (darker)
- [ ] RTL support for tooltip positioning
- [ ] Performance optimized (no lag)

## Implementation

**Install plugin:**
```bash
pnpm --filter @al-ummah/web add videojs-sprite-thumbnails
```

```typescript
import 'videojs-sprite-thumbnails';

// Configure thumbnail sprite
player.spriteThumbnails({
  interval: 5,  // Thumbnail every 5 seconds
  url: bunnyService.getPreviewUrl(bunnyVideoId),
  width: 160,
  height: 90
});
```

**Custom progress bar styling:**
```css
.vjs-progress-control:hover .vjs-thumbnail-holder {
  display: block;
}

.vjs-thumbnail-holder {
  position: absolute;
  bottom: 100%;
  left: 0;
  transform: translateX(-50%);
  background: #000;
  border: 2px solid #fff;
  border-radius: 4px;
  padding: 4px;
}

.vjs-thumbnail-time {
  text-align: center;
  margin-top: 4px;
  font-size: 12px;
}

/* Watched segments */
.vjs-play-progress.watched {
  background: rgba(255, 255, 255, 0.5);
}
```

## Testing
- [ ] Preview loads correctly
- [ ] Follows mouse smoothly
- [ ] Timestamp accurate
- [ ] No performance impact
- [ ] Works on mobile
- [ ] RTL layout correct

## Estimated Effort
**Small** - 2-3 hours
