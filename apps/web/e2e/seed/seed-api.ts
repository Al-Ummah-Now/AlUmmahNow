import * as fs from 'fs';
import * as path from 'path';
import { seedLogger as log } from './seed-logger';

/**
 * Thin api-videos client used by the QA seed.
 *
 * - Bearer auth with the access token taken from the web session cookie.
 * - Optional `channelId` header (the API validates that the caller owns it).
 * - 429 handling that honours Retry-After (upload endpoints are rate limited
 *   per user when ENVIRONMENT is not development/preview), bounded by
 *   SEED_MAX_RATE_LIMIT_WAIT_SECONDS across the whole run.
 * - Transient 5xx / network errors are retried a few times.
 */

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: unknown,
  ) {
    super(message);
  }
}

export interface RequestOptions {
  method?: string;
  token?: string;
  channelId?: string;
  json?: unknown;
  body?: BodyInit;
  headers?: Record<string, string>;
  /** HTTP statuses that are returned instead of thrown */
  allowStatus?: number[];
}

export interface ApiResponse<T> {
  status: number;
  data: T;
  headers: Headers;
}

const maxRateLimitWaitMs = Number(process.env.SEED_MAX_RATE_LIMIT_WAIT_SECONDS || 4200) * 1000;
let totalRateLimitWaitMs = 0;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function describeBody(body: unknown): string {
  if (body === undefined || body === null) return '';
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return text.length > 600 ? `${text.slice(0, 600)}…` : text;
}

export class ApiClient {
  constructor(public baseUrl: string) {}

  async request<T = unknown>(pathname: string, opts: RequestOptions = {}): Promise<ApiResponse<T>> {
    const method = opts.method || 'GET';
    const url = pathname.startsWith('http') ? pathname : `${this.baseUrl}${pathname}`;
    const headers: Record<string, string> = { ...(opts.headers || {}) };
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    // Cloudflare's documented Turnstile test token: QA and stage use the always-pass test secret,
    // production and the local stack ignore it (docs/features/bot-protection.md)
    headers['X-Turnstile-Token'] = 'XXXX.DUMMY.TOKEN.XXXX';
    if (opts.channelId) headers.channelId = opts.channelId;
    let body = opts.body;
    if (opts.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.json);
    }

