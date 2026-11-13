import { test as fixturesTest, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { clickUntil, fillStable, tempName } from './test-utils/channel-content';
import { useOwnData, type Creator } from './release/builders';
import { apiFetch } from './release/web-session';

/**
 * Scholar posts end to end (wiki AUN-SCHOLAR-SITES phase 1, issue #1219): a scholar writes in Studio,
 * the processor's reference outbox gives the post a hidden www reference in the CMS, and www shows
 * the post at that address with "Join the discussion" on the channel. Once in English (an article)
 * and once in Arabic (a text post, Studio in Arabic).
 *
 * Needs the CMS and www on the local stack (their released local-stack bundles, fetch-auth.ts
 * --repo cms|www); skips when either is missing.
 *
 * Own data: a creator with one channel (release/builders.ts, deleted afterwards), a scholar profile
 * in the CMS D1 for that creator with the channel as primary (the stack's SQL fast path), the posts.
 * Cleanup deletes the posts through the API, then the CMS rows of that channel and the profile.
 */

const CMS = process.env.E2E_CMS_URL || 'http://localhost:3402';
const WWW = process.env.E2E_WWW_URL || 'http://localhost:3401';
const CONTROL = process.env.LOCAL_STACK_CONTROL_URL || 'http://127.0.0.1:3190';

const data = useOwnData(fixturesTest);
let scholar: Creator;
let scholarSlug = '';

fixturesTest.describe.configure({ mode: 'default' });

const test = fixturesTest.extend<object, { creator: Creator }>({
  creator: [
    async ({ browser }, use) => {
      scholar = await data.createCreator(browser, 'scholar-ref');
      await use(scholar);
    },
    { scope: 'worker', timeout: 300_000 },
  ],
});
const channelId = () => scholar.channelIds[0];

async function up(url: string): Promise<boolean> {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(5000) })).status < 500;
  } catch {
    return false;
  }
}

/** SQL on the stack's CMS database (values are this spec's own ids, checked to be plain). */
async function cmsSql(sql: string): Promise<unknown[]> {
  const res = await fetch(`${CONTROL}/__stack/d1/al-ummah-now-cms`, { method: 'POST', body: sql });
  expect(res.status, `cms sql: ${sql.slice(0, 80)}`).toBe(200);
  return ((await res.json()) as { results?: unknown[] }).results ?? [];
}

const plain = (v: string) => {
  if (!/^[A-Za-z0-9_.:@-]{1,128}$/.test(v)) throw new Error(`unexpected id ${v}`);
  return v;
};

/** The www address the CMS gave the scholar's post titled `title` (polls: the outbox is a queue). */
async function refSlug(locale: 'en' | 'ar', title: string): Promise<string> {
  let slug = '';
  await expect(async () => {
    const res = await fetch(`${CMS}/api/public/v1/scholars/${scholarSlug}?locale=${locale}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { posts?: { items?: { slug: string; title: string }[] } };
    const item = body.posts?.items?.find((p) => p.title.includes(title));
    expect(item, `a reference for "${title}"`).toBeTruthy();
    slug = item!.slug;
  }).toPass({ timeout: 90_000, intervals: [1000, 2000, 3000] });
  return slug;
}

async function openNewPost(page: Page, locale: 'en' | 'ar') {
  await page.goto(`/${locale}/settings/channel/${channelId()}/community/new`);
  await expect(page.getByRole('radiogroup')).toBeVisible();
}

async function selectType(page: Page, type: string) {
  const option = page.locator(`[role="radio"][data-post-type="${type}"]`);
  await clickUntil(option, async () => expect(option).toHaveAttribute('aria-checked', 'true', { timeout: 3000 }));
}

test.beforeAll(async ({ creator }) => {
  test.setTimeout(300_000);
  test.skip(!(await up(`${CMS}/healthz`)) || !(await up(`${WWW}/en/`)), 'the CMS or www is not on this stack (no released local-stack bundle)');
  const sub = plain(creator.user.userId);
  const ch = plain(channelId());
  scholarSlug = `e2e-scholar-${ch.slice(0, 8).toLowerCase().replace(/[^a-z0-9]/g, '')}`;
  const at = new Date().toISOString();
  await cmsSql(
    `INSERT INTO scholars (sso_sub, slug, name_en, name_ar, channel_ids, primary_channel_id, created_at, updated_at) VALUES ('${sub}', '${scholarSlug}', 'E2E Scholar', 'عالم الاختبار', '["${ch}"]', '${ch}', '${at}', '${at}')`,
  );
  // Posts first (their deletes draft the refs through the outbox), then every CMS row of this channel and the profile
  data.onCleanup(`scholar ${scholarSlug} (CMS refs and profile)`, async () => {
    const list = await apiFetch(creator.user, `/api/community/channels/${ch}/posts?limit=50`, { headers: { channelId: ch } });
    for (const post of (((await list.json()) as { posts?: { id: string }[] }).posts ?? [])) {
      await apiFetch(creator.user, `/api/community/channels/${ch}/posts/${post.id}`, { method: 'DELETE', headers: { channelId: ch } });
    }
    await cmsSql(`DELETE FROM posts WHERE ref_channel_id = '${ch}' OR author_sub = '${sub}'`);
    return cmsSql(`DELETE FROM scholars WHERE sso_sub = '${sub}'`);
  });
});

test.describe('Scholar post → www reference', () => {
  test.use({ storageState: async ({ creator }, use) => use(creator.state) });

  test('SCHREF-001 an article written in Studio is on www at its reference (en)', async ({ page }) => {
    const title = tempName('Scholar article');
    const body = `A paragraph from Studio ${title}.`;
    await openNewPost(page, 'en');
    await selectType(page, 'article');
    await fillStable(page.locator('#article-title'), title);
    await fillStable(page.locator('#article-body'), `## Heading\n\n${body}`);
    await page.getByRole('button', { name: 'Publish' }).click();
    await expect(page).toHaveURL(new RegExp(`/en/settings/channel/${channelId()}/community$`));

    const slug = await refSlug('en', title);
    const www = await page.context().newPage();
    await www.goto(`${WWW}/en/articles/${slug}/`);
    await expect(www.getByRole('heading', { level: 1 })).toHaveText(title);
    await expect(www.getByText(body)).toBeVisible();
    const join = www.getByRole('link', { name: 'Join the discussion' });
    await expect(join).toHaveAttribute('href', new RegExp(`/channels/${channelId()}\\?tab=community`));
    await www.close();
  });

  test('SCHREF-002 a text post written in Studio in Arabic is on www at its reference (ar)', async ({ page }) => {
    const marker = tempName('ar');
    const text = `منشور من الاستوديو للمجتمع ${marker}`;
    await openNewPost(page, 'ar');
    await selectType(page, 'text');
    await fillStable(page.getByLabel('المحتوى'), text);
    await page.getByRole('button', { name: 'نشر' }).click();
    await expect(page).toHaveURL(new RegExp(`/ar/settings/channel/${channelId()}/community$`));

    const slug = await refSlug('ar', marker);
    const www = await page.context().newPage();
    await www.goto(`${WWW}/ar/articles/${slug}/`);
    await expect(www.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(www.getByText(text)).toBeVisible();
    await expect(www.getByRole('link', { name: 'شارك في النقاش' })).toBeVisible();
    await www.close();
  });
});
