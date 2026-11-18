/**
 * Admin-managed video categories (owner 2026-11-15).
 *
 * The list lives in the search D1 (`video_categories`, api-videos migration
 * 0050), seeded from the built-in VIDEO_CATEGORIES. Admins add, rename (en +
 * ar), reorder and retire categories in Videos admin › Categories (admin-api
 * /api/video-categories). A value (slug) never changes once created, so
 * videos keep working; a retired category is hidden from pickers, Explore,
 * search filters and AI suggestions, but videos that have it keep it and still
 * show its label.
 *
 * Every worker reads the list through `loadVideoCategories` (an in-isolate
 * cache, VIDEO_CATEGORY_CACHE_TTL_MS) and then uses the synchronous helpers
 * below. When the table cannot be read (not migrated yet, D1 error) the
 * built-in list is used, so nothing breaks. Browsers read the public
 * GET /api/categories (edge-cached for the same TTL).
 */
import { VIDEO_CATEGORIES, type CategoryDefinition } from './upload-defaults';
import type { SearchDb } from './search/store';
import { buildIndexText } from './search/normalize';

/** A category slug: lower-case letters, digits and underscores, starting with a letter. */
export const CATEGORY_SLUG_PATTERN = /^[a-z][a-z0-9_]{1,39}$/;
export const CATEGORY_LIMITS = { label: 60, hint: 400, max: 100 } as const;
/** How long a worker isolate (and the edge cache of GET /api/categories) keeps the list. */
export const VIDEO_CATEGORY_CACHE_TTL_MS = 60_000;

export interface VideoCategoryEntry extends CategoryDefinition {
  /** Display order, ascending */
  position: number;
  /** Hidden from pickers, Explore, search filters and AI; existing videos keep it */
  retired: boolean;
  /** What belongs there, for the AI suggestion prompt */
  hint?: string;
}

/** What belongs in each built-in category (the AI prompt's guidance; seeded into the table). */
export const DEFAULT_CATEGORY_HINTS: Record<string, string> = {
  quran_recitation: 'recitation of the Quran, tilawa, tarteel, a surah or juz read aloud (تلاوة، ترتيل، سورة، جزء، قارئ، مقرئ)',
  quran_tafsir: 'explaining verses or surahs, tadabbur (تفسير، تدبر، معاني الآيات، وقفات مع سورة)',
  hadith_studies: 'explaining hadith, hadith books and sciences (شرح حديث، صحيح البخاري، صحيح مسلم، الأربعين النووية، رياض الصالحين، مصطلح الحديث)',
  islamic_history: 'seerah, prophets, companions, caliphates, battles and historical events (السيرة النبوية، قصص الأنبياء، الصحابة، الخلافة، غزوة، التاريخ)',
  fiqh: 'rulings and jurisprudence: prayer, purity, fasting rulings, zakat, marriage, divorce, trade, fatwas (أحكام، حكم، فتوى، فقه، الصلاة، الطهارة، الزكاة، البيوع، النكاح)',
  aqeedah: 'creed: tawheed, names and attributes of Allah, iman, the unseen, shirk (العقيدة، التوحيد، الأسماء والصفات، الإيمان، الشرك، اليوم الآخر)',
  dawah: 'inviting to Islam, talks for non-Muslims or new Muslims, comparative religion (الدعوة، دعوة غير المسلمين، مقارنة الأديان، المسلمون الجدد)',
  khutbah: 'Friday or Eid sermons (خطبة الجمعة، خطبة العيد، خطبة)',
  islamic_lectures: 'general lessons, admonitions and reminders whose subject fits no more specific category (محاضرة، درس، موعظة، تذكير، كلمة)',
  islamic_nasheed: 'nasheeds and vocals (نشيد، أنشودة، أناشيد، إنشاد)',
  islamic_kids: 'content made for children (أطفال، للأطفال، قصص للأطفال، تعليم الصغار)',
  islamic_news: 'news and current affairs of Muslims (أخبار، الأمة، حدث، تقرير)',
  hajj_umrah: 'Hajj and Umrah rites, guides and journeys (الحج، العمرة، المناسك، مكة، عرفة، الطواف)',
  ramadan: 'Ramadan, its nights, taraweeh, Laylat al-Qadr, Eid al-Fitr (رمضان، التراويح، ليلة القدر، الصيام في رمضان، زكاة الفطر)',
  islamic_lifestyle: 'family, marriage life, parenting, health, character, everyday halal living (الأسرة، تربية الأبناء، الأخلاق، الحياة الزوجية، تطوير الذات)',
};

/** The built-in list as entries (the fallback, and the migration's seed). */
export const DEFAULT_VIDEO_CATEGORY_ENTRIES: VideoCategoryEntry[] = VIDEO_CATEGORIES.map((c, i) => ({
  value: c.value,
  label: { en: c.label.en, ar: c.label.ar },
  position: (i + 1) * 10,
  retired: false,
  ...(DEFAULT_CATEGORY_HINTS[c.value] ? { hint: DEFAULT_CATEGORY_HINTS[c.value] } : {}),
}));

