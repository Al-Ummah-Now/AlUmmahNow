import { env } from 'cloudflare:workers';

export interface PaginationResponse<T> {
  cursor: string;
  items: T[];
}

class R2Repository<T> {
  private bucketName: string;

  constructor(bucketName: string) {
    this.bucketName = bucketName;
  }

  async listObjects(limit: number, cursor?: string): Promise<PaginationResponse<T>> {
    const listResult = await env.videos.list({ limit, cursor });

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
    const object = await env.videos.get(id);

    const bodyContent = await object.json<T>();
    return bodyContent;
  }

  async putObject(id: string, data: T): Promise<void> {
    await env.videos.put(id, JSON.stringify(data));
  }

  async deleteObject(id: string): Promise<void> {
    await env.videos.delete(id);
  }
}

export default R2Repository;