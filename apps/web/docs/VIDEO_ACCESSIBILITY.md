# Video Player Accessibility Guide

## Overview

The Video.js player implementation in Al Ummah Now includes comprehensive accessibility features to ensure content is available to all users, including those using assistive technologies.

## WCAG 2.1 Level AA Compliance

Our video player implementation aims for WCAG 2.1 Level AA compliance with the following features:

### 1. Keyboard Navigation

All video controls are fully keyboard accessible:

| Key | Action |
|-----|--------|
| `Space` / `K` | Play/Pause video |
| `M` | Mute/Unmute audio |
| `F` | Toggle fullscreen mode |
| `←` / `→` | Seek backward/forward (5 seconds) |
| `↑` / `↓` | Increase/decrease volume |
| `0-9` | Jump to specific percentage of video |
| `C` | Toggle captions/subtitles |
| `Tab` | Navigate between controls |
| `Enter` | Activate focused control |

### 2. Screen Reader Support

#### ARIA Labels
- Video element has `aria-label="Video player"`
- All control buttons have descriptive labels
- Live region announces player state changes

#### Localized Labels
Control labels are available in English and Arabic:

**English:**
- "Play Video" / "Pause Video"
- "Mute Audio" / "Unmute Audio"
- "Enter Fullscreen" / "Exit Fullscreen"
- "Show Captions" / "Show Subtitles"

**Arabic:**
- "تشغيل الفيديو" / "إيقاف الفيديو"
- "كتم الصوت" / "إلغاء كتم الصوت"
- "ملء الشاشة" / "الخروج من ملء الشاشة"
- "إظهار التسميات التوضيحية" / "إظهار الترجمة"

#### State Announcements
Screen readers announce:
- "Video player loaded and ready" when player initializes
- Player state changes (play, pause, ended)
- Volume changes
- Quality changes

### 3. Visual Accessibility

#### Focus Indicators
- Visible focus indicators on all interactive elements
- 3px outline on big play button with 4px offset
- 2px outline on control bar buttons with 2px offset
- Uses theme `--ring` color for consistency
- Enhanced visibility in both light and dark modes

#### High Contrast Mode
Respects user's high contrast preferences:
```css
@media (prefers-contrast: high) {
  .video-js .vjs-big-play-button {
    border: 3px solid currentColor;
  }
  .video-js .vjs-control-bar {
    background: oklch(var(--background));
  }
}
```

#### Reduced Motion Support
Respects user's motion preferences:
```css
@media (prefers-reduced-motion: reduce) {
  .video-js .vjs-big-play-button {
    transition: none;
  }
  .video-js .vjs-big-play-button:hover {
    transform: none;
  }
}
```

#### Enhanced Icon Contrast
Control icons have text-shadow for better visibility:
```css
.video-js .vjs-control-bar .vjs-icon-placeholder::before {
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
}
```

### 4. Captions and Subtitles

#### Native Text Track Support
Video.js uses native browser text track rendering by default, providing optimal accessibility and performance for captions and subtitles.

#### Adding Captions
Captions can be added using WebVTT format:

```typescript
createVideoPlayer(element, {
  controls: true,
  sources: [{ src: 'video.m3u8', type: 'application/x-mpegURL' }],
  tracks: [
    {
      kind: 'captions',
      src: '/captions/english.vtt',
      srclang: 'en',
      label: 'English',
      default: true
    },
    {
      kind: 'captions',
      src: '/captions/arabic.vtt',
      srclang: 'ar',
      label: 'العربية'
    }
  ]
});
```

#### WebVTT Format Example
```vtt
WEBVTT

00:00:00.000 --> 00:00:05.000
Welcome to Al Ummah Now

00:00:05.000 --> 00:00:10.000
This is an example caption
```

### 5. Color Contrast

All visual elements meet WCAG AA contrast requirements:

- **Light Mode:**
  - Big play button: Dark primary color on light background
  - Control icons: High contrast against gradient background

- **Dark Mode:**
  - Big play button: Light primary color on dark background
  - Control icons: Enhanced contrast with text-shadow

### 6. RTL Support

Full right-to-left language support for Arabic:

