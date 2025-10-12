---
name: "[Phase 2.3] Comprehensive Keyboard Shortcuts"
about: Add full keyboard control support
title: "[Phase 2.3] Add Comprehensive Keyboard Shortcuts"
labels: phase-2, video-player, enhancement, accessibility
assignees: ''
---

## Overview
Implement comprehensive keyboard shortcuts for video control, matching YouTube's keyboard interface for familiarity.

## Acceptance Criteria
- [ ] Space/K: Play/Pause
- [ ] Arrow Left: Rewind 5s
- [ ] Arrow Right: Forward 5s
- [ ] Arrow Up: Volume +10%
- [ ] Arrow Down: Volume -10%
- [ ] M: Mute/Unmute
- [ ] F: Fullscreen toggle
- [ ] P: Picture-in-Picture
- [ ] 0-9: Jump to 0%-90%
- [ ] </>: Speed decrease/increase
- [ ] C: Toggle captions (Phase 4)
- [ ] Keyboard shortcuts help modal (?)
- [ ] Don't interfere with form inputs
- [ ] Visual feedback on action
- [ ] Works in fullscreen mode

## Implementation

```typescript
// Expanded setupKeyboardShortcuts() function
const setupKeyboardShortcuts = (player: Player) => {
  const handleKeyPress = (e: KeyboardEvent) => {
    // Ignore if typing in input/textarea
    const target = e.target as HTMLElement;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
      return;
    }

    // Show temporary feedback
    const showFeedback = (text: string) => {
      const overlay = document.createElement('div');
      overlay.className = 'keyboard-feedback';
      overlay.textContent = text;
      player.el().appendChild(overlay);
      setTimeout(() => overlay.remove(), 1000);
    };

    switch(e.key.toLowerCase()) {
      case ' ':
      case 'k':
        e.preventDefault();
        player.paused() ? player.play() : player.pause();
        break;
      case 'arrowleft':
        e.preventDefault();
        player.currentTime(Math.max(0, player.currentTime() - 5));
        showFeedback('-5s');
        break;
      case 'arrowright':
        e.preventDefault();
        player.currentTime(Math.min(player.duration(), player.currentTime() + 5));
        showFeedback('+5s');
        break;
      case 'j':
        e.preventDefault();
        player.currentTime(Math.max(0, player.currentTime() - 10));
        showFeedback('-10s');
        break;
      case 'l':
        e.preventDefault();
        player.currentTime(Math.min(player.duration(), player.currentTime() + 10));
        showFeedback('+10s');
        break;
      case 'arrowup':
        e.preventDefault();
        const newVol = Math.min(1, player.volume() + 0.1);
        player.volume(newVol);
        showFeedback(`Volume ${Math.round(newVol * 100)}%`);
        break;
      case 'arrowdown':
        e.preventDefault();
        const newVol2 = Math.max(0, player.volume() - 0.1);
        player.volume(newVol2);
        showFeedback(`Volume ${Math.round(newVol2 * 100)}%`);
        break;
      case 'm':
        e.preventDefault();
        player.muted(!player.muted());
        showFeedback(player.muted() ? 'Muted' : 'Unmuted');
        break;
      case 'f':
        e.preventDefault();
        player.isFullscreen() ? player.exitFullscreen() : player.requestFullscreen();
        break;
      case 'p':
        e.preventDefault();
        if (document.pictureInPictureEnabled) {
          (player as any).requestPictureInPicture();
        }
        break;
      case '?':
        e.preventDefault();
        showKeyboardHelp();
        break;
      case '0': case '1': case '2': case '3': case '4':
      case '5': case '6': case '7': case '8': case '9':
        e.preventDefault();
        const percent = parseInt(e.key) * 10;
        player.currentTime((percent / 100) * player.duration());
        showFeedback(`${percent}%`);
        break;
    }
  };

  document.addEventListener('keydown', handleKeyPress);
  player.on('dispose', () => {
    document.removeEventListener('keydown', handleKeyPress);
  });
};
```

## Testing
- [ ] All shortcuts work
- [ ] No conflict with page navigation
- [ ] Feedback visible and readable
- [ ] Works in fullscreen
- [ ] Help modal comprehensive
- [ ] Ignored in form fields

## Estimated Effort
**Medium** - 3-4 hours
