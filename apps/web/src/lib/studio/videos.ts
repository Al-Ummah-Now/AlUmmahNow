/** The Videos tab's filters in the URL, and what each row can do (spec §4.4.1). */

import type { StudioVideoStatus } from '@al-ummah/shared-types';
import { can, type StudioRole } from './permissions';

/** POST /api/videos/bulk-* takes at most this many. */
export const MAX_BULK_SELECTION = 50;

const STATUSES = ['published', 'scheduled', 'drafts', 'processing', 'failed'] as const;
const SORTS = ['newest', 'oldest', 'views', 'title'] as const;
const VISIBILITY = ['all', 'public', 'private'] as const;
const TYPES = ['all', 'videos', 'shorts'] as const;
const DURATIONS = ['all', 'short', 'medium', 'long'] as const;
const VIEWS = ['list', 'calendar'] as const;
const CALENDAR_VIEWS = ['month', 'week', 'day'] as const;

export interface VideosQuery {
  status: StudioVideoStatus;
  q: string;
  sort: (typeof SORTS)[number];
  visibility: (typeof VISIBILITY)[number];
  type: (typeof TYPES)[number];
  duration: (typeof DURATIONS)[number];
  category: string;
  language: string;
  view: (typeof VIEWS)[number];
  calendarView: (typeof CALENDAR_VIEWS)[number];
}

function oneOf<T extends string>(value: string | null, allowed: readonly T[]): T {
  return allowed.includes(value as T) ? (value as T) : allowed[0];
}

export function parseVideosQuery(params: URLSearchParams): VideosQuery {
  return {
    status: oneOf(params.get('status'), STATUSES),
    q: params.get('q') ?? '',
    sort: oneOf(params.get('sort'), SORTS),
    visibility: oneOf(params.get('visibility'), VISIBILITY),
    type: oneOf(params.get('type'), TYPES),
    duration: oneOf(params.get('duration'), DURATIONS),
    category: params.get('category') ?? '',
    language: params.get('language') ?? '',
    view: oneOf(params.get('view'), VIEWS),
    calendarView: oneOf(params.get('calendarView'), CALENDAR_VIEWS),
  };
}

const DEFAULTS = parseVideosQuery(new URLSearchParams());

export function videosQueryString(query: VideosQuery): string {
  const params = new URLSearchParams();
  for (const key of Object.keys(DEFAULTS) as Array<keyof VideosQuery>) {
    if (query[key] !== DEFAULTS[key]) params.set(key, query[key]);
  }
  return params.toString();
}

export type VideoRowAction = 'edit' | 'view' | 'analytics' | 'copyLink' | 'schedule' | 'reschedule' | 'publishNow' | 'cancelSchedule' | 'delete';

/** Row actions in display order. The server still decides, per video. */
export function rowActions(status: StudioVideoStatus, role: StudioRole, isPublic = false): VideoRowAction[] {
  const edit: VideoRowAction[] = can(role, 'video.edit') ? ['edit'] : [];
  const schedule = can(role, 'video.schedule');
  const remove: VideoRowAction[] = can(role, 'video.delete') ? ['delete'] : [];
  switch (status) {
    case 'published':
      return [...edit, 'view', ...(can(role, 'analytics.view') ? ['analytics' as const] : []), 'copyLink', ...(schedule && !isPublic ? ['schedule' as const] : []), ...remove];
    case 'scheduled':
      return [...edit, ...(schedule ? ['reschedule' as const, 'publishNow' as const, 'cancelSchedule' as const] : []), ...remove];
    case 'drafts':
      return [...edit, ...(schedule ? ['publishNow' as const, 'schedule' as const] : []), ...remove];
    case 'failed':
      return [...edit, ...remove];
    case 'processing':
      return remove;
  }
}
