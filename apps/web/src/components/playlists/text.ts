/**
 * Small text helpers for the playlist tools (pure, unit-tested). Numbers go through
 * locale-format, so Arabic shows Eastern Arabic (Hindi) numerals ٠–٩.
 */
import { fillTemplate, formatClock } from '@al-ummah/shared-types';

/** Replaces `{name}` placeholders; numbers in the page language's digits. */
export function fill(template: string, vars: Record<string, string | number>, lang = 'en'): string {
  return fillTemplate(lang, template, vars);
}

/** The one/other form of a counted string (`{count}` filled in). */
export function counted(count: number, one: string, other: string, vars: Record<string, string | number> = {}, lang = 'en'): string {
  return fill(count === 1 ? one : other, { count, ...vars }, lang);
}

/** 75 → "1:15", 3725 → "1:02:05". Empty for unknown durations. */
export function formatDuration(seconds: number | null | undefined, lang = 'en'): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return '';
  return formatClock(lang, seconds);
}

/** A title in the page language, falling back to the stored one. */
export function localTitle(video: { title?: string | null; titleLocalized?: Record<string, string> | null }, lang: string): string {
  return video.titleLocalized?.[lang] || video.title || '';
}
