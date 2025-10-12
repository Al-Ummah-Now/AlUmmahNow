---
name: "[Phase 4.5] Accessibility Features"
about: Implement comprehensive accessibility support
title: "[Phase 4.5] Add Comprehensive Accessibility Features"
labels: phase-4, video-player, enhancement, accessibility, a11y
assignees: ''
---

## Overview
Ensure video player is fully accessible with ARIA labels, keyboard navigation, screen reader support, and WCAG 2.1 AA compliance.

## Acceptance Criteria
- [ ] All controls have ARIA labels
- [ ] Keyboard navigation works completely
- [ ] Screen reader announcements
- [ ] Focus indicators visible
- [ ] Color contrast meets WCAG AA
- [ ] No keyboard traps
- [ ] Captions support (Phase 4 extension)
- [ ] Audio descriptions support
- [ ] Skip to content option
- [ ] High contrast mode support

## Implementation

```typescript
// apps/web/src/components/VideoPlayer/Accessibility.tsx
export function setupAccessibility(player: Player, options: { rtl?: boolean }) {
  const el = player.el();

  // ARIA labels
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', 'Video player');

  // Play button
  const playButton = el.querySelector('.vjs-play-control');
  if (playButton) {
    playButton.setAttribute('aria-label', 'Play/Pause');
  }

  // Progress bar
  const seekBar = el.querySelector('.vjs-progress-control');
  if (seekBar) {
    seekBar.setAttribute('role', 'slider');
    seekBar.setAttribute('aria-label', 'Video progress');
    seekBar.setAttribute('aria-valuemin', '0');
    seekBar.setAttribute('aria-valuemax', '100');
  }

  // Volume control
  const volumeControl = el.querySelector('.vjs-volume-panel');
  if (volumeControl) {
    volumeControl.setAttribute('aria-label', 'Volume control');
  }

  // Screen reader announcements
  player.on('play', () => {
    announce('Video playing');
  });

  player.on('pause', () => {
    announce('Video paused');
  });

  player.on('volumechange', () => {
    const volume = Math.round(player.volume() * 100);
    announce(`Volume ${player.muted() ? 'muted' : volume + '%'}`);
  });

  player.on('timeupdate', throttle(() => {
    const current = player.currentTime();
    const duration = player.duration();
    const percent = Math.round((current / duration) * 100);
    seekBar?.setAttribute('aria-valuenow', percent.toString());
  }, 1000));

  // Focus management
  player.on('play', () => {
    el.focus();
  });

  // High contrast mode detection
  if (window.matchMedia('(prefers-contrast: high)').matches) {
    el.classList.add('vjs-high-contrast');
  }
}

function announce(message: string) {
  const announcer = document.getElementById('video-announcer') 
    || createAnnouncer();
  announcer.textContent = message;
}

function createAnnouncer(): HTMLElement {
  const div = document.createElement('div');
  div.id = 'video-announcer';
  div.setAttribute('role', 'status');
  div.setAttribute('aria-live', 'polite');
  div.setAttribute('aria-atomic', 'true');
  div.style.position = 'absolute';
  div.style.left = '-10000px';
  div.style.width = '1px';
  div.style.height = '1px';
  div.style.overflow = 'hidden';
  document.body.appendChild(div);
  return div;
}
```

**CSS for accessibility:**
```css
/* Focus indicators */
.video-js button:focus {
  outline: 2px solid #3b82f6;
  outline-offset: 2px;
}

/* High contrast mode */
.vjs-high-contrast .video-js .vjs-control-bar {
  background: #000;
  border-top: 2px solid #fff;
}

.vjs-high-contrast .video-js .vjs-button {
  border: 1px solid #fff;
}

/* Reduce motion */
@media (prefers-reduced-motion: reduce) {
  .video-js * {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}

/* Skip link */
.skip-to-content {
  position: absolute;
  top: -40px;
  left: 0;
  background: #000;
  color: #fff;
  padding: 8px;
  z-index: 100;
}

.skip-to-content:focus {
  top: 0;
}
```

## Testing
- [ ] Test with screen reader (NVDA/JAWS/VoiceOver)
- [ ] Tab through all controls
- [ ] Verify ARIA attributes
- [ ] Check color contrast ratios
- [ ] Test with high contrast mode
- [ ] Verify focus indicators
- [ ] Test keyboard shortcuts
- [ ] Validate with axe DevTools

## Estimated Effort
**Medium** - 3-4 hours
