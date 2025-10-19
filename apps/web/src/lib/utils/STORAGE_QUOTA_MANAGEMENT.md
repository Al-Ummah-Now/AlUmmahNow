# localStorage Quota Management System

## Overview

This document describes the localStorage quota management system implemented to prevent `QuotaExceededError` and ensure reliable data persistence in the Al Ummah Now web application.

## Problem Statement

Previously, the application had no localStorage quota management, which could lead to:
1. **QuotaExceededError** crashes when storage limit exceeded (typically 5-10MB)
2. **Unbounded data accumulation** with no cleanup of stale data
3. **Silent failures** when trying to save user preferences or watch history

## Solution Architecture

### 1. StorageManager Utility (`/apps/web/src/lib/utils/storage.ts`)

A comprehensive storage management utility that provides:

#### Core Features:
- **Quota Monitoring**: Tracks storage usage and warns at 80% capacity
- **Safe Storage Operations**: Prevents QuotaExceededError with pre-checks
- **Automatic Cleanup**: Removes old data when approaching quota
- **Emergency Cleanup**: Last-resort cleanup when quota exceeded
- **Storage Statistics**: Detailed breakdown of storage usage

#### Key Methods:

```typescript
// Check current storage size
StorageManager.getStorageSize(): number

// Check if data can be stored without exceeding quota
StorageManager.canStore(key: string, value: string): boolean

// Safe storage with automatic cleanup
StorageManager.safeSetItem(key: string, value: string): boolean

// Manual cleanup of old data
StorageManager.cleanupOldData(keys: string[], maxAge?: number): number

// Get detailed storage statistics
StorageManager.getStorageStats(): StorageStats
```

### 2. Integration with Services

#### Watch History Service (`watch-history.ts`)
- Uses `StorageManager.safeSetItem()` for all localStorage writes
- Automatically reduces stored entries if quota exceeded
- Keeps only 10 most recent watch progress entries when space is limited

#### Engagement Service (`engagement.service.ts`)
- Uses `StorageManager.safeSetItem()` for view tracking
- Automatically cleans up views older than 24 hours if quota exceeded
- Maintains session-based view tracking with automatic cleanup

### 3. Storage Monitor Component (`storage-monitor.tsx`)

A React component for monitoring and managing storage health:

#### Features:
- **Real-time Usage Display**: Visual progress bar showing storage usage
- **Item Breakdown**: List of all localStorage items with sizes
- **Manual Cleanup Tools**:
  - Clean old data (30 days)
  - Aggressive clean (7 days)
  - Clear all (with double confirmation)
- **Health Indicator**: Optional floating indicator for high usage

## Configuration

### Storage Limits
```typescript
// Maximum safe storage size (4MB - conservative limit)
MAX_SIZE_BYTES = 4 * 1024 * 1024

// Warning threshold (80% of max)
WARNING_THRESHOLD = 0.8

// Default data retention (30 days)
DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
```

### Cleanup Priorities

When quota is exceeded, cleanup happens in this order:

1. **Watch Progress**: Keeps only 10 most recent videos
2. **View Tracking**: Keeps only last 24 hours of views
3. **Non-Essential Data**: Removes debug, temp, and cache keys

## Usage Examples

### Basic Usage
```typescript
import { StorageManager } from '@/lib/utils/storage';

// Safe storage operation
const data = JSON.stringify({ videoId: '123', progress: 50 });
const success = StorageManager.safeSetItem('watchProgress', data);

if (!success) {
  console.warn('Storage quota exceeded, data not saved');
}
```

### Monitor Storage Health
```typescript
import { StorageHealthIndicator } from '@/components/admin/storage-monitor';

// Add to admin dashboard or settings page
function AdminDashboard() {
  return (
    <>
      <StorageHealthIndicator />
      {/* Other components */}
    </>
  );
}
```

### Manual Cleanup
```typescript
// Clean up data older than 7 days
const itemsRemoved = StorageManager.cleanupOldData(
  ['watchProgress', 'video_views_tracked'],
  7 * 24 * 60 * 60 * 1000
);

console.log(`Cleaned up ${itemsRemoved} old items`);
```

## Error Handling

The system handles various error scenarios:

1. **QuotaExceededError**: Caught and triggers automatic cleanup
2. **Invalid Data**: Malformed JSON is safely handled
3. **Missing localStorage**: Server-side rendering safe
4. **Browser Compatibility**: Handles different error codes across browsers

## Testing

Comprehensive test suite covers:
- Size calculation accuracy
- Quota detection
- Cleanup algorithms
- Emergency cleanup scenarios
- Integration with services

Run tests:
```bash
npm test src/lib/utils/__tests__/storage.test.ts
```

## Monitoring

### Development Mode
```typescript
import { monitorStorage } from '@/lib/utils/storage';

// Log storage statistics to console
monitorStorage();
```

Output:
```
[StorageManager] Storage Statistics
Total Used: 245.67 KB / 4.00 MB
Usage: 6.0%
Warning Level: No

Top 5 Storage Items:
  watchProgress: 123.45 KB
  video_views_tracked: 45.67 KB
  user_preferences: 12.34 KB
```

## Performance Impact

- **Minimal overhead**: Size checks only when writing data
- **Efficient cleanup**: Targets old data first
- **Smart retries**: Attempts storage with reduced data if initial attempt fails
- **No blocking operations**: All operations are synchronous and fast

## Browser Compatibility

Tested and working on:
- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## Security Considerations

1. **No sensitive data**: Never store passwords, tokens, or PII in localStorage
2. **Input validation**: All data is validated before storage (separate from quota management)
3. **XSS protection**: Data is properly escaped when displayed in monitor component

## Future Enhancements

Potential improvements for future versions:
1. **IndexedDB fallback**: Use IndexedDB for larger data sets
2. **Compression**: Compress data before storage to maximize capacity
3. **Cloud sync**: Sync critical data to server when quota is tight
4. **Smart prioritization**: Keep most frequently accessed data
5. **Analytics**: Track storage patterns to optimize cleanup algorithms

## Troubleshooting

### Common Issues

1. **"localStorage quota exceeded" errors**
   - Run `StorageManager.cleanupOldData()` to free space
   - Check storage usage with `StorageManager.getStorageStats()`

2. **Data not persisting**
   - Verify `safeSetItem()` returns `true`
   - Check browser console for quota warnings

3. **Unexpected data loss**
   - Review cleanup configuration (default is 30 days)
   - Check if emergency cleanup was triggered

### Debug Commands

```javascript
// In browser console

// Check current usage
StorageManager.getStorageStats()

// Force cleanup
StorageManager.cleanupOldData(['watchProgress', 'video_views_tracked'])

// Clear everything (careful!)
StorageManager.clearAll()
```

## Conclusion

The localStorage quota management system ensures reliable data persistence while preventing storage-related crashes. It provides automatic cleanup, emergency recovery, and comprehensive monitoring tools to maintain optimal storage health.