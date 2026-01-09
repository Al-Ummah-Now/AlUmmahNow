/**
 * Cloudflare R2 Storage Mock
 * Simulates R2 object storage behavior for testing
 */

export interface R2Object {
  key: string;
  size: number;
  etag: string;
  lastModified: Date;
  customMetadata?: Record<string, string>;
}

export interface R2ListResult {
  objects: R2Object[];
  truncated: boolean;
  cursor?: string;
}

export class R2Mock {
  private storage = new Map<string, { data: any; metadata: R2Object }>();
  private buckets = new Map<string, R2Mock>();

  /**
   * Store an object in R2
   */
  async put(key: string, value: any, metadata?: Record<string, string>): Promise<void> {
    const r2Object: R2Object = {
      key,
      size: JSON.stringify(value).length,
      etag: this.generateETag(value),
      lastModified: new Date(),
      customMetadata: metadata
    };

    this.storage.set(key, { data: value, metadata: r2Object });
  }

  /**
   * Retrieve an object from R2
   */
  async get(key: string): Promise<any | null> {
    const item = this.storage.get(key);
    return item ? JSON.stringify(item.data) : null;
  }

  /**
   * Get object with metadata
   */
  async head(key: string): Promise<R2Object | null> {
    const item = this.storage.get(key);
    return item ? item.metadata : null;
  }

  /**
   * Delete an object from R2
   */
  async delete(key: string): Promise<void> {
    this.storage.delete(key);
  }

  /**
   * Delete multiple objects
   */
  async deleteMultiple(keys: string[]): Promise<void> {
    keys.forEach(key => this.storage.delete(key));
  }

  /**
   * List objects with optional prefix
   */
  async list(prefix?: string, limit?: number): Promise<R2ListResult> {
    let keys = Array.from(this.storage.keys());
    
    if (prefix) {
      keys = keys.filter(key => key.startsWith(prefix));
    }

    // Sort by key
    keys.sort();

    const objects: R2Object[] = [];
    const count = limit ? Math.min(limit, keys.length) : keys.length;

    for (let i = 0; i < count; i++) {
      const key = keys[i];
      const item = this.storage.get(key);
      if (item) {
        objects.push(item.metadata);
      }
    }

    return {
      objects,
      truncated: limit ? keys.length > limit : false,
      cursor: limit && keys.length > limit ? keys[limit] : undefined
    };
  }

  /**
   * Check if object exists
   */
  async exists(key: string): Promise<boolean> {
    return this.storage.has(key);
  }

  /**
   * Copy an object to a new key
   */
  async copy(sourceKey: string, destinationKey: string): Promise<void> {
    const sourceItem = this.storage.get(sourceKey);
    if (!sourceItem) {
      throw new Error(`Source object ${sourceKey} not found`);
    }

    const newMetadata: R2Object = {
      ...sourceItem.metadata,
      key: destinationKey,
      lastModified: new Date()
    };

    this.storage.set(destinationKey, {
      data: sourceItem.data,
      metadata: newMetadata
    });
  }

  /**
   * Get object size
   */
  async size(key: string): Promise<number> {
    const item = this.storage.get(key);
    return item ? item.metadata.size : 0;
  }

  /**
   * Get object count
   */
  async count(prefix?: string): Promise<number> {
    if (prefix) {
      return Array.from(this.storage.keys()).filter(key => key.startsWith(prefix)).length;
    }
    return this.storage.size;
  }

  /**
   * Clear all objects
   */
  clear(): void {
    this.storage.clear();
  }

  /**
   * Get all keys
   */
  getKeys(): string[] {
    return Array.from(this.storage.keys());
  }

  /**
   * Get all objects
  */
  getAll(): Array<{ key: string; data: any; metadata: R2Object }> {
    return Array.from(this.storage.entries()).map(([key, item]) => ({
      key,
      data: item.data,
      metadata: item.metadata
    }));
  }

  /**
   * Simulate R2 error conditions
   */
  simulateError(shouldError: boolean, errorType: 'put' | 'get' | 'delete' | 'list' = 'get'): void {
    if (shouldError) {
      const originalMethod = this[errorType];
      this[errorType] = async () => {
        throw new Error(`R2 ${errorType} operation failed`);
      };
    }
  }

