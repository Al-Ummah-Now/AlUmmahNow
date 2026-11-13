/**
 * Which video each picked file is being uploaded into, kept in localStorage so
 * a page reload or a browser crash resumes the SAME video (and, through the
 * per-video tus fingerprint, the same upload URL at Bunny's offset) when the
 * user picks the file again, instead of creating a new video from byte 0.
 *
 * Keyed by channel + file identity (name, size, lastModified). Entries are
 * dropped when an upload is cancelled or removed, and after 7 days. A finished
 * upload keeps its entry, so picking the file again shows "Already uploaded"
 * (uploadResume answers completed) instead of a duplicate video, in the batch
 * and the single uploader alike; the single uploader creates a new video only
 * when the user picks "Upload again as a new video" (picked-file.ts).
 */

export interface RememberedUpload {
  videoId: string;
  channelId: string;
  savedAt: number;
}

type FileIdentity = Pick<File, 'name' | 'size' | 'lastModified'>;

const STORAGE_KEY = 'aun-upload-resume:v1';
export const REMEMBERED_UPLOAD_TTL_MS = 7 * 24 * 3600 * 1000;
const MAX_ENTRIES = 200;

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function fileResumeKey(file: FileIdentity, channelId: string): string {
  return `${channelId}:${file.name}:${file.size}:${file.lastModified}`;
}

function readAll(storage: StorageLike | null): Record<string, RememberedUpload> {
  if (!storage) return {};
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(storage: StorageLike | null, entries: Record<string, RememberedUpload>, now: number): void {
  if (!storage) return;
  const fresh = Object.entries(entries)
    .filter(([, e]) => e && typeof e.videoId === 'string' && now - e.savedAt < REMEMBERED_UPLOAD_TTL_MS)
    .sort(([, a], [, b]) => b.savedAt - a.savedAt)
    .slice(0, MAX_ENTRIES);
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(fresh)));
  } catch {
    // storage full or blocked: resuming after a reload is best effort
  }
}

export function rememberUpload(file: FileIdentity, channelId: string, videoId: string, now = Date.now(), storage = defaultStorage()): void {
  const entries = readAll(storage);
  entries[fileResumeKey(file, channelId)] = { videoId, channelId, savedAt: now };
  writeAll(storage, entries, now);
}

export function findRememberedUpload(file: FileIdentity, channelId: string, now = Date.now(), storage = defaultStorage()): RememberedUpload | null {
  const entry = readAll(storage)[fileResumeKey(file, channelId)];
  if (!entry || now - entry.savedAt >= REMEMBERED_UPLOAD_TTL_MS) return null;
  return entry;
}

export function forgetUpload(file: FileIdentity, channelId: string, now = Date.now(), storage = defaultStorage()): void {
  const entries = readAll(storage);
  const key = fileResumeKey(file, channelId);
  if (!(key in entries)) return;
  delete entries[key];
  writeAll(storage, entries, now);
}
