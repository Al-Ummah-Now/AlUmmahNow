/**
 * Tells a Bunny encoder outage apart from a bug of ours, for the specs that wait for an
 * upload to become ready (upload-modes, processing.player).
 *
 * QA and stage share one Bunny library. On 2026-11-10 Bunny reported "Partially Degraded
 * Service" and left every QA/stage upload at "processing, 0%" for the whole wait, so those
 * specs failed every PR and every release although our processing-check loop ran on time.
 *
 * Called once, only after the wait for ready has run out: GET /api/videos/:id/upload-status
 * asks Bunny itself (and would mark the video ready if Bunny had finished, which is why the
 * specs never call it while they wait). The verdict:
 *  - Bunny has not started encoding (still processing, 0%, no resolution) → an outage outside
 *    our code: the caller skips with this reason.
 *  - anything else (Bunny finished, failed, or partly encoded) → our bug or a real failure:
 *    the caller rethrows the original timeout, so the release stays blocked.
 */
import { apiFetch, type WebUser } from './web-session';

export interface EncoderVerdict {
  stalled: boolean;
  detail: string;
}

export async function bunnyEncoderVerdict(user: Pick<WebUser, 'accessToken'>, videoId: string, channelId?: string): Promise<EncoderVerdict> {
  const res = await apiFetch(user, `/api/videos/${videoId}/upload-status`, channelId ? { headers: { channelId } } : {});
  if (!res.ok) return { stalled: false, detail: `upload-status ${res.status}` };
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const s = ((body.result ?? body) as {
    status?: string;
    encodingStatus?: { isProcessing?: boolean; encodingProgress?: number; availableResolutions?: string[] };
  }) ?? {};
  const enc = s.encodingStatus;
  const notStarted = s.status === 'processing' && !!enc?.isProcessing && (enc.encodingProgress ?? 0) === 0 && (enc.availableResolutions?.length ?? 0) === 0;
  return {
    stalled: notStarted,
    detail: `status ${s.status}, Bunny ${enc ? `${enc.isProcessing ? 'processing' : 'idle'} ${enc.encodingProgress ?? '?'}%, ${enc.availableResolutions?.length ?? 0} resolutions` : 'no answer'}`,
  };
}

/**
 * Runs the wait for ready; if it times out and Bunny never started encoding any of the
 * videos still not ready, returns the skip reason instead of failing. Otherwise rethrows.
 */
export async function waitForReadyOrEncoderOutage(
  wait: () => Promise<void>,
  notReady: () => Promise<string[]>,
  user: Pick<WebUser, 'accessToken'>,
  channelId?: string,
): Promise<string | null> {
  try {
    await wait();
    return null;
  } catch (error) {
    const pending = await notReady().catch(() => [] as string[]);
    if (!pending.length) throw error;
    const verdicts = await Promise.all(pending.map((id) => bunnyEncoderVerdict(user, id, channelId).catch((e) => ({ stalled: false, detail: String(e) }))));
    if (verdicts.every((v) => v.stalled)) {
      return `Bunny encoder outage: ${pending.length} upload(s) never started encoding during the wait (${verdicts.map((v) => v.detail).join('; ')}). Not a failure of our processing loop; re-run once Bunny recovers.`;
    }
    throw error;
  }
}
