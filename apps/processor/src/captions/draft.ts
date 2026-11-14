/**
 * A transcript becomes a caption draft (AUN-CAPTIONS §3.3): the Quran matcher over the speech,
 * cues whose Quran spans are references only, written to the subtitles bucket. Shared by the
 * review-transcript claim (claim.ts) and on-demand transcription (job.ts).
 */
import {
  captionCuesFromTranscript,
  captionDraftKey,
  matchQuran,
  transcriptWords,
  validateCaptionCues,
  type CaptionDraft,
  type CaptionDraftOrigin,
  type QuranIndex,
  type ReviewTranscriptFile,
} from '@al-ummah/shared-types';

export interface DraftBucket {
  get(key: string): Promise<{ text(): Promise<string> } | null>;
  put(key: string, value: string, options?: { httpMetadata?: { contentType?: string }; onlyIf?: { etagDoesNotMatch?: string } }): Promise<unknown>;
}

export type DraftOutcome = { status: 'drafted'; cues: number; quran: number } | { status: 'draft_exists' };

/**
 * Writes the draft of `language`. Without `replace` an existing draft is kept (draft_exists);
 * with it the new draft takes the next version. Throws when the cues fail validation.
 */
export async function writeTranscriptDraft(
  subtitles: DraftBucket,
  index: QuranIndex,
  d: {
    videoId: string;
    language: string;
    replace: boolean;
    requestedBy: string;
    origin: CaptionDraftOrigin;
    machine: NonNullable<CaptionDraft['machine']>;
    segments: ReviewTranscriptFile['segments'];
  },
  now = new Date(),
): Promise<DraftOutcome> {
  const matches = matchQuran(index, transcriptWords(d.segments));
  const checked = validateCaptionCues(captionCuesFromTranscript(d.segments, matches));
  if (!checked.ok) throw new Error(`draft failed validation: ${(checked as Extract<typeof checked, { ok: false }>).error}`);
  const cues = (checked as Extract<typeof checked, { ok: true }>).cues;

  const at = now.toISOString();
  const draft: CaptionDraft = {
    v: 1,
    videoId: d.videoId,
    language: d.language,
    version: 1,
    kind: 'source',
    origin: d.origin,
    edited: false,
    machine: d.machine,
    cues,
    createdAt: at,
    updatedAt: at,
    updatedBy: d.requestedBy,
  };
  const key = captionDraftKey(d.videoId, d.language);
  if (d.replace) {
    const existing = await subtitles.get(key);
    if (existing) draft.version = ((JSON.parse(await existing.text()) as CaptionDraft).version ?? 0) + 1;
    await subtitles.put(key, JSON.stringify(draft), { httpMetadata: { contentType: 'application/json' } });
  } else {
    const written = await subtitles.put(key, JSON.stringify(draft), { httpMetadata: { contentType: 'application/json' }, onlyIf: { etagDoesNotMatch: '*' } });
    if (!written) return { status: 'draft_exists' };
  }
  const quran = cues.reduce((n, c) => n + c.segments.filter((s) => s.type === 'quran').length, 0);
  return { status: 'drafted', cues: cues.length, quran };
}
