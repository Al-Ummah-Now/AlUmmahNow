/**
 * Pre-publication review gate (wiki AUN-VIDEO-REVIEW, docs/specs/VIDEO-REVIEW.md §3).
 *
 * Decides the `review` state a video starts with when it enters processing. With the settings'
 * mode `off` (the default) or outside production (VIDEO_REVIEW_ALLOWED unset: QA, stage, local),
 * this returns null and nothing changes. In both enforce modes every channel's upload starts
 * `checking` (VR1) and is visible to nobody but its owner until the automated check clears it;
 * an admin-granted trusted channel starts `post_review` (public now, checked afterwards).
 */
import {
  effectiveReviewMode,
  initialReviewState,
  readVideoReviewSettings,
  type ReviewSettingsBucket,
  type VideoReviewMode,
  type VideoReviewSettings,
  type VideoReviewState,
} from '@al-ummah/shared-types';
import { logger } from '../logger';

export interface ReviewGateEnv {
  global_settings?: unknown;
  channels?: R2Bucket;
  /** "true" only in the production wrangler config */
  VIDEO_REVIEW_ALLOWED?: string;
}

/** The channel field an admin sets to grant post-hoc review (admin-api channel page). */
export interface ReviewTrustFields {
  reviewTrusted?: boolean;
}

export interface ReviewGate {
  mode: VideoReviewMode;
  settings: VideoReviewSettings;
  /** The state to write on the video, or null (not gated) */
  state: VideoReviewState | null;
}

/** Reads the settings and the channel's trust; never throws (a failure means "not gated", logged). */
export async function reviewGateFor(env: ReviewGateEnv, video: { channelId?: string | null }, now = new Date()): Promise<ReviewGate> {
  const settings = await readVideoReviewSettings(env.global_settings as ReviewSettingsBucket | undefined);
  const mode = effectiveReviewMode(settings, env.VIDEO_REVIEW_ALLOWED);
  if (mode === 'off' || mode === 'shadow') return { mode, settings, state: null };
  let trusted = false;
  if (video.channelId && env.channels) {
    try {
      const channel = (await (await env.channels.get(video.channelId))?.json<ReviewTrustFields>()) ?? null;
      trusted = channel?.reviewTrusted === true;
    } catch (error) {
      // Fail safe: an unreadable channel is not trusted, so the video is checked before publishing
      logger.warn('[Review] Channel trust could not be read; checking before publishing', { channelId: video.channelId, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { mode, settings, state: initialReviewState(mode, { trusted, reviewId: crypto.randomUUID(), now, settings }) };
}
