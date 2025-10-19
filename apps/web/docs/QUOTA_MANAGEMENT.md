# localStorage Quota Management System

## Overview

The localStorage quota management system prevents `QuotaExceededError` crashes in the A/B testing system by implementing intelligent storage strategies, automatic cleanup, and graceful degradation.

## Problem Statement

Browser localStorage has limited capacity (typically 5-10MB):
- **QuotaExceededError**: Thrown when storage limit is exceeded
- **No built-in eviction**: Old data accumulates indefinitely
- **Silent failures**: Apps crash without proper error handling
- **User impact**: Complete loss of A/B test functionality

## Solution Architecture

### Core Components

1. **LocalStorageQuotaManager** (`src/lib/storage/quota-manager.ts`)
   - Centralized quota monitoring and management
   - Safe storage operations with error handling
   - Automatic cleanup and eviction strategies
   - Size estimation and limits

2. **ABTestingEngine Integration** (`src/services/experiments/ab-testing.ts`)
   - Uses quota manager for all localStorage operations
   - Automatic maintenance on initialization
   - Emergency cleanup on quota exceeded
   - LRU tracking for variant access

## Features

### 1. Quota Monitoring

```typescript
const quotaInfo = quotaManager.checkQuota(additionalSize);
// Returns: { available, totalSize, estimatedUsage, itemCount }
```

- Estimates total localStorage usage
- Checks available space before writing
- Reserves space for other app data (512KB)
- Real-time quota availability status

### 2. Size Limits

- **Per-item limit**: 100KB maximum
- **Per-user limit**: 100 experiments maximum
- **Total limit**: 5MB (typical browser limit)
- **Reserved space**: 512KB for other features

### 3. Automatic Cleanup

**Age-based cleanup:**
- Removes assignments older than 90 days
- Configurable cleanup age threshold
- Runs on initialization and maintenance

**LRU (Least Recently Used) eviction:**
- Tracks last accessed time per assignment
- Evicts oldest items when limit reached
- Keeps 80% of max items after eviction

**Emergency cleanup:**
- Triggered on QuotaExceededError
- More aggressive (30-day threshold)
- Reduces to 30% of max items
- Final retry after cleanup

### 4. Safe Storage Operations

All localStorage operations wrapped with error handling:

```typescript
// Safe write with quota management
const result = quotaManager.safeSetItem(key, value, {
  userId: 'user123',
  maxUserItems: 100,
  enableCleanup: true
});

if (!result.success) {
  console.error(result.error, result.message);
}

// Safe read with error handling
const value = quotaManager.safeGetItem(key);

// Safe delete
const success = quotaManager.safeRemoveItem(key);
```

### 5. LRU Tracking

```typescript
// Update last accessed time for LRU tracking
quotaManager.updateLastAccessed(storageKey, userId, experimentId);
```

- Tracks access patterns
- Enables intelligent eviction
- Preserves frequently used data

### 6. Storage Statistics

```typescript
const stats = quotaManager.getStorageStats();
// Returns: { totalSize, itemCount, percentUsed, available }
```

- Real-time storage metrics
- Percentage usage calculation
- Monitoring and alerting support

## Usage Examples

### Basic Storage

```typescript
import { quotaManager } from '@/lib/storage/quota-manager';

// Store data with quota management
const result = quotaManager.safeSetItem('my-key', JSON.stringify(data), {
  userId: currentUser.id,
  maxUserItems: 100,
  enableCleanup: true
});

if (result.success) {
  console.log('Data stored successfully');
} else {
  console.error('Storage failed:', result.error);
}
```

### A/B Testing Integration

```typescript
import { abTestingEngine } from '@/services/experiments/ab-testing';

// Initialize with quota management
abTestingEngine.initialize(userId);

// Assign variant (automatic quota handling)
const result = abTestingEngine.assignVariant(experiment);

// Get storage statistics
const stats = abTestingEngine.getStorageStats();
console.log(`Using ${stats.percentUsed}% of quota`);
```

### Manual Maintenance

```typescript
import { quotaManager } from '@/lib/storage/quota-manager';

// Perform maintenance
const result = quotaManager.performMaintenance('al-ummah-ab-assignments');
console.log(`Cleaned ${result.cleanedItems} old items`);
console.log(`Quota available: ${result.quotaAvailable}`);
```

### Custom Cleanup

```typescript
// Clean up items older than 30 days
const removedCount = quotaManager.cleanupOldItems('my-storage-key', 30);
console.log(`Removed ${removedCount} old items`);
```

## Error Handling

### Error Types

1. **QUOTA_EXCEEDED**: localStorage quota limit reached
2. **SIZE_LIMIT_EXCEEDED**: Single item exceeds 100KB limit
3. **STORAGE_ERROR**: General storage operation failure

### Recovery Strategy

1. **First attempt**: Try to store data
2. **On quota exceeded**:
   - Run automatic cleanup (90-day threshold)
   - Retry storage operation
   - If still failing, run emergency cleanup (30-day threshold)
   - Final retry
3. **On failure**: Log error and continue (graceful degradation)

### Graceful Degradation

```typescript
try {
  const result = quotaManager.safeSetItem(key, value);
  if (!result.success) {
    // Continue without persistence
    console.warn('Using in-memory storage only');
  }
} catch (error) {
  // App continues functioning without localStorage
  console.error('Storage unavailable:', error);
}
```

## Configuration

### Constants

```typescript
// In quota-manager.ts
const MAX_ITEM_SIZE = 100 * 1024;           // 100KB per item
const MAX_ITEMS_PER_USER = 100;             // Max 100 experiments
const CLEANUP_AGE_DAYS = 90;                // Remove after 90 days
const ESTIMATED_QUOTA_LIMIT = 5 * 1024 * 1024;  // 5MB total
const RESERVED_SPACE = 512 * 1024;          // 512KB reserved
```

