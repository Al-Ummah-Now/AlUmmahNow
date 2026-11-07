import type { ReportStatus, ReportableEntityType } from '@al-ummah/shared-types';

export const REPORT_STATUSES: ReportStatus[] = ['pending', 'reviewing', 'resolved', 'dismissed'];
export const ENTITY_TYPES: ReportableEntityType[] = ['video', 'comment', 'channel', 'livestream', 'playlist', 'post'];
export const PAGE_SIZE = 20;

export interface ModerationFilters {
  status?: ReportStatus;
  entity_type?: ReportableEntityType;
  page: number;
}

/**
 * Normalise untrusted query-string values. Unknown values are dropped rather
 * than forwarded, because admin-api rejects them with a 400.
 */
export function parseModerationFilters(params: Record<string, string | string[] | undefined>): ModerationFilters {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const status = first(params.status);
  const entityType = first(params.entity_type);
  const page = Number.parseInt(first(params.page) ?? '1', 10);

  return {
    status: REPORT_STATUSES.includes(status as ReportStatus) ? (status as ReportStatus) : undefined,
    entity_type: ENTITY_TYPES.includes(entityType as ReportableEntityType)
      ? (entityType as ReportableEntityType)
      : undefined,
    page: Number.isFinite(page) && page >= 1 ? page : 1,
  };
}

export function moderationHref(filters: Partial<ModerationFilters>): string {
  const search = new URLSearchParams();
  if (filters.status) search.set('status', filters.status);
  if (filters.entity_type) search.set('entity_type', filters.entity_type);
  if (filters.page && filters.page > 1) search.set('page', String(filters.page));
  const query = search.toString();
  return query ? `/moderation?${query}` : '/moderation';
}
