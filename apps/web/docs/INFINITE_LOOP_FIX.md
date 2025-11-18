# Fix: Maximum Update Depth Exceeded (Infinite Loop)

## Problem Summary

**Error**: `Maximum update depth exceeded` React error occurring on video page
**Location**: http://localhost:3000/en/video?vid=083bc9e9-f2fd-4614-b7c3-5a05b80b487f
**Date Fixed**: 2025-10-22

## Root Cause Analysis

The infinite loop was caused by a circular dependency chain in the WebSocket subscription system:

### Chain of Events

1. **`useRealTimeNotifications.ts` (lines 46-90)**:
   - `handleNotificationUpdate` callback had `removeNotification` in its dependency array
   - This meant the callback was recreated every time `removeNotification` changed

2. **`WebSocketProvider.tsx` (lines 128-148)**:
   - `useWebSocketSubscription` hook spread the `deps` array into the useEffect
   - This caused re-subscription whenever ANY dependency changed, including the callback

3. **The Loop**:
   ```
   handleNotificationUpdate created with removeNotification dep
   → useWebSocketSubscription sees new callback
   → Re-subscribes to WebSocket channel
   → Triggers state update in WebSocketManager
   → Causes re-render
   → removeNotification reference changes (new function instance)
   → handleNotificationUpdate recreated
   → INFINITE LOOP
   ```

### Why Previous Fixes Didn't Work

1. **useCallback with empty deps**: Didn't help because the issue was in the *consumer* of the callback
2. **useMemo on context**: Didn't address the root cause in useWebSocketSubscription
3. **Removing from deps**: Partially worked but violated React hooks rules
4. **onErrorRef pattern**: Good pattern but didn't fix the notification hook

## The Fix

### 1. Fixed `useRealTimeNotifications.ts`

**Before** (lines 46-90):
```typescript
const handleNotificationUpdate = useCallback((eventData: NotificationEvent) => {
  // ... code using removeNotification, maxNotifications, autoRemoveAfter
}, [maxNotifications, autoRemoveAfter, removeNotification]); // ❌ Causes re-creation
```

**After**:
```typescript
// Store callbacks and values in refs
const removeNotificationRef = useRef(removeNotification);
const maxNotificationsRef = useRef(maxNotifications);
const autoRemoveAfterRef = useRef(autoRemoveAfter);

useEffect(() => {
  removeNotificationRef.current = removeNotification;
  maxNotificationsRef.current = maxNotifications;
  autoRemoveAfterRef.current = autoRemoveAfter;
}, [removeNotification, maxNotifications, autoRemoveAfter]);

const handleNotificationUpdate = useCallback((eventData: NotificationEvent) => {
  // ... code using refs instead of direct values
  // removeNotificationRef.current, maxNotificationsRef.current, etc.
}, []); // ✅ Stable, never recreated
```

**Why This Works**:
- Refs provide stable references that don't change on re-render
- useCallback with empty deps creates a stable function identity
- The ref values are updated separately without affecting the callback identity

### 2. Fixed `useWebSocketSubscription` in `WebSocketProvider.tsx`

**Before** (lines 128-148):
```typescript
export function useWebSocketSubscription(
  channel: string,
  callback: (data: any) => void,
  deps: React.DependencyList = []
): boolean {
  const { subscribe, isConnected } = useWebSocket();

  useEffect(() => {
    if (!channel) return;
    const unsubscribe = subscribe(channel, callback);
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [channel, subscribe, ...deps]); // ❌ Re-subscribes on callback change

  return isConnected;
}
```

**After**:
```typescript
export function useWebSocketSubscription(
  channel: string,
  callback: (data: any) => void,
  deps: React.DependencyList = []
): boolean {
  const { subscribe, isConnected } = useWebSocket();

  // Store callback in ref to prevent re-subscription
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!channel) return;

    // Use stable wrapper that calls current callback from ref
    const unsubscribe = subscribe(channel, (data: any) => {
      callbackRef.current(data);
    });

    return () => {
      if (unsubscribe) unsubscribe();
    };
    // ✅ Only re-subscribe on channel/subscribe/deps change, NOT callback
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, subscribe, ...deps]);

  return isConnected;
}
```