    let transientAttempts = 0;
    for (;;) {
      let res: Response;
      try {
        res = await fetch(url, { method, headers, body });
      } catch (error) {
        transientAttempts++;
        if (transientAttempts > 4) throw error;
        log.warn('Network error, retrying', { method, path: new URL(url).pathname, attempt: transientAttempts, error: String(error) });
        await sleep(2000 * transientAttempts);
        continue;
      }

      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('Retry-After') || '60');
        const waitMs = (Number.isFinite(retryAfter) ? retryAfter : 60) * 1000 + 2000;
        if (totalRateLimitWaitMs + waitMs > maxRateLimitWaitMs) {
          throw new ApiError(`Rate limited on ${method} ${new URL(url).pathname} and the wait budget is exhausted`, 429, await res.text());
        }
        totalRateLimitWaitMs += waitMs;
        log.warn('Rate limited; waiting before retry', { method, path: new URL(url).pathname, waitSeconds: Math.round(waitMs / 1000) });
        await sleep(waitMs);
        continue;
      }

      if (res.status >= 500 && res.status !== 501 && transientAttempts < 3 && method === 'GET') {
        transientAttempts++;
        log.warn('Server error on GET, retrying', { path: new URL(url).pathname, status: res.status, attempt: transientAttempts });
        await sleep(2000 * transientAttempts);
        continue;
      }

      const text = await res.text();
      let data: unknown = text;
      if (text && (res.headers.get('content-type') || '').includes('json')) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }
      if (!res.ok && !(opts.allowStatus || []).includes(res.status)) {
        throw new ApiError(`${method} ${new URL(url).pathname} -> ${res.status} ${describeBody(data)}`, res.status, data);
      }
      return { status: res.status, data: data as T, headers: res.headers };
    }
  }

  get<T = unknown>(pathname: string, opts: Omit<RequestOptions, 'method'> = {}) {
    return this.request<T>(pathname, { ...opts, method: 'GET' });
  }

  post<T = unknown>(pathname: string, json: unknown, opts: Omit<RequestOptions, 'method' | 'json'> = {}) {
    return this.request<T>(pathname, { ...opts, method: 'POST', json });
  }

  put<T = unknown>(pathname: string, json: unknown, opts: Omit<RequestOptions, 'method' | 'json'> = {}) {
    return this.request<T>(pathname, { ...opts, method: 'PUT', json });
  }

  /**
   * Pages through a cursor-paginated list endpoint ({ cursor, data }).
   * Stops when the cursor is empty or repeats.
   */
  async listAll<T>(pathname: string, opts: Omit<RequestOptions, 'method'> = {}, limit = 100, maxPages = 50): Promise<T[]> {
    const items: T[] = [];
    let cursor = '';
    const seen = new Set<string>();
    for (let page = 0; page < maxPages; page++) {
      const sep = pathname.includes('?') ? '&' : '?';
      const url = `${pathname}${sep}limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const res = await this.get<{ cursor?: string; data?: T[] }>(url, opts);
      items.push(...(res.data.data || []));
      cursor = res.data.cursor || '';
      if (!cursor || seen.has(cursor)) break;
      seen.add(cursor);
    }
    return items;
  }

  /**
   * Uploads a file through the api-videos TUS proxy, mirroring the web
   * uploader (components/videoUpload): POST /api/videos/tus with the
   * tusSessionId/videoId/filename/filetype metadata, then PATCH chunks to the
   * returned Location. Resumes from the server offset (HEAD) after a failure.
   */
  async tusUpload(params: { token: string; tusSessionId: string; videoId: string; filePath: string; mimeType: string }): Promise<void> {
    const file = fs.readFileSync(params.filePath);
    const size = file.byteLength;
    const chunkSize = 5 * 1024 * 1024;
    const b64 = (v: string) => Buffer.from(v, 'utf8').toString('base64');
    const metadata = [
      `tusSessionId ${b64(params.tusSessionId)}`,
      `videoId ${b64(params.videoId)}`,
      `filename ${b64(path.basename(params.filePath))}`,
      `filetype ${b64(params.mimeType)}`,
    ].join(',');

    const create = await this.request(`/api/videos/tus`, {
      method: 'POST',
      token: params.token,
      headers: {
        'Tus-Resumable': '1.0.0',
        'Upload-Length': String(size),
        'Upload-Metadata': metadata,
      },
    });
    const location = create.headers.get('Location');
    if (!location) throw new Error('TUS proxy did not return a Location header');
    const uploadUrl = new URL(location, this.baseUrl).toString();

    let offset = 0;
    let failures = 0;
    while (offset < size) {
      const end = Math.min(offset + chunkSize, size);
      try {
        const res = await this.request(uploadUrl, {
          method: 'PATCH',
          token: params.token,
          headers: {
            'Tus-Resumable': '1.0.0',
            'Upload-Offset': String(offset),
            'Content-Type': 'application/offset+octet-stream',
          },
          body: new Uint8Array(file.subarray(offset, end)),
        });
        const next = Number(res.headers.get('Upload-Offset'));
        offset = Number.isFinite(next) && next > offset ? next : end;
        log.info('TUS chunk uploaded', { videoId: params.videoId, offset, size });
      } catch (error) {
        failures++;
        if (failures > 4) throw error;
        log.warn('TUS chunk failed; resuming from server offset', { videoId: params.videoId, attempt: failures, error: String(error) });
        await sleep(3000 * failures);
        const head = await this.request(uploadUrl, { method: 'HEAD', token: params.token, headers: { 'Tus-Resumable': '1.0.0' } });
        const serverOffset = Number(head.headers.get('Upload-Offset'));
        if (Number.isFinite(serverOffset)) offset = serverOffset;
      }
    }
  }
}