### Customization

To adjust limits, modify constants in `src/lib/storage/quota-manager.ts`:

```typescript
// Increase per-user limit
const MAX_ITEMS_PER_USER = 200;

// More aggressive cleanup
const CLEANUP_AGE_DAYS = 60;

// Larger reserved space
const RESERVED_SPACE = 1024 * 1024; // 1MB
```

## Monitoring

### Key Metrics

1. **Storage usage**: Track via `getStorageStats()`
2. **Cleanup frequency**: Count from `performMaintenance()`
3. **Quota exceeded errors**: Log in console
4. **Recovery success rate**: Track retry outcomes

### Logging

All quota operations log to console with `[QuotaManager]` prefix:

```
[QuotaManager] Cleaned up 5 old assignments
[QuotaManager] Evicted 10 LRU items
[QuotaManager] Recovery successful after emergency cleanup
[QuotaManager] Quota check failed, current usage: 4.8MB
```

### Recommended Alerts

1. Alert when storage exceeds 80% capacity
2. Alert on repeated quota exceeded errors
3. Alert on emergency cleanup triggers
4. Monitor cleanup item counts

## Testing

### Unit Tests

Tests located in `src/lib/storage/__tests__/quota-manager.test.ts`:

- Quota checking and monitoring
- Safe storage operations
- Cleanup and eviction strategies
- Error handling and recovery
- SSR compatibility

### Running Tests

```bash
# Run quota manager tests
pnpm test quota-manager

# Run all storage tests
pnpm test storage

# Run with coverage
pnpm test --coverage
```

### Manual Testing

1. **Quota simulation**:
   ```javascript
   // In browser console
   for (let i = 0; i < 1000; i++) {
     localStorage.setItem(`test-${i}`, 'x'.repeat(5000));
   }
   // Should trigger cleanup
   ```

2. **Maintenance check**:
   ```javascript
   import { quotaManager } from '@/lib/storage/quota-manager';
   const stats = quotaManager.getStorageStats();
   console.log(stats);
   ```

## Performance Impact

### Storage Operations

- **checkQuota()**: O(n) where n = localStorage items
- **cleanupOldItems()**: O(n) where n = user assignments
- **evictLRUItems()**: O(n log n) for sorting
- **safeSetItem()**: O(1) + cleanup overhead

### Optimization Strategies

1. **Lazy cleanup**: Only on initialization and errors
2. **Batch operations**: Cleanup multiple items at once
3. **Cache quota info**: Avoid repeated calculations
4. **Early size checks**: Reject oversized items quickly

## Migration Guide

### Existing Code

If you have existing localStorage code:

```typescript
// Before (unsafe)
localStorage.setItem('key', JSON.stringify(data));

// After (quota-managed)
import { quotaManager } from '@/lib/storage/quota-manager';
quotaManager.safeSetItem('key', JSON.stringify(data), {
  userId: currentUser.id,
  enableCleanup: true
});
```

### Gradual Adoption

1. Start with critical features (A/B testing)
2. Monitor quota usage and errors
3. Migrate other features incrementally
4. Add maintenance routines to app initialization

## Best Practices

1. **Always use quota manager** for localStorage operations
2. **Enable cleanup** in production environments
3. **Track storage stats** for monitoring
4. **Set appropriate limits** per feature
5. **Test quota scenarios** in development
6. **Log all errors** for debugging
7. **Graceful degradation** on failure
8. **Regular maintenance** on app initialization

## Troubleshooting

### Issue: QuotaExceededError still occurs

**Solution:**
- Check if cleanup is enabled
- Verify MAX_ITEM_SIZE and MAX_ITEMS_PER_USER
- Review cleanup age threshold
- Monitor emergency cleanup logs

### Issue: Data loss after cleanup

**Solution:**
- Increase CLEANUP_AGE_DAYS
- Implement data backup strategy
- Use server-side persistence for critical data

### Issue: Slow performance

**Solution:**
- Reduce cleanup frequency
- Increase MAX_ITEMS_PER_USER
- Optimize cleanup algorithms
- Use lazy cleanup strategies

### Issue: False quota warnings

**Solution:**
- Adjust ESTIMATED_QUOTA_LIMIT
- Increase RESERVED_SPACE
- Check browser-specific limits

## Browser Compatibility

### Storage Limits by Browser

- **Chrome**: ~10MB
- **Firefox**: ~10MB
- **Safari**: ~5MB (varies by device)
- **Edge**: ~10MB
- **Mobile browsers**: ~5MB (typically lower)

### Feature Detection

```typescript
if (typeof window !== 'undefined' && window.localStorage) {
  // localStorage available
  quotaManager.checkQuota();
} else {
  // Fallback to in-memory storage
}
```

## Future Enhancements

1. **IndexedDB fallback**: For larger storage needs
2. **Compression**: Reduce stored data size
3. **Smart eviction**: ML-based prediction
4. **Cloud sync**: Backup to server
5. **Cross-tab sync**: Share quota info
6. **Progressive cleanup**: Background processing

## References

- [MDN: Window.localStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage)
- [MDN: QuotaExceededError](https://developer.mozilla.org/en-US/docs/Web/API/DOMException#QuotaExceededError)
- [Web Storage API Specification](https://html.spec.whatwg.org/multipage/webstorage.html)
- [Browser Storage Limits](https://web.dev/storage-for-the-web/)

## Support

For issues or questions:
1. Check console logs for `[QuotaManager]` messages
2. Review storage statistics with `getStorageStats()`
3. Test cleanup with `performMaintenance()`
4. Open GitHub issue with logs and reproduction steps
