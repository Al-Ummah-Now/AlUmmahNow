# Video Performance Monitor Memory Leak Fix

## Issue Description
The `VideoPerformanceMonitor` class had a memory leak where the `watchStartTimes` Map would grow indefinitely during video playback sessions. Each `play` event added a new entry, but entries were only removed on `pause` or `end` events, leading to unbounded memory growth in long-running sessions.

## Root Causes
1. **Unbounded Map Growth**: No size limits on the `watchStartTimes` Map
2. **No Cleanup Mechanism**: No periodic cleanup of stale entries
3. **Incorrect Key Usage**: Used `Date.now()` as Map keys for tracking multiple concurrent sessions (unnecessary complexity)
4. **Memory Not Freed on Destroy**: The Map wasn't cleared when the monitor was destroyed

## Solution Implemented

### 1. Simplified Single-Session Tracking
- Added `currentWatchStartTime` property for tracking a single watch session
- Most video players only have one active playback session at a time
- Reduces complexity and memory overhead

### 2. Map Size Limits
- Added `MAX_WATCH_ENTRIES = 10` constant to limit Map size
- Automatically removes oldest entries when limit is exceeded
- Prevents unbounded growth even with the legacy Map approach

### 3. Periodic Cleanup
- Added `cleanupStaleEntries()` method that runs every 5 minutes
- Removes entries older than 1 hour (`STALE_ENTRY_TIMEOUT`)
- Ensures Map stays within size limits

### 4. Proper Cleanup on Destroy
- Clear the Map completely on `destroy()`
- Clear both `sendTimer` and `cleanupTimer`
- Update final watch time before cleanup

## Code Changes

### Modified Files
- `/home/meywd/AlUmmahNow/apps/web/src/services/monitoring/video-performance.ts`

### Key Changes
```typescript
// Before: Unbounded Map
private watchStartTimes: Map<number, number> = new Map();

// After: Bounded Map with cleanup
private currentWatchStartTime: number = 0;  // Primary tracking
private watchStartTimes: Map<number, number> = new Map();  // Legacy support
private readonly MAX_WATCH_ENTRIES = 10;
private readonly STALE_ENTRY_TIMEOUT = 3600000; // 1 hour
private cleanupTimer: NodeJS.Timeout | null = null;
```

### New Methods Added
- `startPeriodicCleanup()`: Initializes cleanup timer
- `cleanupStaleEntries()`: Removes old entries and enforces size limits

### Modified Methods
- `handlePlay()`: Now uses simplified tracking + enforces Map size limit
- `handlePause()`: Updates watch time from both tracking methods
- `handleEnded()`: Updates watch time from both tracking methods
- `updateWatchTime()`: Skips stale entries during processing
- `destroy()`: Properly clears Map and all timers

## Testing
Created comprehensive test suite in:
`/home/meywd/AlUmmahNow/apps/web/src/services/monitoring/__tests__/video-performance.memory-leak.test.ts`

### Test Coverage
✅ Map size stays within MAX_WATCH_ENTRIES limit
✅ Stale entries are removed during cleanup
✅ Cleanup timer is properly set and cleared
✅ Simplified tracking works alongside Map
✅ Destroy method clears Map and timers
✅ Memory usage remains bounded under continuous operation

## Performance Impact
- **Memory Usage**: Reduced from unbounded to maximum 10 entries + single timestamp
- **Cleanup Overhead**: Minimal (runs every 5 minutes, O(n) where n ≤ 10)
- **Accuracy**: Maintained - all watch time is still accurately tracked

## Backwards Compatibility
- Kept the `watchStartTimes` Map for potential backwards compatibility
- Both tracking methods work in parallel
- No changes to public API or metrics format

## Recommendations
1. Monitor memory usage in production after deployment
2. Consider removing the Map entirely in a future update if single-session tracking proves sufficient
3. Add metrics to track how often the Map size limit is hit
4. Consider making cleanup intervals configurable

## Deployment Notes
- No configuration changes required
- No database migrations needed
- Compatible with existing analytics endpoints
- Test in staging environment first to verify memory improvements