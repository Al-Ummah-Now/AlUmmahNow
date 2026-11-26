import { shownR2 } from './media-delivery';
/**
 * Multiple audio tracks per video (wiki AUN-MULTI-AUDIO). Shared by api-videos (owns the track
 * list on the video record, queues the jobs), apps/media (normalises tracks, writes the demuxed
 * HLS package) and the web player and Studio.
 *
 * A video with extra tracks plays a demuxed package of its R2 rendition (decision MA1/MA2):
 *   <pub|priv>/<videoId>/<rev>/a/v/<rung>/…   video-only rungs (stream copy)
 *   <pub|priv>/<videoId>/<rev>/a/orig/…       the original audio (stream copy)
 *   <pub|priv>/<videoId>/<rev>/a/<trackId>/…  each extra track
 *   <pub|priv>/<videoId>/<rev>/master_a<n>.m3u8
 */

import { isReviewCleared, type VideoReviewShadowMarker, type VideoReviewState } from './video-review';

export const AUDIO_TRACK_KINDS = ['original', 'dub', 'commentary', 'description'] as const;
export type AudioTrackKind = (typeof AUDIO_TRACK_KINDS)[number];

/** Track languages: the caption languages (MA6), with their own names (the default label). */
export const AUDIO_TRACK_LANGUAGES = [
  { code: 'ar', name: 'العربية', dir: 'rtl' },
  { code: 'en', name: 'English', dir: 'ltr' },
  { code: 'ur', name: 'اردو', dir: 'rtl' },
  { code: 'fr', name: 'Français', dir: 'ltr' },
  { code: 'id', name: 'Bahasa Indonesia', dir: 'ltr' },
  { code: 'tr', name: 'Türkçe', dir: 'ltr' },
  { code: 'ms', name: 'Bahasa Melayu', dir: 'ltr' },
  { code: 'bn', name: 'বাংলা', dir: 'ltr' },
  { code: 'de', name: 'Deutsch', dir: 'ltr' },
  { code: 'es', name: 'Español', dir: 'ltr' },
] as const;
export type AudioTrackLanguage = (typeof AUDIO_TRACK_LANGUAGES)[number]['code'];

export function isAudioTrackLanguage(value: unknown): value is AudioTrackLanguage {
  return typeof value === 'string' && AUDIO_TRACK_LANGUAGES.some((l) => l.code === value);
}

export function isAudioTrackKind(value: unknown): value is AudioTrackKind {
  return typeof value === 'string' && (AUDIO_TRACK_KINDS as readonly string[]).includes(value);
}

/** The language's own name: the label a new track gets unless the creator types one. */
export function defaultAudioTrackLabel(language: string): string {
  return AUDIO_TRACK_LANGUAGES.find((l) => l.code === language)?.name ?? language;
}

