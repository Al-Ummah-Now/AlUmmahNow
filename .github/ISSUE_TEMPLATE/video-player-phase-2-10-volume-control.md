---
name: "[Phase 2.5] Volume Persistence and Controls"
about: Enhanced volume control with persistence
title: "[Phase 2.5] Implement Volume Persistence and Enhanced Controls"
labels: phase-2, video-player, enhancement, feature
assignees: ''
---

## Overview
Enhance volume controls with persistence across sessions, vertical slider UI, and smooth volume transitions.

## Acceptance Criteria
- [ ] Volume persisted in localStorage
- [ ] Mute state persisted
- [ ] Vertical volume slider on hover
- [ ] Volume indicator shows percentage
- [ ] Keyboard shortcuts (Up/Down arrows)
- [ ] Scroll wheel volume control
- [ ] Smooth volume transitions
- [ ] 0-100% range with 10% steps
- [ ] Visual feedback on volume change
- [ ] Mobile-optimized volume control

## Implementation

```typescript
// Volume persistence (already implemented in Phase 1.3)
player.on('volumechange', () => {
  const volume = player.volume();
  const muted = player.muted();
  localStorage.setItem('videoPlayerVolume', JSON.stringify({ volume, muted }));
});

// Restore on init
const savedVolume = localStorage.getItem('videoPlayerVolume');
if (savedVolume) {
  const { volume, muted } = JSON.parse(savedVolume);
  player.volume(volume);
  player.muted(muted);
}

// Scroll wheel support
player.el().addEventListener('wheel', (e: WheelEvent) => {
  if (e.target === player.el()) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    player.volume(Math.max(0, Math.min(1, player.volume() + delta)));
  }
});

// Volume indicator overlay
player.on('volumechange', () => {
  const indicator = player.el().querySelector('.volume-indicator');
  if (!indicator) {
    const div = document.createElement('div');
    div.className = 'volume-indicator';
    player.el().appendChild(div);
  }
  const volume = Math.round(player.volume() * 100);
  indicator.textContent = player.muted() ? 'Muted' : `${volume}%`;
  indicator.classList.add('show');
  setTimeout(() => indicator.classList.remove('show'), 1000);
});
```

## Testing
- [ ] Volume persists across sessions
- [ ] Mute persists
- [ ] Keyboard volume control
- [ ] Scroll wheel control
- [ ] Visual feedback clear
- [ ] Mobile volume usable

## Estimated Effort
**Small** - 2 hours
