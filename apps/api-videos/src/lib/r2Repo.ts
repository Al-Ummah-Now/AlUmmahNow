import { logger } from './logger';


export interface PaginationResponse<T> {
  cursor: string;
  items: T[];
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
   * `mutate` may change the object in place and returns false to skip the
   * write (nothing to change). Resolves to the stored object, or null when
   * the object does not exist.
   */
  async updateObject(id: string, mutate: (data: T) => boolean | void, maxAttempts = 5): Promise<T | null> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const object = await this.bucket.get(id);
      if (!object) return null;
      const data = await object.json<T>();
      if (mutate(data) === false) return data;
      const written = await this.bucket.put(id, JSON.stringify(data), {
        httpMetadata: { contentType: 'application/json' },
        onlyIf: { etagMatches: object.etag },
      });
      if (written) return data;
      logger.warn('[R2Repository] Concurrent update, retrying', { id, attempt });
    }
    throw new Error(`Concurrent updates to ${id}: gave up after ${maxAttempts} attempts`);
  }

  async deleteObject(id: string): Promise<void> {
    await this.bucket.delete(id);
  }
}

export default R2Repository;