---
name: "[Phase 1.3] CustomVideoPlayer React Component"
about: Create main Video.js React component with basic playback
title: "[Phase 1.3] Create CustomVideoPlayer React Component with Basic Playback"
labels: phase-1, video-player, enhancement, high-priority, frontend
assignees: ''
---

## Overview
Create the main `CustomVideoPlayer` React component that wraps Video.js, manages player lifecycle, handles basic playback controls, and provides a clean React API for video playback.

## Context
- **Why**: Need a React-friendly wrapper around Video.js for use in Next.js App Router
- **Goal**: Production-ready video player component with proper lifecycle management
- **Dependencies**: Requires Phase 1.1 (Video.js) and Phase 1.2 (BunnyStreamService)
- **Architecture Reference**: `/docs/architecture/video-player-implementation-guide.md` lines 176-500

## Acceptance Criteria
- [ ] `CustomVideoPlayer` component created with TypeScript
- [ ] Proper Video.js player lifecycle (mount, update, unmount)
- [ ] HLS stream playback working
- [ ] Basic controls (play, pause, seek, volume)
- [ ] Resume from saved position supported
- [ ] Client-side only (no SSR issues)
- [ ] RTL support for Arabic interface
- [ ] Loading states and error boundaries
- [ ] Memory leaks prevented (proper cleanup)
- [ ] Works in both `/en/` and `/ar/` routes
- [ ] Zero console errors or warnings

## Technical Details

### Files to Create/Modify
- `apps/web/src/components/VideoPlayer/CustomVideoPlayer.tsx` - Main component
- `apps/web/src/components/VideoPlayer/index.ts` - Barrel export
- `apps/web/src/components/VideoPlayer/VideoPlayerSkeleton.tsx` - Loading skeleton
- `apps/web/src/components/VideoPlayer/custom-theme.css` - Custom styles
- `apps/web/src/components/VideoPlayer/__tests__/CustomVideoPlayer.test.tsx` - Tests
- `apps/web/src/hooks/useVideoPlayer.ts` - Custom React hook (optional)

### Implementation Steps

1. **Create Main Component**
   ```typescript
   // apps/web/src/components/VideoPlayer/CustomVideoPlayer.tsx
   'use client';

   import React, { useEffect, useRef, useState } from 'react';
   import videojs from 'video.js';
   import type Player from 'video.js/dist/types/player';
   import { getBunnyStreamService } from '@/services/bunny/stream.service';
   import 'video.js/dist/video-js.css';
   import './custom-theme.css';

   export interface CustomVideoPlayerProps {
     videoId: string;           // Our video ID
     bunnyVideoId: string;      // Bunny.net video GUID
     title: string;
     channelId?: string;
     userId?: string;
     autoplay?: boolean;
     startTime?: number;        // Resume from saved position (seconds)
     onPlay?: () => void;
     onPause?: () => void;
     onEnded?: () => void;
     onTimeUpdate?: (currentTime: number, duration: number) => void;
     onError?: (error: any) => void;
     className?: string;
     rtl?: boolean;
   }

   export function CustomVideoPlayer({
     videoId,
     bunnyVideoId,
     title,
     autoplay = false,
     startTime = 0,
     onPlay,
     onPause,
     onEnded,
     onTimeUpdate,
     onError,
     className = '',
     rtl = false
   }: CustomVideoPlayerProps) {
     const videoRef = useRef<HTMLDivElement>(null);
     const playerRef = useRef<Player | null>(null);
     const [isReady, setIsReady] = useState(false);
     const [error, setError] = useState<string | null>(null);
     const bunnyService = getBunnyStreamService();

     // Initialize player
     useEffect(() => {
       if (!videoRef.current) return;

       // Create video element
       const videoElement = document.createElement('video-js');
       videoElement.classList.add('vjs-big-play-centered');
       videoRef.current.appendChild(videoElement);

       // Get HLS URL
       const hlsUrl = bunnyService.getHLSUrl(bunnyVideoId);

       // Initialize Video.js player
       const player = videojs(videoElement, {
         autoplay,
         controls: true,
         responsive: true,
         fluid: true,
         preload: 'auto',
         playbackRates: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2],
         sources: [{
           src: hlsUrl,
           type: 'application/x-mpegURL'
         }],
         html5: {
           hls: {
             enableLowInitialPlaylist: true,
             smoothQualityChange: true,
             overrideNative: true
           }
         },
         controlBar: {
           pictureInPictureToggle: true,
           volumePanel: {
             inline: false
           }
         }
       });

       playerRef.current = player;

       // Setup event listeners
       player.on('ready', () => {
         setIsReady(true);
         console.log('Video player ready', { videoId, bunnyVideoId });
       });

       player.on('play', () => {
         onPlay?.();
       });

       player.on('pause', () => {
         onPause?.();
       });

       player.on('ended', () => {
         onEnded?.();
       });

       player.on('timeupdate', () => {
         const currentTime = player.currentTime();
         const duration = player.duration();
         onTimeUpdate?.(currentTime, duration);
       });

       player.on('error', (e: any) => {
         const err = player.error();
         console.error('Video playback error:', err);
         setError(err?.message || 'Video playback failed');
         onError?.(err);
       });

       // Load saved progress
       if (startTime > 0) {
         player.one('loadedmetadata', () => {
           player.currentTime(startTime);
           console.log(`Resumed playback from ${startTime} seconds`);
         });
       }

       // Restore saved volume
       const savedVolume = localStorage.getItem('videoPlayerVolume');
       if (savedVolume) {
         try {
           const { volume, muted } = JSON.parse(savedVolume);
           player.volume(volume);
           player.muted(muted);
         } catch (e) {
           console.error('Failed to restore volume:', e);
         }
       }

       // Save volume on change
       player.on('volumechange', () => {
         const volume = player.volume();
         const muted = player.muted();
         localStorage.setItem('videoPlayerVolume', JSON.stringify({ volume, muted }));
       });

       // Cleanup
       return () => {
         if (playerRef.current) {
           playerRef.current.dispose();
           playerRef.current = null;
         }
       };
     }, [bunnyVideoId, autoplay, startTime]);

     // Show error state
     if (error) {
       return (
         <div className="video-player-error">
           <div className="error-content">
             <svg className="error-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
               <circle cx="12" cy="12" r="10" strokeWidth="2" />
               <path d="M12 8v4m0 4h.01" strokeWidth="2" strokeLinecap="round" />
             </svg>
             <h3>Video Playback Error</h3>
             <p>{error}</p>
             <button
               onClick={() => window.location.reload()}
               className="retry-button"
             >
               Retry
             </button>
           </div>
         </div>
       );
     }

     return (
       <div
         className={`video-player-wrapper ${rtl ? 'rtl' : 'ltr'} ${className}`}
         dir={rtl ? 'rtl' : 'ltr'}
       >
         <div ref={videoRef} className="video-js-container" />
         {!isReady && <VideoPlayerSkeleton />}
       </div>
     );
   }
   ```