/** The original audio's track id (never deleted; MA5). */
export const ORIGINAL_AUDIO_TRACK_ID = 'orig';
export const AUDIO_LABEL_MAX = 60;
/** Largest audio file accepted (≈ 3 h of 48 kHz stereo WAV). */
export const AUDIO_TRACK_MAX_BYTES = 2 * 1024 * 1024 * 1024;
/** Largest upload chunk (Workers take ≤ 100 MB per request). */
export const AUDIO_TRACK_MAX_CHUNK_BYTES = 10 * 1024 * 1024;
/** Accepted file types (by extension; the container probes the real content). */
export const AUDIO_TRACK_EXTENSIONS = ['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'opus', 'mp4', 'webm'] as const;
/** Extra tracks on a video are bounded even on unlimited tiers (the master stays small). */
export const AUDIO_TRACKS_HARD_MAX = 16;
/** The tier entitlement named in a 402 (MA9). */
export const AUDIO_TRACKS_ENTITLEMENT = 'audio.tracksPerVideo';

/** The file's pipeline: uploading → processing (normalising in the container) → ready | failed. Review is separate. */
export const AUDIO_TRACK_STATUSES = ['uploading', 'processing', 'ready', 'failed'] as const;
export type AudioTrackStatus = (typeof AUDIO_TRACK_STATUSES)[number];

/** What Studio shows: the pipeline and the review in one word. */
export const AUDIO_TRACK_STATES = ['uploading', 'processing', 'checking', 'in_review', 'rejected', 'ready', 'failed'] as const;
export type AudioTrackState = (typeof AUDIO_TRACK_STATES)[number];

export type AudioTrackSource =
  | { type: 'original' }
  | { type: 'upload'; uploadId: string; bytes: number; fileName?: string; contentType?: string }
  | { type: 'source_stream'; streamIndex: number };

/** One audio track as stored on the video record (`audioTracks`). */
export interface AudioTrack {
  id: string;
  language: AudioTrackLanguage;
  label: string;
  kind: AudioTrackKind;
  isDefault: boolean;
  status: AudioTrackStatus;
  source: AudioTrackSource;
  /** The normalising job (audio_track) */
  jobId?: string;
  attempts?: number;
  durationSeconds?: number;
  /** Review of this track (MA8): the uploads' state machine (absent: review off, or shadow) */
  review?: VideoReviewState;
  reviewShadow?: VideoReviewShadowMarker;
  error?: string;
  createdAt: string;
  createdBy?: string;
  updatedAt: string;
}

/** The demuxed package the player plays (`audioPackage` on the video record). */
export interface AudioPackageState {
  status: 'queued' | 'building' | 'ready' | 'failed';
  jobId: string;
  /** The rendition it belongs to: stale once the rendition's rev or access changes */
  rev: string;
  access: 'pub' | 'priv';
  /** Increments with every build; names the master (MA3) */
  version: number;
  /** master_a<version>.m3u8 once ready */
  master?: string;
  /** Tracks in the ready master, in menu order */
  trackIds?: string[];
  /** The master this one replaced (deleted once the new one is recorded) */
  previousMaster?: string;
  queuedAt: string;
  readyAt?: string;
  failedAt?: string;
  error?: string;
  attempts?: number;
}

/** An audio stream found in the video's own file (multi-track sources). */
export interface DetectedAudioStream {
  /** Audio stream index (ffmpeg `0:a:<index>`) */
  index: number;
  language?: string;
  title?: string;
  channels?: number;
  codec?: string;
}

/** What viewers and the native apps get (VideoView.audioTracks): only tracks they can hear. */
export interface AudioTrackView {
  id: string;
  language: string;
  label: string;
  kind: AudioTrackKind;
  isDefault: boolean;
}

export function audioMasterFile(version: number): string {
  return `master_a${version}.m3u8`;
}

const AUDIO_MASTER = /^master_a[0-9]{1,6}\.m3u8$/;
export function isAudioMasterFile(name: unknown): name is string {
  return typeof name === 'string' && AUDIO_MASTER.test(name);
}

const TRACK_ID = /^(orig|t[a-z0-9]{6,24})$/;
export function isAudioTrackId(id: unknown): id is string {
  return typeof id === 'string' && TRACK_ID.test(id);
}

export function newAudioTrackId(): string {
  return `t${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

/** Originals bucket (private): the uploaded parts and the normalised file. */
export const audioTrackPrefix = (videoId: string, trackId: string) => `audio/${videoId}/${trackId}/`;
export const audioTrackPartKey = (videoId: string, trackId: string, uploadId: string, offset: number) => `${audioTrackPrefix(videoId, trackId)}${uploadId}/${String(offset).padStart(12, '0')}`;
export const audioTrackFileKey = (videoId: string, trackId: string) => `${audioTrackPrefix(videoId, trackId)}track.m4a`;
/** Review audio of a track (MEDIA_PRIVATE), like review/<videoId>/<rev>/ for uploads */
export const audioTrackReviewPrefix = (videoId: string, trackId: string, jobId: string) => `review/${videoId}/audio-${trackId}-${jobId.slice(0, 8)}/`;

type PackagedVideo = Parameters<typeof shownR2>[0] & { audioTracks?: AudioTrack[]; audioPackage?: AudioPackageState };

/** Tracks in the current package that a viewer may hear, in its order (empty when no package plays). */
export function packagedAudioTracks(video: PackagedVideo): AudioTrackView[] {
  const pkg = video.audioPackage;
  const r2 = shownR2(video);
  // A rebuild keeps the last ready master (and its track ids) playing until the new one is recorded
  if (!pkg?.master || !pkg.trackIds?.length || !r2 || r2.rev !== pkg.rev || r2.access !== pkg.access) return [];
  const byId = new Map((video.audioTracks ?? []).map((t) => [t.id, t]));
  const out: AudioTrackView[] = [];
  for (const id of pkg.trackIds) {
    const t = byId.get(id);
    // The master names every track it holds: one that was deleted, rejected or pulled back since
    // must not play, so the whole package waits for its rebuild (the plain master plays meanwhile)
    if (!t || !isAudibleTrack(t)) return [];
    out.push({ id: t.id, language: t.language, label: t.label, kind: t.kind, isDefault: t.isDefault });
  }
  return out;
}

/** The tracks viewers choose between (VideoView.audioTracks): empty unless there are at least two. */
export function audibleAudioTracks(video: PackagedVideo): AudioTrackView[] {
  const out = packagedAudioTracks(video);
  return out.length > 1 ? out : [];
}

/** A track that may be in the master: the original, or an extra track that is ready and cleared by review. */
export function isAudibleTrack(t: Pick<AudioTrack, 'id' | 'status' | 'review'>): boolean {
  if (t.id === ORIGINAL_AUDIO_TRACK_ID) return true;
  return t.status === 'ready' && isReviewCleared(t.review);
}

/** Studio's one-word state of a track. */
export function audioTrackState(t: Pick<AudioTrack, 'status' | 'review'>): AudioTrackState {
  if (t.status !== 'ready') return t.status;
  const r = t.review?.status;
  if (r === 'checking') return 'checking';
  if (r === 'in_review' || r === 'appealed') return 'in_review';
  if (r === 'rejected') return 'rejected';
  return 'ready';
}

/** The package master to play, when the record has one for its current rendition. */
export function audioPackageMaster(video: PackagedVideo): string | null {
  // One track is enough when the video itself has no sound (the package then holds only the extra track)
  return packagedAudioTracks(video).length ? video.audioPackage!.master! : null;
}

// ---------------------------------------------------------------------------
// Queue messages (api-videos → apps/media on TRANSCODE_QUEUE) and reports
// ---------------------------------------------------------------------------

/** Normalise one track: probe, pad or trim to the video, AAC 128k → track.m4a; review audio when asked. */
export interface AudioTrackJobMessage {
  kind: 'audio_track';
  videoId: string;
  trackId: string;
  jobId: string;
  source: { type: 'upload'; uploadId: string; bytes: number } | { type: 'source_stream'; streamIndex: number };
  /** The video's length: the track is padded or cut to it (MA5) */
  durationSeconds: number;
  /** Extract 16 kHz review chunks under this MEDIA_PRIVATE prefix (review on) */
  reviewPrefix?: string;
  queuedAt: string;
}

export interface AudioPackageTrack {
  id: string;
  language: string;
  label: string;
  kind: AudioTrackKind;
  isDefault: boolean;
}

/** Write the demuxed package of a ready rendition with these tracks. */
export interface AudioPackageJobMessage {
  kind: 'audio_package';
  videoId: string;
  jobId: string;
  rev: string;
  access: 'pub' | 'priv';
  version: number;
  /** Rung names of the rendition (from its result) */
  rungs: string[];
  /** The original first, then the extra tracks, in menu order */
  tracks: AudioPackageTrack[];
  queuedAt: string;
}

/** List the source file's audio streams. */
export interface AudioProbeJobMessage {
  kind: 'audio_probe';
  videoId: string;
  jobId: string;
  queuedAt: string;
}

const SAFE_JOB = /^[A-Za-z0-9-]{8,64}$/;
const SAFE_VIDEO = /^[A-Za-z0-9_-]{1,80}$/;
const SAFE_REV = /^[A-Za-z0-9_-]{1,64}$/;

export function isAudioTrackJobMessage(value: unknown): value is AudioTrackJobMessage {
  const m = value as Partial<AudioTrackJobMessage> | null;
  if (!m || m.kind !== 'audio_track' || typeof m.videoId !== 'string' || !SAFE_VIDEO.test(m.videoId) || !isAudioTrackId(m.trackId) || m.trackId === ORIGINAL_AUDIO_TRACK_ID) return false;
  if (typeof m.jobId !== 'string' || !SAFE_JOB.test(m.jobId) || typeof m.queuedAt !== 'string') return false;
  if (!(typeof m.durationSeconds === 'number' && m.durationSeconds > 0 && m.durationSeconds < 86_400)) return false;
  if (m.reviewPrefix !== undefined && (typeof m.reviewPrefix !== 'string' || m.reviewPrefix !== audioTrackReviewPrefix(m.videoId, m.trackId, m.jobId))) return false;
  const s = m.source as AudioTrackJobMessage['source'] | undefined;
  if (s?.type === 'upload') return typeof s.uploadId === 'string' && SAFE_JOB.test(s.uploadId) && Number.isInteger(s.bytes) && s.bytes > 0 && s.bytes <= AUDIO_TRACK_MAX_BYTES;
  if (s?.type === 'source_stream') return Number.isInteger(s.streamIndex) && s.streamIndex >= 0 && s.streamIndex < 64;
  return false;
}

export function isAudioPackageJobMessage(value: unknown): value is AudioPackageJobMessage {
  const m = value as Partial<AudioPackageJobMessage> | null;
  if (!m || m.kind !== 'audio_package' || typeof m.videoId !== 'string' || !SAFE_VIDEO.test(m.videoId)) return false;
  if (typeof m.jobId !== 'string' || !SAFE_JOB.test(m.jobId) || typeof m.rev !== 'string' || !SAFE_REV.test(m.rev) || (m.access !== 'pub' && m.access !== 'priv')) return false;
  if (!Number.isInteger(m.version) || (m.version as number) < 1 || typeof m.queuedAt !== 'string') return false;
  if (!Array.isArray(m.rungs) || !m.rungs.length || m.rungs.length > 8 || !m.rungs.every((r) => typeof r === 'string' && /^[0-9]{2,4}p$/.test(r))) return false;
  if (!Array.isArray(m.tracks) || m.tracks.length < 2 || m.tracks.length > AUDIO_TRACKS_HARD_MAX + 1) return false;
  if (m.tracks[0]?.id !== ORIGINAL_AUDIO_TRACK_ID) return false;
  return m.tracks.every((t) => isAudioTrackId(t?.id) && isAudioTrackLanguage(t.language) && typeof t.label === 'string' && t.label.length > 0 && t.label.length <= AUDIO_LABEL_MAX && isAudioTrackKind(t.kind) && typeof t.isDefault === 'boolean');
}

export function isAudioProbeJobMessage(value: unknown): value is AudioProbeJobMessage {
  const m = value as Partial<AudioProbeJobMessage> | null;
  return !!m && m.kind === 'audio_probe' && typeof m.videoId === 'string' && SAFE_VIDEO.test(m.videoId) && typeof m.jobId === 'string' && SAFE_JOB.test(m.jobId) && typeof m.queuedAt === 'string';
}

/** apps/media → api-videos POST /internal/audio-tracks/:videoId/:trackId/prepared */
export type AudioTrackReport =
  | { jobId: string; ok: true; durationSeconds: number; reviewManifestKey?: string }
  | { jobId: string; ok: false; error: string; retryable: boolean };

/** apps/media → api-videos POST /internal/audio-tracks/:videoId/package */
export type AudioPackageReport =
  | { jobId: string; rev: string; access: 'pub' | 'priv'; ok: true; master: string; trackIds: string[] }
  | { jobId: string; rev: string; access: 'pub' | 'priv'; ok: false; error: string; retryable: boolean };

/** apps/media → api-videos POST /internal/audio-tracks/:videoId/detected */
export type AudioProbeReport = { jobId: string; ok: true; streams: DetectedAudioStream[] } | { jobId: string; ok: false; error: string };

/** Bounded, validated detected streams (from the container). */
export function sanitizeDetectedStreams(input: unknown): DetectedAudioStream[] {
  if (!Array.isArray(input)) return [];
  const clean = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.replace(/[\u0000-\u001f]/g, '').trim().slice(0, max) : undefined);
  const out: DetectedAudioStream[] = [];
  for (const raw of input.slice(0, 32)) {
    const s = raw as Partial<DetectedAudioStream> | null;
    if (!s || !Number.isInteger(s.index) || (s.index as number) < 0 || (s.index as number) >= 64) continue;
    const language = clean(s.language, 8);
    const title = clean(s.title, 80);
    const codec = clean(s.codec, 20);
    out.push({
      index: s.index as number,
      ...(language ? { language } : {}),
      ...(title ? { title } : {}),
      ...(Number.isInteger(s.channels) && (s.channels as number) > 0 && (s.channels as number) <= 32 ? { channels: s.channels } : {}),
      ...(codec ? { codec } : {}),
    });
  }
  return out;
}

/** ISO 639-2 tags in file metadata → our codes (multi-track sources usually carry 3-letter tags). */
const ISO_639_2: Record<string, AudioTrackLanguage> = { ara: 'ar', eng: 'en', urd: 'ur', fra: 'fr', fre: 'fr', ind: 'id', tur: 'tr', msa: 'ms', may: 'ms', ben: 'bn', deu: 'de', ger: 'de', spa: 'es' };
export function detectedStreamLanguage(tag: string | undefined): AudioTrackLanguage | undefined {
  if (!tag) return undefined;
  const t = tag.toLowerCase().split(/[-_]/)[0]!;
  if (isAudioTrackLanguage(t)) return t;
  return ISO_639_2[t];
}

/** Track input from Studio, validated (POST and PATCH share the rules). */
export interface AudioTrackInput {
  language?: unknown;
  label?: unknown;
  kind?: unknown;
  isDefault?: unknown;
}

export function validateAudioTrackInput(input: AudioTrackInput, partial: boolean): { ok: true; value: { language?: AudioTrackLanguage; label?: string; kind?: AudioTrackKind; isDefault?: boolean } } | { ok: false; error: string } {
  const value: { language?: AudioTrackLanguage; label?: string; kind?: AudioTrackKind; isDefault?: boolean } = {};
  if (input.language !== undefined || !partial) {
    if (!isAudioTrackLanguage(input.language)) return { ok: false, error: 'language must be one of ' + AUDIO_TRACK_LANGUAGES.map((l) => l.code).join(', ') };
    value.language = input.language;
  }
  if (input.label !== undefined && input.label !== null && input.label !== '') {
    if (typeof input.label !== 'string') return { ok: false, error: 'label must be text' };
    const label = input.label.replace(/[\u0000-\u001f"]/g, '').trim();
    if (!label || label.length > AUDIO_LABEL_MAX) return { ok: false, error: `label must be 1 to ${AUDIO_LABEL_MAX} characters` };
    value.label = label;
  }
  if (input.kind !== undefined || !partial) {
    if (!isAudioTrackKind(input.kind)) return { ok: false, error: 'kind must be one of ' + AUDIO_TRACK_KINDS.join(', ') };
    value.kind = input.kind;
  }
  if (input.isDefault !== undefined) {
    if (typeof input.isDefault !== 'boolean') return { ok: false, error: 'isDefault must be true or false' };
    value.isDefault = input.isDefault;
  }
  return { ok: true, value };
}

/** Extra tracks that count against the tier limit (everything but the original, failed and rejected ones). */
export function countedAudioTracks(tracks: AudioTrack[] | undefined): number {
  return (tracks ?? []).filter((t) => t.id !== ORIGINAL_AUDIO_TRACK_ID && t.status !== 'failed' && t.review?.status !== 'rejected').length;
}
