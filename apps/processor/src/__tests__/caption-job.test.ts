/**
 * On-demand transcription in the processor (AUN-CAPTIONS §5.1): one chunk per delivery, the
 * partial transcript resumed and never forked, the budget wait, phantom phrases dropped, Quran
 * written as references, and api-videos told of progress, the end and a cancel. Fake speech
 * only: no AI, no QF.
 */
jest.mock('../moderation/budget', () => ({ reserveBudget: jest.fn(async () => true), settleBudget: jest.fn(async () => undefined) }));
jest.mock('../moderation/usage', () => ({ recordUsage: jest.fn(async () => 10) }));

import { MessageType, QuranIndex, captionDraftKey, type CaptionDraft, type CaptionJobPayload } from '@al-ummah/shared-types';
import { reserveBudget } from '../moderation/budget';
import { recordUsage } from '../moderation/usage';
import {
  BUDGET_WAIT_SECONDS,
  CAPTION_JOB_LAST_ATTEMPT,
  WhisperCaptionAsr,
  collapseLoops,
  filterTranscript,
  isCaptionJobPayload,
  processCaptionJobMessages,
  type CaptionAsr,
} from '../captions/job';
import { miniQuranRows } from './fixtures/quran-mini';

const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), job: jest.fn() } as never;
const JOB = 'job-0000-1111';
const RECITED = 'قل هو الله احد الله الصمد لم يلد ولم يولد ولم يكن له كفوا احد';
const index = new QuranIndex(QuranIndex.build(miniQuranRows(), 'v-test', new Date().toISOString()));

class Bucket {
  store = new Map<string, { value: string; etag: string }>();
  n = 0;
  set(key: string, value: string) {
    this.store.set(key, { value, etag: `e${++this.n}` });
  }
  async get(key: string) {
    const v = this.store.get(key);
    return v ? { text: async () => v.value, arrayBuffer: async () => new TextEncoder().encode(v.value).buffer as ArrayBuffer, etag: v.etag } : null;
  }
  async put(key: string, value: string, opts?: { onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string } }) {
    const cur = this.store.get(key);
    if (opts?.onlyIf?.etagDoesNotMatch === '*' && cur) return null;
    if (opts?.onlyIf?.etagMatches && cur?.etag !== opts.onlyIf.etagMatches) return null;
    this.set(key, value);
    return { key };
  }
  read<T>(key: string): T | null {
    const v = this.store.get(key);
    return v ? (JSON.parse(v.value) as T) : null;
  }
}

function setup(chunks = 2, videosStatus: (path: string) => number = () => 200) {
  const REVIEW_MEDIA = new Bucket();
  REVIEW_MEDIA.set(
    `captions-work/${JOB}/manifest.json`,
    JSON.stringify({ jobId: JOB, videoId: 'v1', durationMs: chunks * 600_000 - 30_000, audio: Array.from({ length: chunks }, (_, i) => ({ key: `captions-work/${JOB}/a${i}.mp3`, startMs: i * 600_000, endMs: (i + 1) * 600_000 })) }),
  );
  for (let i = 0; i < chunks; i++) REVIEW_MEDIA.set(`captions-work/${JOB}/a${i}.mp3`, `audio-${i}`);
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  const sent: Array<{ message: { type: number; payload: CaptionJobPayload }; options?: { delaySeconds?: number } }> = [];
  const env = {
    REPORTS_DB: {} as never,
    REVIEW_MEDIA,
    subtitles: new Bucket(),
    VIDEOS: {
      fetch: async (url: RequestInfo, init?: RequestInit) => {
        const path = new URL(String(url)).pathname;
        calls.push({ path, body: JSON.parse(String(init?.body)) });
        return new Response('{}', { status: videosStatus(path) });
      },
    },
    MESSAGE_QUEUE: { send: async (message: never, options?: { delaySeconds?: number }) => void sent.push({ message, ...(options ? { options } : {}) }) },
    INTERNAL_API_KEY: 'internal',
    ERRORS_INGEST_URL: 'https://admin.example/internal/errors',
  };
  return { env, calls, sent, REVIEW_MEDIA, subtitles: env.subtitles };
}

const payload = (over: Partial<CaptionJobPayload> = {}): CaptionJobPayload => ({
  jobId: JOB,
  videoId: 'v1',
  language: 'ar',
  replace: false,
  requestedBy: 'owner',
  audioManifestKey: `captions-work/${JOB}/manifest.json`,
  nextChunk: 0,
  prompt: 'A talk',
  model: '@cf/openai/whisper-large-v3-turbo',
  dailyBudgetUsd: 1,
  requestedAt: '2026-11-14T00:00:00.000Z',
  ...over,
});
const message = (p: unknown = payload(), attempts = 1) => ({ body: { id: 'm', type: MessageType.CaptionJob, payload: p }, attempts, ack: jest.fn(), retry: jest.fn() });

