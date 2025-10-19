# localStorage Quota Management - Quick Start

## TL;DR

The quota management system prevents localStorage crashes by automatically cleaning up old data and handling quota exceeded errors gracefully.

## Basic Usage

### For A/B Testing (Already Integrated)

```typescript
import { abTestingEngine } from '@/services/experiments/ab-testing';

// Initialize (automatic quota management enabled)
abTestingEngine.initialize(userId);

// Use normally - quota is handled automatically
const result = abTestingEngine.assignVariant(experiment);
const variant = abTestingEngine.getVariant(experimentId);

// Monitor storage usage
const stats = abTestingEngine.getStorageStats();
console.log(`Using ${stats.percentUsed}% of localStorage quota`);
```

### For Other Features

```typescript
import { quotaManager } from '@/lib/storage/quota-manager';

// Store data with automatic quota management
const result = quotaManager.safeSetItem('my-key', JSON.stringify(data), {
  userId: currentUser.id,
  maxUserItems: 100,
  enableCleanup: true
});

if (result.success) {
  // Data stored successfully
} else {
  // Handle error (app continues functioning)
  console.error('Storage failed:', result.error);
}

// Retrieve data safely
const value = quotaManager.safeGetItem('my-key');
if (value) {
  const data = JSON.parse(value);
}

// Remove data
quotaManager.safeRemoveItem('my-key');
```

## What It Does Automatically

1. **Monitors Storage**: Checks available quota before writing
2. **Cleans Old Data**: Removes items older than 90 days
3. **Evicts LRU Items**: Removes least recently used when full
4. **Handles Errors**: Catches QuotaExceededError and recovers
5. **Logs Issues**: All operations logged with `[QuotaManager]` prefix
6. **Tracks Usage**: Updates last accessed time for smart eviction

## When to Use

### ✅ Use Quota Manager For:
- Storing experiment assignments
- Caching user preferences
- Temporary data storage
- Any localStorage operations

### ❌ Don't Use For:
- Server-side code (no localStorage)
- Critical data (use server storage)
- Large files (use IndexedDB instead)

## Configuration

Default limits (in `src/lib/storage/quota-manager.ts`):

```typescript
MAX_ITEM_SIZE = 100KB           // Per item limit
MAX_ITEMS_PER_USER = 100        // Per user limit
CLEANUP_AGE_DAYS = 90           // Auto-cleanup threshold
ESTIMATED_QUOTA_LIMIT = 5MB     // Total browser limit
RESERVED_SPACE = 512KB          // Reserved for other features
```

## Monitoring

Check storage health:

```typescript
import { quotaManager } from '@/lib/storage/quota-manager';

const stats = quotaManager.getStorageStats();
console.log(`
  Total Size: ${stats.totalSize / 1024}KB
  Used: ${stats.percentUsed}%
  Items: ${stats.itemCount}
  Available: ${stats.available}
`);
```

## Troubleshooting

### Issue: Data disappears after 90 days

**Expected behavior**: Old assignments are automatically cleaned up.

**Solution**: If you need longer retention, increase `CLEANUP_AGE_DAYS` in `quota-manager.ts`.

### Issue: Storage full warning

**Check**: `quotaManager.getStorageStats()`

**Solutions**:
1. Clear browser cache and localStorage manually
2. Reduce `MAX_ITEMS_PER_USER` to be more aggressive
3. Decrease `CLEANUP_AGE_DAYS` for faster cleanup

### Issue: QuotaExceededError still occurs

**Check**: Console logs for `[QuotaManager]` messages

**Solutions**:
1. Verify cleanup is enabled: `enableCleanup: true`
2. Check if emergency cleanup is running
3. Review browser's total localStorage limit

## Best Practices

1. **Always use `safeSetItem()`** instead of direct localStorage
2. **Enable cleanup** in production: `enableCleanup: true`
3. **Monitor usage** with `getStorageStats()`
4. **Set user context** when possible: `userId: currentUser.id`
5. **Log errors** for debugging
6. **Test quota scenarios** in development

## Examples

### Storing User Preferences

```typescript
import { quotaManager } from '@/lib/storage/quota-manager';

export function saveUserPreferences(userId: string, prefs: UserPreferences) {
  const result = quotaManager.safeSetItem(
    `user-prefs-${userId}`,
    JSON.stringify(prefs),
    {
      userId,
      maxUserItems: 50,
      enableCleanup: true
    }
  );

  if (!result.success) {
    console.error('Failed to save preferences:', result.error);
    // App continues - preferences not persisted
  }

  return result.success;
}

export function loadUserPreferences(userId: string): UserPreferences | null {
  const value = quotaManager.safeGetItem(`user-prefs-${userId}`);
  return value ? JSON.parse(value) : null;
}
```

### Caching API Responses

```typescript
import { quotaManager } from '@/lib/storage/quota-manager';

const CACHE_KEY = 'api-cache';
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export function cacheApiResponse(key: string, data: unknown) {
  const cache = JSON.parse(quotaManager.safeGetItem(CACHE_KEY) || '{}');

  cache[key] = {
    data,
    timestamp: Date.now()
  };

  quotaManager.safeSetItem(CACHE_KEY, JSON.stringify(cache), {
    enableCleanup: true
  });
}

export function getCachedApiResponse<T>(key: string): T | null {
  const cache = JSON.parse(quotaManager.safeGetItem(CACHE_KEY) || '{}');
  const cached = cache[key];

  if (!cached) return null;

  const age = Date.now() - cached.timestamp;
  if (age > CACHE_TTL) {
    // Expired
    delete cache[key];
    quotaManager.safeSetItem(CACHE_KEY, JSON.stringify(cache));
    return null;
  }

  return cached.data as T;
}
```

### Periodic Maintenance

```typescript
import { quotaManager } from '@/lib/storage/quota-manager';

// Run maintenance on app initialization
export function initializeApp() {
  // ... other initialization

  // Clean up old data
  const result = quotaManager.performMaintenance('al-ummah-ab-assignments');

  if (result.cleanedItems > 0) {
    console.log(`Cleaned up ${result.cleanedItems} old assignments`);
  }

  if (!result.quotaAvailable) {
    console.warn('localStorage quota is running low');
    // Maybe show user notification
  }
}
```

## Next Steps

1. **Read full docs**: See `QUOTA_MANAGEMENT.md` for complete documentation
2. **Review implementation**: Check `IMPLEMENTATION_SUMMARY.md` for technical details
3. **Run tests**: `pnpm test quota-manager`
4. **Monitor in production**: Watch for `[QuotaManager]` logs

## Support

For issues or questions:
1. Check console logs for `[QuotaManager]` messages
2. Review storage statistics: `quotaManager.getStorageStats()`
3. Test cleanup: `quotaManager.performMaintenance(storageKey)`
4. Open GitHub issue with logs and steps to reproduce
