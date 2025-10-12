---
name: "[Phase 1.1] Video.js Infrastructure Setup"
about: Set up Video.js dependencies, types, and basic configuration
title: "[Phase 1.1] Set up Video.js Infrastructure and Dependencies"
labels: phase-1, video-player, enhancement, high-priority, infrastructure
assignees: ''
---

## Overview
Set up the foundational Video.js infrastructure including all required npm packages, TypeScript types, and basic configuration. This is the first step in replacing the Bunny.net iframe player with a custom HTML5 video player.

## Context
- **Why**: The current Bunny.net iframe player has SSL certificate issues and limited customization options
- **Goal**: Establish a solid foundation for the custom video player using Video.js
- **Architecture Reference**: See `/docs/architecture/ADR-001-custom-video-player.md` and `/docs/architecture/video-player-implementation-guide.md`

## Acceptance Criteria
- [ ] All required npm packages installed in `apps/web`
- [ ] TypeScript types configured with zero compilation errors
- [ ] Video.js CSS properly imported without conflicts
- [ ] Basic Video.js instance can be created and disposed
- [ ] All HLS streaming plugins loaded correctly
- [ ] Quality selector plugin integrated
- [ ] Build passes with `pnpm --filter @al-ummah/web build`
- [ ] Type check passes with `pnpm --filter @al-ummah/web type-check`
- [ ] No linting errors with `pnpm --filter @al-ummah/web lint`

## Technical Details

### Files to Create/Modify
- `apps/web/package.json` - Add video player dependencies
- `apps/web/src/styles/video-player.css` - Custom Video.js theme
- `apps/web/src/lib/video/videojs-setup.ts` - Video.js initialization utilities
- `apps/web/src/types/videojs.d.ts` - Extended Video.js TypeScript declarations
- `apps/web/next.config.js` - Add Video.js to transpilePackages if needed

### Implementation Steps

1. **Install Core Dependencies**
   ```bash
   cd apps/web
   pnpm add video.js @videojs/http-streaming videojs-contrib-quality-levels videojs-hls-quality-selector
   pnpm add -D @types/video.js
   ```

2. **Create TypeScript Declaration Extensions**
   ```typescript
   // apps/web/src/types/videojs.d.ts
   import videojs from 'video.js';

   declare module 'video.js' {
     interface VideoJsPlayer {
       hlsQualitySelector?: (options?: any) => void;
       pictureInPictureEnabled?: boolean;
       requestPictureInPicture?: () => Promise<void>;
     }
   }
   ```

3. **Create Video.js Setup Utility**
   ```typescript
   // apps/web/src/lib/video/videojs-setup.ts
   import videojs from 'video.js';
   import 'video.js/dist/video-js.css';
   import '@videojs/http-streaming';
   import 'videojs-contrib-quality-levels';
   import 'videojs-hls-quality-selector';

   export const VIDEO_JS_OPTIONS = {
     responsive: true,
     fluid: true,
     playbackRates: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2],
     html5: {
       hls: {
         enableLowInitialPlaylist: true,
         smoothQualityChange: true,
         overrideNative: true
       }
     }
   };

   export function createVideoPlayer(
     element: HTMLVideoElement,
     options: videojs.PlayerOptions
   ): videojs.Player {
     return videojs(element, {
       ...VIDEO_JS_OPTIONS,
       ...options
     });
   }

   export function disposeVideoPlayer(player: videojs.Player | null) {
     if (player && !player.isDisposed()) {
       player.dispose();
     }
   }
   ```

4. **Create Custom Theme CSS**
   ```css
   /* apps/web/src/styles/video-player.css */
   @import 'video.js/dist/video-js.css';

   .video-js {
     font-family: var(--font-family);
   }

   .video-js .vjs-big-play-button {
     border-radius: 50%;
     border: none;
     background-color: rgba(43, 51, 63, 0.9);
   }

   .video-js .vjs-control-bar {
     background: linear-gradient(
       to top,
       rgba(0, 0, 0, 0.8),
       transparent
     );
   }

   /* RTL support */
   [dir="rtl"] .video-js .vjs-control-bar {
     direction: rtl;
   }
   ```

