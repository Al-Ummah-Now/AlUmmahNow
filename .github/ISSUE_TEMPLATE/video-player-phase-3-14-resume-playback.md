---
name: "[Phase 3.3] Resume Playback Feature"
about: Allow users to resume from saved position
title: "[Phase 3.3] Create Resume Playback Feature"
labels: phase-3, video-player, enhancement, feature, ux
assignees: ''
---

## Overview
Implement UI and logic to allow users to resume videos from their saved watch position with an option to start from beginning.

## Acceptance Criteria
- [ ] "Resume watching" prompt appears when saved progress exists
- [ ] Prompt shows thumbnail, title, and timestamp
- [ ] "Resume from X:XX" button
- [ ] "Start from beginning" button
- [ ] Auto-resume after 3 seconds if no interaction
- [ ] Prompt dismissible
- [ ] Progress bar shows saved position indicator
- [ ] Works for both authenticated and anonymous users
- [ ] Bilingual support (EN/AR)
- [ ] Mobile-friendly modal

## Implementation

```typescript
// apps/web/src/components/VideoPlayer/ResumePrompt.tsx
interface ResumePromptProps {
  videoTitle: string;
  savedTime: number;
  duration: number;
  thumbnailUrl: string;
  onResume: () => void;
  onStartOver: () => void;
  onDismiss: () => void;
  rtl?: boolean;
}

export function ResumePrompt({
  videoTitle,
  savedTime,
  duration,
  thumbnailUrl,
  onResume,
  onStartOver,
  onDismiss,
  rtl
}: ResumePromptProps) {
  const [countdown, setCountdown] = useState(3);

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          onResume();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [onResume]);

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return h > 0 
      ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
      : `${m}:${s.toString().padStart(2, '0')}`;
  };

  const progress = (savedTime / duration) * 100;

  return (
    <div className="resume-prompt-overlay" dir={rtl ? 'rtl' : 'ltr'}>
      <div className="resume-prompt">
        <button className="dismiss-btn" onClick={onDismiss}>
          ×
        </button>

        <div className="resume-content">
          <div className="resume-thumbnail">
            <img src={thumbnailUrl} alt={videoTitle} />
            <div className="resume-progress">
              <div 
                className="resume-progress-bar" 
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          <h3>{videoTitle}</h3>
          <p className="resume-time">
            {rtl ? 'متوقف عند' : 'Stopped at'} {formatTime(savedTime)} / {formatTime(duration)}
          </p>

          <div className="resume-actions">
            <button className="btn-resume" onClick={onResume}>
              {rtl ? `استئناف من ${formatTime(savedTime)}` : `Resume from ${formatTime(savedTime)}`}
              {countdown > 0 && ` (${countdown})`}
            </button>
            <button className="btn-start-over" onClick={onStartOver}>
              {rtl ? 'ابدأ من جديد' : 'Start from beginning'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

**Integration in CustomVideoPlayer:**
```typescript
export function CustomVideoPlayer(props: CustomVideoPlayerProps) {
  const [showResumePrompt, setShowResumePrompt] = useState(false);
  const [savedProgress, setSavedProgress] = useState<WatchProgress | null>(null);

  useEffect(() => {
    const loadProgress = async () => {
      const progress = await watchHistoryService.current.getProgress(videoId);
      if (progress && progress.watchTime > 30 && !progress.completed) {
        setSavedProgress(progress);
        setShowResumePrompt(true);
      }
    };
    loadProgress();
  }, [videoId]);

  const handleResume = () => {
    if (savedProgress && playerRef.current) {
      playerRef.current.currentTime(savedProgress.watchTime);
      playerRef.current.play();
    }
    setShowResumePrompt(false);
  };

  const handleStartOver = () => {
    if (playerRef.current) {
      playerRef.current.currentTime(0);
      playerRef.current.play();
    }
    setShowResumePrompt(false);
  };

  return (
    <>
      {showResumePrompt && savedProgress && (
        <ResumePrompt
          videoTitle={props.title}
          savedTime={savedProgress.watchTime}
          duration={savedProgress.totalDuration}
          thumbnailUrl={props.thumbnailUrl || ''}
          onResume={handleResume}
          onStartOver={handleStartOver}
          onDismiss={() => setShowResumePrompt(false)}
          rtl={props.rtl}
        />
      )}
      {/* ... rest of player */}
    </>
  );
}
```

## Testing
- [ ] Prompt appears for saved progress
- [ ] Auto-resume countdown works
- [ ] Manual resume accurate
- [ ] Start over resets position
- [ ] Dismiss button works
- [ ] No prompt for completed videos
- [ ] No prompt for <30s progress
- [ ] Bilingual text correct

## Dependencies
- Phase 3.2: Watch progress tracking ✓

## Estimated Effort
**Small** - 2-3 hours
