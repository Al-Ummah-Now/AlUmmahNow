/**
 * Retry of selected videos: an R2 failure transcodes again, anything else restarts Bunny's processing check.
 * Both are queued and audited by admin-api. Says why not when one of them is refused.
 */
import type { VideoFailure } from '@al-ummah/shared-types';
import { retryMediaJobs, retryProcessing } from '@/lib/api/admin';
import type { ActionResult } from '@/lib/api/errors';
import { splitRetry } from './video-failure';

/** admin-api takes this many ids per transcode retry */
const MEDIA_IDS = 50;

export async function retryFailed(ids: readonly string[], failures: Readonly<Record<string, VideoFailure>>, r2Failed?: ReadonlySet<string>): Promise<ActionResult<unknown>> {
  const { r2, bunny } = splitRetry(ids, failures, r2Failed);
  let result: ActionResult<unknown> = { ok: true, data: null };
  if (bunny.length) result = await retryProcessing(bunny);
  for (let i = 0; i < r2.length && result.ok; i += MEDIA_IDS) result = await retryMediaJobs(r2.slice(i, i + MEDIA_IDS));
  return result;
}
