/**
 * Pre-publication video review (wiki AUN-VIDEO-REVIEW, AlUmmahNow docs/specs/VIDEO-REVIEW.md).
 *
 * Every production upload is checked by open-weight models (Workers AI) before anyone but its
 * owner can see it. Low risk: approved automatically. Flagged, any NSFW hit, or a failed check:
 * held for a person. Owner decisions VR1–VR16 (2026-11-13) are the rules here.
 *
 * This module is the contract shared by api-videos (owns the video's review state and the
 * settings), the processor (runs the checks, writes the findings), the media transcoder (extracts
 * frames and audio), admin-api (the review queue, web and native) and the web app (Studio badges).
 * Everything here is pure: no Workers runtime.
 */

// ---------------------------------------------------------------------------
// State on the video record
// ---------------------------------------------------------------------------

/**
 * Where a video is in review. A video with no `review` field was never reviewed (QA, stage,
 * mode off, older videos): it is "not required" and visible as before.
 *
 * - checking:    the automated check is running (creator sees "usually within N minutes")
 * - in_review:   held for a person (flagged, NSFW, check failed or budget stop)
 * - approved:    cleared (automatically or by a reviewer)
 * - rejected:    a reviewer decided it breaks the guidelines; stays private to its owner
 * - appealed:    the creator appealed a rejection; waits for a different reviewer
 * - post_review: a trusted channel (admin-granted): public now, checked afterwards. An NSFW hit
 *                pulls it back to in_review (VR2)
 */
export type VideoReviewStatus = 'checking' | 'in_review' | 'approved' | 'rejected' | 'appealed' | 'post_review';

export const VIDEO_REVIEW_STATUSES = ['checking', 'in_review', 'approved', 'rejected', 'appealed', 'post_review'] as const satisfies readonly VideoReviewStatus[];

/** How the check was routed: before publishing (every channel, VR1) or after (trusted channels). */
export type VideoReviewTiming = 'pre' | 'post';

/** Why a video waits for a person (shown to admins; the creator only sees "a reviewer will check it"). */
export type VideoReviewHoldCause = 'nsfw' | 'risk' | 'escalation' | 'check_failed' | 'budget' | 'appeal';

/** The `review` field of a stored video. Written only by api-videos (`/internal/review/*`). */
export interface VideoReviewState {
  status: VideoReviewStatus;
  /** The current review row (reports D1 `video_reviews.id`) */
  reviewId: string;
  timing: VideoReviewTiming;
  /** When this status started (ISO) */
  since: string;
  /** checking: when the automated check is expected to finish (ISO; since + settings.etaMinutes) */
  etaAt?: string;
  /** in_review: why it waits for a person (admins only) */
  holdCause?: VideoReviewHoldCause;
  /** rejected: the reason shown to the creator (REVIEW_REASON_CODES) */
  reasonCode?: VideoReviewReasonCode;
  /** When a person decided (ISO) */
  decidedAt?: string;
  /** A rejection was appealed once already (VR10: one appeal) */
  appealUsed?: boolean;
  /** When the scan for this review was queued (one scan per review) */
  scanQueuedAt?: string;
  /** The transcoder's review media manifest (resubmits reuse it until the media is purged) */
  manifestKey?: string;
  /** Before a person decided: the status to restore on undo */
  previousStatus?: VideoReviewStatus;
}

/** A shadow-mode scan was queued for this video (shadow never writes `review`). */
export interface VideoReviewShadowMarker {
  reviewId: string;
  queuedAt: string;
}

/**
 * Cleared for everyone else: never reviewed, approved, or a trusted channel's post-hoc review.
 * The shared visibility rule (video-visibility.ts isVideoReady) calls this.
 */
export function isReviewCleared(review: { status?: VideoReviewStatus | string } | null | undefined): boolean {
  return !review || review.status === 'approved' || review.status === 'post_review';
}

