# Phase 3: Real-time Features UX Specifications

## Executive Summary

This document provides comprehensive UX specifications for Phase 3's real-time features, focusing on WebSocket integration, connection states, animations, and graceful degradation. Each specification follows mobile-first design principles with full accessibility support.

**Critical UX Goals:**
- Sub-100ms perceived latency for all updates
- Zero jank animations (60fps minimum)
- Graceful offline handling
- Clear connection status feedback
- Accessible dynamic content updates

---

## 1. useLiveStreamWebSocket Hook (UX Impact)

### Purpose
Provides real-time data updates with minimal UI latency and clear connection feedback.

### User Experience Flow

```
┌─────────────────────────────────────────────────────────────┐
│                     Connection States                        │
├─────────────┬──────────────┬──────────────┬────────────────┤
│ Connecting  │   Connected  │ Reconnecting │  Disconnected  │
├─────────────┼──────────────┼──────────────┼────────────────┤
│ • Pulse     │ • Solid dot  │ • Pulse      │ • Hollow dot   │
│ • Yellow    │ • Green      │ • Orange     │ • Red          │
│ • "..."     │ • Live data  │ • Keep data  │ • Cached data  │
└─────────────┴──────────────┴──────────────┴────────────────┘
```

### Visual Specifications

#### Mobile (375px)
```tsx
// Connection indicator - top right corner
<div className="fixed top-2 right-2 z-50">
  <div className="
    flex items-center gap-1.5
    bg-background/80 backdrop-blur-sm
    rounded-full px-2 py-1
    border border-border/50
  ">
    {/* Status dot */}
    <div className={cn(
      "w-2 h-2 rounded-full transition-all duration-300",
      isConnecting && "bg-yellow-500 animate-pulse",
      isConnected && "bg-green-500",
      isReconnecting && "bg-orange-500 animate-pulse",
      isDisconnected && "bg-red-500 ring-2 ring-red-500/20"
    )} />

    {/* Optional status text for larger screens */}
    <span className="hidden sm:block text-xs text-muted-foreground">
      {connectionStatusText}
    </span>
  </div>
</div>
```

#### Tablet/Desktop (768px+)
```tsx
// Enhanced connection status with details
<div className="
  fixed top-4 right-4 z-50
  min-w-[140px]
">
  <Card className="bg-background/95 backdrop-blur-md border-border/50">
    <CardContent className="p-3">
      <div className="flex items-center gap-2">
        <div className={statusDotClasses} />
        <div>
          <p className="text-xs font-medium">{connectionStatus}</p>
          <p className="text-[10px] text-muted-foreground">
            {latency}ms • {quality}
          </p>
        </div>
      </div>
    </CardContent>
  </Card>
</div>
```

### Interaction Patterns

#### Connection Feedback
```tsx
// Optimistic: Show success immediately
const handleAction = async () => {
  // 1. Instant visual feedback
  setIsUpdating(true);
  showTemporarySuccess();

  // 2. Send via WebSocket
  await sendMessage(data);

  // 3. Confirm or rollback
  if (success) {
    confirmSuccess();
  } else {
    rollbackWithError();
  }
};
```

### Accessibility

```tsx
// Announce connection changes to screen readers
<div
  role="status"
  aria-live="polite"
  aria-atomic="true"
  className="sr-only"
>
  {connectionStatus === 'connected'
    ? 'Real-time connection established'
    : connectionStatus === 'reconnecting'
    ? 'Connection lost, attempting to reconnect'
    : 'Operating in offline mode'
  }
</div>
```

### Performance Metrics
- Initial connection: < 500ms
- Reconnection: < 2s
- Status update: < 16ms (1 frame)
- Memory overhead: < 5MB

---

## 2. WebSocket Connection with Auto-Reconnect

### Purpose
Maintain persistent connection with intelligent reconnection strategy.

### Visual Design

#### Reconnection Sequence
```
Initial → Failed → Retry 1 → Retry 2 → Retry 3 → Fallback
  ↓         ↓        ↓          ↓          ↓         ↓
[====] → [    ] → [=   ] → [==  ] → [===] → [Offline Mode]
Green    Red     Yellow   Yellow   Yellow    Gray
```

### Mobile UI (375px)
```tsx
// Reconnection toast notification
<div className="
  fixed bottom-20 left-4 right-4 z-50
  animate-in slide-in-from-bottom-2
">
  <Alert className="bg-orange-500/10 border-orange-500/50">
    <AlertCircle className="h-4 w-4 text-orange-500" />
    <AlertTitle className="text-sm">Reconnecting...</AlertTitle>
    <AlertDescription className="text-xs">
      <div className="flex items-center justify-between mt-2">
        <span>Attempt {attempt} of {maxAttempts}</span>
        <Progress value={progress} className="w-20 h-1" />
      </div>
    </AlertDescription>
  </Alert>
</div>
```

### Desktop UI (1024px+)
```tsx
// Persistent connection banner
<div className="
  fixed top-0 left-0 right-0 z-50
  h-8 bg-gradient-to-r from-orange-500/10 to-orange-600/10
  border-b border-orange-500/20
  backdrop-blur-sm
">
  <div className="container mx-auto h-full flex items-center justify-between px-4">
    <div className="flex items-center gap-2">
      <Loader2 className="h-3 w-3 animate-spin text-orange-500" />
      <span className="text-xs font-medium">
        Connection interrupted - Reconnecting...
      </span>
    </div>
    <Button
      variant="ghost"
      size="sm"
      onClick={cancelReconnect}
      className="h-6 text-xs"
    >
      Work Offline
    </Button>
  </div>
</div>
```

