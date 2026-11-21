/**
 * The decisions of provider-retry.ts, without imports, so scripts/qa/__tests__ can test them with
 * plain node: what counts as provider trouble, what is a timeout, and what a failed attempt leads to.
 */

/** One request this long is a provider slowdown (healthy stage pages and API calls take 0.1–3 s). */
export const SLOW_MS = 15_000;

export interface ProviderEvent {
  at: number;
  kind: 'gateway' | 'slow' | 'no-answer';
  detail: string;
}

/** Bunny's hosts (Stream API, TUS, CDN pull zones). */
export const isBunnyHost = (host: string): boolean => /(^|\.)(b-cdn\.net|bunnycdn\.com|bunny\.net|mediadelivery\.net)$/.test(host);

/**
 * A status that means "the provider is in trouble", not "our code is wrong": a gateway or edge
 * error (502/503/504, Cloudflare's 520–530), any 5xx from Bunny, or the TUS proxy's 423 (it turns
 * Bunny errors and timeouts into "retry later", tusProxy.ts handleHead). A 500 from our own API
 * and every 4xx are ours.
 */
export function isProviderStatus(host: string, path: string, status: number): boolean {
  if (status === 502 || status === 503 || status === 504 || (status >= 520 && status <= 530)) return true;
  if (status >= 500 && isBunnyHost(host)) return true;
  return status === 423 && /\/api\/videos\/tus\//.test(path);
}

/** What one answer from a provider host says about its health (null: healthy). */
export function classifyAnswer(host: string, path: string, status: number, ms: number): ProviderEvent['kind'] | null {
  if (isProviderStatus(host, path, status)) return 'gateway';
  if (ms > SLOW_MS) return 'slow';
  return null;
}

/** A Playwright timeout: an action, a navigation, a wait, or an expect that ran out of time. */
export function isTimeout(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { name?: string; message?: string };
  return e.name === 'TimeoutError' || /Timeout:? \d+ ?ms exceeded|timed out/i.test(e.message ?? '');
}

/**
 * After attempt `index` (1 or 2) failed with `error` while `trouble` was recorded:
 * - fail: not a timeout and no provider error (a value, a 4xx, a permission or state error, our 500),
 *   or attempt 2 timed out while every provider answered promptly;
 * - retry: attempt 1 failed on a timeout or while a provider answered a gateway error;
 * - skip: attempt 2 failed the same way and the provider was measurably in trouble meanwhile (#929).
 */
export function decideAfterFailure(index: number, error: unknown, trouble: readonly ProviderEvent[]): 'fail' | 'retry' | 'skip' {
  const retryable = isTimeout(error) || trouble.some((e) => e.kind === 'gateway');
  if (!retryable) return 'fail';
  if (index === 1) return 'retry';
  return trouble.length > 0 ? 'skip' : 'fail';
}

/**
 * A TUS answer from our upload proxy that means Bunny is in trouble, not our code: a transient
 * upstream error (503 with `retryable`, the proxy's "retry later"), a gateway error, the HEAD's 423,
 * or Bunny saying a just-created upload is gone (404/410 with the proxy's "Upload failed" body).
 * Our own "Upload not found" (no session), a 403, a 415 or a 500 stays a failure.
 */
export function isProviderUploadFailure(status: number, body: string): boolean {
  if (status === 502 || status === 503 || status === 504 || (status >= 520 && status <= 530) || status === 423) return true;
  return (status === 404 || status === 410) && /"error"\s*:\s*"Upload failed"/.test(body);
}
