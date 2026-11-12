/**
 * Entitlement declarations for search & discovery (Epic 29 stories 29.7-29.9, Epic 27 §27.2).
 *
 * Viewer search, filters, in-channel search, history and Explore are free for
 * everyone (Core Web Experience §4). Keys are declared so the entitlement
 * catalogue can list them and admins can see they exist; no plan restricts them
 * and the API does not gate on them.
 */

export interface EntitlementDeclaration {
  key: string;
  type: 'boolean' | 'number' | 'enum' | 'list';
  audience: 'viewer' | 'creator';
  /** Seed value for every plan (Free, Plus, Pro, Institution). */
  freeDefault: boolean | number | string;
  description: { en: string; ar: string };
  /** What happens when the entitlement is off or the limit is reached. */
  atLimit: string;
  epic: string;
}

export const SEARCH_ENTITLEMENTS: ReadonlyArray<EntitlementDeclaration> = [
  {
    key: 'search.enabled',
    type: 'boolean',
    audience: 'viewer',
    freeDefault: true,
    description: { en: 'Search videos, channels, playlists and posts', ar: 'البحث في المرئيات والقنوات وقوائم التشغيل والمنشورات' },
    atLimit: 'Not limited; always on.',
    epic: '29.8',
  },
  {
    key: 'search.filters',
    type: 'boolean',
    audience: 'viewer',
    freeDefault: true,
    description: { en: 'Search filters (type, duration, date, language, category, verified)', ar: 'عوامل تصفية البحث (النوع، المدة، التاريخ، اللغة، التصنيف، الموثّق)' },
    atLimit: 'Not limited; always on.',
    epic: '29.8',
  },
  {
    key: 'search.inChannel',
    type: 'boolean',
    audience: 'viewer',
    freeDefault: true,
    description: { en: 'Search within a channel', ar: 'البحث داخل قناة' },
    atLimit: 'Not limited; always on.',
    epic: '29.8',
  },
  {
    key: 'search.history',
    type: 'boolean',
    audience: 'viewer',
    freeDefault: true,
    description: { en: 'Private search history on this device', ar: 'سجل بحث خاص على هذا الجهاز' },
    atLimit: 'Not limited; stored only on the device and clearable.',
    epic: '29.8',
  },
  {
    key: 'explore.enabled',
    type: 'boolean',
    audience: 'viewer',
    freeDefault: true,
    description: { en: 'Explore page (trending, categories, live now, new channels, seasonal)', ar: 'صفحة الاستكشاف (الرائج، التصنيفات، البث المباشر، القنوات الجديدة، المواسم)' },
    atLimit: 'Not limited; always on.',
    epic: '29.7',
  },
];
