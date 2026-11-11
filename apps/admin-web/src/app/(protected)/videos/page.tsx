import { HydrationBoundary, QueryClient, dehydrate } from '@tanstack/react-query';
import { getContentPermissions, listVideos } from '@/lib/api/content';
import type { SearchParams } from '@/components/content/query';
import { LIST_PAGE_SIZE, listKey, permissionsKey } from '@/lib/list/keys';
import { parseListParams, serializeListParams } from '@/lib/list/params';
import { logger } from '@/lib/logger';
import { VIDEO_LIST_SPEC, VIDEO_RESOURCE } from './list-spec';
import { VideosList } from './VideosList';

export const dynamic = 'force-dynamic';

/**
 * The Videos list. The browser fetches and caches the list (VideosList); this
 * server page only puts the first page for the URL's filters and the admin's
 * permissions in that cache, so a link or a reload shows rows at once. A read
 * that fails here is left to the browser, which retries and shows the error.
 */
export default async function VideosPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const values = parseListParams(VIDEO_LIST_SPEC, await searchParams);
  const client = new QueryClient();
  const [list, permissions] = await Promise.allSettled([listVideos({ ...values, pageSize: LIST_PAGE_SIZE }), getContentPermissions()]);
  if (list.status === 'fulfilled') client.setQueryData(listKey(VIDEO_RESOURCE, serializeListParams(VIDEO_LIST_SPEC, values)), list.value);
  else logger.warn('[videos] First page not prefetched', { error: list.reason instanceof Error ? list.reason.message : String(list.reason) });
  if (permissions.status === 'fulfilled') client.setQueryData(permissionsKey, permissions.value);

  return (
    <HydrationBoundary state={dehydrate(client)}>
      <VideosList />
    </HydrationBoundary>
  );
}