```css
[dir="rtl"] .video-js .vjs-control-bar {
  direction: rtl;
}
```

Control bar automatically flips layout for RTL languages.

## Implementation Checklist

When implementing the video player in a new component:

- [ ] Include `aria-label` on video element
- [ ] Add `tabIndex={0}` to video element for keyboard access
- [ ] Include live region for screen reader announcements
- [ ] Add keyboard shortcuts documentation (optional but recommended)
- [ ] Set appropriate language (`en` or `ar`)
- [ ] Include captions/subtitles if available
- [ ] Test with keyboard navigation
- [ ] Test with screen reader (NVDA, JAWS, VoiceOver)
- [ ] Verify focus indicators are visible
- [ ] Test in high contrast mode
- [ ] Test with reduced motion settings

## Example Implementation

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { createVideoPlayer, disposeVideoPlayer } from '@/lib/video/videojs-setup';
import '@/styles/video-player.css';
import type { Player } from 'video.js';

export default function AccessibleVideoPlayer({
  videoId,
  title,
  language = 'en'
}: {
  videoId: string;
  title: string;
  language?: 'en' | 'ar';
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<Player | null>(null);
  const [playerReady, setPlayerReady] = useState(false);

  useEffect(() => {
    if (!videoRef.current || playerRef.current) return;

    playerRef.current = createVideoPlayer(videoRef.current, {
      controls: true,
      language,
      sources: [{
        src: `https://cdn.example.com/${videoId}/playlist.m3u8`,
        type: 'application/x-mpegURL'
      }],
      tracks: [
        {
          kind: 'captions',
          src: `/captions/${videoId}-${language}.vtt`,
          srclang: language,
          label: language === 'en' ? 'English' : 'العربية',
          default: true
        }
      ]
    });

    const player = playerRef.current;
    if (player) {
      player.ready(() => setPlayerReady(true));
    }

    return () => {
      disposeVideoPlayer(playerRef.current);
      playerRef.current = null;
      setPlayerReady(false);
    };
  }, [videoId, language]);

  return (
    <div>
      {/* Screen reader announcement */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {playerReady ? `${title} - Video player ready` : 'Loading video player...'}
      </div>

      {/* Video player */}
      <div data-vjs-player>
        <video
          ref={videoRef}
          className="video-js vjs-big-play-centered"
          playsInline
          aria-label={title}
          tabIndex={0}
        />
      </div>
    </div>
  );
}
```

## Testing Guidelines

### Manual Testing

1. **Keyboard Navigation:**
   - Disconnect mouse
   - Tab through all controls
   - Verify all functionality works with keyboard only

2. **Screen Reader Testing:**
   - Windows: Test with NVDA or JAWS
   - macOS: Test with VoiceOver
   - Verify all controls are announced
   - Verify state changes are announced

3. **High Contrast Mode:**
   - Enable Windows High Contrast Mode
   - Verify all controls are visible
   - Verify focus indicators are clear

4. **Reduced Motion:**
   - Enable reduced motion in OS settings
   - Verify no animations play
   - Verify player remains functional

5. **Color Blindness:**
   - Use color blindness simulator
   - Verify information isn't conveyed by color alone
   - Verify all controls are distinguishable

### Automated Testing

```typescript
import { render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';

expect.extend(toHaveNoViolations);

test('video player has no accessibility violations', async () => {
  const { container } = render(<VideoPlayer videoId="test" title="Test Video" />);
  const results = await axe(container);
  expect(results).toHaveNoViolations();
});
```

## Browser Compatibility

Accessibility features are tested and supported in:

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## Additional Resources

- [Video.js Accessibility Documentation](https://videojs.com/guides/accessibility/)
- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [WebVTT Specification](https://www.w3.org/TR/webvtt1/)
- [ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/)

## Support

For accessibility issues or questions, please:
1. Check this documentation
2. Review Video.js accessibility docs
3. Open an issue with `accessibility` label
4. Contact the development team

## Version History

- **v1.0.0** (2025-01-XX): Initial accessibility implementation
  - Keyboard navigation
  - Screen reader support
  - Focus indicators
  - High contrast support
  - Reduced motion support
  - Bilingual ARIA labels
  - WebVTT captions support
