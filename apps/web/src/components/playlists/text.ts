/**
 * Small text helpers for the playlist tools (pure, unit-tested).
 */

/** Replaces `{name}` placeholders. */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? String(vars[key]) : match));
}

/** The one/other form of a counted string (`{count}` filled in). */
export function counted(count: number, one: string, other: string, vars: Record<string, string | number> = {}): string {
  return fill(count === 1 ? one : other, { count, ...vars });
}

/** 75 → "1:15", 3725 → "1:02:05". Empty for unknown durations. */
export function formatDuration(seconds: number | null | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return '';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** A title in the page language, falling back to the stored one. */
export function localTitle(video: { title?: string | null; titleLocalized?: Record<string, string> | null }, lang: string): string {
  return video.titleLocalized?.[lang] || video.title || '';
}
