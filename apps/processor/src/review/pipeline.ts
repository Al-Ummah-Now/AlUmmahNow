/**
 * The automated check of one video (docs/specs/VIDEO-REVIEW.md §4). Pure over its dependencies:
 * the model provider and the review media bucket. Produces the scored findings, the transcript
 * (for VR11's opt-in caption draft) and the usage; routing is shared-types routeReview().
 *
 * Steps: metadata text → thumbnail → frames stage 1 (every frame, 4 per call) → stage 2 on frames
 * scoring ≥ nsfwScreen → audio chunks → transcript text. A metadata edit checks text and thumbnail
 * only. Missing review media makes the check "partial", which routes to a person (fail safe).
 */
import type { ReviewFinding, ReviewMediaManifest, VideoReviewScanPayload, VideoReviewThresholds } from '@al-ummah/shared-types';
import type { ImageScores, ModerationProvider, ReviewImage, TranscriptSegment, Usage } from './provider';
import { FixtureModerationProvider, ProviderError } from './provider';

/** The part of an R2 bucket the pipeline reads (MEDIA_PRIVATE). */
export interface ReviewMediaBucket {
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; text(): Promise<string>; httpMetadata?: { contentType?: string } } | null>;
}

export interface PipelineDeps {
  provider: ModerationProvider;
  media?: ReviewMediaBucket | undefined;
  fetchImpl?: typeof fetch | undefined;
  /** Stage 2 calls at most this many frames (the highest scoring), per video */
  maxStage2?: number;
  /** Usage is appended here as calls finish, so a failed run still accounts for what it spent */
  usage?: Usage[];
}

export interface PipelineResult {
  findings: ReviewFinding[];
  /** No review media (or none readable): frames and speech were not checked */
  partial: boolean;
  transcript: TranscriptSegment[];
  usage: Usage[];
  framesChecked: number;
}

/** Scores below this are not kept as findings (they never affect routing). */
const KEEP_SCORE = 0.05;
const TEXT_WINDOW_CHARS = 1500;
const LATIN = /[A-Za-z]{3,}/;

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

async function readImage(media: ReviewMediaBucket | undefined, key: string): Promise<ReviewImage | null> {
  const object = await media?.get(key);
  if (!object) return null;
  return { contentType: object.httpMetadata?.contentType || 'image/jpeg', base64: toBase64(await object.arrayBuffer()) };
}

async function fetchImage(fetchImpl: typeof fetch, url: string): Promise<ReviewImage | null> {
  const full = /^https?:\/\//.test(url) ? url : `https://${url}`;
  const res = await fetchImpl(full, { headers: { Accept: 'image/*' } });
  if (!res.ok) return null;
  const contentType = res.headers.get('content-type') ?? 'image/jpeg';
  if (!/^image\/(jpeg|png|webp)/.test(contentType)) return null;
  return { contentType: contentType.split(';')[0] ?? 'image/jpeg', base64: toBase64(await res.arrayBuffer()) };
}

/** Text in windows of ~1,500 characters, each with the time of its first segment. */
function textWindows(segments: TranscriptSegment[]): Array<{ text: string; startMs: number; endMs: number }> {
  const windows: Array<{ text: string; startMs: number; endMs: number }> = [];
  let current: { text: string; startMs: number; endMs: number } | null = null;
  for (const s of segments) {
    if (!current || current.text.length + s.text.length > TEXT_WINDOW_CHARS) {
      if (current) windows.push(current);
      current = { text: s.text, startMs: s.startMs, endMs: s.endMs };
    } else {
      current.text += ` ${s.text}`;
      current.endMs = s.endMs;
    }
  }
  if (current) windows.push(current);
  return windows;
}

async function checkText(
  provider: ModerationProvider,
  text: string,
  usage: Usage[],
  base: Pick<ReviewFinding, 'source' | 'atMs' | 'endMs'>,
  models: { guard: string; policy: string },
): Promise<ReviewFinding[]> {
  const out: ReviewFinding[] = [];
  const excerpt = text.slice(0, 500);
  // Llama Guard does not read Arabic: it gets text with Latin script; Gemma 4 reads everything
  if (LATIN.test(text)) {
    const guard = await provider.guardText(text, usage);
    for (const [category, score] of Object.entries(guard.scores)) if (score >= KEEP_SCORE) out.push({ ...base, category, score, text: excerpt, model: models.guard });
  }
  const policy = await provider.policyText(text, usage);
  for (const [category, score] of Object.entries(policy.scores)) if (score >= KEEP_SCORE) out.push({ ...base, category, score, text: excerpt, model: models.policy, rationale: policy.rationale });
  return out;
}

/**
 * Quran spans in a transcript (AUN-CAPTIONS matcher: quran.com search + local verification). Spans
 * it returns are excluded from violence and hate scoring by routeReview. The matcher is built with
 * the captions feature (AlUmmahNow#1271); until it lands this returns no spans, so nothing is excluded
 * and a recitation that a model flags goes to a person instead of being approved (fail safe).
 */
export type QuranMatcher = (segments: TranscriptSegment[]) => Promise<Array<{ startMs: number; endMs: number; ref: string }>>;
export const noQuranMatcher: QuranMatcher = async () => [];

