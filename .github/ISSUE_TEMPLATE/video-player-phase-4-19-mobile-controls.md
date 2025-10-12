---
name: "[Phase 4.3] Mobile Touch Controls"
about: Optimize controls for mobile devices
title: "[Phase 4.3] Implement Mobile Touch Controls"
labels: phase-4, video-player, enhancement, mobile, ux
assignees: ''
---

## Overview
Implement mobile-optimized touch controls including double-tap seek, pinch zoom, swipe gestures, and larger touch targets.

## Acceptance Criteria
- [ ] Double-tap left to rewind 10s
- [ ] Double-tap right to forward 10s
- [ ] Swipe up/down for volume
- [ ] Single tap to show/hide controls
- [ ] Long press for playback speed
- [ ] Larger touch targets (48x48px minimum)
- [ ] Touch feedback animations
- [ ] Responsive control sizing
- [ ] Mobile fullscreen optimized
- [ ] Works on iOS and Android

## Implementation

```typescript
// apps/web/src/components/VideoPlayer/MobileTouchHandler.ts
export class MobileTouchHandler {
  private lastTap = 0;
  private touchStartY = 0;
  private touchStartVolume = 0;

  constructor(private player: Player, private element: HTMLElement) {
    this.setupListeners();
  }

  private setupListeners() {
    // Double-tap seek
    this.element.addEventListener('touchend', (e) => {
      const now = Date.now();
      const timeSinceLast = now - this.lastTap;

      if (timeSinceLast < 300 && timeSinceLast > 0) {
        const rect = this.element.getBoundingClientRect();
        const x = e.changedTouches[0].clientX - rect.left;
        const width = rect.width;

        if (x < width / 3) {
          // Left third: rewind
          this.player.currentTime(Math.max(0, this.player.currentTime() - 10));
          this.showFeedback('⏪ -10s', 'left');
        } else if (x > (width * 2) / 3) {
          // Right third: forward
          this.player.currentTime(this.player.currentTime() + 10);
          this.showFeedback('⏩ +10s', 'right');
        } else {
          // Center: play/pause
          this.player.paused() ? this.player.play() : this.player.pause();
        }
      }

      this.lastTap = now;
    });

    // Swipe for volume
    this.element.addEventListener('touchstart', (e) => {
      this.touchStartY = e.touches[0].clientY;
      this.touchStartVolume = this.player.volume();
    });

    this.element.addEventListener('touchmove', (e) => {
      const deltaY = this.touchStartY - e.touches[0].clientY;
      const volumeChange = deltaY / 200; // Adjust sensitivity
      const newVolume = Math.max(0, Math.min(1, this.touchStartVolume + volumeChange));
      this.player.volume(newVolume);
    });
  }

  private showFeedback(text: string, position: 'left' | 'right' | 'center') {
    const feedback = document.createElement('div');
    feedback.className = `touch-feedback touch-feedback-${position}`;
    feedback.textContent = text;
    this.element.appendChild(feedback);
    setTimeout(() => feedback.remove(), 1000);
  }
}

// In CustomVideoPlayer
useEffect(() => {
  if (isMobile() && playerRef.current) {
    const handler = new MobileTouchHandler(
      playerRef.current,
      playerRef.current.el()
    );
    return () => handler.cleanup();
  }
}, []);
```

## Testing
- [ ] Double-tap works both sides
- [ ] Swipe volume smooth
- [ ] Touch targets large enough
- [ ] No accidental triggers
- [ ] Works on iOS Safari
- [ ] Works on Android Chrome

## Estimated Effort
**Medium** - 3-4 hours