5. **Update Next.js Configuration**
   ```typescript
   // apps/web/next.config.js
   const nextConfig = {
     // ... existing config
     transpilePackages: [
       'video.js',
       '@videojs/http-streaming',
       'videojs-contrib-quality-levels',
       'videojs-hls-quality-selector'
     ]
   };
   ```

6. **Create Basic Test Component**
   ```typescript
   // apps/web/src/components/VideoPlayer/__tests__/setup.test.tsx
   import { render, cleanup } from '@testing-library/react';
   import videojs from 'video.js';
   import { createVideoPlayer, disposeVideoPlayer } from '@/lib/video/videojs-setup';

   describe('Video.js Setup', () => {
     afterEach(cleanup);

     it('should create and dispose player instance', () => {
       const videoElement = document.createElement('video');
       const player = createVideoPlayer(videoElement, {});

       expect(player).toBeDefined();
       expect(player.isDisposed()).toBe(false);

       disposeVideoPlayer(player);
       expect(player.isDisposed()).toBe(true);
     });
   });
   ```

### Dependencies
- **npm packages**:
  - `video.js@^8.12.0`
  - `@videojs/http-streaming@^3.12.0`
  - `videojs-contrib-quality-levels@^4.1.0`
  - `videojs-hls-quality-selector@^2.0.0`
  - `@types/video.js@^7.3.58`
- **Prerequisites**: None (first task in sequence)

### Code Examples

**Basic Video.js Instance Test:**
```typescript
'use client';

import { useEffect, useRef } from 'react';
import videojs from 'video.js';
import { createVideoPlayer, disposeVideoPlayer } from '@/lib/video/videojs-setup';

export function VideoJsTest() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<videojs.Player | null>(null);

  useEffect(() => {
    if (!videoRef.current) return;

    playerRef.current = createVideoPlayer(videoRef.current, {
      autoplay: false,
      controls: true
    });

    return () => {
      disposeVideoPlayer(playerRef.current);
      playerRef.current = null;
    };
  }, []);

  return (
    <div data-vjs-player>
      <video ref={videoRef} className="video-js vjs-big-play-centered" />
    </div>
  );
}
```

### Testing Requirements
- [ ] Unit test: Create and dispose player successfully
- [ ] Unit test: Player options merge correctly
- [ ] Unit test: TypeScript types compile without errors
- [ ] Integration test: Video.js loads in Next.js environment
- [ ] Integration test: HLS plugin is available
- [ ] Integration test: Quality selector plugin is available
- [ ] Manual test: Basic player renders in browser
- [ ] Manual test: No console errors on player creation
- [ ] Manual test: Player disposes cleanly on unmount

## Design Considerations

### Performance
- Video.js is ~240KB minified (acceptable for video player)
- HLS plugin adds ~150KB (necessary for streaming)
- Consider lazy loading player on route navigation

### Security
- Use specific package versions to avoid supply chain attacks
- Review Video.js security advisories before production
- Sanitize all user-provided URLs

### Accessibility
- Video.js has built-in ARIA labels
- Keyboard navigation supported by default
- Screen reader compatibility verified

### RTL Support
- CSS must support both LTR and RTL layouts
- Control bar should flip horizontally for Arabic
- Time displays remain left-to-right (numbers)

## Success Metrics
- Zero TypeScript compilation errors
- Build time increase < 5 seconds
- Bundle size increase < 500KB
- All tests pass
- No console warnings in development

## References
- [Video.js Documentation](https://videojs.com/guides/)
- [Video.js Getting Started](https://videojs.com/getting-started/)
- [Video.js HLS Plugin](https://github.com/videojs/http-streaming)
- [Video.js Quality Selector](https://github.com/chrisboustead/videojs-hls-quality-selector)
- Architecture: `/docs/architecture/ADR-001-custom-video-player.md`
- Implementation Guide: `/docs/architecture/video-player-implementation-guide.md`

## Estimated Effort
**Small** - 2-4 hours

### Breakdown
- Package installation and configuration: 30 minutes
- TypeScript setup and types: 1 hour
- Basic utility functions: 1 hour
- Testing and validation: 1-1.5 hours
