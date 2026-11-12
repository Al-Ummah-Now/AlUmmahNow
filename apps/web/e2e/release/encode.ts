import { test } from '@playwright/test';

/**
 * Owner rule (2026-11-12): a slow third-party encode is not a functional failure of our code.
 * `wait` is a spec's wait for Bunny's encode. If it times out while the video is still encoding
 * (`stillEncoding` says so), the test is skipped with the reason and #929. Anything else (an
 * encode that failed, wrong behaviour once encoded, a non-timeout error) still fails.
 */
export async function untilEncoded(what: string, wait: () => Promise<unknown>, stillEncoding: () => Promise<boolean>): Promise<void> {
  try {
    await wait();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/Timeout:? \d+ ?ms|timed out/i.test(message) || !(await stillEncoding().catch(() => false))) throw error;
    test.info().annotations.push({ type: 'encode-timeout', description: `${what} (#929)` });
    test.skip(true, `${what}: Bunny did not finish encoding in time, a slow third-party encode, not a product failure (https://github.com/Al-Ummah-Now/AlUmmahNow/issues/929)`);
  }
}

/** An upload status that means Bunny has not finished (neither ready nor failed). */
export const encoding = (status: string | undefined | null) => !!status && status !== 'ready' && status !== 'failed';
