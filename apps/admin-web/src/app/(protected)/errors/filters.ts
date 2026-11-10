import { ERROR_APPS, ERROR_STATUSES, parseErrorRef, type ErrorApp, type ErrorStatus } from '@al-ummah/shared-types';
import type { ErrorSort } from '@/lib/api/error-groups-types';

export const ERROR_SORTS: ErrorSort[] = ['last_seen', 'count', 'users'];
export const ERRORS_PAGE_SIZE = 25;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ENVIRONMENT = /^[a-z0-9-]{1,30}$/;
const RELEASE = /^[A-Za-z0-9._-]{1,80}$/;

export interface ErrorListFilters {
  app?: ErrorApp;
  environment?: string;
  release?: string;
  status?: ErrorStatus;
  from?: string;
  to?: string;
  q?: string;
  sort: ErrorSort;
  /** The "Needs action" tab: groups with open needs-action items */
  needsAction: boolean;
  page: number;
}

/** Untrusted query string → filters admin-api accepts (unknown values are dropped). */
export function parseErrorFilters(params: Record<string, string | string[] | undefined>): ErrorListFilters {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const app = first(params.app);
  const environment = first(params.environment);
  const release = first(params.release);
  const status = first(params.status);
  const from = first(params.from);
  const to = first(params.to);
  const q = first(params.q)?.trim().slice(0, 200);
  const sort = first(params.sort);
  const page = Number.parseInt(first(params.page) ?? '1', 10);
  return {
    app: (ERROR_APPS as readonly string[]).includes(app ?? '') ? (app as ErrorApp) : undefined,
    environment: environment && ENVIRONMENT.test(environment) ? environment : undefined,
    release: release && RELEASE.test(release) ? release : undefined,
    status: (ERROR_STATUSES as readonly string[]).includes(status ?? '') ? (status as ErrorStatus) : undefined,
    from: from && DAY.test(from) ? from : undefined,
    to: to && DAY.test(to) ? to : undefined,
    q: q || undefined,
    sort: ERROR_SORTS.includes(sort as ErrorSort) ? (sort as ErrorSort) : 'last_seen',
    needsAction: first(params.tab) === 'needs-action',
    page: Number.isFinite(page) && page >= 1 ? page : 1,
  };
}

/** The admin-api GET /api/errors/groups query string for these filters. */
export function errorGroupsQuery(f: ErrorListFilters, pageSize = ERRORS_PAGE_SIZE): string {
  const search = new URLSearchParams();
  for (const key of ['app', 'environment', 'release', 'status', 'from', 'to', 'q'] as const) {
    const value = f[key];
    if (value) search.set(key, value);
  }
  if (f.needsAction) search.set('needsAction', '1');
  search.set('sort', f.sort);
  search.set('limit', String(pageSize));
  search.set('offset', String((f.page - 1) * pageSize));
  return search.toString();
}

/** A shareable /errors URL (the page's own query string). */
export function errorsHref(f: Partial<ErrorListFilters>): string {
  const search = new URLSearchParams();
  if (f.needsAction) search.set('tab', 'needs-action');
  for (const key of ['app', 'environment', 'release', 'status', 'from', 'to', 'q'] as const) {
    const value = f[key];
    if (value) search.set(key, value);
  }
  if (f.sort && f.sort !== 'last_seen') search.set('sort', f.sort);
  if (f.page && f.page > 1) search.set('page', String(f.page));
  const query = search.toString();
  return query ? `/errors?${query}` : '/errors';
}

export const hasErrorFilters = (f: ErrorListFilters) => !!(f.app || f.environment || f.release || f.status || f.from || f.to || f.q);

/** A search that is a reference (also typed loosely: "err 3k9f 2b7q") jumps to its group. */
export function searchedRef(f: ErrorListFilters): string | null {
  return f.q ? parseErrorRef(f.q) : null;
}

/** Nav badge: new groups plus open needs-action items. */
export function errorsBadgeCount(counts: { new?: number; openActions?: number } | null | undefined): number {
  return Math.max(0, (counts?.new ?? 0) + (counts?.openActions ?? 0));
}

/** Where an admin replaces a flagged thumbnail: the video's page (its Edit card has the thumbnail upload with crop). */
export function thumbnailFixHref(videoId: string): string {
  return `/videos/${encodeURIComponent(videoId)}`;
}

/** Admin page of an item an index pass skipped (Errors page, "Index out of sync"). */
export function indexItemHref(kind: 'video' | 'channel' | 'profile', id: string): string {
  const base = kind === 'video' ? '/videos' : kind === 'channel' ? '/channels' : '/users';
  return `${base}/${encodeURIComponent(id)}`;
}
