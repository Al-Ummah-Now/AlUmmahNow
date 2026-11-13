/**
 * Model calls for pre-publication review (docs/specs/VIDEO-REVIEW.md §4), behind one interface so
 * tests and the local stack never call a real model:
 *
 * - WorkersAiModerationProvider: open-weight models on Workers AI (owner rule: no proprietary APIs)
 * - FixtureModerationProvider:   deterministic answers for tests and the local stack
 *
 * A loud guard refuses to build the Workers AI provider under test, CI or E2E (owner rule: no AI
 * spend in tests). Every call reports its usage so the budget and ai_usage_daily stay exact.
 */
import type { ImageReviewCategory, VideoReviewSettings } from '@al-ummah/shared-types';

/** One image: JPEG/PNG/WebP bytes, base64. */
export interface ReviewImage {
  contentType: string;
  base64: string;
}

/** Scores in [0, 1] per image category, one entry per input image (same order). */
export type ImageScores = Record<ImageReviewCategory, number>;

export interface ImageReviewVerdict {
  /** 'none' or the violated category */
  category: 'none' | 'sexual' | 'gore' | 'disturbing';
  /** Probability that the image violates the policy */
  score: number;
  minorPresent: number;
  rationale: string;
}

export interface TranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
}

export interface TextVerdict {
  /** Category → score in [0, 1] (Llama Guard S-codes, platform categories, sexual_explicit_language) */
  scores: Record<string, number>;
  rationale?: string | undefined;
}

export interface Usage {
  model: string;
  /** Tokens in, or audio seconds for speech-to-text */
  inputUnits: number;
  outputUnits: number;
}

export interface ModerationProvider {
  readonly kind: 'workers-ai' | 'fixture';
  /** Stage 1: up to 4 images in one call, a score per image and category. */
  screenImages(images: ReviewImage[], usage: Usage[]): Promise<ImageScores[]>;
  /** Stage 2: one image with the policy prompt (thumbnail, flagged frames, post images). */
  reviewImage(image: ReviewImage, usage: Usage[]): Promise<ImageReviewVerdict>;
  /** Speech to text for one ≤ 10-minute chunk (VAD off; language explicit when known). */
  transcribe(audio: { base64: string; startMs: number; durationMs: number }, language: string | undefined, usage: Usage[]): Promise<TranscriptSegment[]>;
  /** Llama Guard on English text. */
  guardText(text: string, usage: Usage[]): Promise<TextVerdict>;
  /** The platform policy (Arabic native, extension categories, explicit language). */
  policyText(text: string, usage: Usage[]): Promise<TextVerdict>;
}

export class ProviderError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Loud guard
// ---------------------------------------------------------------------------

interface GuardEnv {
  NODE_ENV?: string;
  CI?: string;
  E2E_ENV?: string;
}

/** Throws when a real model could be called from a test, CI or E2E run. */
export function assertRealAiAllowed(env: GuardEnv, processEnv: GuardEnv = (globalThis as { process?: { env?: GuardEnv } }).process?.env ?? {}): void {
  const under = (e: GuardEnv) => e.NODE_ENV === 'test' || e.CI === 'true' || !!e.E2E_ENV;
  if (under(env) || under(processEnv)) {
    throw new Error('[Review] Refusing to call Workers AI from a test, CI or E2E run: use FixtureModerationProvider (owner rule: no AI spend in tests)');
  }
}

// ---------------------------------------------------------------------------
// Workers AI (open weights)
// ---------------------------------------------------------------------------