### Exponential Backoff Visual
```tsx
// Show increasing delay between attempts
const delays = [1, 2, 4, 8, 16]; // seconds

<div className="space-y-2">
  {delays.map((delay, index) => (
    <div key={index} className={cn(
      "flex items-center gap-2 text-xs",
      attempt === index + 1 && "font-semibold text-foreground",
      attempt > index + 1 && "text-muted-foreground line-through",
      attempt < index + 1 && "text-muted-foreground/50"
    )}>
      <span>Attempt {index + 1}</span>
      <span className="text-[10px]">({delay}s delay)</span>
      {attempt === index + 1 && (
        <Loader2 className="h-3 w-3 animate-spin" />
      )}
    </div>
  ))}
</div>
```

### Accessibility
```tsx
// Announce reconnection attempts
<div role="alert" aria-live="assertive" className="sr-only">
  {isReconnecting && (
    <>Reconnection attempt {attempt} of {maxAttempts}</>
  )}
</div>
```

---

## 3. Channel Subscription for Live Stream Updates

### Purpose
Subscribe to specific stream channels for targeted updates.

### Visual Subscription Flow

```
┌────────────────────────────────────────────┐
│         Subscription State Machine          │
├──────────┬────────┬───────────┬────────────┤
│ Initial  │ Joining│ Subscribed│   Leaving  │
├──────────┼────────┼───────────┼────────────┤
│ No badge │ Pulse  │ Solid     │ Fade out   │
│          │ badge  │ badge     │ badge      │
└──────────┴────────┴───────────┴────────────┘
```

### Mobile UI (375px)
```tsx
// Subscription indicator on stream card
<div className="absolute top-2 right-2">
  <Badge
    variant={isSubscribed ? "default" : "outline"}
    className={cn(
      "transition-all duration-300",
      isSubscribing && "animate-pulse",
      isSubscribed && "bg-green-500/90 border-green-500"
    )}
  >
    <Bell className="h-3 w-3 mr-1" />
    {isSubscribed ? "Watching" : "Watch"}
  </Badge>
</div>
```

### Desktop UI with Channel List
```tsx
// Active subscriptions sidebar
<Card className="w-64">
  <CardHeader>
    <CardTitle className="text-sm flex items-center justify-between">
      Active Streams
      <Badge variant="secondary">{activeCount}</Badge>
    </CardTitle>
  </CardHeader>
  <CardContent className="p-0">
    <ScrollArea className="h-[300px]">
      <div className="space-y-1 p-4">
        {subscriptions.map(sub => (
          <div
            key={sub.id}
            className="flex items-center gap-2 p-2 rounded hover:bg-muted/50"
          >
            <div className="relative">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              {sub.hasUpdate && (
                <div className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full" />
              )}
            </div>
            <span className="text-sm flex-1 truncate">{sub.name}</span>
            <span className="text-xs text-muted-foreground">
              {sub.viewerCount}
            </span>
          </div>
        ))}
      </div>
    </ScrollArea>
  </CardContent>
</Card>
```

### Multi-Channel Management
```tsx
// Bulk subscription actions
<div className="flex items-center gap-2 p-2 bg-muted rounded-lg">
  <Button
    size="sm"
    variant="outline"
    onClick={subscribeAll}
    disabled={isSubscribing}
  >
    <Bell className="h-3 w-3 mr-1" />
    Watch All ({streams.length})
  </Button>

  <Button
    size="sm"
    variant="ghost"
    onClick={unsubscribeAll}
  >
    Clear All
  </Button>

  <span className="ml-auto text-xs text-muted-foreground">
    {subscribedCount}/{maxSubscriptions} active
  </span>
</div>
```

---

## 4. Real-time Viewer Count Updates with Animations

### Purpose
Display viewer counts with smooth, non-distracting animations.

### Animation Specifications

#### Count Change Animation
```tsx
// Smooth number transition with color flash
const ViewerCountAnimation = {
  // Increase animation
  increase: {
    scale: [1, 1.1, 1],
    color: ["default", "green", "default"],
    duration: 400,
    easing: "cubic-bezier(0.34, 1.56, 0.64, 1)"
  },

  // Decrease animation
  decrease: {
    scale: [1, 0.95, 1],
    color: ["default", "orange", "default"],
    duration: 300,
    easing: "ease-out"
  },

  // Pulse for live indicator
  pulse: {
    scale: [1, 1.05, 1],
    opacity: [1, 0.8, 1],
    duration: 2000,
    repeat: Infinity
  }
};
```

