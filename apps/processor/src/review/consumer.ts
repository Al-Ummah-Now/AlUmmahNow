/**
 * Review queue consumer (MessageType.VideoReviewScan / VideoReviewAppeal on the moderation queue;
 * docs/specs/VIDEO-REVIEW.md §4).
 *
 * Idempotent: a redelivered scan whose row already has a result re-sends the outcome instead of
 * calling the models again. Fail safe: a provider error is retried by the queue; on the last
 * attempt the review routes as `check_failed` (held for a person), never approved.
 */
import type { Logger } from '@al-ummah/logger';
import {
  MessageType,
  publishAdminLive,
  routeReview,
  type D1Database,
  type ReviewOutcomeRequest,
  type ReviewRouting,
  type VideoReviewAppealPayload,
  type VideoReviewScanPayload,
} from '@al-ummah/shared-types';
import { reserveBudget, settleBudget } from '../moderation/budget';
import { neuronsFor, usdFor, USD_PER_NEURON } from '../moderation/pricing';
import { recordUsage } from '../moderation/usage';
import { FixtureModerationProvider, ProviderError, WorkersAiModerationProvider, fixtureFrom, type AiRunner, type ModerationProvider, type Usage } from './provider';
import { runReviewPipeline, type ReviewMediaBucket } from './pipeline';
import { alertRecipients, finishReviewRow, getReviewRow, openAppealRow, startReviewRow } from './store';

export const REVIEW_FEATURE = 'video_review';

export interface ReviewConsumerEnv {
  REPORTS_DB: D1Database;
  AI?: AiRunner;
  /** MEDIA_PRIVATE: frames, audio and manifests under review/ */
  REVIEW_MEDIA?: ReviewMediaBucket & { put?(key: string, value: string, options?: unknown): Promise<unknown> };
  /** api-videos (service binding): /internal/review/:videoId/outcome */
  VIDEOS?: { fetch(input: RequestInfo, init?: RequestInit): Promise<Response> };
  INTERNAL_API_KEY?: string | { get(): Promise<string> };
  MESSAGE_QUEUE?: { send(message: unknown): Promise<unknown> };
  WEBSOCKET_URL?: string;
  AI_GATEWAY_ID?: string;
  /** "fixture" on the local stack: deterministic answers, never a model (owner rule) */
  REVIEW_PROVIDER?: string;
  VIDEO_REVIEW_ALLOWED?: string;
  NODE_ENV?: string;
  CI?: string;
  E2E_ENV?: string;
}

export type ReviewScanOutcome = { status: 'done'; route?: string } | { status: 'retry'; error: string };

export function isReviewScanPayload(value: unknown): value is VideoReviewScanPayload {
  const p = value as VideoReviewScanPayload | null;
  return !!p && typeof p.videoId === 'string' && typeof p.reviewId === 'string' && !!p.settings && typeof p.mode === 'string';
}

export function isReviewAppealPayload(value: unknown): value is VideoReviewAppealPayload {
  const p = value as VideoReviewAppealPayload | null;
  return !!p && typeof p.videoId === 'string' && typeof p.reviewId === 'string' && typeof p.appealReviewId === 'string';
}

/** The provider for this environment: fixtures on the local stack, Workers AI in production. */
export function providerFor(env: ReviewConsumerEnv, payload: VideoReviewScanPayload): ModerationProvider {
  if (env.REVIEW_PROVIDER === 'fixture') return new FixtureModerationProvider(fixtureFrom(payload.metadataText), 0);
  if (!env.AI) throw new ProviderError('AI binding missing', false);
  return new WorkersAiModerationProvider(env.AI, payload.settings.models, env);
}

async function secret(value: ReviewConsumerEnv['INTERNAL_API_KEY']): Promise<string> {
  return typeof value === 'string' ? value : ((await value?.get()) ?? '');
}

async function sendOutcome(env: ReviewConsumerEnv, p: VideoReviewScanPayload, routing: Pick<ReviewRouting, 'route' | 'risk' | 'nsfw' | 'escalate' | 'holdCause'>, findingsCount: number): Promise<void> {
  if (!env.VIDEOS) throw new ProviderError('VIDEOS service binding missing', true);
  const body: ReviewOutcomeRequest = { reviewId: p.reviewId, mode: p.mode, timing: p.timing, routing, findingsCount, checkedAt: new Date().toISOString() };
  const res = await env.VIDEOS.fetch(`https://videos.internal/internal/review/${encodeURIComponent(p.videoId)}/outcome`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-API-Key': await secret(env.INTERNAL_API_KEY) },
    body: JSON.stringify(body),
  });
  // 409: a newer review or a person already decided: nothing to apply, not an error
  if (!res.ok && res.status !== 409) throw new ProviderError(`outcome not applied (${res.status})`, true);
}

