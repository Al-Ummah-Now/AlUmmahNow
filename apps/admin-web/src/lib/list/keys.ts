/**
 * Query keys and cache timings of the admin lists, shared by the server page
 * (which hydrates the first page) and the browser hooks, so both name the same
 * cache entry. The query part is the canonical query string from params.ts.
 */

/** A list page for `query` (the list's canonical query string, page size included by the hook). */
export const listKey = (resource: string, query: string) => ['admin-list', resource, query] as const;
/** Every page of a resource (for invalidation). */
export const listRootKey = (resource: string) => ['admin-list', resource] as const;
/** A saved view's count. */
export const countKey = (resource: string, query: string) => ['admin-count', resource, query] as const;
export const countRootKey = (resource: string) => ['admin-count', resource] as const;
export const permissionsKey = ['admin-permissions'] as const;
/** The optimistic overrides of a resource's rows (optimistic.ts). */
export const overridesKey = (resource: string) => ['admin-overrides', resource] as const;

/** A list shown again within this time is not refetched (it refreshes in the background after). */
export const LIST_STALE_MS = 30_000;
export const COUNT_STALE_MS = 60_000;
/** The admin lists' page size. */
export const LIST_PAGE_SIZE = 20;