### Mobile UI (375px)
```tsx
// Compact viewer count with trend
<div className="flex items-center gap-1.5 bg-black/60 rounded px-2 py-1">
  {/* Live indicator */}
  <div className="relative">
    <div className="absolute inset-0 bg-red-500 rounded-full blur animate-pulse" />
    <Eye className="h-3 w-3 text-red-500 relative" />
  </div>

  {/* Animated count */}
  <animated.span
    className="text-white text-sm font-semibold tabular-nums"
    style={{
      transform: springs.scale.to(s => `scale(${s})`),
      color: springs.color
    }}
  >
    {animatedCount.to(n => formatNumber(Math.floor(n)))}
  </animated.span>

  {/* Trend indicator */}
  {trend !== 'stable' && (
    <animated.div
      style={{
        opacity: springs.trend,
        transform: springs.trendY.to(y => `translateY(${y}px)`)
      }}
    >
      {trend === 'up' ? (
        <TrendingUp className="h-3 w-3 text-green-400" />
      ) : (
        <TrendingDown className="h-3 w-3 text-orange-400" />
      )}
    </animated.div>
  )}
</div>
```

### Desktop UI with Details
```tsx
// Enhanced viewer metrics
<Card className="overflow-hidden">
  <CardContent className="p-4">
    <div className="space-y-3">
      {/* Current viewers */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">Live Viewers</span>
        <div className="flex items-center gap-2">
          <animated.span className="text-2xl font-bold tabular-nums">
            {currentCount}
          </animated.span>
          {/* Change indicator */}
          {recentChange !== 0 && (
            <animated.span
              className={cn(
                "text-sm font-medium",
                recentChange > 0 ? "text-green-500" : "text-orange-500"
              )}
              style={changeAnimation}
            >
              {recentChange > 0 ? '+' : ''}{recentChange}
            </animated.span>
          )}
        </div>
      </div>

      {/* Peak viewers */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Peak</span>
        <span className="text-sm font-medium">{peakCount}</span>
      </div>

      {/* Mini sparkline */}
      <div className="h-8">
        <Sparkline data={viewerHistory} />
      </div>
    </div>
  </CardContent>
</Card>
```

### Performance Optimizations
```tsx
// Throttle updates to prevent jank
const throttledUpdate = useMemo(
  () => throttle((count: number) => {
    // Batch DOM updates
    requestAnimationFrame(() => {
      setViewerCount(count);
      triggerAnimation(count - previousCount);
    });
  }, 100), // Max 10 updates per second
  []
);
```

---

## 5. Real-time Status Change Notifications

### Purpose
Notify users of stream status changes with clear, accessible alerts.

### Notification Hierarchy

```
Critical: Stream Started/Ended → Toast + Sound + Badge
High:     Status Change       → Toast + Badge
Medium:   Quality Change      → Inline indicator
Low:      Viewer Milestone    → Subtle animation
```

### Mobile Notifications (375px)
```tsx
// Stream status change toast
<div className="fixed top-4 left-4 right-4 z-[100]">
  <motion.div
    initial={{ opacity: 0, y: -20, scale: 0.95 }}
    animate={{ opacity: 1, y: 0, scale: 1 }}
    exit={{ opacity: 0, y: -20, scale: 0.95 }}
    transition={{
      type: "spring",
      stiffness: 500,
      damping: 30
    }}
  >
    <Alert className={cn(
      "border-2",
      status === 'live' && "border-red-500 bg-red-500/10",
      status === 'ended' && "border-gray-500 bg-gray-500/10"
    )}>
      <div className="flex items-start gap-3">
        {/* Icon with animation */}
        <div className="mt-0.5">
          {status === 'live' ? (
            <div className="relative">
              <div className="absolute inset-0 bg-red-500 rounded-full blur animate-ping" />
              <Radio className="h-5 w-5 text-red-500 relative" />
            </div>
          ) : (
            <RadioOff className="h-5 w-5 text-gray-500" />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 space-y-1">
          <AlertTitle className="text-sm font-semibold">
            {streamTitle}
          </AlertTitle>
          <AlertDescription className="text-xs">
            {status === 'live'
              ? 'Stream is now live!'
              : 'Stream has ended'
            }
          </AlertDescription>
        </div>

        {/* Action */}
        <Button size="sm" variant="ghost" onClick={dismiss}>
          <X className="h-4 w-4" />
        </Button>
      </div>
    </Alert>
  </motion.div>
</div>
```

### Desktop Notification Center
```tsx
// Notification panel with history
<Popover>
  <PopoverTrigger asChild>
    <Button variant="ghost" size="sm" className="relative">
      <Bell className="h-4 w-4" />
      {unreadCount > 0 && (
        <Badge
          className="absolute -top-1 -right-1 h-5 w-5 p-0"
          variant="destructive"
        >
          {unreadCount}
        </Badge>
      )}
    </Button>
  </PopoverTrigger>

  <PopoverContent className="w-80 p-0" align="end">
    <div className="p-4 border-b">
      <h3 className="font-semibold text-sm">Stream Updates</h3>
    </div>

    <ScrollArea className="h-[300px]">
      <div className="p-2 space-y-2">
        {notifications.map(notif => (
          <motion.div
            key={notif.id}
            layout
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className={cn(
              "p-3 rounded-lg cursor-pointer transition-colors",
              "hover:bg-muted/50",
              !notif.read && "bg-primary/5 border-l-2 border-primary"
            )}
            onClick={() => markAsRead(notif.id)}
          >
            <div className="flex items-start gap-3">
              <div className={cn(
                "w-2 h-2 rounded-full mt-2",
                notif.type === 'live' && "bg-red-500",
                notif.type === 'ended' && "bg-gray-500",
                notif.type === 'scheduled' && "bg-blue-500"
              )} />

              <div className="flex-1 space-y-1">
                <p className="text-sm font-medium line-clamp-1">
                  {notif.title}
                </p>
                <p className="text-xs text-muted-foreground">
                  {notif.message}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {formatRelativeTime(notif.timestamp)}
                </p>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </ScrollArea>
  </PopoverContent>
</Popover>
```