/** Still waiting for the automated check or a person (Studio's "In review" badge). */
export function isReviewPending(review: { status?: VideoReviewStatus | string } | null | undefined): boolean {
  return !!review && (review.status === 'checking' || review.status === 'in_review' || review.status === 'appealed');
}

// ---------------------------------------------------------------------------
// Reasons a reviewer gives (fixed list, en/ar text in the i18n catalogues: videoReview.reason.<code>)
// ---------------------------------------------------------------------------

/** Each maps to a Community Guidelines section (shared-types i18n-community-guidelines.ts). */
export const REVIEW_REASON_CODES = {
  sexual: 'prohibited',
  child_safety: 'prohibited',
  graphic_violence: 'prohibited',
  self_harm: 'prohibited',
  hate: 'prohibited',
  violent_extremism: 'prohibited',
  harassment: 'respect',
  spam_scam: 'prohibited',
  impersonation: 'prohibited',
  privacy: 'prohibited',
  copyright: 'prohibited',
  misleading_metadata: 'creators',
  religious_misattribution: 'knowledge',
  other: 'enforcement',
} as const;

export type VideoReviewReasonCode = keyof typeof REVIEW_REASON_CODES;

export function isReviewReasonCode(value: unknown): value is VideoReviewReasonCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(REVIEW_REASON_CODES, value);
}

// ---------------------------------------------------------------------------
// Settings (admin-managed; global_settings R2 `video-review/settings.json`)
// ---------------------------------------------------------------------------

/**
 * - off:          nothing runs (default; QA and stage are always off: VIDEO_REVIEW_ALLOWED)
 * - shadow:       every new upload is checked and logged ("would hold"); nothing is held
 * - enforce_nsfw: only NSFW hits hold; everything else is approved
 * - enforce:      full routing (VR1)
 */
export type VideoReviewMode = 'off' | 'shadow' | 'enforce_nsfw' | 'enforce';

export const VIDEO_REVIEW_MODES = ['off', 'shadow', 'enforce_nsfw', 'enforce'] as const satisfies readonly VideoReviewMode[];

/** The R2 key in the `global_settings` bucket (api-videos, admin-api and the processor read it). */
export const VIDEO_REVIEW_SETTINGS_KEY = 'video-review/settings.json';

/** Every threshold is admin-configurable (VR5). Scores are probabilities in [0, 1]. */
export interface VideoReviewThresholds {
  /** Auto-approve only when the overall risk is below this */
  autoApproveRisk: number;
  /** Auto-approve only when every NSFW score is below this */
  nsfwClear: number;
  /** Stage 1 (every frame): a frame scoring at least this goes to stage 2 */
  nsfwScreen: number;
  /** Stage 2 (or the text pass): an NSFW hit at or above this always holds (VR2) */
  nsfwHit: number;
  /** violent_extremism or a minor with any sexual score above this: escalate to the senior role */
  escalate: number;
  /** Per text category (Llama Guard / platform categories): a score at or above this flags it */
  textFlag: number;
}

export interface VideoReviewSettings {
  mode: VideoReviewMode;
  thresholds: VideoReviewThresholds;
  /** Creator ETA for the automated check (VR6: "usually within 5 minutes") */
  etaMinutes: number;
  /** Frame sampling (VR4) */
  frameIntervalSeconds: number;
  sceneThreshold: number;
  maxFrames: number;
  /** Daily AI budget for video review in USD; at the stop, videos queue for a person (VR14) */
  dailyBudgetUsd: number;
  /** Media (frames, audio, transcript) kept this many days after the decision or appeal (VR12) */
  mediaRetentionDays: number;
  /** Model ids (Workers AI, open weights only; VR3). Changeable without a deploy. */
  models: {
    frames: string;
    imageReview: string;
    transcribe: string;
    textGuard: string;
    textPolicy: string;
  };
  updatedAt?: string;
  updatedBy?: string;
}