export async function runReviewPipeline(
  payload: VideoReviewScanPayload,
  deps: PipelineDeps,
  quranMatcher: QuranMatcher = noQuranMatcher,
): Promise<PipelineResult> {
  const { provider } = deps;
  const t: VideoReviewThresholds = payload.settings.thresholds;
  const models = payload.settings.models;
  const usage: Usage[] = deps.usage ?? [];
  const findings: ReviewFinding[] = [];
  const fetchImpl = deps.fetchImpl ?? fetch;

  // 1. Metadata (title, description, tags)
  if (payload.metadataText.trim()) {
    findings.push(...(await checkText(provider, payload.metadataText, usage, { source: 'metadata' }, { guard: models.textGuard, policy: models.textPolicy })));
  }

  // 2. Thumbnail (stage 2 directly: it is what everyone sees first)
  if (payload.thumbnail) {
    const image = payload.thumbnail.key ? await readImage(deps.media, payload.thumbnail.key) : payload.thumbnail.url ? await fetchImage(fetchImpl, payload.thumbnail.url).catch(() => null) : null;
    if (image) {
      const verdict = await provider.reviewImage(image, usage);
      if (verdict.category !== 'none' && verdict.score >= KEEP_SCORE) findings.push({ source: 'thumbnail', category: verdict.category, score: verdict.score, model: models.imageReview, rationale: verdict.rationale, mediaKey: payload.thumbnail.key });
      if (verdict.minorPresent > t.escalate) findings.push({ source: 'thumbnail', category: 'minor_present', score: verdict.minorPresent, model: models.imageReview });
    }
  }

  if (payload.trigger === 'metadata_edit') return { findings, partial: false, transcript: [], usage, framesChecked: 0 };

  // 3. Review media from the transcoder
  let manifest: ReviewMediaManifest | null = null;
  if (payload.manifestKey && deps.media) {
    const object = await deps.media.get(payload.manifestKey);
    if (object) manifest = JSON.parse(await object.text()) as ReviewMediaManifest;
  }
  if (!manifest) return { findings, partial: true, transcript: [], usage, framesChecked: 0 };

  // 3a. Frames, stage 1: every frame, four per call
  const stage1: Array<{ atMs: number; key: string; scores: ImageScores }> = [];
  let framesChecked = 0;
  for (let i = 0; i < manifest.frames.length; i += 4) {
    const batch = manifest.frames.slice(i, i + 4);
    const images: ReviewImage[] = [];
    const kept: typeof batch = [];
    for (const frame of batch) {
      const image = await readImage(deps.media, frame.key);
      if (image) {
        images.push(image);
        kept.push(frame);
      }
    }
    if (!images.length) continue;
    if (provider instanceof FixtureModerationProvider) provider.frameTimes = kept.map((f) => f.atMs);
    const scores = await provider.screenImages(images, usage);
    framesChecked += images.length;
    kept.forEach((frame, j) => {
      const s = scores[j];
      if (s) stage1.push({ atMs: frame.atMs, key: frame.key, scores: s });
    });
  }
  if (manifest.frames.length && !framesChecked) return { findings, partial: true, transcript: [], usage, framesChecked: 0 };

  // 3b. Stage 2 on the frames stage 1 flagged (highest first); the others keep their stage-1 scores
  const maxNsfw = (s: ImageScores) => Math.max(s.sexual, s.gore, s.disturbing);
  const screened = stage1.filter((f) => maxNsfw(f.scores) >= t.nsfwScreen).sort((a, b) => maxNsfw(b.scores) - maxNsfw(a.scores));
  const toStage2 = new Set(screened.slice(0, deps.maxStage2 ?? 20).map((f) => f.key));
  for (const frame of stage1) {
    if (toStage2.has(frame.key)) {
      const image = await readImage(deps.media, frame.key);
      if (!image) continue;
      if (provider instanceof FixtureModerationProvider) provider.frameTimes = [frame.atMs];
      const verdict = await provider.reviewImage(image, usage);
      // A frame stage 2 clears drops to its stage-2 score; a confirmed one keeps the timestamp
      const category = verdict.category === 'none' ? (Object.entries(frame.scores).filter(([k]) => k !== 'minor_present').sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'sexual') : verdict.category;
      findings.push({ source: 'frame', category, score: verdict.score, atMs: frame.atMs, mediaKey: frame.key, model: models.imageReview, rationale: verdict.rationale });
      if (Math.max(verdict.minorPresent, frame.scores.minor_present) > t.escalate) findings.push({ source: 'frame', category: 'minor_present', score: Math.max(verdict.minorPresent, frame.scores.minor_present), atMs: frame.atMs, mediaKey: frame.key, model: models.imageReview });
    } else {
      for (const category of ['sexual', 'gore', 'disturbing'] as const) {
        if (frame.scores[category] >= KEEP_SCORE) findings.push({ source: 'frame', category, score: frame.scores[category], atMs: frame.atMs, mediaKey: frame.key, model: models.frames });
      }
      if (frame.scores.minor_present > t.escalate) findings.push({ source: 'frame', category: 'minor_present', score: frame.scores.minor_present, atMs: frame.atMs, mediaKey: frame.key, model: models.frames });
    }
  }

  // 4. Speech: transcribe each chunk, then check the transcript in windows
  const transcript: TranscriptSegment[] = [];
  for (const chunk of manifest.audio) {
    const object = await deps.media?.get(chunk.key);
    if (!object) throw new ProviderError(`audio chunk missing: ${chunk.key}`, false);
    transcript.push(...(await provider.transcribe({ base64: toBase64(await object.arrayBuffer()), startMs: chunk.startMs, durationMs: chunk.endMs - chunk.startMs }, undefined, usage)));
  }
  const quran = await quranMatcher(transcript);
  for (const w of textWindows(transcript)) {
    const span = quran.find((q) => q.startMs < w.endMs && q.endMs > w.startMs);
    const found = await checkText(provider, w.text, usage, { source: 'transcript', atMs: w.startMs, endMs: w.endMs }, { guard: models.textGuard, policy: models.textPolicy });
    findings.push(...found.map((f) => (span ? { ...f, quranRef: span.ref } : f)));
  }

  return { findings, partial: false, transcript, usage, framesChecked };
}
