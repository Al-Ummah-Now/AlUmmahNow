/**
 * Headings of the ranked video rails (wiki E07 "Discovery ranking"): the home page rails, Explore's
 * Trending and the sections page. The API says which list a rail is showing right now
 * (`info.label` / `metadata.rail.label` / `rail.label`): with too little viewer signal Trending
 * reads "New this week" and Popular reads "Featured", so a heading never claims more than the
 * list is. en/ar, shared by the web static fallback and the api-videos translation seed.
 *
 * Tone (wiki "Copy Tone Guide"): videos, channels, watch; Arabic says «مرئي / مرئيات», never «فيديو».
 */

/** Every label the ranking can give a rail (api-videos RailLabel). */
export const RAIL_LABELS = [
  'trending_today',
  'trending_this_week',
  'trending_this_month',
  'popular',
  'new_today',
  'new_this_week',
  'new_this_month',
  'latest',
  'featured',
  'top',
] as const;
export type RailLabelKey = (typeof RAIL_LABELS)[number];

export interface RailTranslations {
  /** Heading per label; `top` takes `{category}` */
  labels: Record<RailLabelKey, string>;
  /** Link to the full list */
  seeAll: string;
  /** Accessible name of the "See all" link, `{rail}` is the heading */
  seeAllLabel: string;
  /** Accessible names of the rail's scroll buttons */
  previous: string;
  next: string;
}

export const RAILS_EN: RailTranslations = {
  labels: {
    trending_today: 'Trending today',
    trending_this_week: 'Trending this week',
    trending_this_month: 'Trending this month',
    popular: 'Popular',
    new_today: 'New today',
    new_this_week: 'New this week',
    new_this_month: 'New this month',
    latest: 'Latest videos',
    featured: 'Featured',
    top: 'Top in {category}',
  },
  seeAll: 'See all',
  seeAllLabel: 'See all: {rail}',
  previous: 'Previous videos',
  next: 'More videos',
};

export const RAILS_AR: RailTranslations = {
  labels: {
    trending_today: 'الرائج اليوم',
    trending_this_week: 'الرائج هذا الأسبوع',
    trending_this_month: 'الرائج هذا الشهر',
    popular: 'الأكثر مشاهدة',
    new_today: 'جديد اليوم',
    new_this_week: 'جديد هذا الأسبوع',
    new_this_month: 'جديد هذا الشهر',
    latest: 'أحدث المرئيات',
    featured: 'مرئيات مختارة',
    top: 'الأبرز في {category}',
  },
  seeAll: 'عرض الكل',
  seeAllLabel: 'عرض الكل: {rail}',
  previous: 'المرئيات السابقة',
  next: 'مرئيات أخرى',
};

/** The heading for a rail label, or null for a label this build does not know (show a default). */
export function railHeading(t: RailTranslations, label: string | null | undefined, category?: string | null): string | null {
  if (!label || !(RAIL_LABELS as readonly string[]).includes(label)) return null;
  const text = t.labels[label as RailLabelKey];
  return label === 'top' ? (category ? text.replace('{category}', category) : null) : text;
}