### Accessibility
```tsx
// Screen reader announcements
<div
  role="alert"
  aria-live="assertive"
  aria-atomic="true"
  className="sr-only"
>
  {statusChange && (
    `${streamTitle} is now ${status}. ${
      status === 'live'
        ? `${viewerCount} viewers watching.`
        : 'Thank you for watching.'
    }`
  )}
</div>
```

---

## 6. Presence Tracking (Who's Watching)

### Purpose
Show who else is watching the stream in real-time.

### Visual Design

#### Avatar Stack (Mobile - 375px)
```tsx
// Compact avatar stack with overflow
<div className="flex items-center">
  <div className="flex -space-x-2">
    {viewers.slice(0, 3).map((viewer, i) => (
      <Avatar
        key={viewer.id}
        className={cn(
          "h-8 w-8 border-2 border-background",
          "hover:z-10 hover:scale-110 transition-transform"
        )}
        style={{ zIndex: 3 - i }}
      >
        <AvatarImage src={viewer.avatar} alt={viewer.name} />
        <AvatarFallback>{viewer.initials}</AvatarFallback>
      </Avatar>
    ))}
  </div>

  {viewers.length > 3 && (
    <div className="ml-1 flex items-center">
      <div className="
        h-8 w-8 rounded-full
        bg-muted border-2 border-background
        flex items-center justify-center
      ">
        <span className="text-xs font-medium">
          +{viewers.length - 3}
        </span>
      </div>
    </div>
  )}

  <span className="ml-2 text-sm text-muted-foreground">
    watching
  </span>
</div>
```

#### Expanded Presence List (Desktop)
```tsx
// Detailed presence panel
<Card className="w-64">
  <CardHeader className="pb-3">
    <CardTitle className="text-sm flex items-center justify-between">
      <span>Viewers</span>
      <Badge variant="secondary">{viewers.length}</Badge>
    </CardTitle>
  </CardHeader>

  <CardContent className="p-0">
    <ScrollArea className="h-[400px]">
      <div className="p-4 space-y-3">
        {/* Recently joined */}
        {recentlyJoined.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              Just joined
            </p>
            {recentlyJoined.map(viewer => (
              <motion.div
                key={viewer.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                className="flex items-center gap-2 p-2 rounded bg-green-500/5"
              >
                <Avatar className="h-6 w-6">
                  <AvatarImage src={viewer.avatar} />
                  <AvatarFallback>{viewer.initials}</AvatarFallback>
                </Avatar>
                <span className="text-sm flex-1">{viewer.name}</span>
                <span className="text-xs text-green-500">New</span>
              </motion.div>
            ))}
          </div>
        )}

        {/* Active viewers */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            Watching now
          </p>
          {activeViewers.map(viewer => (
            <div
              key={viewer.id}
              className="flex items-center gap-2 p-2 rounded hover:bg-muted/50"
            >
              <div className="relative">
                <Avatar className="h-6 w-6">
                  <AvatarImage src={viewer.avatar} />
                  <AvatarFallback>{viewer.initials}</AvatarFallback>
                </Avatar>
                {viewer.isActive && (
                  <div className="
                    absolute bottom-0 right-0
                    w-2 h-2 bg-green-500 rounded-full
                    ring-2 ring-background
                  " />
                )}
              </div>
              <span className="text-sm flex-1 truncate">
                {viewer.name}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {formatDuration(viewer.watchTime)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </ScrollArea>
  </CardContent>
</Card>
```

### Animation for Join/Leave
```tsx
// Smooth enter/exit animations
<AnimatePresence mode="popLayout">
  {viewers.map(viewer => (
    <motion.div
      key={viewer.id}
      layout
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0, opacity: 0 }}
      transition={{
        type: "spring",
        stiffness: 500,
        damping: 30
      }}
    >
      <ViewerAvatar viewer={viewer} />
    </motion.div>
  ))}
</AnimatePresence>
```

---

## 7. Optimistic Updates for Better UX

### Purpose
Provide instant feedback for user actions before server confirmation.

### Optimistic Update Flow

```
User Action → Instant UI Update → Server Request → Confirm/Rollback
     ↓              ↓                    ↓              ↓
   Click      Visual Change         WebSocket      Final State
```

### Implementation Patterns

