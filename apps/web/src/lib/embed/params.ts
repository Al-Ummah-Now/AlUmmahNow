/**
 * Embed URL parameters (docs/embeds/README.md §2).
 *
 * Pure parsing/validation shared by the embed pages, the watch page (?t=) and
 * oEmbed. Invalid values fall back to the defaults; nothing here throws.
 */

export type EmbedLang = 'en' | 'ar';

export interface EmbedParams {
  lang: EmbedLang;
  /** Start position in seconds (0 = beginning) */
  start: number;
  /** Pause position in seconds, only when after `start` */
  end: number | null;
  /** Autoplay, always muted */
  autoplay: boolean;
  loop: boolean;
  /** Title bar over the player */
  showTitle: boolean;
  /** Playlist item to start with (0-based) */
  index: number;
  /** Requested postMessage partner origin (validated later against the real embedder) */
  origin: string | null;
}

export type RawParams = Record<string, string | string[] | undefined> | URLSearchParams;

/** Longest accepted position: 48 h, far beyond any video, guards against absurd values. */
const MAX_SECONDS = 48 * 3600;

function first(raw: RawParams, key: string): string | undefined {
  if (raw instanceof URLSearchParams) return raw.get(key) ?? undefined;
  const value = raw[key];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Parse a time position: "754", "754s", "12m34s", "1h2m3s", "2m".
 * Returns null for anything else (negative, empty, garbage, too large).
 */
export function parseTime(value: string | null | undefined): number | null {
  if (value == null) return null;
  const text = value.trim().toLowerCase();
  if (!text) return null;
  let seconds: number;
  if (/^\d+(\.\d+)?$/.test(text)) {
    seconds = Math.floor(Number(text));
  } else {
    const match = text.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
    if (!match || (!match[1] && !match[2] && !match[3])) return null;
    seconds = Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
  }
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > MAX_SECONDS) return null;
  return seconds;
}

function flag(value: string | undefined): boolean {
  return value === '1' || value === 'true';
}

/** An http(s) origin ("https://example.org[:port]"), or null. Paths are dropped. */
export function normalizeOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function parseEmbedLang(value: string | null | undefined): EmbedLang {
  return value === 'ar' ? 'ar' : 'en';
}

export function parseEmbedParams(raw: RawParams): EmbedParams {
  const start = parseTime(first(raw, 'start') ?? first(raw, 't')) ?? 0;
  const endValue = parseTime(first(raw, 'end'));
  const indexValue = Number(first(raw, 'index'));
  return {
    lang: parseEmbedLang(first(raw, 'lang')),
    start,
    end: endValue !== null && endValue > start ? endValue : null,
    autoplay: flag(first(raw, 'autoplay')),
    loop: flag(first(raw, 'loop')),
    showTitle: first(raw, 'title') !== '0',
    index: Number.isInteger(indexValue) && indexValue >= 0 ? indexValue : 0,
    origin: normalizeOrigin(first(raw, 'origin')),
  };
}

/** Video and playlist ids are UUIDs / opaque tokens; refuse anything that could break out of a path. */
export function isValidContentId(id: string | null | undefined): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id);
}
