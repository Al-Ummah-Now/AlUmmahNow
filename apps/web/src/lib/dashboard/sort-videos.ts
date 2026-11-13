import { publishedDateOf } from '@/lib/format/videoMeta';

export type DashboardSort = 'date' | 'views' | 'title';

interface SortableVideo {
  title: string;
  dateCreated: string;
  /** When it was first published; newest-first uses it, else the upload date */
  publishedAt?: string;
  views?: number;
}

/** Comparator for the video dashboard's sort menu (newest, most viewed, A-Z) */
export function compareDashboardVideos(a: SortableVideo, b: SortableVideo, sortBy: DashboardSort): number {
  switch (sortBy) {
    case 'views':
      return (b.views || 0) - (a.views || 0);
    case 'title':
      return a.title.localeCompare(b.title);
    case 'date':
    default:
      // The "Published on" date the cards show (publishedAt, else the upload)
      return new Date(publishedDateOf(b) ?? 0).getTime() - new Date(publishedDateOf(a) ?? 0).getTime();
  }
}
