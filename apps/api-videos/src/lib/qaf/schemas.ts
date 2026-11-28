import { z } from 'zod';
import { QAF_LIMITS, QAF_PASSAGE_URL, QAF_TURATH_URL } from '@al-ummah/shared-types';

export const qafLocale = z.enum(['en', 'ar']).default('en');
const ids = <T extends z.ZodType>(id: T) => z.array(id).min(1).max(20);
const deathYear = z.strictObject({
  gt: z.int().optional(), gte: z.int().optional(), lt: z.int().optional(), lte: z.int().optional(),
}).refine((value) => Object.keys(value).length > 0, 'Enter at least one death year bound');

const genre = z.enum([
  'creed', 'sects-and-refutations', 'quran-commentary', 'quranic-sciences-and-principles-of-exegesis',
  'quran-recitation-and-readings', 'hadith-collections', 'hadith-commentary', 'hadith-sourcing-and-indexes',
  'hadith-defects-and-scholarly-questions', 'hadith-sciences', 'principles-of-jurisprudence',
  'legal-maxims-and-jurisprudence', 'logic', 'hanafi-fiqh', 'maliki-fiqh', 'shafii-fiqh', 'hanbali-fiqh',
  'general-fiqh', 'fiqh-issues', 'islamic-governance-and-judiciary', 'inheritance-and-wills', 'fatwas',
  'spirituality-etiquette-and-remembrances', 'prophetic-biography', 'history', 'biographies-and-generations',
  'genealogy', 'geography-and-travel', 'arabic-language', 'rare-words-and-dictionaries',
  'grammar-and-morphology', 'literature', 'prosody-and-rhyme', 'poetry', 'rhetoric',
  'collected-works-and-compilations', 'bibliographies-and-guides', 'medicine', 'general-books', 'other-sciences',
]);

export const qafSearch = z.strictObject({
  query: z.string().trim().min(1).max(2000),
  limit: z.int().min(1).max(20).default(20),
  excludeIds: z.array(z.uuid()).max(200).optional(),
  locale: qafLocale,
  filterOperator: z.enum(['AND', 'OR']).default('AND'),
  filters: z.strictObject({
    authorIds: ids(z.int().positive()).optional(),
    bookIds: ids(z.uuid()).optional(),
    deathYearAH: deathYear.optional(),
    genres: ids(genre).optional(),
  }).optional(),
});

export const qafLookup = z.strictObject({
  type: z.enum(['author', 'book']),
  query: z.string().trim().min(1).max(200),
  locale: qafLocale,
});

export const qafPassageQuery = z.strictObject({ radius: z.coerce.number().int().min(0).max(5).default(0), locale: qafLocale });
export const qafPassage = z.object({
  id: z.uuid(),
  title: z.string(),
  url: z.string().regex(QAF_PASSAGE_URL),
  turathUrl: z.string().regex(QAF_TURATH_URL),
  text: z.string(),
  pages: z.array(z.object({ vol: z.string().nullable(), page: z.int().nullable() })),
  book: z.object({ id: z.uuid(), title: z.string(), titleArabic: z.string() }),
  author: z.object({ id: z.int(), name: z.string(), nameArabic: z.string() }),
});
export const qafSearchResult = z.object({ results: z.array(qafPassage).max(20) });
export const qafContextResult = qafPassage.extend({
  before: z.array(qafPassage).max(5), after: z.array(qafPassage).max(5),
  footnotes: z.string().optional(),
});

const candidate = z.object({ label: z.string(), deathYearAH: z.int().nullable(), deathInexactLabel: z.string().nullable() });
export const qafLookupResult = z.object({ candidates: z.array(z.discriminatedUnion('type', [
  candidate.extend({ type: z.literal('author'), id: z.int() }),
  candidate.extend({ type: z.literal('book'), id: z.uuid(), authorId: z.int(), authorLabel: z.string() }),
])).max(5) });

export const qafSettingsPatch = z.strictObject({
  key: z.union([z.string().min(16).max(256).regex(/^qaf_sk_[a-zA-Z0-9_-]+$/).refine((value) => !/\s/.test(value)), z.null()]).optional(),
  userMinute: z.int().min(1).max(QAF_LIMITS.userMinute.max).optional(),
  globalMinute: z.int().min(1).max(QAF_LIMITS.globalMinute.max).optional(),
  userWeek: z.int().min(1).max(QAF_LIMITS.userWeek.max).optional(),
  globalWeek: z.int().min(1).max(QAF_LIMITS.globalWeek.max).optional(),
});