2. **Create Loading Skeleton**
   ```typescript
   // apps/web/src/components/VideoPlayer/VideoPlayerSkeleton.tsx
   export function VideoPlayerSkeleton() {
     return (
       <div className="video-player-skeleton">
         <div className="skeleton-content">
           <div className="skeleton-play-button" />
           <div className="skeleton-controls">
             <div className="skeleton-progress-bar" />
             <div className="skeleton-buttons" />
           </div>
         </div>
       </div>
     );
   }
   ```

3. **Create Custom Styles**
   ```css
   /* apps/web/src/components/VideoPlayer/custom-theme.css */
   .video-player-wrapper {
     position: relative;
     width: 100%;
     max-width: 100%;
     background: #000;
     border-radius: 8px;
     overflow: hidden;
   }

   .video-player-wrapper.rtl {
     direction: rtl;
   }

   .video-js-container {
     width: 100%;
     height: 100%;
   }

   .video-js {
     width: 100%;
     height: 100%;
     font-family: inherit;
   }

   .video-js .vjs-big-play-button {
     border-radius: 50%;
     border: none;
     background-color: rgba(43, 51, 63, 0.9);
     width: 80px;
     height: 80px;
     line-height: 80px;
     font-size: 48px;
     transition: all 0.3s ease;
   }

   .video-js .vjs-big-play-button:hover {
     background-color: rgba(43, 51, 63, 1);
     transform: scale(1.1);
   }

   .video-js .vjs-control-bar {
     background: linear-gradient(to top, rgba(0, 0, 0, 0.8), transparent);
     height: 4rem;
   }

   /* RTL adjustments */
   .video-player-wrapper.rtl .video-js .vjs-control-bar {
     direction: rtl;
   }

   /* Error state */
   .video-player-error {
     display: flex;
     align-items: center;
     justify-content: center;
     min-height: 400px;
     background: #1a1a1a;
     border-radius: 8px;
   }

   .error-content {
     text-align: center;
     padding: 2rem;
   }

   .error-icon {
     width: 64px;
     height: 64px;
     margin: 0 auto 1rem;
     color: #ef4444;
   }

   /* Loading skeleton */
   .video-player-skeleton {
     position: absolute;
     inset: 0;
     background: #1a1a1a;
     display: flex;
     align-items: center;
     justify-content: center;
   }

   .skeleton-play-button {
     width: 80px;
     height: 80px;
     border-radius: 50%;
     background: rgba(255, 255, 255, 0.1);
     animation: pulse 2s infinite;
   }

   @keyframes pulse {
     0%, 100% { opacity: 1; }
     50% { opacity: 0.5; }
   }
   ```

