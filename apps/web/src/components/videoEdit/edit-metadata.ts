/**
 * Helpers for initialising and diffing editable video metadata (tags/category).
 */

import { VIDEO_CATEGORIES, type VideoCategory } from '@al-ummah/shared-types';

const MAX_TAG_LENGTH = 50;

const KNOWN_CATEGORIES = new Set<string>(VIDEO_CATEGORIES.map((c) => c.value));

/**
 * Normalize a single user-entered tag (trim, collapse whitespace, cap length).
 * Returns an empty string for blank input.
 */
export function normalizeTag(input: string): string {
  return input.trim().replace(/\s+/g, ' ').slice(0, MAX_TAG_LENGTH);
}

/**
 * Parse tags as stored on a video. The API stores an array, but older records
 * (and some create paths) may carry a comma-separated string.
 */
export function parseVideoTags(raw: unknown): string[] {
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw.split(',')
      : [];

  const seen = new Set<string>();
  const tags: string[] = [];
  for (const item of list) {
    if (typeof item !== 'string') continue;
    const tag = normalizeTag(item);
    if (tag && !seen.has(tag)) {
      seen.add(tag);
      tags.push(tag);
    }
  }
  return tags;
}

/**
 * Parse a stored category, ignoring values that are not known categories.
 */
export function parseVideoCategory(raw: unknown): VideoCategory | '' {
  return typeof raw === 'string' && KNOWN_CATEGORIES.has(raw) ? (raw as VideoCategory) : '';
}

export function getInitialEditMetadata(video: { tags?: unknown; category?: unknown }): {
  tags: string[];
  category: VideoCategory | '';
} {
  return {
    tags: parseVideoTags(video.tags),
    category: parseVideoCategory(video.category),
  };
}

/**
 * Tags are an ordered list in the UI; any difference in order or content is a change.
 */
export function haveTagsChanged(original: string[], current: string[]): boolean {
  if (original.length !== current.length) return true;
  return original.some((tag, index) => tag !== current[index]);
}
