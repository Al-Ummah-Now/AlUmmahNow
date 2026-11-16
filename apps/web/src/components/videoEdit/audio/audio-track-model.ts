/**
 * What Studio's Audio tracks panel shows for a track and for the limit (wiki AUN-MULTI-AUDIO
 * §Studio). Pure, unit-tested in __tests__/audio-track-model.test.ts.
 */
import { AUDIO_TRACK_EXTENSIONS, AUDIO_TRACK_MAX_BYTES, type AudioTrackState, type AudioTracksTranslations, type DetectedAudioStream, fillTemplate, formatBytes, formatNumber } from '@al-ummah/shared-types';
import type { AudioTracksView, StudioAudioTrack } from '@/lib/api/audio-tracks';

export type Tone = 'neutral' | 'progress' | 'good' | 'bad';

export function stateTone(state: AudioTrackState): Tone {
  if (state === 'ready') return 'good';
  if (state === 'failed' || state === 'rejected') return 'bad';
  if (state === 'uploading' || state === 'processing' || state === 'checking') return 'progress';
  return 'neutral';
}

/** Percent uploaded: this tab's upload when it runs one, else what the server holds. */
export function uploadPercent(track: Pick<StudioAudioTrack, 'state' | 'bytes' | 'uploadedBytes'>, local?: { stored: number; total: number }): number | null {
  if (track.state !== 'uploading') return null;
  const stored = local ? local.stored : track.uploadedBytes ?? 0;
  const total = local ? local.total : track.bytes ?? 0;
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.floor((stored / total) * 100)));
}

/** The status chip's text, and the line under it for a failed or rejected track. */
export function trackStatusText(
  track: Pick<StudioAudioTrack, 'state' | 'error' | 'reasonCode'>,
  t: AudioTracksTranslations,
  reasons: Record<string, string>,
  percent: number | null,
  rejectedLine?: string,
  lang = 'en',
): { label: string; detail?: string } {
  if (track.state === 'uploading') return { label: t.uploading.replace('{percent}', formatNumber(lang, percent ?? 0)) };
  const label = t.states[track.state];
  if (track.state === 'failed') {
    const key = track.error === 'processing_failed' || track.error === 'unreadable_file' ? track.error : 'other';
    return { label, detail: t.failedReasons[key] };
  }
  if (track.state === 'rejected') {
    const reason = reasons[track.reasonCode ?? 'other'] ?? reasons.other;
    return { label, ...(reason && rejectedLine ? { detail: rejectedLine.replace('{reason}', reason) } : {}) };
  }
  return { label };
}

/** Why Add is off because of the tier (null when the tier allows another track). */
export function addLimitMessage(view: Pick<AudioTracksView, 'limit'>, t: AudioTracksTranslations, lang = 'en'): string | null {
  const { allowed, used, unlimited } = view.limit;
  // A plan without extra tracks never shows Add at all (GET /api/me/features `audioTracks`)
  if (unlimited || allowed <= 0) return null;
  if (used >= allowed) return t.limitReached.replace('{allowed}', formatNumber(lang, allowed));
  return null;
}

/** A language's name in the page's language ("Arabic" / «العربية»). */
export function languageName(code: string, pageLang: string): string {
  try {
    const name = new Intl.DisplayNames([pageLang], { type: 'language' }).of(code);
    return name && name !== code ? name : code;
  } catch {
    return code;
  }
}

/** Why a picked file cannot be a track (null when it can). */
/** The largest track file in words: "2 GB" / «٢ غيغابايت». */
export function maxFileSize(lang: string): string {
  return formatBytes(lang, AUDIO_TRACK_MAX_BYTES, { unitDisplay: lang === 'ar' ? 'long' : 'short' });
}

export function fileProblem(file: Pick<File, 'name' | 'size'>, t: AudioTracksTranslations, lang = 'en'): string | null {
  const ext = file.name.toLowerCase().split('.').pop() ?? '';
  if (!(AUDIO_TRACK_EXTENSIONS as readonly string[]).includes(ext)) return t.form.fileType;
  if (file.size > AUDIO_TRACK_MAX_BYTES) return fillTemplate(lang, t.form.fileTooBig, { size: maxFileSize(lang) });
  if (file.size <= 0) return t.form.fileType;
  return null;
}

/** A detected stream's line: "Track 2 · Arabic · Dub (stereo)". */
export function streamText(s: DetectedAudioStream, t: AudioTracksTranslations, pageLang: string): string {
  const bits = [s.language ? languageName(s.language, pageLang) : null, s.title ?? null, s.channels ? `${s.channels}ch` : null].filter(Boolean);
  return t.form.stream.replace('{n}', formatNumber(pageLang, s.index + 1)).replace('{details}', bits.join(' · ') || '—');
}
