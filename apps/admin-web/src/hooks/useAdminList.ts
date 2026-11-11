'use client';

/**
 * The admin lists' data hooks (TanStack Query over the content pass-through):
 *
 * - useAdminList: one page of a list, cached per query string; a return to the
 *   list shows the cached rows at once and refreshes them in the background,
 *   and a new page or filter keeps the old rows on screen until it arrives.
 *   Rows come back with any optimistic change applied.
 * - useAdminCount: a saved view's total (a one-row page).
 * - useAdminPermissions: the admin's content permissions.
 * - useAdminMutation: a change with an optimistic row update that rolls back
 *   when it fails; the list is marked stale so its next read is fresh.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { AdminContentPermission } from '@/lib/api/content-types';
import { contentApi } from '@/lib/list/api-client';
import { COUNT_STALE_MS, LIST_PAGE_SIZE, LIST_STALE_MS, countKey, countRootKey, listKey, listRootKey, overridesKey, permissionsKey } from '@/lib/list/keys';
import { addOverride, applyOverrides, confirmOverride, narrowOverride, pruneOverrides, rollbackOverride, type RowOverride, type RowPatch } from '@/lib/list/optimistic';
import { serializeListParams, type ListSpec, type ListValues } from '@/lib/list/params';
import { logger } from '@/lib/logger-client';

/** A list page from admin-api: numbered pages carry total/page, cursor pages carry nextCursor. */
export interface ListPage<T> {
  items: T[];
  total?: number;
  page?: number;
  pageSize?: number;
  indexComplete?: boolean;
  nextCursor?: string | null;
}

/** The query sent for a list: the URL's values plus the page size. */
export function listQueryString(spec: ListSpec, values: ListValues): string {
  return serializeListParams(spec, values);
}

function useOverrides<T>(resource: string): RowOverride<T>[] {
  const { data } = useQuery({
    queryKey: overridesKey(resource),
    queryFn: () => [] as RowOverride<T>[],
    initialData: [] as RowOverride<T>[],
    staleTime: Infinity,
    gcTime: Infinity,
  });
  return data;
}

function setOverrides<T>(client: QueryClient, resource: string, fn: (current: RowOverride<T>[]) => RowOverride<T>[]) {
  client.setQueryData<RowOverride<T>[]>(overridesKey(resource), (current) => fn(current ?? []));
}

/** Re-renders when the next override expires, so an expired one stops showing. */
function useExpiryTick(overrides: readonly RowOverride<unknown>[]): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (overrides.length === 0) return;
    const next = Math.min(...overrides.map((o) => o.expiresAt));
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(0, next - Date.now()) + 50);
    return () => window.clearTimeout(timer);
  }, [overrides, now]);
  return now;
}

export interface UseAdminListOptions {
  /** admin-api /api/content/<resource>, e.g. 'videos'. */
  resource: string;
  spec: ListSpec;
  values: ListValues;
  pageSize?: number;
  /** Refetch on an interval (e.g. while a "Processing" view is open). */
  refetchInterval?: number | false;
}

export function useAdminList<T extends { id: string }>({ resource, spec, values, pageSize = LIST_PAGE_SIZE, refetchInterval = false }: UseAdminListOptions) {
  const client = useQueryClient();
  const query = listQueryString(spec, values);
  const result = useQuery({
    queryKey: listKey(resource, query),
    queryFn: ({ signal }) => contentApi.get<ListPage<T>>(resource, { ...values, page: values.page ?? undefined, pageSize }, signal),
    staleTime: LIST_STALE_MS,
    placeholderData: keepPreviousData,
    refetchInterval,
    retry: 1,
  });
  const overrides = useOverrides<T>(resource);
  const now = useExpiryTick(overrides as RowOverride<unknown>[]);
  const items = result.data?.items;

  // Overrides the API now agrees with (or that ran out) are dropped
  useEffect(() => {
    if (!items || overrides.length === 0) return;
    const pruned = pruneOverrides(overrides, items, Date.now());
    if (pruned.length !== overrides.length) setOverrides<T>(client, resource, () => pruned);
  }, [client, items, overrides, resource, now]);

  useEffect(() => {
    if (result.error) logger.warn('[list] Could not load a list', { resource, error: result.error instanceof Error ? result.error.message : String(result.error) });
  }, [resource, result.error]);

  const rows = useMemo(() => applyOverrides(items ?? [], overrides, now), [items, overrides, now]);
  const hidden = (items?.length ?? 0) - rows.length;
  const total = result.data?.total !== undefined ? Math.max(0, result.data.total - hidden) : undefined;

  return {
    rows,
    total,
    page: result.data?.page ?? Number(values.page ?? 1),
    pageSize,
    indexComplete: result.data?.indexComplete ?? true,
    nextCursor: result.data?.nextCursor ?? null,
    /** First load with nothing to show yet. */
    isLoading: result.isPending,
    /** Fetching in the background (rows on screen may be the previous page). */
    isFetching: result.isFetching,
    isPreviousData: result.isPlaceholderData,
    error: result.data ? null : result.error,
    refetch: result.refetch,
  };
}

