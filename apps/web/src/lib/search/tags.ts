/**
 * Tag suggestions: the tags a creator already uses, most used first, and
 * helpers for comma-separated tag fields (both "," and the Arabic "،").
 */

import { normalizeSearchText } from '@al-ummah/shared-types';

const SEPARATOR = /[,،]/;

/** Known tags by how often they are used, one spelling per normalised form. */
export function collectTags(items: ReadonlyArray<{ tags?: ReadonlyArray<string> | null }>): string[] {
  const counts = new Map<string, { tag: string; count: number }>();
  for (const item of items) {
    for (const raw of item.tags ?? []) {
      const tag = typeof raw === 'string' ? raw.trim() : '';
      const key = normalizeSearchText(tag);
      if (!key) continue;
      const entry = counts.get(key);
      if (entry) entry.count += 1;
      else counts.set(key, { tag, count: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)).map((e) => e.tag);
}

/** The tags typed so far in a comma-separated field. */
export function splitTagList(text: string): string[] {
  return text.split(SEPARATOR).map((t) => t.trim()).filter(Boolean);
}

/** The tag being typed (after the last comma). */
export function lastTagSegment(text: string): string {
  const parts = text.split(SEPARATOR);
  return parts[parts.length - 1] ?? '';
}

/** Replace the tag being typed with `tag`, ready for the next one. */
export function replaceLastTag(text: string, tag: string): string {
  const match = /^(.*[,،])/s.exec(text);
  const head = match ? `${match[1].replace(/\s+$/, '')} ` : '';
  return `${head}${tag}, `;
}

/** Known tags not already in `used` (normalised comparison). */
export function unusedTags(known: ReadonlyArray<string>, used: ReadonlyArray<string>): string[] {
  const taken = new Set(used.map((t) => normalizeSearchText(t)));
  return known.filter((t) => !taken.has(normalizeSearchText(t)));
}
