/**
 * Transcript search (AUN-CAPTIONS §5.10, P5): every published caption track (a transcription, a
 * creator-edited one, a machine translation or an uploaded file) is split into short passages
 * with their start time and indexed in SEARCH_DB, so search can say where in a video something is
 * said and open it there (`?t=`).
 *
 * - Source: the published WebVTT in the subtitles bucket (`{videoId}/{language}.vtt`). Quran spans
 *   are markers in that file and carry no text, so recitation is never indexed: only speech.
 * - Visibility is decided at query time by joining search_videos (visible rows of visible
 *   channels), so a private, unlisted-by-channel, hidden or deleted video never matches.
 * - Writes come from the processor (MessageType.TranscriptIndexSync, retried, then the DLQ and an
 *   admin flag); a deleted video's passages go with its search row (removeSearchDocument).
 */
import type { SearchDb, SearchStatement } from './store';
import { normalizeSearchText } from './normalize';

export const TRANSCRIPT_TABLE = 'search_transcripts';
export const TRANSCRIPT_FTS_TABLE = 'search_transcripts_fts';

/** A published track in the subtitles bucket: `{videoId}/{language}.vtt` */
export const TRANSCRIPT_TRACK_KEY = /^([A-Za-z0-9_-]{1,80})\/([a-z]{2,3}(?:-[A-Za-z]{2,4})?)\.vtt$/;

/** A passage ends once it is this long or spans this much time */
export const PASSAGE_MAX_CHARS = 160;
export const PASSAGE_MAX_MS = 30_000;
/** At most this many passages per track (about 4 hours of steady speech) */
export const MAX_PASSAGES_PER_TRACK = 1500;
/** Statements per D1 batch */
const BATCH_STATEMENTS = 200;

export interface TranscriptIndexSyncPayload {
  videoId: string;
  language: string;
  /** When the track was written or deleted (ms): an older message never replaces a newer index */
  version: number;
}

export interface TranscriptPassage {
  startMs: number;
  text: string;
}

/** The video and language a subtitles-bucket key holds, or null when it is not a published track. */
export function transcriptTrackForKey(key: string): { videoId: string; language: string } | null {
  const match = TRANSCRIPT_TRACK_KEY.exec(key);
  return match ? { videoId: match[1]!, language: match[2]! } : null;
}

const TIMING = /^\s*((?:\d+:)?\d{1,2}:\d{2}[.,]\d{3})\s+-->\s+((?:\d+:)?\d{1,2}:\d{2}[.,]\d{3})/;
const QURAN_MARKER = /[^]*/g;
const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&nbsp;': ' ', '&lrm;': '', '&rlm;': '', '&quot;': '"', '&#39;': "'" };

function timestampMs(stamp: string): number {
  const parts = stamp.replace(',', '.').split(':');
  const seconds = Number(parts.pop());
  const minutes = Number(parts.pop() ?? 0);
  const hours = Number(parts.pop() ?? 0);
  return Math.round(((hours * 60 + minutes) * 60 + seconds) * 1000);
}

/** Drops every <...> tag and any stray angle bracket in one linear pass, so no tag can survive. */
function withoutTags(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '<') {
      const end = text.indexOf('>', i);
      if (end < 0) break;
      i = end + 1;
      continue;
    }
    if (ch !== '>') out += ch;
    i += 1;
  }
  return out;
}

function cueText(lines: string[]): string {
  // Tags go before entities are decoded, and decoding runs once, so a decoded &lt; stays plain text.
  return withoutTags(lines.join(' ').replace(QURAN_MARKER, ' '))
    .replace(/&[a-z#0-9]+;/gi, (e) => ENTITIES[e.toLowerCase()] ?? e)
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The speech of a WebVTT file as passages: neighbouring cues joined until a passage reaches
 * PASSAGE_MAX_CHARS or PASSAGE_MAX_MS. Quran markers, styling tags, NOTE/STYLE blocks and empty
 * cues are left out.
 */
export function transcriptPassages(vtt: string): TranscriptPassage[] {
  const passages: TranscriptPassage[] = [];
  let current: TranscriptPassage | null = null;
  const flush = () => {
    if (current?.text) passages.push(current);
    current = null;
  };
  for (const block of vtt.replace(/\r\n?/g, '\n').split(/\n{2,}/)) {
    const lines = block.split('\n');
    const at = lines.findIndex((l) => TIMING.test(l));
    if (at < 0) continue;
    const startMs = timestampMs(TIMING.exec(lines[at]!)![1]!);
    const text = cueText(lines.slice(at + 1));
    if (!text) continue;
    if (current && (current.text.length >= PASSAGE_MAX_CHARS || startMs - current.startMs >= PASSAGE_MAX_MS)) flush();
    if (!current) current = { startMs, text };
    else current.text = `${current.text} ${text}`;
    if (passages.length >= MAX_PASSAGES_PER_TRACK) break;
  }
  flush();
  return passages.slice(0, MAX_PASSAGES_PER_TRACK);
}

function deleteTrackStatements(db: SearchDb, videoId: string, language?: string): SearchStatement[] {
  const where = language ? 'video_id = ? AND language = ?' : 'video_id = ?';
  const binds = language ? [videoId, language] : [videoId];
  return [
    db.prepare(`DELETE FROM ${TRANSCRIPT_FTS_TABLE} WHERE rowid IN (SELECT rowid FROM ${TRANSCRIPT_TABLE} WHERE ${where})`).bind(...binds),
    db.prepare(`DELETE FROM ${TRANSCRIPT_TABLE} WHERE ${where}`).bind(...binds),
  ];
}

/** Every passage of a video, all languages (the video was deleted). */
export function removeVideoTranscriptStatements(db: SearchDb, videoId: string): SearchStatement[] {
  return deleteTrackStatements(db, videoId);
}

export type TranscriptSyncResult = 'indexed' | 'removed' | 'stale';

/**
 * Replace one track's passages (vtt null: the track was deleted). A message older than what is
 * indexed for that track changes nothing.
 */
export async function syncTranscriptTrack(
  db: SearchDb,
  track: { videoId: string; language: string; version: number },
  vtt: string | null,
): Promise<TranscriptSyncResult> {
  const { videoId, language, version } = track;
  const current = await db
    .prepare(`SELECT MAX(source_version) AS v FROM ${TRANSCRIPT_TABLE} WHERE video_id = ? AND language = ?`)
    .bind(videoId, language)
    .first<{ v: number | null }>();
  if (current?.v != null && Number(current.v) > version) return 'stale';

  const passages = vtt ? transcriptPassages(vtt) : [];
  const statements: SearchStatement[] = deleteTrackStatements(db, videoId, language);
  for (const p of passages) {
    const body = normalizeSearchText(p.text);
    if (!body) continue;
    statements.push(
      db.prepare(`INSERT INTO ${TRANSCRIPT_TABLE} (video_id, language, start_ms, text, source_version) VALUES (?, ?, ?, ?, ?)`).bind(videoId, language, p.startMs, p.text, version),
      db.prepare(`INSERT INTO ${TRANSCRIPT_FTS_TABLE} (rowid, body) VALUES (last_insert_rowid(), ?)`).bind(body),
    );
  }
  for (let i = 0; i < statements.length; i += BATCH_STATEMENTS) {
    await db.batch(statements.slice(i, i + BATCH_STATEMENTS));
  }
  return passages.length ? 'indexed' : 'removed';
}