export interface AiRunner {
  run(model: string, input: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
}

const SCREEN_QUESTIONS = {
  sexual: { criteria: ['no nudity or sexual content', 'suggestive: revealing clothing, sexualised pose, partial nudity', 'explicit: nudity of intimate parts or sexual activity'] },
  gore: { criteria: ['no injury or violence', 'mild: minor injury, non-graphic violence', 'graphic: gore, mutilation, severe injury, death shown to shock'] },
  disturbing: { criteria: ['not disturbing', 'somewhat disturbing', 'disturbing imagery meant to shock (corpses, cruelty, self-harm)'] },
} as const;

/** Level probabilities → one score: P(explicit) + half of P(suggestive). */
function levelScore(probabilities: Record<string, number> | undefined): number {
  if (!probabilities) return 0;
  const p1 = Number(probabilities['1'] ?? 0);
  const p2 = Number(probabilities['2'] ?? 0);
  return Math.min(1, Math.max(0, p2 + p1 * 0.5));
}

const IMAGE_POLICY = `You review images for a family-friendly Islamic video platform. Decide whether the image shows:
- sexual: nudity of intimate parts, sexual activity, or sexualised content (medical or educational diagrams of wudu or ghusl are NOT violations)
- gore: graphic violence, mutilation, severe injury or death shown to shock (news or history without graphic detail is NOT a violation)
- disturbing: imagery meant to shock or disturb (cruelty, corpses, self-harm)
Also estimate whether a minor (under 18) appears.
Answer ONLY with JSON: {"category":"none|sexual|gore|disturbing","score":0..1,"minor_present":0..1,"rationale":"one short sentence"}`;

const TEXT_POLICY = `You review text (a video's title, description or speech transcript, in English or Arabic, including dialects) for an Islamic video platform's Community Guidelines.
Score each category from 0 to 1:
sexual_explicit_language (explicit sexual language; fiqh discussion of marriage or purity is NOT a violation),
hate (incitement or dehumanising language against a people, religion, sect, ethnicity or gender),
sectarian_hate (takfir or incitement against a sect or group),
violent_extremism (praise of, recruitment for or calls to violence by terrorist groups; quoting Quran verses or history about battles is NOT a violation),
harassment, charity_scam (fake zakat or fundraising, "send to this account"), spam, impersonation, misinfo_health, self_harm.
Answer ONLY with JSON: {"scores":{"<category>":0..1,...},"rationale":"one short sentence"}`;

function parseJsonObject(text: unknown): Record<string, unknown> | null {
  if (text && typeof text === 'object') return text as Record<string, unknown>;
  if (typeof text !== 'string') return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

function chatText(result: unknown): unknown {
  const r = result as { response?: unknown; choices?: Array<{ message?: { content?: unknown } }> } | null;
  return r?.choices?.[0]?.message?.content ?? r?.response ?? result;
}

function tokenUsage(result: unknown): { in: number; out: number } {
  const u = (result as { usage?: { prompt_tokens?: number; completion_tokens?: number; input_tokens?: number; output_tokens?: number } } | null)?.usage;
  return { in: u?.prompt_tokens ?? u?.input_tokens ?? 0, out: u?.completion_tokens ?? u?.output_tokens ?? 0 };
}

export class WorkersAiModerationProvider implements ModerationProvider {
  readonly kind = 'workers-ai' as const;
  constructor(
    private readonly ai: AiRunner,
    private readonly models: VideoReviewSettings['models'],
    env: GuardEnv & { AI_GATEWAY_ID?: string },
    private readonly gatewayId = env.AI_GATEWAY_ID || undefined,
  ) {
    assertRealAiAllowed(env);
  }

  private async call(model: string, input: Record<string, unknown>): Promise<unknown> {
    try {
      return await this.ai.run(model, input, this.gatewayId ? { gateway: { id: this.gatewayId } } : undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Capacity and timeouts are retried by the queue; a refused input is not
      const retryable = !/invalid|too large|unsupported|400/i.test(message);
      throw new ProviderError(`${model}: ${message}`, retryable);
    }
  }

  async screenImages(images: ReviewImage[], usage: Usage[]): Promise<ImageScores[]> {
    const questions: Record<string, unknown> = {};
    images.forEach((_img, i) => {
      for (const [category, q] of Object.entries(SCREEN_QUESTIONS)) {
        questions[`i${i}_${category}`] = { type: 'score', instructions: `Image ${i + 1} only: rate ${category}.`, criteria: q.criteria };
      }
      questions[`i${i}_minor`] = { type: 'noul', instructions: `Image ${i + 1} only: does a child or minor (under 18) appear?` };
    });
    const result = (await this.call(this.models.frames, {
      model: this.models.frames.split('/').pop(),
      state: `Frames sampled from one uploaded video, numbered 1 to ${images.length} in order.`,
      questions,
      images: images.map((img) => ({ content_type: img.contentType, base64: img.base64 })),
    })) as { answers?: Record<string, { noul?: number; probabilities?: Record<string, number> }> };
    const t = tokenUsage(result);
    usage.push({ model: this.models.frames, inputUnits: t.in, outputUnits: t.out });
    const answers = result?.answers ?? {};
    if (!result?.answers) throw new ProviderError(`${this.models.frames}: no answers`, true);
    return images.map((_img, i) => ({
      sexual: levelScore(answers[`i${i}_sexual`]?.probabilities),
      gore: levelScore(answers[`i${i}_gore`]?.probabilities),
      disturbing: levelScore(answers[`i${i}_disturbing`]?.probabilities),
      minor_present: num(answers[`i${i}_minor`]?.noul),
    }));
  }

  async reviewImage(image: ReviewImage, usage: Usage[]): Promise<ImageReviewVerdict> {
    const result = await this.call(this.models.imageReview, {
      messages: [
        { role: 'system', content: IMAGE_POLICY },
        { role: 'user', content: [{ type: 'image_url', image_url: { url: `data:${image.contentType};base64,${image.base64}` } }, { type: 'text', text: 'Review this image.' }] },
      ],
      max_completion_tokens: 200,
      temperature: 0,
      chat_template_kwargs: { enable_thinking: false },
    });
    const t = tokenUsage(result);
    usage.push({ model: this.models.imageReview, inputUnits: t.in, outputUnits: t.out });
    const json = parseJsonObject(chatText(result));
    if (!json) throw new ProviderError(`${this.models.imageReview}: unreadable verdict`, true);
    const category = ['sexual', 'gore', 'disturbing'].includes(String(json.category)) ? (json.category as ImageReviewVerdict['category']) : 'none';
    return { category, score: category === 'none' ? 0 : num(json.score), minorPresent: num(json.minor_present), rationale: String(json.rationale ?? '').slice(0, 300) };
  }

  async transcribe(audio: { base64: string; startMs: number; durationMs: number }, language: string | undefined, usage: Usage[]): Promise<TranscriptSegment[]> {
    // VAD off: it deleted whole recitations in the AUN-CAPTIONS measurements
    const result = (await this.call(this.models.transcribe, { audio: audio.base64, task: 'transcribe', vad_filter: false, ...(language ? { language } : {}) })) as {
      segments?: Array<{ start?: number; end?: number; text?: string }>;
      text?: string;
    };
    usage.push({ model: this.models.transcribe, inputUnits: Math.ceil(audio.durationMs / 1000), outputUnits: 0 });
    const segments = (result?.segments ?? []).filter((s) => typeof s.text === 'string' && s.text.trim());
    if (!segments.length && result?.text) return [{ startMs: audio.startMs, endMs: audio.startMs + audio.durationMs, text: result.text.trim() }];
    return segments.map((s) => ({ startMs: audio.startMs + Math.round((s.start ?? 0) * 1000), endMs: audio.startMs + Math.round((s.end ?? 0) * 1000), text: String(s.text).trim() }));
  }

  async guardText(text: string, usage: Usage[]): Promise<TextVerdict> {
    const result = await this.call(this.models.textGuard, { messages: [{ role: 'user', content: text }], max_tokens: 32, temperature: 0 });
    const t = tokenUsage(result);
    usage.push({ model: this.models.textGuard, inputUnits: t.in || Math.ceil(text.length / 4), outputUnits: t.out });
    const response = String(chatText(result) ?? '').trim().toLowerCase();
    if (response.startsWith('safe')) return { scores: {} };
    const codes = (response.split('\n')[1] ?? '').toUpperCase().split(',').map((c) => c.trim()).filter((c) => /^S\d{1,2}$/.test(c));
    // Llama Guard gives no probability: an "unsafe" category counts as 0.9
    return { scores: Object.fromEntries(codes.map((c) => [c, 0.9])) };
  }

  async policyText(text: string, usage: Usage[]): Promise<TextVerdict> {
    const result = await this.call(this.models.textPolicy, {
      messages: [
        { role: 'system', content: TEXT_POLICY },
        { role: 'user', content: text },
      ],
      max_completion_tokens: 300,
      temperature: 0,
      chat_template_kwargs: { enable_thinking: false },
    });
    const t = tokenUsage(result);
    usage.push({ model: this.models.textPolicy, inputUnits: t.in || Math.ceil(text.length / 3), outputUnits: t.out });
    const json = parseJsonObject(chatText(result));
    if (!json || typeof json.scores !== 'object' || !json.scores) throw new ProviderError(`${this.models.textPolicy}: unreadable verdict`, true);
    const scores: Record<string, number> = {};
    for (const [k, v] of Object.entries(json.scores as Record<string, unknown>)) if (/^[a-z_]{2,40}$/.test(k)) scores[k] = num(v);
    return { scores, rationale: typeof json.rationale === 'string' ? json.rationale.slice(0, 300) : undefined };
  }
}

// ---------------------------------------------------------------------------
// Fixtures (tests, local stack)
// ---------------------------------------------------------------------------

/**
 * Deterministic outcomes, chosen by a marker in the video's metadata text (tests and the local
 * stack create videos titled with it), else `clean`:
 *   [review-fixture:clean] [review-fixture:nsfw_frame@42000] [review-fixture:explicit_ar_transcript]
 *   [review-fixture:high_risk_metadata] [review-fixture:provider_down] [review-fixture:slow]
 */
export type ReviewFixture = 'clean' | 'nsfw_frame' | 'explicit_ar_transcript' | 'high_risk_metadata' | 'provider_down' | 'slow';

export function fixtureFrom(text: string): { fixture: ReviewFixture; atMs?: number } {
  const m = /\[review-fixture:([a-z_]+)(?:@(\d+))?\]/.exec(text);
  const fixture = (m?.[1] ?? 'clean') as ReviewFixture;
  return ['clean', 'nsfw_frame', 'explicit_ar_transcript', 'high_risk_metadata', 'provider_down', 'slow'].includes(fixture)
    ? { fixture, ...(m?.[2] ? { atMs: Number(m[2]) } : {}) }
    : { fixture: 'clean' };
}

export class FixtureModerationProvider implements ModerationProvider {
  readonly kind = 'fixture' as const;
  /** Frame times the pipeline is screening, in order (set by the pipeline before each call) */
  frameTimes: number[] = [];
  calls = 0;
  constructor(private readonly scenario: { fixture: ReviewFixture; atMs?: number }, private readonly delayMs = 0) {}

  private async tick(): Promise<void> {
    this.calls++;
    if (this.scenario.fixture === 'provider_down') throw new ProviderError('fixture: provider down', true);
    if (this.scenario.fixture === 'slow' && this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
  }

  private hitAt(atMs: number | undefined): boolean {
    return this.scenario.fixture === 'nsfw_frame' && atMs !== undefined && Math.abs(atMs - (this.scenario.atMs ?? 42_000)) <= 2_000;
  }

  async screenImages(images: ReviewImage[], usage: Usage[]): Promise<ImageScores[]> {
    await this.tick();
    usage.push({ model: 'fixture/frames', inputUnits: images.length * 300, outputUnits: 0 });
    return images.map((_img, i) => {
      const hit = this.hitAt(this.frameTimes[i]);
      return { sexual: hit ? 0.95 : 0.01, gore: 0.01, disturbing: 0.01, minor_present: 0 };
    });
  }

  async reviewImage(image: ReviewImage, usage: Usage[]): Promise<ImageReviewVerdict> {
    await this.tick();
    usage.push({ model: 'fixture/image', inputUnits: 300, outputUnits: 40 });
    const hit = image.base64.startsWith('HIT') || this.hitAt(this.frameTimes[0]);
    return hit ? { category: 'sexual', score: 0.93, minorPresent: 0, rationale: 'fixture: explicit nudity' } : { category: 'none', score: 0, minorPresent: 0, rationale: 'fixture: clean' };
  }

  async transcribe(audio: { base64: string; startMs: number; durationMs: number }, _language: string | undefined, usage: Usage[]): Promise<TranscriptSegment[]> {
    await this.tick();
    usage.push({ model: 'fixture/transcribe', inputUnits: Math.ceil(audio.durationMs / 1000), outputUnits: 0 });
    const text = this.scenario.fixture === 'explicit_ar_transcript' ? 'fixture: كلام فاحش صريح' : 'fixture: السلام عليكم ورحمة الله';
    return [{ startMs: audio.startMs, endMs: audio.startMs + Math.min(audio.durationMs, 5000), text }];
  }

  async guardText(text: string, usage: Usage[]): Promise<TextVerdict> {
    await this.tick();
    usage.push({ model: 'fixture/guard', inputUnits: Math.ceil(text.length / 4), outputUnits: 2 });
    return this.scenario.fixture === 'high_risk_metadata' ? { scores: { S10: 0.9 } } : { scores: {} };
  }

  async policyText(text: string, usage: Usage[]): Promise<TextVerdict> {
    await this.tick();
    usage.push({ model: 'fixture/policy', inputUnits: Math.ceil(text.length / 3), outputUnits: 20 });
    if (this.scenario.fixture === 'explicit_ar_transcript' && text.includes('فاحش')) return { scores: { sexual_explicit_language: 0.92 }, rationale: 'fixture: explicit language' };
    if (this.scenario.fixture === 'high_risk_metadata') return { scores: { harassment: 0.7 }, rationale: 'fixture: targeted insults' };
    return { scores: {} };
  }
}
