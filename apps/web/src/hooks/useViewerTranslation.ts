'use client';

/**
 * A viewer's machine translation of a video's title and description (AUN-CAPTIONS §5.9, decision
 * O6: labelled, each channel can opt out, an admin can pause it). Asked only when the title is not already in the
 * viewer's language and the creator wrote none in it, so most watch views make no request. The
 * title (VideoDetails) and the description (WatchPageContent) share one answer and one
 * "Show original" choice per video.
 */
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { guessTitleLanguage } from '@al-ummah/shared-types';
import { getTranslatedMetadata, type ViewerTranslation } from '@/lib/api/translate-client';

type Entry = { translation: ViewerTranslation['translation']; showOriginal: boolean; asked: boolean };

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
const EMPTY: Entry = { translation: null, showOriginal: false, asked: false };
/** While the translation is being made (queued), ask again this often, at most this many times */
const PENDING_RETRY_MS = 15_000;
const PENDING_RETRIES = 2;

const emit = () => listeners.forEach((l) => l());
const set = (key: string, patch: Partial<Entry>) => {
  entries.set(key, { ...(entries.get(key) ?? EMPTY), ...patch });
  emit();
};

/** Whether a viewer of `lang` could be offered a translation of this video at all (no request otherwise). */
export function wantsViewerTranslation(video: { title?: string; titleLocalized?: Record<string, string | undefined> }, lang: string): boolean {
  if (!video.title?.trim()) return false;
  if (video.titleLocalized?.[lang]?.trim()) return false;
  return guessTitleLanguage(video.title) !== lang;
}

async function load(videoId: string, lang: string, key: string, attempt = 0): Promise<void> {
  const res = await getTranslatedMetadata(videoId, lang);
  if (!res.ok) return;
  if (res.data.translation) set(key, { translation: res.data.translation });
  else if (res.data.pending && attempt < PENDING_RETRIES) setTimeout(() => void load(videoId, lang, key, attempt + 1), PENDING_RETRY_MS);
}

export function useViewerTranslation(video: { id: string; title?: string; titleLocalized?: Record<string, string | undefined> } | null, lang: string) {
  const key = video ? `${video.id}:${lang}` : '';
  const entry = useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => (key ? (entries.get(key) ?? EMPTY) : EMPTY),
    () => EMPTY,
  );
  const wanted = !!video && wantsViewerTranslation(video, lang);

  useEffect(() => {
    if (!video || !wanted || entries.get(key)?.asked) return;
    set(key, { asked: true });
    void load(video.id, lang, key);
  }, [video, wanted, key, lang]);

  const toggle = useCallback(() => {
    if (key) set(key, { showOriginal: !(entries.get(key) ?? EMPTY).showOriginal });
  }, [key]);

  const translation = wanted ? entry.translation : null;
  return { translation, showOriginal: entry.showOriginal, showing: !!translation && !entry.showOriginal, toggle };
}
