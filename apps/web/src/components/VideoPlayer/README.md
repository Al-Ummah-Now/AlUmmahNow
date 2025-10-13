# CustomVideoPlayer Component

A production-ready React component for video playback using Video.js and Bunny.net HLS streaming.

## Features

- ✅ Video.js player with HLS streaming support
- ✅ Proper lifecycle management (mount, update, unmount)
- ✅ Client-side only rendering (no SSR issues)
- ✅ RTL support for Arabic interface
- ✅ Resume from saved position
- ✅ Accessibility features (ARIA labels, keyboard navigation, screen reader support)
- ✅ Error handling and loading states
- ✅ Memory leak prevention
- ✅ Responsive design
- ✅ Dark mode support
- ✅ TypeScript support

## Installation

The component is already integrated with the required dependencies:

```json
{
  "video.js": "^8.23.4",
  "@videojs/http-streaming": "^3.17.2",
  "videojs-contrib-quality-levels": "^4.1.0",
  "videojs-hls-quality-selector": "^2.0.0"
}
```

## Usage

### Basic Usage

```tsx
import { CustomVideoPlayer } from '@/components/VideoPlayer';

function VideoPage() {
  return (
    <CustomVideoPlayer
      videoId="my-video-123"
      bunnyVideoId="bunny-guid-abc-def"
      title="Introduction to Islam"
    />
  );
}
```

### With All Options

```tsx
import { CustomVideoPlayer } from '@/components/VideoPlayer';

function VideoPage() {
  const handlePlay = () => {
    console.log('Video started playing');
  };

  const handlePause = () => {
    console.log('Video paused');
  };

  const handleTimeUpdate = (currentTime: number, duration: number) => {
    console.log(`Progress: ${currentTime}/${duration} seconds`);
    // Save progress to backend
  };

  const handleEnded = () => {
    console.log('Video ended');
  };

  const handleError = (error: any) => {
    console.error('Video error:', error);
  };

  return (
    <CustomVideoPlayer
      videoId="my-video-123"
      bunnyVideoId="bunny-guid-abc-def"
      title="Introduction to Islam"
      channelId="channel-123"
      userId="user-456"
      autoplay={false}
      startTime={120}  // Resume from 2 minutes
      onPlay={handlePlay}
      onPause={handlePause}
      onEnded={handleEnded}
      onTimeUpdate={handleTimeUpdate}
      onError={handleError}
      className="my-custom-class"
      rtl={false}
    />
  );
}
```

### Arabic/RTL Version

```tsx
import { CustomVideoPlayer } from '@/components/VideoPlayer';

function VideoPageArabic() {
  return (
    <CustomVideoPlayer
      videoId="my-video-123"
      bunnyVideoId="bunny-guid-abc-def"
      title="مقدمة إلى الإسلام"
      rtl={true}
    />
  );
}
```

### With Loading Skeleton

```tsx
import { CustomVideoPlayer, VideoPlayerSkeleton } from '@/components/VideoPlayer';
import { Suspense } from 'react';

function VideoPage() {
  return (
    <Suspense fallback={<VideoPlayerSkeleton />}>
      <CustomVideoPlayer
        videoId="my-video-123"
        bunnyVideoId="bunny-guid-abc-def"
        title="Introduction to Islam"
      />
    </Suspense>
  );
}
```

## Props

### CustomVideoPlayer Props

| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `videoId` | `string` | ✅ | - | Your internal video ID |
| `bunnyVideoId` | `string` | ✅ | - | Bunny.net video GUID |
| `title` | `string` | ✅ | - | Video title for accessibility |
| `channelId` | `string` | ❌ | - | Channel ID for analytics |
| `userId` | `string` | ❌ | - | User ID for analytics |
| `autoplay` | `boolean` | ❌ | `false` | Auto-play video on load |
| `startTime` | `number` | ❌ | `0` | Start position in seconds |
| `onPlay` | `() => void` | ❌ | - | Callback when video plays |
| `onPause` | `() => void` | ❌ | - | Callback when video pauses |
| `onEnded` | `() => void` | ❌ | - | Callback when video ends |
| `onTimeUpdate` | `(currentTime: number, duration: number) => void` | ❌ | - | Callback on time update |
| `onError` | `(error: any) => void` | ❌ | - | Callback on error |
| `className` | `string` | ❌ | `''` | Additional CSS classes |
| `rtl` | `boolean` | ❌ | `false` | Enable RTL layout |

