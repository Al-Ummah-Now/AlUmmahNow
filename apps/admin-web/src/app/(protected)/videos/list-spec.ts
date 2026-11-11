/**
 * The Videos list's URL parameters and saved views, shared by the server page
 * (first page, cache hydration), the client list and the detail page's Back
 * link (which keeps the list's filters).
 */
import { ADMIN_VIDEO_SORTS, ADMIN_VIDEO_STATUSES } from '@al-ummah/shared-types';
import { listHref, parseListParams, type ListSpec, type SavedView } from '@/lib/list/params';

export const VIDEO_RESOURCE = 'videos';

export const VIDEO_LIST_SPEC: ListSpec = {
  q: 'text',
  status: ADMIN_VIDEO_STATUSES,
  visibility: ['public', 'private'],
  hidden: ['yes', 'no'],
  reported: ['yes'],
  channelId: 'text',
  ownerId: 'text',
  noChannel: ['1'],
  createdFrom: 'date',
  createdTo: 'date',
  sort: ADMIN_VIDEO_SORTS,
  page: 'page',
};

export const VIDEO_VIEWS: readonly SavedView[] = [
  { id: 'all', params: {} },
  { id: 'processing', params: { status: 'processing' } },
  { id: 'failed', params: { status: 'failed' } },
  { id: 'reported', params: { reported: 'yes' } },
  { id: 'private', params: { visibility: 'private' } },
];

/** The query a detail link carries (`?list=`), so its Back link returns to the same list. */
export const LIST_RETURN_PARAM = 'list';

/** The Videos list URL for a detail page's `list` parameter (anything not a list filter is dropped). */
export function videosBackHref(list: string | string[] | undefined): string {
  const raw = Array.isArray(list) ? list[0] : list;
  if (!raw) return '/videos';
  return listHref('/videos', VIDEO_LIST_SPEC, parseListParams(VIDEO_LIST_SPEC, raw));
}