/** Alerts on a hold: the live admin queue at once, and an in-app + push notice per subscriber (VR6). */
async function alertReviewers(env: ReviewConsumerEnv, p: VideoReviewScanPayload, routing: ReviewRouting, title: string, logger: Logger): Promise<void> {
  await publishAdminLive(env as never, 'moderation', { kind: 'review_needed', key: `review:${p.reviewId}`, reviewId: p.reviewId, videoId: p.videoId, escalated: routing.escalate, holdCause: routing.holdCause ?? null }).catch(() => false);
  if (!env.MESSAGE_QUEUE) return;
  const recipients = await alertRecipients(env.REPORTS_DB, routing.escalate);
  for (const userId of recipients) {
    await env.MESSAGE_QUEUE.send({
      id: crypto.randomUUID(),
      type: MessageType.NotificationCreate,
      payload: {
        notificationId: crypto.randomUUID(),
        recipientUserId: userId,
        notificationKey: 'reviewNeeded',
        params: { videoTitle: title, escalated: routing.escalate ? 1 : 0 },
        actionUrl: `/moderation/review/${p.reviewId}`,
        entityId: p.reviewId,
        dedupeKey: `review-needed:${p.reviewId}`,
        createdAt: Date.now(),
      },
      timestamp: Date.now(),
    }).catch((error: unknown) => logger.warn('[Review] Reviewer alert not queued', { userId, reviewId: p.reviewId, error: error instanceof Error ? error.message : String(error) }));
  }
}

/** Worst case for one scan, reserved before any call (Epic 28 budget pattern). */
export function estimateReviewNeurons(p: VideoReviewScanPayload, frames: number, audioSeconds: number): number {
  const m = p.settings.models;
  return (
    neuronsFor(m.frames, frames * 1000, 0) +
    neuronsFor(m.imageReview, 21 * 1500, 21 * 120) +
    neuronsFor(m.transcribe, audioSeconds, 0) +
    neuronsFor(m.textPolicy, (p.metadataText.length + audioSeconds * 20) / 2, 2000) +
    neuronsFor(m.textGuard, (p.metadataText.length + audioSeconds * 20) / 3, 100)
  );
}

async function settle(db: D1Database, logger: Logger, usage: Usage[], now: number): Promise<{ neurons: number; models: string[] }> {
  let neurons = 0;
  const models = new Set<string>();
  for (const u of usage) {
    models.add(u.model);
    if (u.model.startsWith('fixture/')) continue;
    neurons += await recordUsage(db, logger, { model: u.model, inputTokens: u.inputUnits, outputTokens: u.outputUnits, surface: 'video_review', feature: REVIEW_FEATURE }, now);
  }
  return { neurons, models: [...models] };
}

