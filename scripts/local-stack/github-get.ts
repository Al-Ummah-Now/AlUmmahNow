/**
 * GETs of GitHub's API and release assets for the local stack, waiting out GitHub's own trouble: 5xx, 429 and network
 * errors (a body cut off too) are tried again with growing pauses, or after what Retry-After asks, for about three
 * minutes. Any other status is the answer, at once.
 */
export const RETRY_MS = 180_000;
/** One try at most, and never past RETRY_MS: a connection that hangs is a network error. */
export const TRY_MS = 120_000;
const FIRST_PAUSE_MS = 2_000;
const MAX_PAUSE_MS = 30_000;
/** The least that Retry-After means, and the random part added to it. */
const ASKED_MIN_MS = 1_000;
const ASKED_JITTER_MS = 1_000;
/** A try with less time than this left is not started. */
const MIN_TRY_MS = 1_000;

export interface GetDeps {
  fetch: typeof fetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
  timeout: (ms: number) => AbortSignal;
  log: (line: string) => void;
}

const real: GetDeps = {
  fetch: (...args) => fetch(...args),
  now: Date.now,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  random: Math.random,
  timeout: (ms) => AbortSignal.timeout(ms),
  log: (line) => void process.stderr.write(`${line}\n`),
};

/** A status that is not retried, or still there at the end. */
export class HttpStatusError extends Error {
  readonly status: number;
  constructor(url: string, status: number, note = '') {
    super(`GET ${url} answered ${status}${note}`);
    this.status = status;
  }
}

/** What Retry-After asks (seconds or a date), in ms; null when it says nothing usable. */
export function retryAfterMs(value: string | null, now: number): number | null {
  if (!value?.trim()) return null;
  if (/^\d+$/.test(value.trim())) return Number(value.trim()) * 1000;
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

/** GETs `url` and reads the answer with `read`, which is part of the try. */
export async function githubGet<T>(url: string, opts: { accept: string; token?: string | undefined; read: (res: Response) => Promise<T> }, deps: Partial<GetDeps> = {}): Promise<T> {
  const d = { ...real, ...deps };
  const start = d.now();
  for (let tries = 1; ; tries++) {
    let failure: Error;
    let asked: number | null = null;
    try {
      const res = await d.fetch(url, {
        headers: { Accept: opts.accept, ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
        redirect: 'follow',
        signal: d.timeout(Math.min(TRY_MS, RETRY_MS - (d.now() - start))),
      });
      if (res.ok) return await opts.read(res);
      failure = new HttpStatusError(url, res.status, tries > 1 ? ` (try ${tries})` : '');
      asked = retryAfterMs(res.headers.get('retry-after'), d.now());
      await res.body?.cancel().catch(() => undefined);
      if (res.status < 500 && res.status !== 429) throw failure;
    } catch (error) {
      if (error instanceof HttpStatusError) throw error;
      failure = new Error(`GET ${url} failed: ${(error as Error).message}`, { cause: error });
    }
    // Half of the pause is random (a second on top of what Retry-After asks): several jobs that failed together do not come back together
    const backoff = Math.min(FIRST_PAUSE_MS * 2 ** (tries - 1), MAX_PAUSE_MS);
    const pause = Math.round(asked === null ? backoff * (0.5 + d.random() / 2) : Math.max(asked, ASKED_MIN_MS) + d.random() * ASKED_JITTER_MS);
    const waited = d.now() - start;
    if (waited + pause + MIN_TRY_MS > RETRY_MS) {
      failure.message += `; gave up after ${tries} ${tries === 1 ? 'try' : 'tries'} in ${Math.round(waited / 1000)} s${asked !== null ? ` (Retry-After ${Math.round(asked / 1000)} s)` : ''}`;
      throw failure;
    }
    d.log(`[local-stack] ${failure.message}; trying again in ${Math.round(pause / 1000)} s`);
    await d.sleep(pause);
  }
}
