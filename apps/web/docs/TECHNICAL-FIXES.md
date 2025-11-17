# Technical Fixes & Bug Reports

This document consolidates all technical fixes, bug reports, and implementation details for the Al Ummah Now web application.

---

## Table of Contents
1. [Authentication Fix for Analytics](#authentication-fix-for-analytics)
2. [Memory Leak Fix - Video Performance Monitor](#memory-leak-fix---video-performance-monitor)
3. [Infinite Loop Fix - WebSocket Subscriptions](#infinite-loop-fix---websocket-subscriptions)
4. [Focus Trap Implementation](#focus-trap-implementation)
5. [Video Player Quality Selector Fix](#video-player-quality-selector-fix)

---

## Authentication Fix for Analytics

**Date**: 2025-10
**Issue**: Analytics endpoints were missing JWT authentication headers

### Changes Made

#### 1. New Utility: `src/lib/auth/client-token.ts`
- `getClientAuthToken()`: Extracts JWT from cookies (client-side only)
- `getAuthHeaders()`: Returns Authorization header with Bearer token
- Client-side only with graceful server-side handling
- URI decoding support

#### 2. Updated Services
- **`video-performance.ts`**: Added auth headers to performance metrics
- **`analytics.ts`**: Added auth to A/B test events, results, and statistics

#### 3. Test Coverage
Created `client-token.test.ts` with 9 comprehensive test cases (all passing)

### Benefits
- Proper user attribution for analytics
- Backward compatible
- Graceful degradation for unauthenticated users

---

## Memory Leak Fix - Video Performance Monitor

**Date**: 2025-10
**Issue**: `watchStartTimes` Map grew unbounded during video playback

### Root Causes
1. No size limits on the Map
2. No cleanup mechanism for stale entries
3. Used `Date.now()` as keys (unnecessary complexity)
4. Map not cleared on destroy

### Solution

#### Simplified Single-Session Tracking
```typescript
private currentWatchStartTime: number = 0;  // Primary tracking
private watchStartTimes: Map<number, number> = new Map();  // Legacy support
private readonly MAX_WATCH_ENTRIES = 10;
private readonly STALE_ENTRY_TIMEOUT = 3600000; // 1 hour
```

#### New Methods
- `startPeriodicCleanup()`: Cleanup timer (every 5 minutes)
- `cleanupStaleEntries()`: Removes old entries, enforces size limits

#### Modified Methods
- `handlePlay()`: Simplified tracking + enforces Map limit
- `destroy()`: Properly clears Map and timers

### Testing
Comprehensive test suite in `video-performance.memory-leak.test.ts`
- ✅ Map size limits enforced
- ✅ Stale entries removed
- ✅ Memory usage bounded

---

## Infinite Loop Fix - WebSocket Subscriptions

**Date**: 2025-10-22
**Error**: `Maximum update depth exceeded` on video pages

### Root Cause
Circular dependency in WebSocket subscription system:

```
handleNotificationUpdate with removeNotification dep
→ useWebSocketSubscription sees new callback
→ Re-subscribes to WebSocket
→ State update
→ removeNotification reference changes
→ INFINITE LOOP
```

### The Fix

#### 1. Fixed `useRealTimeNotifications.ts`
**Before**:
```typescript
const handleNotificationUpdate = useCallback((eventData: NotificationEvent) => {
  // uses removeNotification, maxNotifications, autoRemoveAfter
}, [maxNotifications, autoRemoveAfter, removeNotification]); // ❌ Causes re-creation
```

**After**:
```typescript
// Store in refs
const removeNotificationRef = useRef(removeNotification);
const maxNotificationsRef = useRef(maxNotifications);
const autoRemoveAfterRef = useRef(autoRemoveAfter);

useEffect(() => {
  removeNotificationRef.current = removeNotification;
  maxNotificationsRef.current = maxNotifications;
  autoRemoveAfterRef.current = autoRemoveAfter;
}, [removeNotification, maxNotifications, autoRemoveAfter]);

const handleNotificationUpdate = useCallback((eventData: NotificationEvent) => {
  // uses refs instead
}, []); // ✅ Stable, never recreated
```

#### 2. Fixed `useWebSocketSubscription` in `WebSocketProvider.tsx`
**Before**:
```typescript
useEffect(() => {
  if (!channel) return;
  const unsubscribe = subscribe(channel, callback);
  return () => { if (unsubscribe) unsubscribe(); };
}, [channel, subscribe, ...deps]); // ❌ Re-subscribes on callback change
```

**After**:
```typescript
const callbackRef = useRef(callback);
useEffect(() => { callbackRef.current = callback; }, [callback]);

useEffect(() => {
  if (!channel) return;
  const unsubscribe = subscribe(channel, (data: any) => {
    callbackRef.current(data); // ✅ Stable wrapper
  });
  return () => { if (unsubscribe) unsubscribe(); };
}, [channel, subscribe, ...deps]); // Only re-subscribe on these
```

### Prevention Guidelines

#### Use Refs for Callbacks in useEffect
```typescript
// ❌ BAD
const callback = useCallback(() => { /* uses state */ }, [state]);
useEffect(() => subscribe(callback), [callback]);

// ✅ GOOD
const callbackRef = useRef(callback);
useEffect(() => { callbackRef.current = callback; }, [callback]);
useEffect(() => subscribe(() => callbackRef.current()), [subscribe]);
```

#### Be Careful with Spread in Dependencies
```typescript
// ❌ BAD - deps might include callbacks
useEffect(() => doSomething(), [channel, subscribe, ...deps]);

// ✅ GOOD - Explicit stable deps
useEffect(() => doSomething(), [channel, subscribe]);
```

---

## Focus Trap Implementation

**Feature**: Accessible modal dialogs with keyboard focus management

### Implementation
Focus trap for modal dialogs to meet WCAG accessibility standards

### Key Features
- Traps Tab/Shift+Tab within modal
- Returns focus to trigger element on close
- Escape key to close
- ARIA attributes for screen readers

### Files
- Implementation in modal components
- Test coverage for keyboard navigation

---

## Video Player Quality Selector Fix

**Issue**: Quality selector not functioning correctly

### Changes
- Fixed quality level detection
- Improved UI/UX for quality selection
- Added proper state management

### Testing
- Manual testing on multiple video formats
- Verified across different quality levels
- Browser compatibility testing

---

## Related Documentation

- [ADR-001: Multi-Account Multi-Channel](./ADR-001-multi-account-multi-channel.md)
- [Cookie Size Monitoring](./COOKIE-SIZE-MONITORING.md)
- [Migration Guide: Multi-Account](./MIGRATION-GUIDE-multi-account.md)
- [Video Accessibility](./VIDEO_ACCESSIBILITY.md)

---

## Contributing

When adding new technical fixes to this document:

1. **Use clear section headers** with the fix name
2. **Include date** when the fix was implemented
3. **Describe the problem** clearly
4. **Explain root causes** with code examples
5. **Document the solution** with before/after code
6. **Add test coverage** information
7. **Link to related issues** if applicable

### Template

```markdown
## Fix Name

**Date**: YYYY-MM-DD
**Issue**: Brief description

### Root Cause
Explanation of why it happened

### Solution
How it was fixed

### Testing
How to verify the fix

### Prevention
Guidelines to avoid similar issues
```