const speech = (byChunk: (startMs: number) => Array<{ offset: number; text: string }>): CaptionAsr & { prompts: Array<string | undefined> } => {
  const prompts: Array<string | undefined> = [];
  return {
    provider: 'fake',
    prompts,
    async transcribe(audio, _language, prompt, usage) {
      prompts.push(prompt);
      usage.push({ model: '@cf/openai/whisper-large-v3-turbo', inputUnits: 600, outputUnits: 0 });
      return byChunk(audio.startMs).map((s, i) => ({ startMs: audio.startMs + s.offset, endMs: audio.startMs + s.offset + 4000 + i, text: s.text }));
    },
  };
};
const deps = (asr: CaptionAsr) => ({ asr, quranIndex: async () => index });

beforeEach(() => {
  (reserveBudget as jest.Mock).mockResolvedValue(true);
  globalThis.fetch = jest.fn(async () => new Response('{}')) as never;
});

describe('caption job consumer', () => {
  it('transcribes one chunk per delivery, then writes the draft with Quran as references and finishes', async () => {
    const { env, calls, sent, subtitles } = setup(2);
    const asr = speech((at) => (at === 0 ? [{ offset: 0, text: 'قال الشيخ في درس اليوم' }, { offset: 4000, text: RECITED }] : [{ offset: 0, text: 'Thank you.' }, { offset: 5000, text: 'وهذه السورة تعدل ثلث القرآن' }]));

    let m = message();
    await processCaptionJobMessages([m], env, undefined, logger, deps(asr));
    expect(m.ack).toHaveBeenCalled();
    expect(sent.map((s) => s.message.payload.nextChunk)).toEqual([1]);
    expect(calls).toEqual([{ path: `/internal/captions/jobs/${JOB}/progress`, body: { status: 'transcribing', done: 0, total: 2 } }]);
    expect(recordUsage).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ feature: 'captions', inputTokens: 600 }), expect.any(Number));

    m = message(sent[0]!.message.payload);
    await processCaptionJobMessages([m], env, undefined, logger, deps(asr));
    expect(sent.map((s) => s.message.payload.nextChunk)).toEqual([1, 2]);

    m = message(sent[1]!.message.payload);
    await processCaptionJobMessages([m], env, undefined, logger, deps(asr));
    expect(asr.prompts).toEqual(['A talk', 'A talk']);
    const draft = subtitles.read<CaptionDraft>(captionDraftKey('v1', 'ar'))!;
    expect(draft.origin).toBe('transcription');
    expect(draft.machine).toEqual({ provider: 'fake', model: '@cf/openai/whisper-large-v3-turbo' });
    const all = JSON.stringify(draft.cues);
    expect(all).not.toContain('Thank you');
    // Recitation is a reference to the official text, never shown ASR text (`heard` is never rendered)
    const speechText = draft.cues.flatMap((c) => c.segments.filter((s) => s.type === 'speech').map((s) => (s as { text: string }).text)).join(' ');
    expect(speechText).not.toContain('الصمد');
    expect(draft.cues.flatMap((c) => c.segments).find((s) => s.type === 'quran')).toMatchObject({ range: '112:1:1-112:4:5', status: 'confirmed' });
    expect(calls.slice(-2)).toEqual([
      { path: `/internal/captions/jobs/${JOB}/progress`, body: { status: 'postprocessing', done: 2, total: 2 } },
      { path: `/internal/captions/jobs/${JOB}/finish`, body: { outcome: 'ready', minutesUsed: 20 } },
    ]);
  });

  it('a duplicate delivery never forks the job', async () => {
    const { env, sent } = setup(2);
    const asr = speech(() => [{ offset: 0, text: 'كلام' }]);
    await processCaptionJobMessages([message()], env, undefined, logger, deps(asr));
    const dup = message();
    await processCaptionJobMessages([dup], env, undefined, logger, deps(asr));
    expect(dup.ack).toHaveBeenCalled();
    expect(sent).toHaveLength(1);
  });

  it('waits for tomorrow when the budget is spent, telling the admin', async () => {
    const { env, sent, calls } = setup(1);
    (reserveBudget as jest.Mock).mockResolvedValue(false);
    const m = message();
    await processCaptionJobMessages([m], env, undefined, logger, deps(speech(() => [])));
    expect(m.ack).toHaveBeenCalled();
    expect(sent[0]!.options).toEqual({ delaySeconds: BUDGET_WAIT_SECONDS });
    expect(sent[0]!.message.payload.nextChunk).toBe(0);
    expect(calls[0]!.body).toEqual({ status: 'waiting_budget', done: 0, total: 1 });
    expect(globalThis.fetch).toHaveBeenCalled();
  });

  it('stops quietly once api-videos says the job was cancelled', async () => {
    const { env, sent } = setup(1, () => 409);
    const asr = speech(() => [{ offset: 0, text: 'كلام' }]);
    const m = message();
    await processCaptionJobMessages([m], env, undefined, logger, deps(asr));
    expect(m.ack).toHaveBeenCalled();
    expect(m.retry).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
    expect(asr.prompts).toHaveLength(0);
  });

  it('only silence or phantom phrases → no_speech; a draft written meanwhile → draft_exists', async () => {
    const one = setup(1);
    const silent = speech(() => [{ offset: 0, text: 'Thanks for watching!' }]);
    await processCaptionJobMessages([message()], one.env, undefined, logger, deps(silent));
    await processCaptionJobMessages([message(payload({ nextChunk: 1 }))], one.env, undefined, logger, deps(silent));
    expect(one.calls.at(-1)).toEqual({ path: `/internal/captions/jobs/${JOB}/finish`, body: { outcome: 'failed', error: 'no_speech' } });

    const two = setup(1);
    two.subtitles.set(captionDraftKey('v1', 'ar'), '{"version":3}');
    const talk = speech(() => [{ offset: 0, text: 'كلام' }]);
    await processCaptionJobMessages([message()], two.env, undefined, logger, deps(talk));
    await processCaptionJobMessages([message(payload({ nextChunk: 1 }))], two.env, undefined, logger, deps(talk));
    expect(two.calls.at(-1)!.body).toEqual({ outcome: 'failed', error: 'draft_exists' });
  });

  it('retries a failing step, then fails the job and flags the admin with a free Retry', async () => {
    const { env, calls } = setup(1);
    const broken: CaptionAsr = { provider: 'fake', transcribe: async () => { throw new Error('capacity'); } };
    const early = message(payload(), 1);
    await processCaptionJobMessages([early], env, undefined, logger, deps(broken));
    expect(early.retry).toHaveBeenCalledWith({ delaySeconds: 60 });

    const last = message(payload(), CAPTION_JOB_LAST_ATTEMPT);
    await processCaptionJobMessages([last], env, undefined, logger, deps(broken));
    expect(last.ack).toHaveBeenCalled();
    expect(calls.at(-1)).toEqual({ path: `/internal/captions/jobs/${JOB}/finish`, body: { outcome: 'failed', error: 'transcription_failed' } });
    const report = JSON.parse(String((globalThis.fetch as jest.Mock).mock.calls.at(-1)[1].body));
    expect(report.events[0].action).toMatchObject({ key: `caption-job:${JOB}`, retry: { kind: 'service', service: 'api-videos', path: '/internal/captions/jobs/retry', body: { jobId: JOB } } });
  });

  it('waits for a fresh Quran copy rather than draft recitation as ASR text', async () => {
    const { env, subtitles } = setup(1);
    const asr = speech(() => [{ offset: 0, text: RECITED }]);
    await processCaptionJobMessages([message()], env, undefined, logger, deps(asr));
    const m = message(payload({ nextChunk: 1 }));
    await processCaptionJobMessages([m], env, undefined, logger, { asr, quranIndex: async () => null });
    expect(m.retry).toHaveBeenCalled();
    expect(subtitles.read(captionDraftKey('v1', 'ar'))).toBeNull();
  });

  it('accepts only this video’s review audio or the job’s own extraction', () => {
    expect(isCaptionJobPayload(payload())).toBe(true);
    expect(isCaptionJobPayload(payload({ audioManifestKey: 'review/v1/3/manifest.json' }))).toBe(true);
    expect(isCaptionJobPayload(payload({ audioManifestKey: 'review/v2/3/manifest.json' }))).toBe(false);
    expect(isCaptionJobPayload(payload({ audioManifestKey: 'captions-work/other-job-1/manifest.json' }))).toBe(false);
    expect(isCaptionJobPayload(payload({ audioManifestKey: 'review/v1/../x/manifest.json' }))).toBe(false);
    expect(isCaptionJobPayload(payload({ model: 'https://evil' }))).toBe(false);
  });

  it('Whisper refuses to run under test (owner rule: no AI spend in tests)', () => {
    expect(() => new WhisperCaptionAsr({ run: jest.fn() }, '@cf/openai/whisper-large-v3-turbo', { REPORTS_DB: {} as never })).toThrow(/Refusing/);
  });
});

describe('hallucination filter', () => {
  it('collapses word loops and runs of 3+ identical segments, keeps a repeated ayah', () => {
    expect(collapseLoops('نعم نعم نعم نعم نعم ثم')).toBe('نعم ثم');
    expect(collapseLoops('الله اكبر الله اكبر')).toBe('الله اكبر الله اكبر');
    const seg = (text: string, startMs: number) => ({ startMs, endMs: startMs + 1000, text });
    expect(filterTranscript([seg('a b', 0), seg('a b', 1000)]).map((s) => s.text)).toEqual(['a b', 'a b']);
    const loop = filterTranscript([seg('x y', 0), seg('x y', 1000), seg('x y', 2000), seg('x y', 3000), seg('z', 4000)]);
    expect(loop).toEqual([{ startMs: 0, endMs: 4000, text: 'x y' }, seg('z', 4000)]);
    expect(filterTranscript([seg('Thank you.', 0), seg('  ', 1000), seg('اشتركوا في القناة!', 2000)])).toEqual([]);
  });
});
