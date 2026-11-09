import { logger } from './logger';
import { updateJson, type CasBucket, type CasResult } from './r2Cas';

export interface PaginationResponse<T> {
  cursor: string;
  items: T[];
}

class R2Repository<T> {
  private bucket: R2Bucket;

  constructor(bucket: R2Bucket) {
    this.bucket = bucket;
  }

  async listObjects(limit: number, cursor?: string): Promise<PaginationResponse<T>> {
    const listResult = await this.bucket.list({ limit, cursor });

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

  /** Returns the stored object's R2 `uploaded` time (epoch ms), the version for the search index. */
  async putObject(id: string, data: T): Promise<number> {
    const options: R2PutOptions = {
      httpMetadata: { contentType: 'application/json' },
    };
    const written = await this.bucket.put(id, JSON.stringify(data), options);
    return written?.uploaded ? new Date(written.uploaded).getTime() : Date.now();
  }

  /**
   * Conditional read-modify-write (see r2Cas.ts): `mutate` changes a copy of
   * the current object and returns false to write nothing. Null when missing.
   */
  async updateObject(id: string, mutate: (data: T) => boolean | void): Promise<CasResult<T> | null> {
    return updateJson<T>(this.bucket as unknown as CasBucket, id, (current) => {
      if (current === null) return undefined;
      return mutate(current) === false ? undefined : current;
    });
  }

  async deleteObject(id: string): Promise<void> {
    await this.bucket.delete(id);
  }
}

export default R2Repository;
