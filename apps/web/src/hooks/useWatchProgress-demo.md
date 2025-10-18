# Watch Progress Hook - Mutex Implementation

## Problem Solved

The watch progress hook previously had a race condition where multiple save operations could overlap, causing:
1. **Race conditions**: Save calls completing out of order
2. **Duplicate API calls**: Multiple simultaneous API requests
3. **Incorrect progress values**: Earlier saves overwriting later ones

## Solution: Mutex Pattern

We implemented a mutex (mutual exclusion) pattern that ensures:
- Only **ONE** save operation runs at a time
- Pending saves are **queued** while a save is in progress
- The **latest** progress value is always saved
- No race conditions or duplicate API calls

## How It Works

### 1. Mutex Lock
```typescript
// Check if save is already in progress
if (saveMutexRef.current) {
  // Queue this save for later
  pendingSaveRef.current = { progress, force };
  return;
}

// Acquire mutex (lock)
saveMutexRef.current = true;
```

### 2. Process Save
```typescript
try {
  // Process the current save
  await processSave(progress);

  // Process any pending saves that accumulated
  while (pendingSaveRef.current) {
    const pending = pendingSaveRef.current;
    pendingSaveRef.current = null;
    await processSave(pending.progress);
  }
} finally {
  // Always release mutex
  saveMutexRef.current = false;
}
```

## Test Results

✅ **Prevents concurrent saves**: Multiple rapid calls result in 1-2 API calls, not 10+
✅ **Queues pending saves**: Latest position is always saved
✅ **Handles API failures**: Falls back to localStorage
✅ **Component unmount safety**: Stops processing if unmounted
✅ **Event-based saves work**: pause/seek/ended events don't cause race conditions

## Example Scenario

**Before (Race Condition):**
```
User seeks to 30s → API call 1 starts
User seeks to 60s → API call 2 starts (concurrent!)
User seeks to 90s → API call 3 starts (concurrent!)

Results:
- 3 simultaneous API calls
- Call 2 might finish after Call 3
- Final saved position could be 60s instead of 90s ❌
```

**After (With Mutex):**
```
User seeks to 30s → API call 1 starts, mutex locked
User seeks to 60s → Queued (mutex busy)
User seeks to 90s → Replaces queued 60s

Results:
- Only 2 API calls (30s, then 90s)
- Final saved position is always 90s ✅
- No race conditions
```

## Performance Impact

- **Reduced API calls**: Fewer simultaneous requests
- **Better consistency**: Always saves the latest state
- **No blocking**: Async operations continue normally
- **Memory efficient**: Only stores one pending save at a time

## Usage

The hook automatically handles all mutex logic internally:

```typescript
const { savedProgress, saveProgress, clearProgress } = useWatchProgress(
  videoId,
  player,
  userId,
  authToken
);

// Just call saveProgress() - mutex handles the rest
saveProgress(); // Safe to call multiple times rapidly
```

## Key Benefits

1. **Reliability**: No more race conditions or out-of-order saves
2. **Efficiency**: Reduces unnecessary API calls
3. **Accuracy**: Always saves the most recent progress
4. **Fallback**: Gracefully handles API failures with localStorage
5. **Transparent**: Works seamlessly without changing the API