export interface VideoCategoryRow {
  value: string;
  label_en: string;
  label_ar: string;
  hint: string | null;
  position: number;
  retired: number;
  created_at?: number;
  updated_at?: number;
}

const sortEntries = (list: VideoCategoryEntry[]) =>
  [...list].sort((a, b) => a.position - b.position || a.value.localeCompare(b.value));

export function rowToEntry(row: VideoCategoryRow): VideoCategoryEntry {
  return {
    value: row.value,
    label: { en: row.label_en, ar: row.label_ar },
    position: Number(row.position) || 0,
    retired: Number(row.retired) === 1,
    ...(row.hint ? { hint: row.hint } : {}),
  };
}

let registry: VideoCategoryEntry[] = DEFAULT_VIDEO_CATEGORY_ENTRIES;
let byValue = new Map(registry.map((c) => [c.value, c]));
let loadedAt = 0;
/**
 * A refresh is running in this isolate. Only a flag: Workers refuse to settle a
 * promise in a request other than the one that created it
 * (handle_cross_request_promise_resolution), so a request never awaits another
 * request's read (prod 2026-11-18: 500s on /api/videos/:id, /api/profile, ...).
 */
let refreshing = false;

/** Replace the in-memory list (the loader, an admin write in this isolate, tests). */
export function setVideoCategories(list: VideoCategoryEntry[], now = Date.now()): void {
  registry = list.length ? sortEntries(list) : DEFAULT_VIDEO_CATEGORY_ENTRIES;
  byValue = new Map(registry.map((c) => [c.value, c]));
  loadedAt = now;
}

/** Forget the cached list: the next `loadVideoCategories` reads D1 (after an admin change; tests). */
export function invalidateVideoCategories(): void {
  loadedAt = 0;
  refreshing = false;
}

/** Back to the built-in list (tests). */
export function resetVideoCategories(): void {
  registry = DEFAULT_VIDEO_CATEGORY_ENTRIES;
  byValue = new Map(registry.map((c) => [c.value, c]));
  invalidateVideoCategories();
}

/** Every category this isolate knows, retired included, in display order. */
export function getVideoCategories(): VideoCategoryEntry[] {
  return registry;
}

/** The categories people can pick, in display order. */
export function getActiveVideoCategories(): VideoCategoryEntry[] {
  return registry.filter((c) => !c.retired);
}

export function findVideoCategory(value: unknown): VideoCategoryEntry | undefined {
  return typeof value === 'string' ? byValue.get(value) : undefined;
}

/** A category's label in a language; a retired category keeps its label. Null for an unknown value. */
export function videoCategoryLabel(value: unknown, lang: string): string | null {
  const found = findVideoCategory(value);
  if (!found) return null;
  return lang === 'ar' ? found.label.ar : found.label.en;
}

/**
 * Can a video be given this category? 'ok' for an active category, or for the
 * category it already has (a retired one is kept, never re-picked).
 */
export function categoryAssignability(value: string, current?: string | null): 'ok' | 'unknown' | 'retired' {
  const found = byValue.get(value);
  if (!found) return 'unknown';
  if (found.retired && value !== current) return 'retired';
  return 'ok';
}

/**
 * The live list from the search D1, cached in this isolate for
 * VIDEO_CATEGORY_CACHE_TTL_MS. Never throws: on a D1 error (or an empty or
 * missing table) the last good list, else the built-in one, is kept.
 */
export async function loadVideoCategories(
  db: SearchDb | null | undefined,
  options: { now?: number; force?: boolean } = {},
): Promise<VideoCategoryEntry[]> {
  const now = options.now ?? Date.now();
  if (!db) return registry;
  if (!options.force && loadedAt && now - loadedAt < VIDEO_CATEGORY_CACHE_TTL_MS) return registry;
  // Another request is refreshing a list this isolate already has: use that list now
  if (refreshing && loadedAt && !options.force) return registry;
  refreshing = true;
  try {
    const { results } = await db
      .prepare('SELECT value, label_en, label_ar, hint, position, retired FROM video_categories ORDER BY position, value')
      .all<VideoCategoryRow>();
    const rows = results ?? [];
    setVideoCategories(rows.length ? rows.map(rowToEntry) : DEFAULT_VIDEO_CATEGORY_ENTRIES, now);
  } catch {
    // Keep the last good list; try again in 10 s rather than on every request
    loadedAt = now - VIDEO_CATEGORY_CACHE_TTL_MS + 10_000;
  } finally {
    refreshing = false;
  }
  return registry;
}

/**
 * A short fingerprint of the active values when they differ from the built-in
 * set ('' otherwise): part of the AI result cache key, so a cached answer never
 * names a category that was retired or misses one that was added.
 */
