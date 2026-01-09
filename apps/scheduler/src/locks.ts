import { logger } from './lib/logger';

/**
 * Result of a lock acquisition attempt
 */
export interface LockResult {
  acquired: boolean;
  token?: string;
}

/**
 * Acquire a distributed lock using Durable Objects (atomic).
 *
 * Each video gets its own Durable Object instance, ensuring
 * single-threaded execution and true atomic locking.
 *
 * @param lockNamespace Durable Object namespace for locks
 * @param key Lock key (e.g., "videoId")
 * @param ttl Time-to-live in seconds
 * @returns Lock result with token if acquired
 */
export async function acquireLock(
  lockNamespace: DurableObjectNamespace,
  key: string,
  ttl: number = 120
): Promise<LockResult> {
  try {
    // Get the Durable Object stub for this specific key
    const id = lockNamespace.idFromName(key);
    const stub = lockNamespace.get(id);

    // Call the acquire endpoint
    const response = await stub.fetch('https://lock/acquire', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl }),
    });

    const result = await response.json() as {
      acquired: boolean;
      token?: string;
      reason?: string;
    };

    if (result.acquired) {
      logger.debug('Lock acquired via DO', { key });
    } else {
      logger.debug('Lock not acquired', { key, reason: result.reason });
    }

    return {
      acquired: result.acquired,
      token: result.token,
    };
  } catch (error) {
    logger.error('Failed to acquire lock via DO', { key, error });
    return { acquired: false };
  }
}

/**
 * Verify that we still hold the lock
 * @param lockNamespace Durable Object namespace for locks
 * @param key Lock key
 * @param token The token returned from acquireLock
 * @returns true if we still hold the lock
 */
export async function verifyLock(
  lockNamespace: DurableObjectNamespace,
  key: string,
  token: string
): Promise<boolean> {
  try {
    const id = lockNamespace.idFromName(key);
    const stub = lockNamespace.get(id);

    const response = await stub.fetch('https://lock/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });

    const result = await response.json() as { valid: boolean };
    return result.valid;
  } catch (error) {
    logger.error('Failed to verify lock via DO', { key, error });
    return false;
  }
}

/**
 * Release a distributed lock
 * @param lockNamespace Durable Object namespace for locks
 * @param key Lock key
 * @param token Token to verify ownership before release
 */
export async function releaseLock(
  lockNamespace: DurableObjectNamespace,
  key: string,
  token: string
): Promise<void> {
  try {
    const id = lockNamespace.idFromName(key);
    const stub = lockNamespace.get(id);

    const response = await stub.fetch('https://lock/release', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });

    const result = await response.json() as { released: boolean; reason?: string };

    if (result.released) {
      logger.debug('Lock released via DO', { key });
    } else {
      logger.warn('Lock release failed', { key, reason: result.reason });
    }
  } catch (error) {
    logger.error('Failed to release lock via DO', { key, error });
  }
}

/**
 * Check if a lock exists (without acquiring)
 * @param lockNamespace Durable Object namespace for locks
 * @param key Lock key
 * @returns true if locked, false otherwise
 */
export async function isLocked(
  lockNamespace: DurableObjectNamespace,
  key: string
): Promise<boolean> {
  try {
    const id = lockNamespace.idFromName(key);
    const stub = lockNamespace.get(id);

    const response = await stub.fetch('https://lock/status', {
      method: 'GET',
    });

    const result = await response.json() as { locked: boolean };
    return result.locked;
  } catch (error) {
    logger.error('Failed to check lock via DO', { key, error });
    return false;
  }
}

/**
 * Update last run timestamp (still uses KV for simple metadata)
 * @param kv KV namespace for metadata
 */
export async function updateLastRun(kv: KVNamespace): Promise<void> {
  try {
    await kv.put('last_run', Date.now().toString(), {
      expirationTtl: 300, // 5 minutes
    });
  } catch (error) {
    logger.error('Failed to update last run', { error });
  }
}

/**
 * Get last run timestamp
 * @param kv KV namespace for metadata
 * @returns Timestamp or null if not found
 */
export async function getLastRun(kv: KVNamespace): Promise<number | null> {
  try {
    const value = await kv.get('last_run');
    return value ? parseInt(value, 10) : null;
  } catch (error) {
    logger.error('Failed to get last run', { error });
    return null;
  }
}
