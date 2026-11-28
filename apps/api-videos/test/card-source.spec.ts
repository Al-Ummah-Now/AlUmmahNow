import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QURAN_CURRENT_KEY, QURAN_MAX_STALE_MS, quranTextKey } from '@al-ummah/shared-types';
import { canCreateCard, cardSourceSchema, formatCardQafCitation, readQuranCard } from '../src/lib/cards/source';
import { clearQuranCopyCache } from '../src/lib/quran/copy';

test('card creation requires a creator tier or super admin', async () => {
  const db = {
    prepare() {
      return { bind() { return { async first() { return null; } }; } };
    },
  } as unknown as D1Database;
  assert.equal(await canCreateCard(db, { userId: 'member', roles: ['admin'] }), false);
  assert.equal(await canCreateCard(db, { userId: 'super', roles: ['Super Admin'] }), true);
});

test('Qaf citations keep repeated volume entries and localize page digits', () => {
  const passage = {
    id: 'fixture', title: 'Passage', url: '', turathUrl: '', text: 'Fixture',
    book: { id: 'book', title: 'Book', titleArabic: 'كتاب' },
    author: { id: 1, name: 'Author', nameArabic: 'المؤلف' },
    pages: [{ vol: '2', page: 1130 }, { vol: '2', page: 1131 }],
  };
  assert.equal(formatCardQafCitation(passage, 'ar'), 'كتاب — المؤلف، ج ٢، ص ١١٣٠؛ ج ٢، ص ١١٣١');
});

test('card source clients cannot supply text or citations for sourced cards', () => {
  assert.equal(cardSourceSchema.safeParse({ kind: 'quran', surah: 2, ayah: 1, text: 'override' }).success, false);
  assert.equal(cardSourceSchema.safeParse({ kind: 'message', text: ' '.repeat(5) }).success, false);
  assert.equal(cardSourceSchema.safeParse({ kind: 'message', text: 'a'.repeat(601) }).success, false);
});

test('Quran cards keep synced text byte-exact, cite the verse and expire with the copy', async () => {
  clearQuranCopyCache();
  const text = 'ع\u0654  ا "text"';
  const now = Date.now();
  const version = 'test';
  const files = new Map<string, unknown>([
    [QURAN_CURRENT_KEY, { version, syncedAt: new Date(now).toISOString() }],
    [quranTextKey(version, 2), { name: { ar: 'البقرة', simple: 'Al-Baqarah' }, ayat: [{ text }] }],
  ]);
  const bucket = {
    async get(key: string) {
      const data = files.get(key);
      return data === undefined ? null : { async json<T>() { return data as T; } };
    },
  };
  const source = { kind: 'quran', surah: 2, ayah: 1 } as const;
  const result = await readQuranCard(bucket, source, 'ar', now);
  assert.ok(result);
  assert.deepEqual(Buffer.from(result.copy.text), Buffer.from(text));
  assert.equal(result.copy.citation, 'سورة البقرة · الآية ١');
  assert.match(result.copy.credit ?? '', /quran\.foundation/u);
  assert.equal(await readQuranCard(bucket, source, 'ar', now + QURAN_MAX_STALE_MS + 1), null);
  clearQuranCopyCache();
});
