---
name: "[Phase 4.2] RTL (Arabic) Support"
about: Full RTL layout support for Arabic interface
title: "[Phase 4.2] Implement Full RTL Support"
labels: phase-4, video-player, enhancement, i18n, accessibility
assignees: ''
---

## Overview
Ensure complete RTL (Right-to-Left) support for Arabic language users, including flipped controls, proper text direction, and culturally appropriate icons.

## Acceptance Criteria
- [ ] Control bar layout flips for RTL
- [ ] Volume slider direction flips
- [ ] Menus align to right side
- [ ] Text displays in correct direction
- [ ] Time displays remain LTR (numbers)
- [ ] Icons mirror appropriately
- [ ] Keyboard shortcuts respect RTL
- [ ] Progress bar thumb on correct side
- [ ] Tooltips positioned correctly
- [ ] No layout breaking in Arabic route

## Implementation

```css
/* RTL-specific styles */
[dir="rtl"] .video-js .vjs-control-bar {
  direction: rtl;
}

[dir="rtl"] .video-js .vjs-control-bar > * {
  float: right;
}

[dir="rtl"] .video-js .vjs-volume-panel {
  order: -1;
}

[dir="rtl"] .video-js .vjs-menu {
  left: auto;
  right: 0;
}

[dir="rtl"] .video-js .vjs-progress-control {
  direction: rtl;
}

/* Keep time displays LTR */
[dir="rtl"] .video-js .vjs-time-control {
  direction: ltr;
}
```

```typescript
// Detect and apply RTL
export function CustomVideoPlayer(props: CustomVideoPlayerProps) {
  useEffect(() => {
    if (playerRef.current && props.rtl) {
      const el = playerRef.current.el();
      el.setAttribute('dir', 'rtl');
      el.classList.add('vjs-rtl');
    }
  }, [props.rtl]);

  return (
    <div dir={props.rtl ? 'rtl' : 'ltr'}>
      {/* player */}
    </div>
  );
}
```

## Testing
- [ ] Test in `/ar/` route
- [ ] All controls mirrored
- [ ] Text readable
- [ ] No overlapping elements
- [ ] Keyboard shortcuts work
- [ ] Mobile RTL correct

## Estimated Effort
**Small** - 2-3 hours
