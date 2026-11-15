/**
 * MessageType.CategoryRelabel: an admin renamed a category. The handler swaps
 * the labels in the search index text page by page (videos, then channels),
 * queues the next page, and the categorize prompt follows the live list.
 */
import { join } from 'path';
import { createLogger } from '@al-ummah/logger';
import {
  CATEGORY_RELABEL_PAGE,
  DEFAULT_VIDEO_CATEGORY_ENTRIES,
  MessageType,
  categorySystemPrompt,
  loadVideoCategories,
  resetVideoCategories,
  syncSearchDocument,
  type SearchDb,
} from '@al-ummah/shared-types';
import { handleCategoryRelabel, isCategoryRelabelPayload } from '../handlers/category-relabel';
import { createSqliteD1 } from './sqlite-d1';

const SEARCH_MIGRATIONS_DIR = join(__dirname, '..', '..', '..', 'api-videos', 'migrations', 'search');
const logger = createLogger('processor-test', { logLevel: 'error' });
const payload = { category: 'fiqh', entity: 'video' as const, from: { en: 'Fiqh', ar: 'الفقه' }, to: { en: 'Jurisprudence', ar: 'أحكام الفقه' } };
const message = (p: unknown) => ({ id: 'm1', type: MessageType.CategoryRelabel, payload: p, timestamp: new Date().toISOString() }) as never;

afterEach(() => resetVideoCategories());

async function seed(search: SearchDb, count: number) {
  for (let i = 0; i < count; i++) {
    await syncSearchDocument(search, 'video', `v${i}`, { id: `v${i}`, title: `Talk ${i}`, description: 'about rulings', category: 'fiqh', isPublic: true, visibility: 'public', uploadStatus: 'ready', userId: 'u', channelId: 'c' }, { version: 1 });
  }
  await syncSearchDocument(search, 'channel', 'c1', { id: 'c1', name: 'A channel', category: 'fiqh' }, { version: 1 });
}

const matches = (search: { raw: { prepare(sql: string): { all(): unknown[] } } }, table: string, term: string) =>
  (search.raw.prepare(`SELECT rowid FROM ${table}_fts WHERE ${table}_fts MATCH '${term}'`).all() as unknown[]).length;

describe('CategoryRelabel', () => {
  it('validates its payload', () => {
    expect(isCategoryRelabelPayload(payload)).toBe(true);
    expect(isCategoryRelabelPayload({ ...payload, category: 'Bad!' })).toBe(false);
    expect(isCategoryRelabelPayload({ ...payload, to: { en: 'x' } })).toBe(false);
  });

  it('a page of videos queues the next page; the last page moves on to channels', async () => {
    const search = createSqliteD1(SEARCH_MIGRATIONS_DIR);
    await seed(search as unknown as SearchDb, CATEGORY_RELABEL_PAGE + 1);
    const sent: any[] = [];
    const env = { SEARCH_DB: search, MESSAGE_QUEUE: { send: async (m: unknown) => { sent.push(m); } } } as never;

    await handleCategoryRelabel(message(payload), env, logger);
    expect(sent).toHaveLength(1);
    expect(sent[0].payload.entity).toBe('video');
    expect(sent[0].payload.afterRowid).toBeGreaterThan(0);

    await handleCategoryRelabel(message(sent[0].payload), env, logger);
    expect(sent[1].payload).toMatchObject({ entity: 'channel', afterRowid: 0 });
    await handleCategoryRelabel(message(sent[1].payload), env, logger);
    expect(sent).toHaveLength(2);
    expect(matches(search, 'search_videos', 'jurisprudence')).toBe(CATEGORY_RELABEL_PAGE + 1);
    expect(matches(search, 'search_channels', 'jurisprudence')).toBe(1);
  });

  it('without a producer (local dev) every page runs inline; a repeat is harmless', async () => {
    const search = createSqliteD1(SEARCH_MIGRATIONS_DIR);
    await seed(search as unknown as SearchDb, 3);
    const env = { SEARCH_DB: search } as never;
    await handleCategoryRelabel(message(payload), env, logger);
    await handleCategoryRelabel(message(payload), env, logger);
    expect(matches(search, 'search_videos', 'jurisprudence')).toBe(3);
    expect(matches(search, 'search_videos', 'fiqh')).toBe(0);
  });

  it('a bad payload throws (retried, then the DLQ)', async () => {
    await expect(handleCategoryRelabel(message({ category: 'fiqh' }), { SEARCH_DB: createSqliteD1(SEARCH_MIGRATIONS_DIR) } as never, logger)).rejects.toThrow('CategoryRelabel');
  });

  it('the categorize prompt reads the live list: a new category with its hint, a retired one gone', async () => {
    const search = createSqliteD1(SEARCH_MIGRATIONS_DIR);
    search.raw.exec("INSERT INTO video_categories (value, label_en, label_ar, hint, position, retired, created_at, updated_at) VALUES ('seerah_kids', 'Seerah for kids', 'السيرة للأطفال', 'stories for children', 1, 0, 0, 0)");
    search.raw.exec("UPDATE video_categories SET retired = 1 WHERE value = 'islamic_news'");
    await loadVideoCategories(search as unknown as SearchDb, { force: true });
    const prompt = categorySystemPrompt();
    expect(prompt).toContain('- seerah_kids: Seerah for kids / السيرة للأطفال: stories for children');
    expect(prompt).not.toContain('islamic_news');
    expect(DEFAULT_VIDEO_CATEGORY_ENTRIES.some((c) => c.value === 'islamic_news')).toBe(true);
  });
});
