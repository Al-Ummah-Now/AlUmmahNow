/**
 * fetch for the suite's own API calls (not the page's), riding over a dropped
 * connection. On 2026-11-11 the runners' network failed requests with
 * "fetch failed" (ECONNRESET, DNS) while QA itself answered: a test failed on a
 * request the server never saw. A network-level failure (fetch rejects with a
 * TypeError, no HTTP answer) is retried with backoff, but only when repeating
 * the request is safe: GET/HEAD/PUT/DELETE/OPTIONS, or a call the caller marks
 * idempotent. Any HTTP answer, error statuses included, is returned as is.
 */
const SAFE = new Set(['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS']);
const DELAYS_MS = [1000, 3000];

export async function fetchRetry(url: string, init: RequestInit = {}, opts: { idempotent?: boolean } = {}): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase();
  const retryable = opts.idempotent || SAFE.has(method);
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(url, init);
    } catch (error) {
      if (!retryable || !(error instanceof TypeError) || attempt >= DELAYS_MS.length) throw error;
      await new Promise((r) => setTimeout(r, DELAYS_MS[attempt]));
    }
  }
}