**Why This Works**:
- The subscription wrapper function `(data) => callbackRef.current(data)` is stable
- When the callback prop changes, only the ref is updated (cheap operation)
- No re-subscription happens when callback changes
- Only re-subscribes when channel or external deps change

## Files Changed

1. `/home/meywd/AlUmmahNow/apps/web/src/hooks/useRealTimeNotifications.ts`
   - Added refs for callbacks and values (lines 48-56)
   - Changed handleNotificationUpdate to use refs with empty deps (lines 58-101)
   - Added `useRef` import (line 1)

2. `/home/meywd/AlUmmahNow/apps/web/src/lib/websocket/WebSocketProvider.tsx`
   - Added callbackRef pattern to useWebSocketSubscription (lines 135-140)
   - Changed subscription to use stable wrapper (lines 142-158)
   - Added explanatory comments

3. `/home/meywd/AlUmmahNow/apps/web/src/hooks/__tests__/useWebSocketSubscription.test.tsx`
   - New test file to prevent regression
   - Tests callback stability
   - Tests channel changes
   - Tests notification auto-remove

## Testing

### Manual Testing
1. Navigate to video page: http://localhost:3001/en/video?vid=083bc9e9-f2fd-4614-b7c3-5a05b80b487f
2. Open browser console
3. Watch for "Maximum update depth exceeded" error
4. Expected: No infinite loop, WebSocket connects normally

### Automated Testing
```bash
cd /home/meywd/AlUmmahNow/apps/web
pnpm test useWebSocketSubscription.test.tsx
```

Expected results:
- ✅ "should not re-subscribe when callback changes"
- ✅ "should re-subscribe when channel changes"
- ✅ "should not cause infinite loop when notifications update"
- ✅ "should handle auto-remove without infinite loop"

## Prevention Guidelines

To prevent similar issues in the future:

### 1. Use Refs for Callbacks in useEffect
```typescript
// ❌ BAD - Callback in deps causes re-runs
const callback = useCallback(() => { /* uses state */ }, [state]);
useEffect(() => {
  subscribe(callback);
}, [callback]);

// ✅ GOOD - Use ref pattern
const callbackRef = useRef(callback);
useEffect(() => { callbackRef.current = callback; }, [callback]);
useEffect(() => {
  subscribe(() => callbackRef.current());
}, [subscribe]);
```

### 2. Be Careful with Spread in Dependencies
```typescript
// ❌ BAD - Spreads all deps including callbacks
useEffect(() => {
  doSomething();
}, [channel, subscribe, ...deps]); // deps might include callbacks!

// ✅ GOOD - Only spread when you control what's in deps
useEffect(() => {
  doSomething();
}, [channel, subscribe]); // Explicit, stable deps
```

### 3. Use ESLint Disable Sparingly
```typescript
// Only disable exhaustive-deps when you have a good reason
// and document WHY
// eslint-disable-next-line react-hooks/exhaustive-deps
useEffect(() => {
  // Explanation: We only want to run this when X changes,
  // not when callback Y changes, because...
}, [onlyTheseSpecificDeps]);
```

### 4. Test for Infinite Loops
Always add tests for hooks that:
- Subscribe to external systems (WebSockets, events)
- Accept callbacks as props
- Use complex dependency arrays
- Spread dependency arrays

### 5. Monitor Re-renders in Development
```typescript
useEffect(() => {
  if (process.env.NODE_ENV === 'development') {
    console.log('[ComponentName] Effect ran', { deps });
  }
}, [deps]);
```

## Related Issues

- Similar pattern used in `useVideoWebSocket.ts` (already had onErrorRef pattern)
- All WebSocket hooks should follow this ref pattern
- Consider creating a `useStableCallback` custom hook for reuse

## References

- React Hooks Documentation: https://react.dev/reference/react/useRef
- React Hooks FAQ: https://react.dev/learn/separating-events-from-effects
- Issue thread: [Link to GitHub issue if applicable]
