export type DashboardSort = 'date' | 'views' | 'title';

interface SortableVideo {
  title: string;
  dateCreated: string;
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
      return new Date(b.dateCreated).getTime() - new Date(a.dateCreated).getTime();
  }
}
