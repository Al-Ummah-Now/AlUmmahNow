/**
 * Retries for transient R2/KV errors.
 *
 * R2 and KV sometimes fail a call with an internal error that succeeds when
 * tried again a moment later, e.g. "list: We encountered an internal error.
 * Please try again. (10001)". Such a call is retried a couple of times with
 * a short jittered backoff. Anything else (a missing binding, a bad argument,
 * a parse error) is not transient and is thrown at once, unchanged.
 */

/** R2 error codes that mean "try again": internal error, service unavailable, rate limited */
const TRANSIENT_CODES = new Set(['10001', '10043', '10054', '10058']);
const TRANSIENT_MESSAGE = /internal error|please try again|temporarily unavailable|service unavailable|network connection lost|connection reset|timed out|reduce your (concurrent )?request rate/i;

/** The 5-digit R2 error code at the end of the message, e.g. "(10001)" */
export function storageErrorCode(error: unknown): string | undefined {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return /\((\d{5})\)\s*$/.exec(message)?.[1];
}

export function isTransientStorageError(error: unknown): boolean {
  // A TypeError is a programming or binding problem (e.g. reading .list of undefined), never transient
  if (!(error instanceof Error) || error instanceof TypeError) return false;
  if (error instanceof TransientStorageError) return true;
  const code = storageErrorCode(error);
  if (code) return TRANSIENT_CODES.has(code);
  return TRANSIENT_MESSAGE.test(error.message);
}

/** A storage call that still failed transiently after every retry. */
export class TransientStorageError extends Error {
  readonly code?: string;
  readonly attempts: number;
  readonly cause: unknown;
  constructor(op: string, cause: unknown, attempts: number) {
    const message = cause instanceof Error ? cause.message : String(cause);
    // R2 messages already name the operation ("list: We encountered ...")
    super(message.startsWith(`${op}:`) ? message : `${op}: ${message}`);
    this.cause = cause;
    this.name = 'TransientStorageError';
    this.code = storageErrorCode(cause);
    this.attempts = attempts;
  }
}

/** Retry settings: 2 retries, ~100 ms then ~200 ms (±50% jitter), well inside a one-minute cron run. */
export const STORAGE_RETRY = { retries: 2, baseDelayMs: 100 };

/**
 * Run `fn`, retrying transient storage errors. After the last retry the error
 * is thrown as a TransientStorageError; a non-transient error is thrown as is.
 */
export async function withStorageRetry<T>(op: string, fn: () => Promise<T>, opts: { retries?: number; baseDelayMs?: number } = {}): Promise<T> {
  const retries = opts.retries ?? STORAGE_RETRY.retries;
  const baseDelayMs = opts.baseDelayMs ?? STORAGE_RETRY.baseDelayMs;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (!isTransientStorageError(error)) throw error;
      if (attempt >= retries) throw error instanceof TransientStorageError ? error : new TransientStorageError(op, error, attempt + 1);
      const delay = baseDelayMs * 2 ** attempt * (0.5 + Math.random());
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
