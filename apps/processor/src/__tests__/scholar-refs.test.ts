/**
 * The scholar post reference outbox (handlers/scholar-refs.ts): a public post is PUT to the CMS, a
 * deleted or non-public one DELETEd, www's address is written back, CMS outages retry, refusals and
 * "not a scholar's channel" do not.
 */
import { RefSyncRetry, syncScholarRef, type PostsBucket } from '../handlers/scholar-refs';

class Bucket implements PostsBucket {
  store = new Map<string, { body: string; etag: string }>();
  n = 0;
  async get(key: string) {
    const o = this.store.get(key);
    return o ? { etag: o.etag, json: async <T>() => JSON.parse(o.body) as T } : null;
  }
  async put(key: string, value: string, options?: { onlyIf?: { etagMatches?: string } }) {
    const cur = this.store.get(key);
    if (options?.onlyIf?.etagMatches && cur?.etag !== options.onlyIf.etagMatches) return null;
    this.store.set(key, { body: value, etag: `e${++this.n}` });
    return {};
  }
}

const log = { debug: jest.fn(), warn: jest.fn() };
const post = (extra: Record<string, unknown> = {}) => ({ id: 'p1', channelId: 'c1', type: 'article', status: 'published', visibility: 'public', article: { title: 'T', body: 'B', coverUrl: null, locale: 'en' }, ...extra });

function setup(answer: { status: number; body?: unknown } | Error, stored: Record<string, unknown> | null = post()) {
  const bucket = new Bucket();
  if (stored) bucket.store.set('posts/c1/p1.json', { body: JSON.stringify(stored), etag: 'e0' });
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (answer instanceof Error) throw answer;
    return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), { status: answer.status });
  }) as unknown as typeof fetch;
  const env = { community_posts: bucket, CMS_INTERNAL_URL: 'https://cms.test/', INTERNAL_API_KEY: 'k' };
  return { bucket, calls, fetcher, env };
}

describe('scholar post references', () => {
  it('PUTs a public post and writes www\'s address back', async () => {
    const s = setup({ status: 200, body: { status: 'ok', url: 'https://www.test/en/articles/t/', slug: 't', locale: 'en' } });
    expect(await syncScholarRef(s.env, 'c1', 'p1', log, s.fetcher)).toBe('upserted');
    expect(s.calls[0].url).toBe('https://cms.test/internal/refs/p1');
    expect(s.calls[0].init.method).toBe('PUT');
    expect((s.calls[0].init.headers as Record<string, string>)['X-API-Key']).toBe('k');
    expect(JSON.parse(String(s.calls[0].init.body)).post.id).toBe('p1');
    const saved = JSON.parse(s.bucket.store.get('posts/c1/p1.json')!.body);
    expect(saved.www).toEqual({ url: 'https://www.test/en/articles/t/', slug: 't', locale: 'en' });
    expect(saved.article.url).toBe('https://www.test/en/articles/t/');
  });

  it('DELETEs a deleted, members-only or missing post', async () => {
    for (const stored of [post({ status: 'deleted' }), post({ visibility: 'members' }), null]) {
      const s = setup({ status: 200, body: { status: 'ok' } }, stored);
      expect(await syncScholarRef(s.env, 'c1', 'p1', log, s.fetcher)).toBe('removed');
      expect(s.calls[0].init.method).toBe('DELETE');
      expect(s.calls[0].url).toBe('https://cms.test/internal/refs/p1?channelId=c1');
    }
  });

  it('a channel that is not a scholar\'s primary channel changes nothing', async () => {
    const s = setup({ status: 200, body: { status: 'ignored' } });
    expect(await syncScholarRef(s.env, 'c1', 'p1', log, s.fetcher)).toBe('ignored');
    expect(JSON.parse(s.bucket.store.get('posts/c1/p1.json')!.body).www).toBeUndefined();
  });

  it('retries outages and 5xx, never refusals', async () => {
    await expect(syncScholarRef(setup(new Error('down')).env, 'c1', 'p1', log, setup(new Error('down')).fetcher)).rejects.toBeInstanceOf(RefSyncRetry);
    const s5 = setup({ status: 503 });
    await expect(syncScholarRef(s5.env, 'c1', 'p1', log, s5.fetcher)).rejects.toBeInstanceOf(RefSyncRetry);
    const s4 = setup({ status: 400, body: { error: 'bad' } });
    expect(await syncScholarRef(s4.env, 'c1', 'p1', log, s4.fetcher)).toBe('refused');
  });

  it('does nothing without a CMS URL or with bad ids', async () => {
    const s = setup({ status: 200 });
    expect(await syncScholarRef({ ...s.env, CMS_INTERNAL_URL: undefined }, 'c1', 'p1', log, s.fetcher)).toBe('skipped');
    expect(await syncScholarRef(s.env, '../x', 'p1', log, s.fetcher)).toBe('skipped');
    expect(s.calls).toHaveLength(0);
  });
});
