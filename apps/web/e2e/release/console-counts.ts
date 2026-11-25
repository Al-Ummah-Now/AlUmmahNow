/**
 * What a failed stage check may say about the page's console: counts only. The release suite's
 * failure messages go to public CI logs, and console text carries signed media URLs, tokens and
 * addresses, so no line is ever kept or printed: each is counted by its level and by the fixed
 * markers below, and then dropped. A marker's name comes from this file, never from the line; the
 * only thing taken from a line is a three-digit 4xx/5xx status.
 *
 * No imports: node --test (scripts/qa/__tests__/embed-console-counts.test.ts) loads it as it is.
 */
const MARKERS: Array<[string, RegExp]> = [
  ['MEDIA_ERR_ABORTED', /MEDIA_ERR_ABORTED/g],
  ['MEDIA_ERR_NETWORK', /MEDIA_ERR_NETWORK/g],
  ['MEDIA_ERR_DECODE', /MEDIA_ERR_DECODE/g],
  ['MEDIA_ERR_SRC_NOT_SUPPORTED', /MEDIA_ERR_SRC_NOT_SUPPORTED/g],
  ['MEDIA_ERR_ENCRYPTED', /MEDIA_ERR_ENCRYPTED/g],
  ['NotAllowedError', /NotAllowedError/g],
  ['AbortError', /AbortError/g],
  ['NotSupportedError', /NotSupportedError/g],
  ['CORS', /\bCORS\b|Access-Control-Allow-Origin/g],
  ['CSP', /\bCSP\b|Content[ -]Security[ -]Policy/g],
  ['VIDEOJS', /VIDEOJS/g],
];

/** "HTTP 403", "status of 403" (Chromium), "Status code: 403" (WebKit) */
const HTTP_STATUS = /\b(?:HTTP(?:\/[\d.]+)?|status(?: of| code)?)[:\s]+([45]\d\d)\b/gi;

export interface ConsoleCounts {
  /** Lines per console level */
  levels: Record<string, number>;
  /** How often each known marker or HTTP error status appeared */
  markers: Record<string, number>;
}

export const noConsoleCounts = (): ConsoleCounts => ({ levels: {}, markers: {} });

const add = (to: Record<string, number>, key: string, n: number) => {
  if (n > 0) to[key] = (to[key] ?? 0) + n;
};

/** Counts one console line; nothing of its text is kept */
export function countConsoleLine(counts: ConsoleCounts, level: string, text: string): void {
  add(counts.levels, level, 1);
  for (const [name, pattern] of MARKERS) add(counts.markers, name, text.match(pattern)?.length ?? 0);
  for (const found of text.matchAll(HTTP_STATUS)) add(counts.markers, `HTTP ${found[1]}`, 1);
}