#### Like/Unlike Animation
```tsx
// Optimistic like with rollback
const [isLiked, setIsLiked] = useState(false);
const [likeCount, setLikeCount] = useState(100);
const [isProcessing, setIsProcessing] = useState(false);

const handleLike = async () => {
  if (isProcessing) return;

  // 1. Optimistic update
  const wasLiked = isLiked;
  const previousCount = likeCount;

  setIsLiked(!wasLiked);
  setLikeCount(wasLiked ? previousCount - 1 : previousCount + 1);
  setIsProcessing(true);

  // 2. Animate
  animateLike(!wasLiked);

  try {
    // 3. Send to server
    const result = await sendWebSocketMessage({
      type: 'like',
      streamId,
      liked: !wasLiked
    });

    // 4. Confirm with server state
    setLikeCount(result.likeCount);

  } catch (error) {
    // 5. Rollback on error
    setIsLiked(wasLiked);
    setLikeCount(previousCount);
    showErrorToast("Couldn't update. Please try again.");
  } finally {
    setIsProcessing(false);
  }
};

// Visual feedback
<Button
  variant={isLiked ? "default" : "outline"}
  size="sm"
  onClick={handleLike}
  disabled={isProcessing}
  className={cn(
    "transition-all duration-200",
    isProcessing && "opacity-50 cursor-not-allowed"
  )}
>
  <motion.div
    animate={isLiked ? {
      scale: [1, 1.2, 1],
      rotate: [0, -10, 10, 0]
    } : {}}
    transition={{ duration: 0.3 }}
  >
    <Heart className={cn(
      "h-4 w-4",
      isLiked && "fill-current text-red-500"
    )} />
  </motion.div>
  <span className="ml-1 tabular-nums">{likeCount}</span>
</Button>
```

#### Comment Submission
```tsx
// Optimistic comment with placeholder
const handleSubmitComment = async (text: string) => {
  // 1. Create optimistic comment
  const optimisticComment = {
    id: `optimistic-${Date.now()}`,
    text,
    user: currentUser,
    timestamp: Date.now(),
    isOptimistic: true
  };

  // 2. Add to UI immediately
  setComments(prev => [optimisticComment, ...prev]);

  // 3. Show sending indicator
  <div className={cn(
    "p-3 rounded-lg",
    comment.isOptimistic && "bg-muted/50 animate-pulse"
  )}>
    <div className="flex items-start gap-2">
      <Avatar className="h-6 w-6 opacity-70" />
      <div className="flex-1">
        <p className="text-sm">{comment.text}</p>
        <p className="text-xs text-muted-foreground">
          Sending...
        </p>
      </div>
    </div>
  </div>

  try {
    // 4. Send to server
    const realComment = await submitComment(text);

    // 5. Replace optimistic with real
    setComments(prev =>
      prev.map(c =>
        c.id === optimisticComment.id ? realComment : c
      )
    );

  } catch (error) {
    // 6. Remove optimistic comment
    setComments(prev =>
      prev.filter(c => c.id !== optimisticComment.id)
    );
    showErrorToast("Comment failed to send");
  }
};
```

---

## 8. Message Throttling (Max 100/min)

### Purpose
Prevent spam while maintaining responsive feel.

### Visual Throttling Indicators

#### Rate Limit Gauge (Mobile)
```tsx
// Subtle rate limit indicator
<div className="fixed bottom-4 right-4 z-40">
  <div className="relative w-12 h-12">
    {/* Circular progress */}
    <svg className="transform -rotate-90 w-12 h-12">
      <circle
        cx="24"
        cy="24"
        r="20"
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
        className="text-muted"
      />
      <circle
        cx="24"
        cy="24"
        r="20"
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
        strokeDasharray={`${(messagesUsed / 100) * 125.6} 125.6`}
        className={cn(
          "transition-all duration-300",
          messagesUsed < 50 && "text-green-500",
          messagesUsed >= 50 && messagesUsed < 80 && "text-yellow-500",
          messagesUsed >= 80 && "text-red-500"
        )}
      />
    </svg>

    {/* Count */}
    <div className="absolute inset-0 flex items-center justify-center">
      <span className="text-xs font-medium">
        {100 - messagesUsed}
      </span>
    </div>
  </div>
</div>
```

#### Input Throttling Feedback
```tsx
// Chat input with throttling
<div className="relative">
  <Input
    value={message}
    onChange={(e) => setMessage(e.target.value)}
    onKeyPress={handleKeyPress}
    placeholder={
      isThrottled
        ? `Wait ${cooldownSeconds}s...`
        : "Type a message..."
    }
    disabled={isThrottled}
    className={cn(
      isThrottled && "opacity-50 cursor-not-allowed"
    )}
  />

  {/* Throttle warning */}
  {messagesUsed > 80 && (
    <div className="absolute -top-8 left-0 right-0">
      <Alert className="p-2 bg-yellow-500/10 border-yellow-500/50">
        <AlertDescription className="text-xs">
          Slow down! {100 - messagesUsed} messages left
        </AlertDescription>
      </Alert>
    </div>
  )}
</div>

{/* Send button with cooldown */}
<Button
  onClick={sendMessage}
  disabled={isThrottled || !message.trim()}
  className="relative"
>
  {isThrottled ? (
    <div className="absolute inset-0 flex items-center justify-center">
      <span className="text-xs">{cooldownSeconds}</span>
    </div>
  ) : (
    <Send className="h-4 w-4" />
  )}
</Button>
```

