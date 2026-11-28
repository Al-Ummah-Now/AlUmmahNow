import {
  isSuperAdmin, localizeDigits, QURAN_ATTRIBUTION, QURAN_FOUNDATION_URL, tierAllowsChannels, tierAllowsUploads,
} from '@al-ummah/shared-types';
import type { QafPassage } from '@al-ummah/shared-types';
import { z } from 'zod';
import { resolveCreator } from '../creatorTiers';
import { qafContextResult } from '../qaf/schemas';
import { queryQaf, type QafEnv } from '../qaf/service';
import { readQuranSurah } from '../quran/copy';

export const cardSourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('quran'), surah: z.int().min(1).max(114), ayah: z.int().min(1).max(286) }),
  z.strictObject({ kind: z.literal('qaf'), passageId: z.uuid() }),
  z.strictObject({ kind: z.literal('message'), text: z.string().max(600).refine((text) => text.trim().length > 0) }),
]);

export type CardSource = z.infer<typeof cardSourceSchema>;
type Locale = 'ar' | 'en';

export type CardCopy = {
  text: string;
  ayat?: readonly string[];
  pageLabel?: string;
  citation: string;
  credit?: string;
  sourceUrl?: string;
};

export async function canCreateCard(
  db: D1Database,
  actor: { userId: string; roles?: readonly string[] },
): Promise<boolean> {
  if (isSuperAdmin(actor.roles)) return true;
  const { tier } = await resolveCreator(db, actor);
  return tierAllowsChannels(tier) || tierAllowsUploads(tier);
}

export async function readQuranCard(
  bucket: Parameters<typeof readQuranSurah>[0],
  source: Extract<CardSource, { kind: 'quran' }>,
  locale: Locale,
  now?: number,
): Promise<{ copy: CardCopy; version: string } | null> {
  const result = await readQuranSurah(bucket, source.surah, now);
  const verse = result?.file.ayat[source.ayah - 1];
  if (!result || !verse) return null;

  const name = locale === 'ar' ? result.file.name.ar : result.file.name.simple;
  const number = localizeDigits(locale, source.ayah);
  return {
    version: result.current.version,
    copy: {
      text: verse.text,
      ayat: [verse.text],
      citation: locale === 'ar' ? `سورة ${name}، الآية ${number}` : `${name}, Verse ${number}`,
      credit: QURAN_ATTRIBUTION[locale],
      sourceUrl: QURAN_FOUNDATION_URL,
    },
  };
}

export function formatCardQafCitation(passage: Omit<QafPassage, 'pages'> & { pages: Partial<QafPassage['pages'][number]>[] }, locale: Locale): string {
  const arabic = locale === 'ar';
  const separator = arabic ? '، ' : ', ';
  const book = arabic ? passage.book.titleArabic : passage.book.title;
  const author = arabic ? passage.author.nameArabic : passage.author.name;
  const pages = passage.pages.map(({ vol, page }) => [
    vol == null ? '' : `${arabic ? 'ج' : 'vol.'} ${localizeDigits(locale, vol)}`,
    page == null ? '' : `${arabic ? 'ص' : 'p.'} ${localizeDigits(locale, page)}`,
  ].filter(Boolean).join(separator)).filter(Boolean);
  return [[book, author].filter(Boolean).join(' — '), pages.join(arabic ? '؛ ' : '; ')]
    .filter(Boolean).join(separator);
}

export async function readQafCard(
  env: QafEnv,
  actorId: string,
  source: Extract<CardSource, { kind: 'qaf' }>,
  locale: Locale,
): Promise<CardCopy> {
  const passage = qafContextResult.parse(await queryQaf(env, actorId, {
    kind: 'context', id: source.passageId, input: { radius: 0, locale },
  }));
  const citation = formatCardQafCitation(passage, locale);
  if (passage.id !== source.passageId || !passage.text.trim() || !citation.trim()) {
    throw new Error('Qaf returned an incomplete passage');
  }
  return {
    text: passage.text,
    citation,
    credit: locale === 'ar' ? 'قاف' : 'Qaf',
    sourceUrl: passage.url,
  };
}
