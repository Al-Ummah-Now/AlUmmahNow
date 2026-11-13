/**
 * Reads our Quran Foundation copy (AUN-CAPTIONS) from the private media bucket, written by the
 * processor's Content Sync job (`quran/current.json` → `quran/text/<version>/<surah>.json`).
 * A copy older than 7 days is never served (QF terms): callers get null and show references only.
 */
import { QURAN_CURRENT_KEY, quranCopyFresh, quranPassage, quranTextKey, type QuranCurrent, type QuranRange, type QuranSurahFile } from '@al-ummah/shared-types';

type Bucket = { get(key: string): Promise<{ json<T>(): Promise<T> } | null> };

const POINTER_TTL_MS = 5 * 60_000;
const MAX_SURAHS = 24;
let pointer: { at: number; value: QuranCurrent | null } | null = null;
const surahs = new Map<string, QuranSurahFile>();

/** Test hook: forget the cached pointer and surahs. */
export function clearQuranCopyCache(): void {
  pointer = null;
  surahs.clear();
}

export async function readQuranCurrent(bucket: Bucket | undefined, now = Date.now()): Promise<QuranCurrent | null> {
  if (!bucket) return null;
  if (!pointer || now - pointer.at > POINTER_TTL_MS) {
    const obj = await bucket.get(QURAN_CURRENT_KEY);
    pointer = { at: now, value: obj ? await obj.json<QuranCurrent>() : null };
  }
  return pointer.value && quranCopyFresh(pointer.value, now) ? pointer.value : null;
}

export async function readQuranSurah(bucket: Bucket | undefined, surah: number, now = Date.now()): Promise<{ current: QuranCurrent; file: QuranSurahFile } | null> {
  const current = await readQuranCurrent(bucket, now);
  if (!current || !bucket) return null;
  const key = quranTextKey(current.version, surah);
  let file = surahs.get(key);
  if (!file) {
    const obj = await bucket.get(key);
    if (!obj) return null;
    file = await obj.json<QuranSurahFile>();
    if (surahs.size >= MAX_SURAHS) surahs.delete(surahs.keys().next().value!);
    surahs.set(key, file);
  }
  return { current, file };
}

export type PassageResult =
  | { status: 'ok'; current: QuranCurrent; file: QuranSurahFile; ayat: Array<{ ayah: number; text: string; partial: boolean }> }
  | { status: 'unavailable' | 'not_found' };

/** The official text of a range; `unavailable` when there is no fresh copy, `not_found` for a range the copy does not have. */
export async function readQuranPassage(bucket: Bucket | undefined, range: QuranRange, now = Date.now()): Promise<PassageResult> {
  const got = await readQuranSurah(bucket, range.from.surah, now);
  if (!got) return { status: (await readQuranCurrent(bucket, now)) ? 'not_found' : 'unavailable' };
  const passage = quranPassage(got.file, range);
  return passage ? { status: 'ok', current: got.current, file: got.file, ayat: passage.ayat } : { status: 'not_found' };
}
