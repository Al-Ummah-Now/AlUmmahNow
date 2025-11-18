# Resume Playback Integration Guide

This guide shows how to integrate the ResumePrompt component into CustomVideoPlayer.tsx once the `useWatchProgress` hook is implemented.

## Prerequisites

The `useWatchProgress` hook (Issue #57) must be implemented with the following interface:

```typescript
interface UseWatchProgressResult {
  savedProgress: {
    currentTime: number;
    duration: number;
    percentage: number;
    timestamp: Date;
  } | null;
  saveProgress: (currentTime: number, duration: number) => Promise<void>;
  clearProgress: () => Promise<void>;
  isLoading: boolean;
}
```

## Integration Steps

### 1. Import ResumePrompt Component

Add to imports in `CustomVideoPlayer.tsx`:

```typescript
import { ResumePrompt } from './ResumePrompt';
```

### 2. Add State and Hook

After existing state declarations (around line 133):

```typescript
const [showResumePrompt, setShowResumePrompt] = useState(false);

// Watch progress hook (Issue #57)
const { savedProgress, saveProgress, clearProgress } = useWatchProgress({
  videoId,
  userId,
  authToken,
});
```

### 3. Check for Saved Progress on Mount

Add this useEffect after the main player initialization (around line 484, after main useEffect):

```typescript
/**
 * Issue #58: Check for saved progress and show resume prompt
 * Only show if progress > 30 seconds and not near the end (< 95%)
 */
useEffect(() => {
  if (!playerRef.current || !savedProgress || !playerReady) return;

  const { currentTime, duration } = savedProgress;

  // Don't show prompt if:
  // - Less than 30 seconds watched
  // - More than 95% complete (near end)
  // - No valid duration
  if (currentTime < 30 || !duration || (currentTime / duration) > 0.95) {
    return;
  }

  // Show resume prompt
  setShowResumePrompt(true);
}, [savedProgress, playerReady]);
```

### 4. Add Resume Handlers

Add these handlers after `handleFallback` (around line 167):

```typescript
/**
 * Handle resume from saved position
 */
const handleResume = useCallback(() => {
  if (!playerRef.current || !savedProgress) return;

  const player = playerRef.current as ExtendedPlayer;

  // Seek to saved position
  player.currentTime(savedProgress.currentTime);

  // Start playback
  player.play().catch((err) => {
    console.error('[CustomVideoPlayer] Resume play failed:', err);
  });

  // Hide prompt
  setShowResumePrompt(false);
}, [savedProgress]);

/**
 * Handle start from beginning
 */
const handleStartFromBeginning = useCallback(() => {
  if (!playerRef.current) return;

  const player = playerRef.current as ExtendedPlayer;

  // Clear saved progress
  clearProgress();

  // Start from beginning
  player.currentTime(0);
  player.play().catch((err) => {
    console.error('[CustomVideoPlayer] Start from beginning play failed:', err);
  });

  // Hide prompt
  setShowResumePrompt(false);
}, [clearProgress]);

/**
 * Handle dismiss resume prompt
 */
const handleDismissPrompt = useCallback(() => {
  setShowResumePrompt(false);
}, []);
```

### 5. Add Save Progress Handlers

Inside the main player initialization useEffect, add these event handlers after the existing event listeners (around line 360):

```typescript
// Issue #57: Save watch progress
player.on('timeupdate', () => {
  const currentTime = player.currentTime();
  const duration = player.duration();

  if (!duration || isNaN(duration) || duration === 0) {
    return;
  }

  // Throttle saves to every 10 seconds
  const now = Date.now();
  const SAVE_INTERVAL = 10000; // 10 seconds

  // Use a ref to track last save time (add to refs at top)
  // const lastSaveTimeRef = useRef<number>(0);

  if (now - lastSaveTimeRef.current >= SAVE_INTERVAL) {
    saveProgress(currentTime, duration).catch((err) => {
      console.error('[CustomVideoPlayer] Save progress failed:', err);
    });
    lastSaveTimeRef.current = now;
  }
});

// Save on pause
player.on('pause', () => {
  const currentTime = player.currentTime();
  const duration = player.duration();

  if (duration && !isNaN(duration) && duration > 0) {
    saveProgress(currentTime, duration).catch((err) => {
      console.error('[CustomVideoPlayer] Save on pause failed:', err);
    });
  }

  analyticsRef.current?.trackPause();
  setIsPlaying(false);
});

// Save on seeked
player.on('seeked', () => {
  const currentTime = player.currentTime();
  const duration = player.duration();

  if (duration && !isNaN(duration) && duration > 0) {
    saveProgress(currentTime, duration).catch((err) => {
      console.error('[CustomVideoPlayer] Save on seek failed:', err);
    });
  }

  const fromTime = seekStartTimeRef.current;
  analyticsRef.current?.trackSeek(fromTime, currentTime);
});

// Clear progress when video ends
player.on('ended', () => {
  clearProgress().catch((err) => {
    console.error('[CustomVideoPlayer] Clear progress failed:', err);
  });

  analyticsRef.current?.trackComplete();
  setIsPlaying(false);
});
```

### 6. Render Resume Prompt

Add ResumePrompt component in the render section, after the BufferingIndicator (around line 528):

```typescript
{/* Issue #58: Resume playback prompt */}
{showResumePrompt && savedProgress && poster && (
  <ResumePrompt
    videoTitle={ariaLabel || 'Video'}
    savedTime={savedProgress.currentTime}
    duration={savedProgress.duration}
    thumbnailUrl={poster}
    onResume={handleResume}
    onStartFromBeginning={handleStartFromBeginning}
    onDismiss={handleDismissPrompt}
    autoResumeSeconds={3}
    lang={lang}
  />
)}
```

### 7. Add Required Ref

Add to state/refs section (around line 127):

```typescript
const lastSaveTimeRef = useRef<number>(0);
```

## Complete Integration Example

Here's a complete diff showing all changes:

```diff
// Imports
+import { ResumePrompt } from './ResumePrompt';

// State and refs
  const [isBuffering, setIsBuffering] = useState(false);
  const [bufferProgress, setBufferProgress] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState(false);
+ const [showResumePrompt, setShowResumePrompt] = useState(false);
+ const lastSaveTimeRef = useRef<number>(0);

  // Phase 3: Advanced analytics state tracking
  const seekStartTimeRef = useRef<number>(0);
  const lastProgressTrackRef = useRef<number>(0);
  const quartilesFiredRef = useRef<Set<25 | 50 | 75>>(new Set());

  // WebSocket integration for real-time metrics
  const { viewerCount, isConnected: wsConnected } = useVideoWebSocket({
    videoId,
    userId,
    autoConnect: enableWebSocket,
    isPlaying,
    onError: (error) => {
      console.error('[CustomVideoPlayer] WebSocket error:', error);
    }
  });

+ // Watch progress hook (Issue #57)
+ const { savedProgress, saveProgress, clearProgress } = useWatchProgress({
+   videoId,
+   userId,
+   authToken,
+ });

// Add handlers after handleFallback
+ const handleResume = useCallback(() => { ... }, [savedProgress]);
+ const handleStartFromBeginning = useCallback(() => { ... }, [clearProgress]);
+ const handleDismissPrompt = useCallback(() => { ... }, []);

// Add useEffect to check for saved progress
+ useEffect(() => {
+   if (!playerRef.current || !savedProgress || !playerReady) return;
+   // ... show prompt logic
+ }, [savedProgress, playerReady]);

// In render section, after BufferingIndicator
+ {showResumePrompt && savedProgress && poster && (
+   <ResumePrompt
+     videoTitle={ariaLabel || 'Video'}
+     savedTime={savedProgress.currentTime}
+     duration={savedProgress.duration}
+     thumbnailUrl={poster}
+     onResume={handleResume}
+     onStartFromBeginning={handleStartFromBeginning}
+     onDismiss={handleDismissPrompt}
+     autoResumeSeconds={3}
+     lang={lang}
+   />
+ )}
```

## Testing

1. **First Watch**: Play video for >30 seconds, then navigate away
2. **Return**: Come back to same video
3. **Expected**: Resume prompt appears with saved timestamp
4. **Test Actions**:
   - Click "Resume from X:XX" → Should continue from saved position
   - Click "Start from beginning" → Should restart video
   - Press ESC → Should dismiss prompt
   - Click outside → Should dismiss prompt
   - Wait 3 seconds → Should auto-resume

## Notes

- Prompt only shows when progress > 30 seconds
- Prompt doesn't show when > 95% complete
- Auto-resume countdown is 3 seconds (configurable)
- Progress saves every 10 seconds, on pause, and on seek
- Progress clears when video ends
- Bilingual support (EN/AR) is automatic via `lang` prop
- RTL layout is automatic for Arabic
