import { logger } from './lib/logger';

/**
 * Acquire a distributed lock for a video to prevent duplicate processing
 * @param kv KV namespace for locks
 * @param key Lock key (e.g., "lock:videoId")
 * @param ttl Time-to-live in seconds
 * @returns true if lock acquired, false if already locked
 */
export async function acquireLock(
  kv: KVNamespace,
  key: string,
  ttl: number = 120
): Promise<boolean> {
  try {
    const lockValue = Date.now().toString();

    // Try to put the lock with NX (only if not exists)
    await kv.put(key, lockValue, {
      expirationTtl: ttl,
    });

    // Verify we got the lock by reading it back
    const currentValue = await kv.get(key);
    return currentValue === lockValue;
  } catch (error) {
    logger.error('Failed to acquire lock:', error);
    return false;
  }
}

/**
 * Release a distributed lock
 * @param kv KV namespace for locks
 * @param key Lock key
 */
export async function releaseLock(
  kv: KVNamespace,
  key: string
): Promise<void> {
  try {
    await kv.delete(key);
  } catch (error) {
    logger.error('Failed to release lock:', error);
  }
}

/**
 * Check if a lock exists
 * @param kv KV namespace for locks
 * @param key Lock key
 * @returns true if locked, false otherwise
 */
export async function isLocked(
  kv: KVNamespace,
  key: string
): Promise<boolean> {
  try {
    const value = await kv.get(key);
    return value !== null;
  } catch (error) {
    logger.error('Failed to check lock:', error);
    return false;
  }
}

/**
 * Update last run timestamp
 * @param kv KV namespace for locks
 */
export async function updateLastRun(kv: KVNamespace): Promise<void> {
  try {
    await kv.put('last_run', Date.now().toString(), {
      expirationTtl: 300, // 5 minutes
    });
  } catch (error) {
    logger.error('Failed to update last run:', error);
  }
}

/**
 * Get last run timestamp
 * @param kv KV namespace for locks
 * @returns Timestamp or null if not found
 */
export async function getLastRun(kv: KVNamespace): Promise<number | null> {
  try {
    const value = await kv.get('last_run');
    return value ? parseInt(value, 10) : null;
  } catch (error) {
    logger.error('Failed to get last run:', error);
    return null;
  }
}