  /**
   * Simulate slow operations
   */
  simulateDelay(ms: number): void {
    const originalPut = this.put;
    const originalGet = this.get;
    const originalDelete = this.delete;

    this.put = async (key: string, value: any, metadata?: Record<string, string>) => {
      await new Promise(resolve => setTimeout(resolve, ms));
      return originalPut.call(this, key, value, metadata);
    };

    this.get = async (key: string) => {
      await new Promise(resolve => setTimeout(resolve, ms));
      return originalGet.call(this, key);
    };

    this.delete = async (key: string) => {
      await new Promise(resolve => setTimeout(resolve, ms));
      return originalDelete.call(this, key);
    };
  }

  /**
   * Generate ETag for object
   */
  private generateETag(value: any): string {
    const hash = JSON.stringify(value);
    return `"${hash.slice(0, 32)}"`;
  }

  /**
   * Get storage statistics
   */
  getStats() {
    const objects = Array.from(this.storage.values());
    const totalSize = objects.reduce((sum, item) => sum + item.metadata.size, 0);
    
    return {
      objectCount: this.storage.size,
      totalSize,
      averageSize: this.storage.size > 0 ? totalSize / this.storage.size : 0,
      oldestObject: objects.length > 0 ? 
        Math.min(...objects.map(item => item.metadata.lastModified.getTime())) : null,
      newestObject: objects.length > 0 ? 
        Math.max(...objects.map(item => item.metadata.lastModified.getTime())) : null
    };
  }

  /**
   * Create a bucket (for multi-bucket testing)
   */
  createBucket(name: string): R2Mock {
    const bucket = new R2Mock();
    this.buckets.set(name, bucket);
    return bucket;
  }

  /**
   * Get a bucket
   */
  getBucket(name: string): R2Mock | undefined {
    return this.buckets.get(name);
  }

  /**
   * Delete a bucket
   */
  deleteBucket(name: string): void {
    this.buckets.delete(name);
  }

  /**
   * List all buckets
   */
  listBuckets(): string[] {
    return Array.from(this.buckets.keys());
  }

  /**
   * Simulate bucket operations
   */
  async putInBucket(bucketName: string, key: string, value: any): Promise<void> {
    const bucket = this.buckets.get(bucketName);
    if (!bucket) {
      throw new Error(`Bucket ${bucketName} not found`);
    }
    return bucket.put(key, value);
  }

  async getFromBucket(bucketName: string, key: string): Promise<any | null> {
    const bucket = this.buckets.get(bucketName);
    if (!bucket) {
      throw new Error(`Bucket ${bucketName} not found`);
    }
    return bucket.get(key);
  }

  /**
   * Bulk operations
   */
  async bulkPut(objects: Array<{ key: string; value: any; metadata?: Record<string, string> }>): Promise<void> {
    for (const obj of objects) {
      await this.put(obj.key, obj.value, obj.metadata);
    }
  }

  async bulkDelete(keys: string[]): Promise<void> {
    for (const key of keys) {
      await this.delete(key);
    }
  }

  /**
   * Search objects by metadata
   */
  async searchByMetadata(searchKey: string, searchValue: string): Promise<R2Object[]> {
    const results: R2Object[] = [];
    
    for (const [, item] of this.storage) {
      if (item.metadata.customMetadata && 
          item.metadata.customMetadata[searchKey] === searchValue) {
        results.push(item.metadata);
      }
    }
    
    return results;
  }

  /**
   * Export data for testing
   */
  export(): Record<string, any> {
    const exportData: Record<string, any> = {};
    
    for (const [key, item] of this.storage) {
      exportData[key] = {
        data: item.data,
        metadata: item.metadata
      };
    }
    
    return exportData;
  }

  /**
   * Import data for testing
   */
  import(data: Record<string, any>): void {
    this.clear();
    
    for (const [key, item] of Object.entries(data)) {
      if (typeof item === 'object' && item !== null && 'data' in item && 'metadata' in item) {
        this.storage.set(key, item as { data: any; metadata: R2Object });
      }
    }
  }
}