### Desktop Throttle Dashboard
```tsx
// Detailed rate limit panel
<Card className="w-72">
  <CardHeader className="pb-3">
    <CardTitle className="text-sm">Message Rate</CardTitle>
  </CardHeader>
  <CardContent className="space-y-4">
    {/* Visual gauge */}
    <div className="relative h-32">
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart
          cx="50%"
          cy="50%"
          innerRadius="60%"
          outerRadius="90%"
          data={[{ value: messagesUsed, fill: getColor(messagesUsed) }]}
        >
          <RadialBar dataKey="value" cornerRadius={10} />
        </RadialBarChart>
      </ResponsiveContainer>

      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold">{messagesUsed}</span>
        <span className="text-xs text-muted-foreground">/100 per min</span>
      </div>
    </div>

    {/* Reset timer */}
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">Resets in</span>
        <span className="font-mono">{formatTime(resetTime)}</span>
      </div>
      <Progress value={(60 - resetTime) / 60 * 100} className="h-1" />
    </div>

    {/* Rate history */}
    <div className="space-y-1">
      <p className="text-xs font-medium">Last minute</p>
      <div className="h-8">
        <Sparkline
          data={messageHistory}
          color={messagesUsed > 80 ? "red" : "green"}
        />
      </div>
    </div>
  </CardContent>
</Card>
```

---

## 9. Virtual Scrolling for Large Stream Lists

### Purpose
Render only visible items for optimal performance with thousands of streams.

### Visual Implementation

#### Mobile Virtual List (375px)
```tsx
// Virtual scroll container
<div
  ref={containerRef}
  className="h-[calc(100vh-120px)] overflow-y-auto"
  onScroll={handleScroll}
>
  {/* Total height spacer */}
  <div style={{ height: totalHeight }}>
    {/* Visible window */}
    <div
      style={{
        transform: `translateY(${offsetY}px)`,
        position: 'relative'
      }}
    >
      {visibleItems.map((stream, index) => (
        <div
          key={stream.id}
          className="mb-4"
          style={{ height: itemHeight }}
        >
          <LiveStreamCard stream={stream} />
        </div>
      ))}
    </div>
  </div>

  {/* Scroll position indicator */}
  <div className="fixed right-2 top-1/2 -translate-y-1/2">
    <div className="
      bg-background/80 backdrop-blur-sm
      rounded-full px-2 py-1
      text-xs
    ">
      {startIndex + 1}-{endIndex} of {totalItems}
    </div>
  </div>
</div>
```

#### Desktop Grid Virtual Scroll
```tsx
// Virtualized grid layout
<div className="relative h-[calc(100vh-200px)] overflow-y-auto">
  <div style={{ height: totalHeight }}>
    <div
      className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
      style={{
        transform: `translateY(${offsetY}px)`,
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0
      }}
    >
      {visibleItems.map((stream) => (
        <motion.div
          key={stream.id}
          layout
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.2 }}
        >
          <LiveStreamCard stream={stream} />
        </motion.div>
      ))}
    </div>
  </div>

  {/* Loading indicator for scroll */}
  {isLoadingMore && (
    <div className="
      absolute bottom-4 left-1/2 -translate-x-1/2
      bg-background/90 backdrop-blur-sm
      rounded-full px-4 py-2
      flex items-center gap-2
    ">
      <Loader2 className="h-3 w-3 animate-spin" />
      <span className="text-sm">Loading more streams...</span>
    </div>
  )}
</div>
```

### Performance Indicators
```tsx
// Show rendering performance
{process.env.NODE_ENV === 'development' && (
  <div className="fixed bottom-4 left-4 bg-black/80 text-white p-2 rounded text-xs">
    <div>Visible: {visibleItems.length}/{totalItems}</div>
    <div>FPS: {currentFPS}</div>
    <div>Render: {renderTime}ms</div>
  </div>
)}
```

---

## 10. Lazy Loading for Off-Screen Cards

### Purpose
Load content only when visible to improve initial load time.

### Loading States

#### Placeholder Card (Mobile)
```tsx
// Skeleton loader for lazy cards
<Card className="animate-pulse">
  <div className="aspect-video bg-muted" />
  <div className="p-4 space-y-3">
    <div className="h-4 bg-muted rounded w-3/4" />
    <div className="flex items-center gap-2">
      <div className="h-8 w-8 bg-muted rounded-full" />
      <div className="h-3 bg-muted rounded w-1/2" />
    </div>
  </div>
</Card>
```

#### Progressive Image Loading
```tsx
// Image with blur-up effect
<div className="relative aspect-video">
  {/* Low quality placeholder */}
  {!imageLoaded && (
    <img
      src={stream.thumbnailLowRes}
      alt=""
      className="absolute inset-0 w-full h-full object-cover filter blur-md"
    />
  )}

  {/* High quality image */}
  <img
    ref={imgRef}
    src={isVisible ? stream.thumbnailHighRes : undefined}
    alt={stream.title}
    onLoad={() => setImageLoaded(true)}
    className={cn(
      "absolute inset-0 w-full h-full object-cover",
      "transition-opacity duration-300",
      imageLoaded ? "opacity-100" : "opacity-0"
    )}
    loading="lazy"
  />

  {/* Loading spinner */}
  {isVisible && !imageLoaded && (
    <div className="absolute inset-0 flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  )}
</div>
```

### Intersection Observer Setup
```tsx
// Lazy loading with margin
const observerOptions = {
  root: null,
  rootMargin: '100px', // Start loading 100px before visible
  threshold: 0.01
};

// Visual feedback for loading state
<div className="space-y-4">
  {streams.map((stream, index) => (
    <LazyStreamCard
      key={stream.id}
      stream={stream}
      onVisible={() => {
        // Track visibility
        analytics.track('stream_card_visible', {
          streamId: stream.id,
          position: index
        });
      }}
    />
  ))}
</div>
```