export async function handleVideoReviewScan(
  p: VideoReviewScanPayload,
  env: ReviewConsumerEnv,
  logger: Logger,
  opts: { lastAttempt: boolean; now?: number; fetchImpl?: typeof fetch } = { lastAttempt: true },
): Promise<ReviewScanOutcome> {
  const db = env.REPORTS_DB;
  const now = opts.now ?? Date.now();
  if (env.VIDEO_REVIEW_ALLOWED !== 'true' && env.REVIEW_PROVIDER !== 'fixture') {
    // QA, stage: never (api-videos does not queue scans there either)
    logger.warn('[Review] Scan received where review is not allowed; dropped', { videoId: p.videoId });
    return { status: 'done' };
  }
  await startReviewRow(db, p, new Date(now).toISOString());

  // Redelivery after the result was stored: only the outcome is sent again
  const existing = await getReviewRow(db, p.reviewId);
  if (existing?.checked_at && existing.route) {
    if (p.mode !== 'shadow') {
      try {
        await sendOutcome(env, p, { route: existing.route as 'approve' | 'hold', risk: existing.risk ?? 0, nsfw: !!existing.nsfw, escalate: !!existing.escalate, holdCause: (existing.hold_cause ?? undefined) as ReviewRouting['holdCause'] }, 0);
      } catch (error) {
        return { status: 'retry', error: error instanceof Error ? error.message : String(error) };
      }
    }
    return { status: 'done', route: existing.route };
  }

  // Budget (VR14): reserve the worst case; at the stop the video goes to a person
  const manifestFrames = p.settings.maxFrames;
  const audioSeconds = 2 * 60 * 60;
  const estimate = estimateReviewNeurons(p, manifestFrames, audioSeconds);
  const capNeurons = p.settings.dailyBudgetUsd / USD_PER_NEURON;
  const reserved = await reserveBudget(db, capNeurons, estimate, now, REVIEW_FEATURE);

  let routing: ReviewRouting;
  let partial = false;
  let models: string[] = [];
  let costUsd = 0;
  let findings: Awaited<ReturnType<typeof runReviewPipeline>>['findings'] = [];
  if (!reserved) {
    routing = routeReview([], p.settings, { mode: p.mode === 'shadow' ? 'enforce' : p.mode, budgetStopped: true });
    logger.warn('[Review] Daily review budget reached; held for a person', { videoId: p.videoId, budgetUsd: p.settings.dailyBudgetUsd });
  } else {
    const usage: Usage[] = [];
    try {
      const provider = providerFor(env, p);
      const result = await runReviewPipeline(p, { provider, media: env.REVIEW_MEDIA, fetchImpl: opts.fetchImpl, usage });
      findings = result.findings;
      partial = result.partial;
      // A partial upload check never approves: frames and speech were not seen (fail safe)
      const checkFailed = partial && p.trigger !== 'metadata_edit';
      routing = routeReview(findings, p.settings, { mode: p.mode === 'shadow' ? 'enforce' : p.mode, checkFailed });
      if (result.transcript.length && p.manifestKey && env.REVIEW_MEDIA?.put) {
        // VR11: the creator may claim it as a caption draft; purged with the review media
        await env.REVIEW_MEDIA.put(p.manifestKey.replace(/manifest\.json$/, 'transcript.json'), JSON.stringify({ videoId: p.videoId, reviewId: p.reviewId, segments: result.transcript }), { httpMetadata: { contentType: 'application/json' } }).catch(() => undefined);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const retryable = !(error instanceof ProviderError) || error.retryable;
      if (retryable && !opts.lastAttempt) {
        const settled = await settle(db, logger, usage, now);
        await settleBudget(db, estimate, settled.neurons, now, REVIEW_FEATURE);
        logger.warn('[Review] Check failed, will retry', { videoId: p.videoId, error: message });
        return { status: 'retry', error: message };
      }
      logger.error('[Review] Check failed for good; held for a person', { videoId: p.videoId, error: message });
      findings = [];
      routing = routeReview([], p.settings, { mode: p.mode === 'shadow' ? 'enforce' : p.mode, checkFailed: true });
    }
    const settled = await settle(db, logger, usage, now);
    await settleBudget(db, estimate, settled.neurons, now, REVIEW_FEATURE);
    models = settled.models;
    costUsd = usdFor(settled.neurons);
  }

  // Shadow mode records what would have happened, as enforce would have routed it
  await finishReviewRow(db, p, { routing, findings, partial, models, costUsd, mediaRetentionDays: p.settings.mediaRetentionDays }, new Date(now));
  logger.info('[Review] Checked', { videoId: p.videoId, reviewId: p.reviewId, mode: p.mode, route: routing.route, nsfw: routing.nsfw, escalate: routing.escalate, partial, costUsd: Math.round(costUsd * 1e5) / 1e5 });
  if (p.mode === 'shadow') return { status: 'done', route: routing.route };

  try {
    await sendOutcome(env, p, routing, findings.length);
  } catch (error) {
    return { status: 'retry', error: error instanceof Error ? error.message : String(error) };
  }
  if (routing.route === 'hold') await alertReviewers(env, p, routing, (p.metadataText.split('\n')[0] ?? '').slice(0, 120), logger);
  return { status: 'done', route: routing.route };
}

export async function handleVideoReviewAppeal(a: VideoReviewAppealPayload, env: ReviewConsumerEnv, logger: Logger): Promise<void> {
  await openAppealRow(env.REPORTS_DB, a);
  await publishAdminLive(env as never, 'moderation', { kind: 'review_needed', key: `review:${a.appealReviewId}`, reviewId: a.appealReviewId, videoId: a.videoId, appeal: true }).catch(() => false);
  logger.info('[Review] Appeal opened', { videoId: a.videoId, reviewId: a.reviewId, appealReviewId: a.appealReviewId });
}