/** The total of a filtered list (a saved view's count). */
export function useAdminCount(resource: string, spec: ListSpec, values: ListValues) {
  const query = serializeListParams(spec, values);
  return useQuery({
    queryKey: countKey(resource, query),
    queryFn: async ({ signal }) => (await contentApi.get<ListPage<unknown>>(resource, { ...values, pageSize: 1 }, signal)).total ?? 0,
    staleTime: COUNT_STALE_MS,
    retry: 1,
  });
}

export function useAdminPermissions() {
  return useQuery({
    queryKey: permissionsKey,
    queryFn: async ({ signal }) => (await contentApi.get<{ permissions: AdminContentPermission[] }>('permissions', undefined, signal)).permissions,
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

export interface AdminMutationOptions<TVars, TResult, TRow> {
  resource: string;
  mutationFn: (vars: TVars) => Promise<TResult>;
  /** The rows the change touches and what they show meanwhile ('remove' for a delete). */
  optimistic?: (vars: TVars) => { ids: string[]; patch: RowPatch<TRow> | 'remove' };
  /** A change that went through for only some rows: the ids that did (the others roll back). */
  succeededIds?: (result: TResult, vars: TVars) => string[];
}

let tokenSeq = 0;

export function useAdminMutation<TVars, TResult, TRow extends { id: string } = { id: string }>({ resource, mutationFn, optimistic, succeededIds }: AdminMutationOptions<TVars, TResult, TRow>) {
  const client = useQueryClient();
  const markStale = useCallback(() => {
    // Not refetched now (the index lags a moment); the next read of any page or count is fresh
    void client.invalidateQueries({ queryKey: listRootKey(resource), refetchType: 'none' });
    void client.invalidateQueries({ queryKey: countRootKey(resource), refetchType: 'none' });
  }, [client, resource]);

  return useMutation({
    mutationFn,
    onMutate: async (vars: TVars) => {
      if (!optimistic) return { token: null as string | null };
      const token = `m${++tokenSeq}-${Date.now()}`;
      const { ids, patch } = optimistic(vars);
      setOverrides<TRow>(client, resource, (current) => addOverride(current, { token, ids, patch }, Date.now()));
      return { token };
    },
    onError: (error, _vars, context) => {
      if (context?.token) setOverrides<TRow>(client, resource, (current) => rollbackOverride(current, context.token!));
      logger.debug('[list] Change rolled back', { resource, error: error instanceof Error ? error.message : String(error) });
    },
    onSuccess: (result, vars, context) => {
      const token = context?.token;
      if (token) {
        setOverrides<TRow>(client, resource, (current) => {
          const narrowed = succeededIds ? narrowOverride(current, token, succeededIds(result, vars)) : current;
          return confirmOverride(narrowed, token, Date.now());
        });
      }
      markStale();
    },
  });
}

export interface BulkResult {
  ok: string[];
  failed: { id: string; error: unknown }[];
}

/** Runs one request per id, a few at a time; never throws (the failures are in the result). */
export async function runBulk(ids: readonly string[], run: (id: string) => Promise<unknown>, concurrency = 4): Promise<BulkResult> {
  const out: BulkResult = { ok: [], failed: [] };
  let next = 0;
  async function worker() {
    while (next < ids.length) {
      const id = ids[next++];
      try {
        await run(id);
        out.ok.push(id);
      } catch (error) {
        out.failed.push({ id, error });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
  return out;
}