---

## 11. Connection Status Indicator

### Purpose
Provide clear, persistent feedback about connection quality.

### Visual States

#### Mobile Status Bar (375px)
```tsx
// Minimal connection indicator
<div className="fixed top-0 left-0 right-0 z-[60]">
  {/* Color-coded status bar */}
  <div className={cn(
    "h-1 transition-all duration-300",
    connectionQuality === 'excellent' && "bg-green-500",
    connectionQuality === 'good' && "bg-blue-500",
    connectionQuality === 'fair' && "bg-yellow-500",
    connectionQuality === 'poor' && "bg-red-500",
    !isConnected && "bg-gray-500 animate-pulse"
  )} />

  {/* Expanded details on tap */}
  {showDetails && (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      className="bg-background/95 backdrop-blur-sm border-b"
    >
      <div className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Connection Status</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowDetails(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <span className="text-muted-foreground">Status:</span>
            <span className="ml-1 font-medium">{connectionStatus}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Quality:</span>
            <span className="ml-1 font-medium">{connectionQuality}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Latency:</span>
            <span className="ml-1 font-medium">{latency}ms</span>
          </div>
          <div>
            <span className="text-muted-foreground">Uptime:</span>
            <span className="ml-1 font-medium">{uptime}</span>
          </div>
        </div>

        {!isConnected && (
          <Button
            size="sm"
            variant="outline"
            onClick={reconnect}
            className="w-full"
          >
            <RefreshCw className="h-3 w-3 mr-1" />
            Reconnect
          </Button>
        )}
      </div>
    </motion.div>
  )}
</div>
```

#### Desktop Persistent Widget
```tsx
// Floating connection widget
<motion.div
  initial={{ x: 100, opacity: 0 }}
  animate={{ x: 0, opacity: 1 }}
  className="fixed bottom-8 right-8 z-50"
  drag
  dragConstraints={{
    top: -400,
    left: -800,
    right: 0,
    bottom: 0,
  }}
>
  <Card className="w-64 shadow-lg">
    <CardHeader className="pb-3">
      <CardTitle className="text-sm flex items-center justify-between">
        <span>Connection</span>
        <div className={cn(
          "w-2 h-2 rounded-full",
          isConnected ? "bg-green-500" : "bg-red-500 animate-pulse"
        )} />
      </CardTitle>
    </CardHeader>

    <CardContent className="space-y-3">
      {/* Quality gauge */}
      <div className="space-y-1">
        <div className="flex justify-between text-xs">
          <span>Quality</span>
          <span className="font-medium">{connectionQuality}</span>
        </div>
        <div className="flex gap-1">
          {['poor', 'fair', 'good', 'excellent'].map((level) => (
            <div
              key={level}
              className={cn(
                "flex-1 h-2 rounded-full transition-all",
                connectionQuality >= level
                  ? "bg-primary"
                  : "bg-muted"
              )}
            />
          ))}
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <span className="text-muted-foreground">Latency</span>
          <p className="font-mono">{latency}ms</p>
        </div>
        <div>
          <span className="text-muted-foreground">Messages</span>
          <p className="font-mono">{messageCount}</p>
        </div>
        <div>
          <span className="text-muted-foreground">Uptime</span>
          <p className="font-mono">{uptime}</p>
        </div>
        <div>
          <span className="text-muted-foreground">Errors</span>
          <p className="font-mono">{errorCount}</p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={testConnection}
          className="flex-1"
        >
          Test
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={reconnect}
          className="flex-1"
        >
          Reconnect
        </Button>
      </div>
    </CardContent>
  </Card>
</motion.div>
```

---

## 12. WebSocket Reconnection Testing Criteria

### Purpose
Define clear testing criteria for reconnection scenarios.

### Visual Testing Interface

#### Testing Dashboard (Development Only)
```tsx
// WebSocket testing panel
<Card className="fixed bottom-4 left-4 w-80 z-[100]">
  <CardHeader>
    <CardTitle className="text-sm">WebSocket Testing</CardTitle>
  </CardHeader>

  <CardContent className="space-y-4">
    {/* Connection controls */}
    <div className="space-y-2">
      <p className="text-xs font-medium">Connection Controls</p>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="destructive"
          onClick={disconnect}
        >
          Disconnect
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={simulateError}
        >
          Simulate Error
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={simulateLatency}
        >
          Add Latency
        </Button>
      </div>
    </div>

    {/* Test scenarios */}
    <div className="space-y-2">
      <p className="text-xs font-medium">Test Scenarios</p>
      <div className="space-y-1">
        {testScenarios.map(scenario => (
          <div
            key={scenario.id}
            className="flex items-center justify-between p-2 rounded bg-muted"
          >
            <span className="text-xs">{scenario.name}</span>
            <div className="flex items-center gap-2">
              {scenario.status === 'running' && (
                <Loader2 className="h-3 w-3 animate-spin" />
              )}
              {scenario.status === 'passed' && (
                <CheckCircle className="h-3 w-3 text-green-500" />
              )}
              {scenario.status === 'failed' && (
                <XCircle className="h-3 w-3 text-red-500" />
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => runTest(scenario.id)}
              >
                Run
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>

    {/* Event log */}
    <div className="space-y-2">
      <p className="text-xs font-medium">Event Log</p>
      <ScrollArea className="h-32 rounded bg-muted p-2">
        <div className="space-y-1 font-mono text-[10px]">
          {eventLog.map((event, i) => (
            <div key={i} className="text-muted-foreground">
              <span className="text-primary">{event.time}</span>
              {' '}
              <span>{event.type}</span>
              {' '}
              <span className="text-foreground">{event.message}</span>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>

    {/* Metrics */}
    <div className="grid grid-cols-3 gap-2 text-xs">
      <div className="text-center">
        <p className="text-muted-foreground">Reconnects</p>
        <p className="font-bold">{reconnectCount}</p>
      </div>
      <div className="text-center">
        <p className="text-muted-foreground">Avg Time</p>
        <p className="font-bold">{avgReconnectTime}ms</p>
      </div>
      <div className="text-center">
        <p className="text-muted-foreground">Success</p>
        <p className="font-bold">{successRate}%</p>
      </div>
    </div>
  </CardContent>
</Card>
```