export const DEFAULT_VIDEO_REVIEW_SETTINGS: VideoReviewSettings = {
  mode: 'off',
  thresholds: { autoApproveRisk: 0.15, nsfwClear: 0.1, nsfwScreen: 0.2, nsfwHit: 0.5, escalate: 0.3, textFlag: 0.5 },
  etaMinutes: 5,
  frameIntervalSeconds: 2,
  sceneThreshold: 0.3,
  maxFrames: 1200,
  dailyBudgetUsd: 10,
  mediaRetentionDays: 30,
  models: {
    frames: '@cf/cloudflare/clef-flash',
    imageReview: '@cf/google/gemma-4-26b-a4b-it',
    transcribe: '@cf/openai/whisper-large-v3-turbo',
    textGuard: '@cf/meta/llama-guard-3-8b',
    textPolicy: '@cf/google/gemma-4-26b-a4b-it',
  },
};

const clamp = (value: unknown, min: number, max: number, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(Math.max(value, min), max) : fallback;

const modelId = (value: unknown, fallback: string): string =>
  typeof value === 'string' && /^@cf\/[a-z0-9._-]+\/[a-z0-9._-]+$/i.test(value.trim()) ? value.trim() : fallback;

/** Any stored or submitted value → valid settings (unknown fields dropped, out-of-range clamped). */
export function normaliseVideoReviewSettings(input: unknown): VideoReviewSettings {
  const raw = (input && typeof input === 'object' ? input : {}) as Partial<VideoReviewSettings> & { thresholds?: Partial<VideoReviewThresholds>; models?: Partial<VideoReviewSettings['models']> };
  const d = DEFAULT_VIDEO_REVIEW_SETTINGS;
  const t: Partial<VideoReviewThresholds> = raw.thresholds ?? {};
  const m: Partial<VideoReviewSettings['models']> = raw.models ?? {};
  const out: VideoReviewSettings = {
    mode: (VIDEO_REVIEW_MODES as readonly string[]).includes(raw.mode as string) ? (raw.mode as VideoReviewMode) : d.mode,
    thresholds: {
      autoApproveRisk: clamp(t.autoApproveRisk, 0, 1, d.thresholds.autoApproveRisk),
      nsfwClear: clamp(t.nsfwClear, 0, 1, d.thresholds.nsfwClear),
      nsfwScreen: clamp(t.nsfwScreen, 0, 1, d.thresholds.nsfwScreen),
      nsfwHit: clamp(t.nsfwHit, 0, 1, d.thresholds.nsfwHit),
      escalate: clamp(t.escalate, 0, 1, d.thresholds.escalate),
      textFlag: clamp(t.textFlag, 0, 1, d.thresholds.textFlag),
    },
    etaMinutes: Math.round(clamp(raw.etaMinutes, 1, 24 * 60, d.etaMinutes)),
    frameIntervalSeconds: clamp(raw.frameIntervalSeconds, 0.5, 30, d.frameIntervalSeconds),
    sceneThreshold: clamp(raw.sceneThreshold, 0.05, 0.9, d.sceneThreshold),
    maxFrames: Math.round(clamp(raw.maxFrames, 10, 5000, d.maxFrames)),
    dailyBudgetUsd: clamp(raw.dailyBudgetUsd, 0, 1000, d.dailyBudgetUsd),
    mediaRetentionDays: Math.round(clamp(raw.mediaRetentionDays, 1, 365, d.mediaRetentionDays)),
    models: {
      frames: modelId(m.frames, d.models.frames),
      imageReview: modelId(m.imageReview, d.models.imageReview),
      transcribe: modelId(m.transcribe, d.models.transcribe),
      textGuard: modelId(m.textGuard, d.models.textGuard),
      textPolicy: modelId(m.textPolicy, d.models.textPolicy),
    },
  };
  if (typeof raw.updatedAt === 'string') out.updatedAt = raw.updatedAt;
  if (typeof raw.updatedBy === 'string') out.updatedBy = raw.updatedBy;
  return out;
}

/**
 * The mode that applies: always `off` unless the environment allows review. Only the production
 * wrangler configs set VIDEO_REVIEW_ALLOWED="true" (owner 2026-11-13: "we will not test this in
 * QA"); QA, stage, previews and the local stack never run it.
 */
export function effectiveReviewMode(settings: Pick<VideoReviewSettings, 'mode'>, allowed: string | undefined | null): VideoReviewMode {
  return allowed === 'true' ? settings.mode : 'off';
}

/** Whether new uploads are held while they are checked (both enforce modes; NSFW must never show). */
export function holdsWhileChecking(mode: VideoReviewMode): boolean {
  return mode === 'enforce' || mode === 'enforce_nsfw';
}

// ---------------------------------------------------------------------------
// Findings and routing (pure; the processor routes, api-videos applies)
// ---------------------------------------------------------------------------

/** Image categories (frames, thumbnails, post images, avatars). */
export type ImageReviewCategory = 'sexual' | 'gore' | 'disturbing' | 'minor_present';
export const NSFW_IMAGE_CATEGORIES = ['sexual', 'gore', 'disturbing'] as const satisfies readonly ImageReviewCategory[];

/** Text categories: Epic 28's (Llama Guard + platform extensions) plus explicit language. */
export type TextReviewCategory = string;
/** Text categories that count as NSFW (explicit sexual language, VR: owner "flag NSFW") */
export const NSFW_TEXT_CATEGORIES = ['sexual', 'sexual_explicit_language', 'S12'] as const;
/** Categories that escalate to the senior role at the `escalate` threshold */
export const ESCALATE_CATEGORIES = ['violent_extremism', 'child_safety', 'S4', 'S1'] as const;

export type ReviewFindingSource = 'metadata' | 'thumbnail' | 'frame' | 'transcript' | 'image';

/** One scored observation. Only flagged ones are stored (video_review_findings). */
export interface ReviewFinding {
  source: ReviewFindingSource;
  category: string;
  score: number;
  /** frame / transcript: position in the video (ms) */
  atMs?: number;
  /** transcript: end of the span (ms) */
  endMs?: number;
  /** frame / thumbnail / image: the R2 key of the image (MEDIA_PRIVATE review/…) */
  mediaKey?: string;
  /** transcript / metadata: the flagged text (kept with the review, deleted with the media) */
  text?: string;
  /** Quran span found by the captions matcher: excluded from violence and hate scoring */
  quranRef?: string;
  model: string;
  /** Stage 2 rationale, one short sentence */
  rationale?: string;
  /** Severity weight applied in the risk score */
  weight?: number;
}

export type ReviewRoute = 'approve' | 'hold';

export interface ReviewRouting {
  route: ReviewRoute;
  risk: number;
  nsfw: boolean;
  escalate: boolean;
  holdCause?: VideoReviewHoldCause;
  /** The findings that decided it, highest first */
  reasons: ReviewFinding[];
}

/** Severity weights per category (risk = max(score × weight)); NSFW and escalation are separate rules. */
export const CATEGORY_WEIGHTS: Record<string, number> = {
  sexual: 1, gore: 1, disturbing: 0.8, minor_present: 0,
  violent_extremism: 1, child_safety: 1, hate: 0.9, sectarian_hate: 0.9, harassment: 0.7,
  charity_scam: 0.8, spam: 0.5, impersonation: 0.7, misinfo_health: 0.6, self_harm: 0.9,
  sexual_explicit_language: 1, religious_authenticity: 0,
};

const weightOf = (category: string): number => CATEGORY_WEIGHTS[category] ?? 0.6;

/**
 * Route one review (owner decisions VR1, VR2, VR5).
 *
 * - Any NSFW finding at or above `nsfwHit` (image stage 2 or explicit text): hold, always, in
 *   both enforce modes, for trusted channels too.
 * - A minor present together with any sexual score above `escalate`, or violent extremism above
 *   `escalate`: hold and escalate to the senior role.
 * - `enforce_nsfw`: everything else is approved.
 * - `enforce`: approved only when risk < autoApproveRisk and every NSFW score < nsfwClear.
 * - `checkFailed` (a check could not run after its retries) or `budgetStopped`: hold. Never
 *   auto-publish unchecked (fail safe).
 * - Quran spans never count for violence or hate.
 */
export function routeReview(
  findings: readonly ReviewFinding[],
  settings: Pick<VideoReviewSettings, 'thresholds'>,
  ctx: { mode: VideoReviewMode; checkFailed?: boolean; budgetStopped?: boolean },
): ReviewRouting {
  const t = settings.thresholds;
  const counted = findings.filter((f) => !(f.quranRef && ['violent_extremism', 'hate', 'sectarian_hate', 'gore', 'S1', 'S10'].includes(f.category)));
  const scored = counted.map((f) => ({ ...f, weight: weightOf(f.category) })).sort((a, b) => b.score * b.weight - a.score * a.weight);
  const risk = scored.reduce((max, f) => Math.max(max, f.score * f.weight), 0);
  const isNsfwCategory = (f: ReviewFinding) =>
    (NSFW_IMAGE_CATEGORIES as readonly string[]).includes(f.category) || (NSFW_TEXT_CATEGORIES as readonly string[]).includes(f.category);
  const nsfwFindings = scored.filter(isNsfwCategory);
  const nsfw = nsfwFindings.some((f) => f.score >= t.nsfwHit);
  const sexualAbove = scored.some((f) => (f.category === 'sexual' || f.category === 'sexual_explicit_language') && f.score > t.escalate);
  const minor = scored.some((f) => f.category === 'minor_present' && f.score > t.escalate);
  const escalate = (minor && sexualAbove) || scored.some((f) => (ESCALATE_CATEGORIES as readonly string[]).includes(f.category) && f.score > t.escalate);
  const reasons = scored.filter((f) => f.score * f.weight > 0).slice(0, 50);

  const hold = (holdCause: VideoReviewHoldCause): ReviewRouting => ({ route: 'hold', risk, nsfw, escalate, holdCause, reasons });
  if (nsfw) return hold('nsfw');
  if (escalate) return hold('escalation');
  if (ctx.checkFailed) return hold('check_failed');
  if (ctx.budgetStopped) return hold('budget');
  if (ctx.mode === 'enforce_nsfw') return { route: 'approve', risk, nsfw, escalate, reasons };
  const nsfwClear = nsfwFindings.every((f) => f.score < t.nsfwClear);
  if (risk < t.autoApproveRisk && nsfwClear) return { route: 'approve', risk, nsfw, escalate, reasons };
  return hold('risk');
}

// ---------------------------------------------------------------------------
// Review media produced by the transcoder (MEDIA_PRIVATE, `review/<videoId>/<rev>/`)
// ---------------------------------------------------------------------------

export const REVIEW_MEDIA_PREFIX = 'review/';

export function reviewMediaPrefix(videoId: string, rev: string): string {
  return `${REVIEW_MEDIA_PREFIX}${videoId}/${rev}/`;
}

/** `review/<videoId>/<rev>/manifest.json`, written last by the transcoder. */
export interface ReviewMediaManifest {
  videoId: string;
  rev: string;
  durationMs: number;
  /** JPEG frames, ≤ 512 px on the long side, in time order */
  frames: Array<{ key: string; atMs: number; sceneCut: boolean }>;
  /** 16 kHz mono chunks of ≤ 10 minutes (the AUN-CAPTIONS format), in order */
  audio: Array<{ key: string; startMs: number; endMs: number }>;
  /** True when the frame cap was reached and the interval was widened (VR4) */
  capped: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Messages and internal API contracts
// ---------------------------------------------------------------------------

/** api-videos → processor (MODERATION_QUEUE, MessageType.VideoReviewScan). */
export interface VideoReviewScanPayload {
  videoId: string;
  reviewId: string;
  channelId?: string;
  ownerId?: string;
  timing: VideoReviewTiming;
  /** The mode when the scan was queued (shadow: only record; never change the video) */
  mode: Exclude<VideoReviewMode, 'off'>;
  /** Title + description + tags, capped like the Epic 28 scan */
  metadataText: string;
  /** Thumbnail to check (R2 key in MEDIA_PRIVATE or an https URL the processor may fetch) */
  thumbnail?: { key?: string; url?: string };
  /** The transcoder's manifest key; absent when extraction failed (the check is "partial") */
  manifestKey?: string;
  /** What triggered it: a new upload, a metadata edit (text only), a resubmit, a live VOD */
  trigger: 'upload' | 'metadata_edit' | 'resubmit' | 'live_vod' | 'thumbnail';
  /** A settings snapshot (thresholds, models, budget) so a scan is routed by the rules it was queued with */
  settings: VideoReviewSettings;
  queuedAt: string;
}

/** processor → api-videos `POST /internal/review/:videoId/outcome` (X-API-Key). */
export interface ReviewOutcomeRequest {
  reviewId: string;
  mode: Exclude<VideoReviewMode, 'off'>;
  timing: VideoReviewTiming;
  routing: Pick<ReviewRouting, 'route' | 'risk' | 'nsfw' | 'escalate' | 'holdCause'>;
  /** At most 10 top reasons for the creator-facing summary are NOT sent; admins read the D1 rows */
  findingsCount: number;
  checkedAt: string;
}

/** A reviewer's decision (admin-api → api-videos `POST /internal/review/:videoId/decision`). */
export interface ReviewDecisionRequest {
  reviewId: string;
  decision: 'approve' | 'reject' | 'undo';
  reasonCode?: VideoReviewReasonCode;
  /** Optional note to the creator (plain text, ≤ 1,000 chars) */
  note?: string;
  reviewerId: string;
  decidedAt: string;
}

/** The creator's appeal (web/native → api-videos `POST /api/videos/:id/review/appeal`). */
export interface ReviewAppealRequest {
  message: string;
}

/** api-videos → processor (MODERATION_QUEUE, MessageType.VideoReviewAppeal): the processor opens the appeal row. */
export interface VideoReviewAppealPayload {
  videoId: string;
  /** The rejected review */
  reviewId: string;
  /** The new review row for the appeal (video.review.reviewId after the appeal) */
  appealReviewId: string;
  ownerId?: string;
  channelId?: string;
  message: string;
  at: string;
}

/** Transcode job options for review media (TranscodeJobMessage.review). */
export interface ReviewExtractionOptions {
  frameIntervalSeconds: number;
  sceneThreshold: number;
  maxFrames: number;
}

/** Minutes a reviewer may undo a decision (admin UX rule: undo over confirm). */
export const REVIEW_UNDO_MINUTES = 10;

// ---------------------------------------------------------------------------
// Settings storage (global_settings R2): one reader for api-videos, admin-api and the processor
// ---------------------------------------------------------------------------

/** The part of an R2 bucket the settings helpers use (structurally compatible with R2Bucket). */
export interface ReviewSettingsBucket {
  get(key: string): Promise<{ text(): Promise<string> } | null>;
  put(key: string, value: string, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
}

const SETTINGS_CACHE_MS = 30_000;
let settingsCache: { at: number; value: VideoReviewSettings } | null = null;

/** Clears the in-memory copy (tests; a write in this isolate clears it too). */
export function clearVideoReviewSettingsCache(): void {
  settingsCache = null;
}

/**
 * The stored settings, normalised; defaults (mode off) when nothing is stored or it cannot be
 * read. Cached for 30 s per isolate: a mode switch reaches every worker within half a minute.
 */
export async function readVideoReviewSettings(bucket: ReviewSettingsBucket | undefined | null, fresh = false): Promise<VideoReviewSettings> {
  if (!fresh && settingsCache && Date.now() - settingsCache.at < SETTINGS_CACHE_MS) return settingsCache.value;
  let value = DEFAULT_VIDEO_REVIEW_SETTINGS;
  if (bucket) {
    try {
      const object = await bucket.get(VIDEO_REVIEW_SETTINGS_KEY);
      if (object) value = normaliseVideoReviewSettings(JSON.parse(await object.text()));
    } catch {
      // Unreadable settings never turn review on: the defaults (off) apply
      value = DEFAULT_VIDEO_REVIEW_SETTINGS;
    }
  }
  settingsCache = { at: Date.now(), value };
  return value;
}

/** Merges a patch into the stored settings (admin-api only) and returns the result. */
export async function writeVideoReviewSettings(
  bucket: ReviewSettingsBucket,
  patch: Partial<Omit<VideoReviewSettings, 'thresholds' | 'models'>> & { thresholds?: Partial<VideoReviewThresholds>; models?: Partial<VideoReviewSettings['models']> },
  actorId: string,
  now = new Date(),
): Promise<VideoReviewSettings> {
  const current = await readVideoReviewSettings(bucket, true);
  const value = normaliseVideoReviewSettings({
    ...current,
    ...patch,
    thresholds: { ...current.thresholds, ...(patch.thresholds ?? {}) },
    models: { ...current.models, ...(patch.models ?? {}) },
    updatedAt: now.toISOString(),
    updatedBy: actorId,
  });
  await bucket.put(VIDEO_REVIEW_SETTINGS_KEY, JSON.stringify(value), { httpMetadata: { contentType: 'application/json' } });
  settingsCache = { at: Date.now(), value };
  return value;
}

/** Creator-facing ETA: `etaMinutes` after `since` (VR6). */
export function reviewEtaAt(since: Date, settings: Pick<VideoReviewSettings, 'etaMinutes'>): string {
  return new Date(since.getTime() + settings.etaMinutes * 60_000).toISOString();
}

/**
 * The review state a new video starts with, or null when it is not gated:
 * - mode off or shadow: null (nothing is held; shadow still queues a scan that only records)
 * - enforce / enforce_nsfw, every channel (VR1): `checking` until the automated check routes it
 * - a trusted channel (admin-granted): `post_review`, public at once and checked afterwards; an
 *   NSFW hit pulls it back (VR2)
 */
export function initialReviewState(
  mode: VideoReviewMode,
  opts: { trusted: boolean; reviewId: string; now: Date; settings: Pick<VideoReviewSettings, 'etaMinutes'> },
): VideoReviewState | null {
  if (!holdsWhileChecking(mode)) return null;
  const since = opts.now.toISOString();
  if (opts.trusted) return { status: 'post_review', reviewId: opts.reviewId, timing: 'post', since };
  return { status: 'checking', reviewId: opts.reviewId, timing: 'pre', since, etaAt: reviewEtaAt(opts.now, opts.settings) };
}

/** Whether a scan should be queued at all for this mode (shadow and both enforce modes). */
export function scansInMode(mode: VideoReviewMode): mode is Exclude<VideoReviewMode, 'off'> {
  return mode !== 'off';
}

/** What the creator (and every API view) may see of a review: never the hold cause or internals. */
export interface CreatorReviewView {
  status: VideoReviewStatus;
  since: string;
  etaAt?: string;
  reasonCode?: VideoReviewReasonCode;
  decidedAt?: string;
  appealUsed?: boolean;
}

export function creatorReviewView(review: Partial<VideoReviewState> | null | undefined): CreatorReviewView | undefined {
  if (!review || !review.status || !review.since) return undefined;
  const out: CreatorReviewView = { status: review.status, since: review.since };
  if (review.etaAt) out.etaAt = review.etaAt;
  if (review.reasonCode && isReviewReasonCode(review.reasonCode)) out.reasonCode = review.reasonCode;
  if (review.decidedAt) out.decidedAt = review.decidedAt;
  if (review.appealUsed) out.appealUsed = true;
  return out;
}