export function activeCategoryFingerprint(): string {
  const active = getActiveVideoCategories().map((c) => c.value).sort();
  const builtIn = DEFAULT_VIDEO_CATEGORY_ENTRIES.map((c) => c.value).sort();
  return active.join(',') === builtIn.join(',') ? '' : active.join(',');
}

export interface CategoryInputErrors {
  value?: string;
  labelEn?: string;
  labelAr?: string;
  hint?: string;
}

/** Field checks shared by admin-api and admin-web. Returns error codes, empty when valid. */
export function validateCategoryFields(input: { value?: unknown; labelEn?: unknown; labelAr?: unknown; hint?: unknown }, creating: boolean): CategoryInputErrors {
  const errors: CategoryInputErrors = {};
  if (creating) {
    if (typeof input.value !== 'string' || !CATEGORY_SLUG_PATTERN.test(input.value)) errors.value = 'invalid_slug';
  }
  const label = (v: unknown, required: boolean) => {
    if (v === undefined && !required) return undefined;
    if (typeof v !== 'string' || !v.trim()) return 'required';
    if (v.trim().length > CATEGORY_LIMITS.label) return 'too_long';
    return undefined;
  };
  const en = label(input.labelEn, creating);
  const ar = label(input.labelAr, creating);
  if (en) errors.labelEn = en;
  if (ar) errors.labelAr = ar;
  if (input.hint !== undefined && input.hint !== null) {
    if (typeof input.hint !== 'string') errors.hint = 'invalid';
    else if (input.hint.trim().length > CATEGORY_LIMITS.hint) errors.hint = 'too_long';
  }
  return errors;
}

/** A slug suggestion from an English name ("Seerah for kids" → "seerah_for_kids"). */
export function slugFromLabel(label: string): string {
  // One linear pass, no backtracking regexes (CodeQL js/polynomial-redos); the input is bounded first
  const text = label.slice(0, 200).toLowerCase().normalize('NFKD');
  let slug = '';
  let gap = false;
  for (const ch of text) {
    if (ch >= '\u0300' && ch <= '\u036f') continue; // combining accents
    const piece = ch === '&' ? 'and' : (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') ? ch : '';
    if (!piece) {
      gap = true;
      continue;
    }
    // A slug starts with a letter: leading digits are dropped
    if (!slug && piece >= '0' && piece <= '9') continue;
    if (gap && slug) slug += '_';
    gap = false;
    slug += piece;
    if (slug.length >= 40) break;
  }
  slug = slug.slice(0, 40);
  return slug.endsWith('_') ? slug.slice(0, -1) : slug;
}

/** Payload of MessageType.CategoryRelabel (admin-api → processor). */
export interface CategoryRelabelPayload {
  category: string;
  from: { en: string; ar: string };
  to: { en: string; ar: string };
  /** Which index; videos first, then channels (the handler queues the next step) */
  entity: 'video' | 'channel';
  /** Keyset cursor: rows after this rowid */
  afterRowid?: number;
}

export const CATEGORY_RELABEL_PAGE = 200;

/**
 * One page of a rename in the search index. The category's labels are the
 * tail of a row's FTS body text (documents.ts: buildIndexText(..., labels)),
 * so a body ending with the old labels' tokens gets the new ones. Rows whose
 * body was clipped keep their text; their next sync rewrites them anyway.
 * Returns the cursor of the next page, or null when this index is done.
 */
export async function relabelCategoryPage(db: SearchDb, payload: CategoryRelabelPayload): Promise<number | null> {
  const base = payload.entity === 'channel' ? 'search_channels' : 'search_videos';
  const fts = `${base}_fts`;
  const oldTail = buildIndexText([payload.from.en, payload.from.ar]);
  const newTail = buildIndexText([payload.to.en, payload.to.ar]);
  const after = Math.max(0, Math.floor(payload.afterRowid ?? 0));
  const { results } = await db
    .prepare(`SELECT rowid AS r FROM ${base} WHERE category = ? AND rowid > ? ORDER BY rowid LIMIT ${CATEGORY_RELABEL_PAGE}`)
    .bind(payload.category, after)
    .all<{ r: number }>();
  const rowids = (results ?? []).map((row) => Number(row.r));
  if (rowids.length && oldTail && oldTail !== newTail) {
    const placeholders = rowids.map(() => '?').join(',');
    await db
      .prepare(
        `UPDATE ${fts} SET body = substr(body, 1, length(body) - length(?)) || ?
         WHERE rowid IN (${placeholders}) AND length(body) >= length(?) AND substr(body, length(body) - length(?) + 1) = ?`,
      )
      .bind(oldTail, newTail, ...rowids, oldTail, oldTail, oldTail)
      .run();
  }
  return rowids.length === CATEGORY_RELABEL_PAGE ? rowids[rowids.length - 1]! : null;
}