### Test Scenarios

```typescript
const testScenarios = [
  {
    id: 'immediate-disconnect',
    name: 'Immediate Disconnect',
    description: 'Test reconnect after clean disconnect',
    steps: [
      'Disconnect WebSocket',
      'Wait 100ms',
      'Verify reconnection starts',
      'Verify connection restored'
    ]
  },
  {
    id: 'network-failure',
    name: 'Network Failure',
    description: 'Simulate network interruption',
    steps: [
      'Block network',
      'Wait for timeout',
      'Restore network',
      'Verify automatic reconnect'
    ]
  },
  {
    id: 'server-restart',
    name: 'Server Restart',
    description: 'Handle server going down and up',
    steps: [
      'Server sends close event',
      'Client enters reconnect loop',
      'Server comes back online',
      'Client reconnects successfully'
    ]
  },
  {
    id: 'auth-expiry',
    name: 'Auth Token Expiry',
    description: 'Handle authentication refresh',
    steps: [
      'Token expires',
      'Connection rejected',
      'Refresh token',
      'Reconnect with new token'
    ]
  },
  {
    id: 'rate-limit',
    name: 'Rate Limiting',
    description: 'Handle rate limit errors',
    steps: [
      'Exceed rate limit',
      'Receive 429 error',
      'Back off exponentially',
      'Resume normal operation'
    ]
  }
];
```

---

## Performance Guidelines

### Animation Performance
- All animations must run at 60fps minimum
- Use `transform` and `opacity` for animations (GPU accelerated)
- Avoid animating `width`, `height`, `padding`, `margin`
- Use `will-change` sparingly for critical animations
- Implement frame budget monitoring in development

### Memory Management
- Limit WebSocket message queue to 1000 items
- Clear old messages after 60 seconds
- Implement virtual scrolling for lists > 50 items
- Lazy load images with Intersection Observer
- Dispose of event listeners on unmount

### Network Optimization
- Throttle updates to max 10/second for UI
- Batch WebSocket messages when possible
- Implement exponential backoff for reconnections
- Cache static data with 5-minute TTL
- Use compression for WebSocket messages

### Accessibility Performance
- Debounce screen reader announcements (500ms)
- Group related updates into single announcements
- Provide text alternatives for all animations
- Ensure focus management doesn't cause reflows
- Test with screen readers at different speeds

---

## Testing Checklist

### Functional Testing
- [ ] WebSocket connects within 500ms
- [ ] Reconnection works after network loss
- [ ] Viewer count updates within 100ms
- [ ] Status changes trigger notifications
- [ ] Presence tracking shows correct users
- [ ] Rate limiting prevents spam
- [ ] Virtual scrolling handles 10,000 items
- [ ] Lazy loading triggers at correct threshold

### Performance Testing
- [ ] Initial load < 2.5s (LCP)
- [ ] Interaction response < 100ms (FID)
- [ ] Layout shift < 0.1 (CLS)
- [ ] Animations run at 60fps
- [ ] Memory usage < 50MB increase
- [ ] CPU usage < 5% idle

### Accessibility Testing
- [ ] All updates announced to screen readers
- [ ] Keyboard navigation works for all features
- [ ] Focus indicators visible
- [ ] Color contrast meets WCAG AA
- [ ] Error messages are descriptive
- [ ] Connection status is perceivable

### Network Testing
- [ ] Works on 3G connection
- [ ] Handles intermittent connectivity
- [ ] Graceful degradation when offline
- [ ] Message queue doesn't overflow
- [ ] Reconnection uses exponential backoff

---

## Conclusion

These UX specifications ensure that Phase 3's real-time features provide a smooth, responsive, and accessible experience across all devices. The focus on connection feedback, smooth animations, and graceful degradation creates a robust system that handles real-world network conditions while maintaining excellent user experience.

Key principles maintained throughout:
1. **Mobile-first responsive design** - All features designed for 375px first
2. **Progressive enhancement** - Features gracefully degrade
3. **Accessibility first** - WCAG AA compliance for all components
4. **Performance focused** - 60fps animations, minimal latency
5. **Clear feedback** - Users always know system state
6. **Bilingual ready** - RTL support considered throughout