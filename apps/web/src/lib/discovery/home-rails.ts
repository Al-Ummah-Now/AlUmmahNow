/**
 * Home page rails (GET /api/discovery/home, wiki E07 "Discovery ranking"): the shapes, the response
 * check and what each rail's heading and "See all" link are. The API says what a rail is showing right
 * now (`info.label`): with no viewer signal yet Trending reads "New this week" and Popular reads
 * "Featured", so a heading never claims more than the list is.
 */
import { railHeading, type RailTranslations, type VideoObject } from '@al-ummah/shared-types';

export type HomeRailKey = 'featured' | 'trending' | 'new' | 'popular' | 'categories';

export interface HomeRailInfo {
  mode: string;
  label: string;
  signalItems: number;
  computedAt: string;
}

export interface HomeRail {
  key: HomeRailKey;
  /** The ranked list behind it (trending:week, new, popular, featured, top) */
  rail: string;
  category?: string;
  categoryLabel?: { en: string; ar: string };
  info: HomeRailInfo;
  data: VideoObject[];
  cursor?: string;
}

/** Videos per rail */
export const HOME_RAIL_LIMIT = 12;

const KEYS: ReadonlySet<string> = new Set(['featured', 'trending', 'new', 'popular', 'categories']);

/** The rails a response carries, dropping anything malformed or empty. */
export function parseHomeRails(body: unknown): HomeRail[] {
  const rails = (body as { data?: { rails?: unknown } } | null)?.data?.rails;
  if (!Array.isArray(rails)) return [];
  return rails.filter((r): r is HomeRail => {
    if (!r || typeof r !== 'object') return false;
    const rail = r as HomeRail;
    return KEYS.has(rail.key) && Array.isArray(rail.data) && rail.data.length > 0 && typeof rail.info?.label === 'string';
  });
}

/** A rail's heading in the page language; null when this build does not know its label. */
export function homeRailHeading(rail: HomeRail, t: RailTranslations, lang: string): string | null {
  const category = rail.categoryLabel ? (lang === 'ar' ? rail.categoryLabel.ar : rail.categoryLabel.en) : null;
  return railHeading(t, rail.info.label, category);
}

/**
 * Where "See all" goes: the full list the rail is the start of. Trending (or what it reads with no
 * signal) is Explore's Trending; New is every video, newest first; a category is that category's
 * search; Featured and Popular are the sections page.
 */
export function homeRailHref(rail: HomeRail, lang: string): string {
  switch (rail.key) {
    case 'trending':
      return `/${lang}/explore`;
    case 'new':
      return `/${lang}/videos`;
    case 'categories':
      return rail.category ? `/${lang}/search?type=video&category=${encodeURIComponent(rail.category)}` : `/${lang}/explore`;
    default:
      return `/${lang}/sections`;
  }
}
