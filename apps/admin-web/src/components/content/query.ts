/**
 * URL query helpers for the content list pages. Filters live in the URL so a
 * filtered list can be shared and the back button works; each page whitelists
 * the parameters it accepts.
 */
export type SearchParams = Record<string, string | string[] | undefined>;

export function firstParam(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  const trimmed = v?.trim();
  return trimmed ? trimmed : undefined;
}

/** Only the allowed keys, with enum values checked; everything else is dropped. */
export function pickParams(
  params: SearchParams,
  spec: Record<string, readonly string[] | 'text' | 'date' | 'page' | 'cursor'>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, rule] of Object.entries(spec)) {
    const value = firstParam(params[key]);
    if (value === undefined) continue;
    if (rule === 'text') out[key] = value.slice(0, 200);
    else if (rule === 'date') {
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) out[key] = value;
    } else if (rule === 'cursor') {
      // Opaque keyset cursor from the API (ks:<base64url>)
      if (/^ks:[A-Za-z0-9_-]{1,1500}$/.test(value)) out[key] = value;
    } else if (rule === 'page') {
      const n = Number(value);
      if (Number.isInteger(n) && n > 1) out[key] = String(Math.min(n, 10000));
    } else if (rule.includes(value)) out[key] = value;
  }
  return out;
}

export function hrefWith(base: string, params: Record<string, string | undefined>, overrides: Record<string, string | undefined> = {}): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...params, ...overrides })) {
    if (value !== undefined && value !== '') search.set(key, value);
  }
  const query = search.toString();
  return query ? `${base}?${query}` : base;
}

export const PAGE_SIZE = 20;

/** The list's filters without its position (page number, cursor): links to the first or next page. */
export function withoutPaging(params: Record<string, string>): Record<string, string> {
  const out = { ...params };
  delete out.page;
  delete out.cursor;
  return out;
}
