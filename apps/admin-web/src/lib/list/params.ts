/**
 * The URL codec of the admin lists: filters, sort, page or cursor live in the
 * query string, so a filtered list can be shared and Back returns to it.
 *
 * A list declares its parameters once (a ListSpec). Parsing keeps only those
 * keys, with each value checked against its rule; serializing writes them in
 * the spec's order and drops empty values, so the same filters always give the
 * same query string (it is also the list's cache key, on the server and in
 * the browser). A saved view is a named set of filter values: the active view
 * is the one whose values are exactly the filters in the URL, so a view needs
 * no parameter of its own and a shared link opens on the same tab.
 *
 * Pure (no React, no Next): the server page, the client hooks and the unit
 * tests all use it.
 */

/** text: free text (trimmed, at most 200 characters); date: YYYY-MM-DD; page: an integer above 1; cursor: an opaque token; a list: one of these values. */
export type ParamRule = 'text' | 'date' | 'page' | 'cursor' | readonly string[];

export type ListSpec = Readonly<Record<string, ParamRule>>;

/** Parsed values: only the keys present and valid. */
export type ListValues = Record<string, string>;

/** What a change sets: a string sets the key, undefined or '' removes it. */
export type ListChanges = Record<string, string | undefined>;

export interface SavedView {
  id: string;
  /** The filters this view sets; every other filter is cleared. */
  params: ListValues;
}

/** Keys that are not filters: they never decide the saved view and a filter change does not keep the page. */
export const NON_FILTER_KEYS = ['sort', 'page', 'cursor'] as const;

const TEXT_MAX = 200;
const CURSOR_MAX = 500;
const PAGE_MAX = 10000;

type SearchInput = URLSearchParams | Record<string, string | string[] | undefined> | string;

function first(input: SearchInput, key: string): string | undefined {
  if (typeof input === 'string') return new URLSearchParams(input.startsWith('?') ? input.slice(1) : input).get(key) ?? undefined;
  if (input instanceof URLSearchParams) return input.get(key) ?? undefined;
  const value = input[key];
  return Array.isArray(value) ? value[0] : value;
}

/** One value checked against its rule; undefined when it is empty or invalid. */
export function checkValue(rule: ParamRule, raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  if (rule === 'text') return value.slice(0, TEXT_MAX);
  if (rule === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) ? value : undefined;
  if (rule === 'page') {
    const n = Number(value);
    return Number.isInteger(n) && n > 1 ? String(Math.min(n, PAGE_MAX)) : undefined;
  }
  if (rule === 'cursor') return value.length <= CURSOR_MAX && /^[\w\-.:~=+/]+$/.test(value) ? value : undefined;
  return rule.includes(value) ? value : undefined;
}

/** Only the spec's keys, each checked; everything else in the URL is ignored. */
export function parseListParams(spec: ListSpec, input: SearchInput): ListValues {
  const out: ListValues = {};
  for (const [key, rule] of Object.entries(spec)) {
    const value = checkValue(rule, first(input, key));
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** The canonical query string (no leading "?"): the spec's order, empty values dropped. */
export function serializeListParams(spec: ListSpec, values: ListChanges): string {
  const search = new URLSearchParams();
  for (const [key, rule] of Object.entries(spec)) {
    const value = checkValue(rule, values[key]);
    if (value !== undefined) search.set(key, value);
  }
  return search.toString();
}

/** `base` with the query, or `base` alone when there is none. */
export function listHref(base: string, spec: ListSpec, values: ListChanges): string {
  const query = serializeListParams(spec, values);
  return query ? `${base}?${query}` : base;
}

/**
 * Applies a change. Any change that is not only the page or cursor starts
 * again from the first page: page 4 of another filter is a different list.
 */
export function mergeListParams(spec: ListSpec, current: ListValues, changes: ListChanges): ListValues {
  const next: ListChanges = { ...current, ...changes };
  const paging = Object.keys(changes).every((k) => k === 'page' || k === 'cursor');
  if (!paging) {
    if (!('page' in changes)) delete next.page;
    if (!('cursor' in changes)) delete next.cursor;
  }
  return parseListParams(spec, Object.fromEntries(Object.entries(next).filter((e): e is [string, string] => e[1] !== undefined)));
}

/** The filters only (no sort, page or cursor). */
export function filtersOf(values: ListValues): ListValues {
  const out: ListValues = {};
  for (const [key, value] of Object.entries(values)) {
    if (!(NON_FILTER_KEYS as readonly string[]).includes(key)) out[key] = value;
  }
  return out;
}

/** True when the URL has any filter set. */
export function hasFilters(values: ListValues): boolean {
  return Object.keys(filtersOf(values)).length > 0;
}

/** The saved view whose filters are exactly the URL's, or null (a custom filter). */
export function activeView(views: readonly SavedView[], values: ListValues): string | null {
  const filters = filtersOf(values);
  const keys = Object.keys(filters);
  for (const view of views) {
    const viewKeys = Object.keys(view.params);
    if (viewKeys.length === keys.length && viewKeys.every((k) => filters[k] === view.params[k])) return view.id;
  }
  return null;
}

/** The values after choosing a view: its filters, the current sort, the first page. */
export function selectView(spec: ListSpec, views: readonly SavedView[], values: ListValues, id: string): ListValues {
  const view = views.find((v) => v.id === id);
  if (!view) return values;
  return parseListParams(spec, { ...view.params, ...(values.sort ? { sort: values.sort } : {}) });
}