### VideoPlayerSkeleton Props

| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `className` | `string` | ❌ | `''` | Additional CSS classes |
| `rtl` | `boolean` | ❌ | `false` | Enable RTL layout |

## Environment Variables

Ensure these environment variables are set in your `.env.local`:

```env
NEXT_PUBLIC_BUNNY_PULL_ZONE_URL=vz-xxxxx.b-cdn.net
NEXT_PUBLIC_BUNNY_LIBRARY_ID=12345
NEXT_PUBLIC_BUNNY_TOKEN_AUTH=false  # Optional
NEXT_PUBLIC_BUNNY_API_KEY=your-api-key  # Optional
```

## Examples

### Resume Playback Feature

```tsx
import { CustomVideoPlayer } from '@/components/VideoPlayer';
import { useState, useEffect } from 'react';

function VideoWithResume({ videoId, bunnyVideoId }: Props) {
  const [startTime, setStartTime] = useState(0);

  // Load saved progress from localStorage or API
  useEffect(() => {
    const savedProgress = localStorage.getItem(`video-progress-${videoId}`);
    if (savedProgress) {
      setStartTime(parseInt(savedProgress));
    }
  }, [videoId]);

  const handleTimeUpdate = (currentTime: number, duration: number) => {
    // Save progress every few seconds
    if (Math.floor(currentTime) % 10 === 0) {
      localStorage.setItem(`video-progress-${videoId}`, currentTime.toString());
    }
  };

  return (
    <CustomVideoPlayer
      videoId={videoId}
      bunnyVideoId={bunnyVideoId}
      title="My Video"
      startTime={startTime}
      onTimeUpdate={handleTimeUpdate}
    />
  );
}
```

### Integration with Analytics

```tsx
import { CustomVideoPlayer } from '@/components/VideoPlayer';
import { trackVideoEvent } from '@/lib/analytics';

function VideoWithAnalytics({ videoId, bunnyVideoId, userId }: Props) {
  const handlePlay = () => {
    trackVideoEvent('video_play', { videoId, userId });
  };

  const handleEnded = () => {
    trackVideoEvent('video_complete', { videoId, userId });
  };

  const handleTimeUpdate = (currentTime: number, duration: number) => {
    const progress = (currentTime / duration) * 100;
    
    // Track milestone events
    if (Math.floor(progress) === 25) {
      trackVideoEvent('video_25_percent', { videoId, userId });
    } else if (Math.floor(progress) === 50) {
      trackVideoEvent('video_50_percent', { videoId, userId });
    } else if (Math.floor(progress) === 75) {
      trackVideoEvent('video_75_percent', { videoId, userId });
    }
  };

  return (
    <CustomVideoPlayer
      videoId={videoId}
      bunnyVideoId={bunnyVideoId}
      title="My Video"
      userId={userId}
      onPlay={handlePlay}
      onEnded={handleEnded}
      onTimeUpdate={handleTimeUpdate}
    />
  );
}
```

## Accessibility

The component includes comprehensive accessibility features:

- ARIA labels and roles
- Keyboard navigation support
- Screen reader announcements
- Focus indicators
- High contrast mode support
- Reduced motion support
- Proper error announcements

## Styling

The component uses:

- Base styles from `video.js/dist/video-js.css`
- Global styles from `@/styles/video-player.css`
- Component-specific styles from `./custom-theme.css`

To customize, modify `custom-theme.css` or override with Tailwind classes via the `className` prop.

## Testing

Run tests with:

```bash
npm test -- CustomVideoPlayer.test.tsx
```

## Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- Mobile browsers with HLS support

## Troubleshooting

### Video doesn't play

1. Check environment variables are set correctly
2. Verify Bunny.net video GUID is valid
3. Check browser console for errors
4. Ensure HLS streaming is enabled in Bunny.net

### Memory leaks

The component properly cleans up Video.js instances on unmount. If you experience issues:

1. Ensure you're not creating multiple instances
2. Check that the component is being unmounted properly
3. Monitor browser memory in DevTools

### SSR errors

The component is client-side only (`'use client'`). If you see SSR errors:

1. Ensure you're not importing it in server components
2. Use dynamic imports with `ssr: false` if needed

## License

Part of Al Ummah Now project.
