import { logger } from './logger';


export interface PaginationResponse<T> {
  cursor: string;
  items: T[];
}

/** Attempts before `updateObject` gives up on a key under constant contention. */
export const DEFAULT_CAS_ATTEMPTS = 10;

/** R2 precondition that only lets a put through when the key does not exist. */
export const CREATE_ONLY: R2Conditional = { etagDoesNotMatch: '*' };

/**
 * Thrown when `updateObject` lost every attempt to concurrent writers (the
 * change was not made). It is transient, so the API answers 503 with
 * Retry-After (error-handler.ts) and clients retry; the key stays out of the
 * message (it can name a user) and is logged from the property.
 */
export class ConcurrentUpdateError extends Error {
  readonly status = 503;
  readonly retryAfterSeconds = 1;
  constructor(readonly key: string, readonly attempts: number) {
    super(`Busy: concurrent updates, retry shortly (gave up after ${attempts} attempts)`);
    this.name = 'ConcurrentUpdateError';
  }
}

/**
 * For handlers that turn any failure into a 500: rethrows a lost write race so
 * the global error handler answers 503 with Retry-After instead.
 */
export function rethrowBusy(error: unknown): void {
  if (error instanceof ConcurrentUpdateError) throw error;
}

/** Full-jitter exponential backoff: up to 10, 20, 40 … 320 ms. */
export function casBackoff(attempt: number): Promise<void> {
  const ceiling = Math.min(10 * 2 ** (attempt - 1), 320);
  return new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * ceiling)));
}

class R2Repository<T> {
  private bucket: R2Bucket;

  constructor(bucket: R2Bucket) {
    this.bucket = bucket;
  }

  async listObjects(limit: number, cursor?: string, prefix?: string): Promise<PaginationResponse<T>> {
    const listResult = await this.bucket.list(prefix ? { limit, cursor, prefix } : { limit, cursor });

    if (!listResult.objects) {
      return {
        cursor: listResult.truncated ? listResult.cursor : '',
        items: [],
      }
    }

    const objects = await Promise.all(
      listResult.objects.map(async (object) => {
        if (!object.key) return null;

        const bodyContent = await this.getObject(object.key);
        return bodyContent;
      })
    );

    return {
      cursor: listResult.truncated ? listResult.cursor : '',
      items: objects.filter((item) => item !== null) as T[],
    };
  }

  async getObject(id: string): Promise<T | null> {
    try {
      const object = await this.bucket.get(id);

      // Check if object exists before trying to parse it
      if (!object) {
        return null;
      }

      try {
        const bodyContent = await object.json<T>();
        return bodyContent;
      } catch (error) {
        logger.error(`Failed to parse object ${id} as JSON:`, error);
        return null;
      }
    } catch (error) {
      logger.error(`Failed to fetch object ${id} from R2 bucket:`, error);
      throw error;
    }
  }

  async putObject(id: string, data: T): Promise<void> {
    const options: R2PutOptions = {
      httpMetadata: { contentType: 'application/json' },
    };
    await this.bucket.put(id, JSON.stringify(data), options);
  }

  /**
   * Read-modify-write with optimistic concurrency: the write only succeeds if
   * the object is unchanged since it was read (R2 conditional put on the
   * etag), otherwise it re-reads and re-applies `mutate`. Concurrent updates
   * to one record (e.g. two viewers liking the same video) no longer drop
   * each other's change.
   *
   * Every writer of a key must go through here (or another conditional put):
   * one blind `putObject` on the same key overwrites the changes this
   * protects (docs/architecture/SCALABILITY-AUDIT.md).
   *
   * `mutate` may change the object in place and returns false to skip the
   * write (nothing to change). It can run several times, so it must only
   * change `data` (record outcomes in variables reset on each run). Resolves
   * to the stored object, or null when the object does not exist and no
   * `initial` value is given (with `initial`, a missing object is created
   * from it with a create-only put, so two first writers cannot overwrite
   * each other either).
   *
   * Between attempts it waits a short, growing, random delay so writers that
   * collided do not collide again.
   */
  async updateObject(
    id: string,
    mutate: (data: T) => boolean | void,
    opts: { maxAttempts?: number; initial?: () => T } = {},
  ): Promise<T | null> {
    const maxAttempts = opts.maxAttempts ?? DEFAULT_CAS_ATTEMPTS;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const object = await this.bucket.get(id);
      if (!object && !opts.initial) return null;
      const data = object ? await object.json<T>() : opts.initial!();
      if (mutate(data) === false) return data;
      const written = await this.bucket.put(id, JSON.stringify(data), {
        httpMetadata: { contentType: 'application/json' },
        onlyIf: object ? { etagMatches: object.etag } : CREATE_ONLY,
      });
      if (written) return data;
      logger.warn('[R2Repository] Concurrent update, retrying', { id, attempt });
      if (attempt < maxAttempts) await casBackoff(attempt);
    }
    throw new ConcurrentUpdateError(id, maxAttempts);
  }

  /**
   * `updateObject` for handlers that validate the fresh object: `mutate`
   * returns `{ reject: value }` to stop without writing (e.g. the comment it
   * edits was deleted meanwhile), false to skip the write, or nothing to
   * write. Resolves to the stored object (null when missing) and the
   * rejection of the last attempt, if any.
   */
  async updateObjectOrReject<E>(
    id: string,
    mutate: (data: T) => { reject: E } | boolean | void,
    opts: { maxAttempts?: number; initial?: () => T } = {},
  ): Promise<{ data: T | null; rejected?: E }> {
    let rejection = undefined as { reject: E } | undefined;
    const data = await this.updateObject(id, (fresh) => {
      rejection = undefined;
      const outcome = mutate(fresh);
      if (outcome && typeof outcome === 'object') {
        rejection = outcome;
        return false;
      }
      return outcome as boolean | void;
    }, opts);
    return rejection ? { data, rejected: rejection.reject } : { data };
  }

  /**
   * Creates `id` only when it does not exist yet (R2 create-only put).
   * Resolves to true when this call created it, false when it already existed.
   */
  async createObject(id: string, data: T): Promise<boolean> {
    const written = await this.bucket.put(id, JSON.stringify(data), {
      httpMetadata: { contentType: 'application/json' },
      onlyIf: CREATE_ONLY,
    });
    return written !== null;
  }

  async deleteObject(id: string): Promise<void> {
    await this.bucket.delete(id);
  }
}

export default R2Repository;