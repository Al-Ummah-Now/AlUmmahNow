---
name: "[Phase 4.1] Custom Control Skin Design"
about: Design and implement custom video player UI
title: "[Phase 4.1] Design and Implement Custom Control Skin"
labels: phase-4, video-player, enhancement, ui, design
assignees: ''
---

## Overview
Create a custom, YouTube-like control skin matching Al Ummah Now's design system with modern aesthetics and smooth animations.

## Acceptance Criteria
- [ ] Custom control bar design
- [ ] Modern play button with animation
- [ ] Gradient control background
- [ ] Custom progress bar with hover effects
- [ ] Styled volume control
- [ ] Custom quality/speed menus
- [ ] Smooth transitions and animations
- [ ] Dark/light theme support
- [ ] Matches existing design system
- [ ] Professional appearance

## Implementation

**Custom CSS theme:**
```css
/* apps/web/src/components/VideoPlayer/custom-theme.css */
.video-js {
  --primary-color: #3b82f6;
  --control-bg: rgba(0, 0, 0, 0.8);
  --control-text: #ffffff;
  --progress-bg: rgba(255, 255, 255, 0.3);
  --progress-filled: var(--primary-color);
}

.video-js .vjs-big-play-button {
  width: 88px;
  height: 88px;
  border-radius: 50%;
  background: rgba(59, 130, 246, 0.9);
  border: none;
  backdrop-filter: blur(10px);
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.video-js .vjs-big-play-button:hover {
  background: rgba(59, 130, 246, 1);
  transform: scale(1.1);
}

.video-js .vjs-control-bar {
  background: linear-gradient(
    to top,
    rgba(0, 0, 0, 0.9),
    rgba(0, 0, 0, 0.7),
    transparent
  );
  height: 4.5rem;
  padding: 0 1rem;
}

.video-js .vjs-progress-control {
  position: absolute;
  top: -8px;
  left: 0;
  right: 0;
  height: 8px;
  transition: height 0.2s;
}

.video-js .vjs-progress-control:hover {
  height: 12px;
}

.video-js .vjs-progress-holder {
  height: 100%;
  border-radius: 4px;
  overflow: hidden;
}

.video-js .vjs-play-progress {
  background: var(--progress-filled);
  box-shadow: 0 0 8px rgba(59, 130, 246, 0.5);
}

.video-js .vjs-load-progress {
  background: var(--progress-bg);
}

/* Buttons */
.video-js .vjs-button {
  transition: all 0.2s;
}

.video-js .vjs-button:hover {
  transform: scale(1.1);
}

/* Menus */
.video-js .vjs-menu {
  background: rgba(0, 0, 0, 0.95);
  backdrop-filter: blur(20px);
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.video-js .vjs-menu-item {
  padding: 0.75rem 1rem;
  transition: background 0.2s;
}

.video-js .vjs-menu-item:hover {
  background: rgba(255, 255, 255, 0.1);
}

.video-js .vjs-menu-item.vjs-selected {
  background: rgba(59, 130, 246, 0.2);
  color: var(--primary-color);
}

/* Animations */
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.video-js .vjs-control-bar {
  animation: fadeIn 0.3s;
}
```

## Testing
- [ ] Consistent with design system
- [ ] Smooth animations
- [ ] No visual glitches
- [ ] Theme switching works
- [ ] Mobile-friendly sizes

## Estimated Effort
**Medium** - 4-5 hours