4. **Create Barrel Export with Dynamic Import**
   ```typescript
   // apps/web/src/components/VideoPlayer/index.ts
   import dynamic from 'next/dynamic';
   import { VideoPlayerSkeleton } from './VideoPlayerSkeleton';

   // Lazy load player (client-side only)
   export const CustomVideoPlayer = dynamic(
     () => import('./CustomVideoPlayer').then(mod => ({ default: mod.CustomVideoPlayer })),
     {
       ssr: false,
       loading: () => <VideoPlayerSkeleton />
     }
   );

   export { VideoPlayerSkeleton };
   export type { CustomVideoPlayerProps } from './CustomVideoPlayer';
   ```

5. **Create Unit Tests**
   ```typescript
   // apps/web/src/components/VideoPlayer/__tests__/CustomVideoPlayer.test.tsx
   import { render, waitFor } from '@testing-library/react';
   import { CustomVideoPlayer } from '../CustomVideoPlayer';
   import videojs from 'video.js';

   jest.mock('video.js');
   jest.mock('@/services/bunny/stream.service');

   describe('CustomVideoPlayer', () => {
     const mockProps = {
       videoId: 'test-123',
       bunnyVideoId: '00000000-0000-0000-0000-000000000000',
       title: 'Test Video'
     };

     beforeEach(() => {
       (videojs as jest.Mock).mockImplementation(() => ({
         on: jest.fn(),
         off: jest.fn(),
         dispose: jest.fn(),
         ready: jest.fn((cb) => cb()),
         currentTime: jest.fn(),
         volume: jest.fn(),
         muted: jest.fn(),
         error: jest.fn()
       }));
     });

     it('should render without crashing', () => {
       render(<CustomVideoPlayer {...mockProps} />);
     });

     it('should initialize Video.js player', () => {
       render(<CustomVideoPlayer {...mockProps} />);
       expect(videojs).toHaveBeenCalled();
     });

     it('should handle autoplay prop', () => {
       render(<CustomVideoPlayer {...mockProps} autoplay={true} />);
       expect(videojs).toHaveBeenCalledWith(
         expect.anything(),
         expect.objectContaining({ autoplay: true })
       );
     });

     it('should dispose player on unmount', () => {
       const { unmount } = render(<CustomVideoPlayer {...mockProps} />);
       const disposeMock = jest.fn();
       (videojs as jest.Mock).mockReturnValue({ dispose: disposeMock });
       unmount();
       expect(disposeMock).toHaveBeenCalled();
     });
   });
   ```

### Dependencies
- **Prerequisites**:
  - Phase 1.1: Video.js infrastructure ✓
  - Phase 1.2: BunnyStreamService ✓
- **API endpoints**: None yet (will connect in Phase 3)
- **Components**: Uses dynamic import from Next.js

### Testing Requirements
- [ ] Unit test: Component renders
- [ ] Unit test: Player initializes
- [ ] Unit test: Player disposes on unmount
- [ ] Unit test: Props passed correctly
- [ ] Integration test: HLS stream loads
- [ ] Integration test: Resume from startTime works
- [ ] Integration test: Volume persistence works
- [ ] Manual test: Play/pause functionality
- [ ] Manual test: Seek bar works
- [ ] Manual test: Volume control works
- [ ] Manual test: Fullscreen toggle works
- [ ] Manual test: Works in both English and Arabic routes

## Design Considerations

### Performance
- Lazy loaded via `next/dynamic` to reduce initial bundle
- Only loads on client-side (ssr: false)
- Proper cleanup prevents memory leaks
- HLS adaptive streaming optimizes bandwidth

### Accessibility
- Video.js provides ARIA labels by default
- Keyboard navigation supported
- Screen reader compatible
- Focus management handled by Video.js

### RTL Support
- `dir` attribute set based on `rtl` prop
- Control bar flips horizontally for Arabic
- Time displays remain LTR (numbers)
- CSS handles layout adjustments

### Error Handling
- Graceful error UI with retry option
- Console logging for debugging
- Error callbacks for parent components
- Fallback to error boundary if needed

## Success Metrics
- Video plays successfully in browser
- No console errors or warnings
- Memory usage stable (no leaks)
- Responsive on all screen sizes
- Works in both English and Arabic
- Load time < 2 seconds

## References
- Video.js Player API: https://docs.videojs.com/player
- React Hooks: https://react.dev/reference/react
- Next.js Dynamic Import: https://nextjs.org/docs/pages/building-your-application/optimizing/lazy-loading
- Implementation Guide: `/docs/architecture/video-player-implementation-guide.md` (lines 176-500)

## Estimated Effort
**Medium** - 4-6 hours

### Breakdown
- Component structure and props: 1 hour
- Video.js lifecycle management: 1.5 hours
- Error handling and loading states: 1 hour
- Styling and RTL support: 1 hour
- Unit tests: 1-1.5 hours
- Manual testing and debugging: 30 minutes
