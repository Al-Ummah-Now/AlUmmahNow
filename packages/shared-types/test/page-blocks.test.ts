/**
 * Page-block meta lines follow the owner's number rule (2026-11-21): Arabic joins with «،», English with «·».
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePageBlocks, pageBlocksToMarkdown, renderPageBlocks } from '../src/page-blocks.ts';

const post = (locale: 'en' | 'ar', title: string, author: string | null) => ({
  slug: 'p1',
  locale,
  title,
  excerpt: null,
  cover: null,
  published_at: '2026-11-18T09:00:00.000Z',
  author_name: author,
});
const postsBlock = (items: unknown[]) => [{ id: 'b1', type: 'posts', appearance: {}, heading: null, mode: 'latest', items }];
const meta = (html: string) => /<p class="pb-post-m">(.*?)<\/p>/.exec(html)?.[1] ?? '';

test('Arabic post meta joins the date and author with «،»', () => {
  const m = meta(renderPageBlocks(postsBlock([post('ar', 'استقبال رمضان', 'فريق التحرير')]), { locale: 'ar' }));
  assert.match(m, /<\/time>، فريق التحرير$/);
  assert.doesNotMatch(m, /·/);
});

test('English post meta keeps «·»', () => {
  const m = meta(renderPageBlocks(postsBlock([post('en', 'Welcoming Ramadan', 'The editors')]), { locale: 'en' }));
  assert.match(m, /<\/time> · The editors$/);
});

test('post meta without an author has no separator', () => {
  const m = meta(renderPageBlocks(postsBlock([post('ar', 'استقبال رمضان', null)]), { locale: 'ar' }));
  assert.doesNotMatch(m, /[،·]/);
});

test('the markdown fallback joins Arabic hero links with «،» and English ones with «·»', () => {
  const hero = (labels: string[]) =>
    normalizePageBlocks([{ id: 'h', type: 'hero', title: 'T', buttons: labels.map((label, i) => ({ label, url: `/p${i}/`, variant: 'primary' })) }]);
  assert.match(pageBlocksToMarkdown(hero(['اقرأ', 'شاهد'])), /\[اقرأ\]\(\/p0\/\)، \[شاهد\]\(\/p1\/\)/);
  assert.match(pageBlocksToMarkdown(hero(['Read', 'Watch'])), /\[Read\]\(\/p0\/\) · \[Watch\]\(\/p1\/\)/);
});

test('no Arabic thousands separator «٬» in rendered Arabic blocks', () => {
  const html = renderPageBlocks(postsBlock([post('ar', 'استقبال رمضان', 'فريق التحرير')]), { locale: 'ar' });
  assert.doesNotMatch(html, /٬/);
});
