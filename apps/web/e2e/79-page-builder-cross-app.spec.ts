import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { test as fixturesTest, expect } from './fixtures';
import { useOwnData } from './release/builders';
import { promoteToAdmin } from './release/sink';
import type { WebUser } from './release/web-session';

/**
 * The page builder across apps (wiki AUN-CMS-PAGE-BUILDER): a staff member builds the About page in
 * the CMS's page builder (block picker, live preview), publishes it, and the same blocks show on www
 * (/{l}/about/) and on this site's About page (/{l}/about), rendered by the one shared renderer. Once
 * in English; then the Arabic page, made with "Copy from English" and translated, on both sites right
 * to left.
 *
 * Needs the CMS and www on the local stack with the page builder in them: their released bundles
 * (fetch-auth.ts --repo cms|www), or a branch or local build before they release it
 * (sibling-build.ts --repo cms|www --ref <branch> | --checkout <dir>). Skips when either is missing
 * or its build predates the page builder.
 *
 * Own data: a run account promoted to Admin (it signs in to the CMS through the local issuer). The
 * About pages are the CMS's own (there is one About page): their rows are saved first and put back
 * afterwards, with this run's revisions and its CMS user row deleted. The words the run writes carry
 * no run id, so no cache of www or this site holds one.
 */

const CMS = process.env.E2E_CMS_URL || 'http://localhost:3402';
const WWW = process.env.E2E_WWW_URL || 'http://localhost:3401';
const CONTROL = process.env.LOCAL_STACK_CONTROL_URL || 'http://127.0.0.1:3190';
const SHOW_MS = 120_000; // www and this site keep a fresh CMS copy for 60 s (Cache API)

const data = useOwnData(fixturesTest);
const test = fixturesTest;
test.describe.configure({ mode: 'serial' });

async function up(url: string): Promise<boolean> {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(5000) })).status < 500;
  } catch {
    return false;
  }
}

/** SQL on the stack's CMS database. */
async function cmsSql(sql: string): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${CONTROL}/__stack/d1/al-ummah-now-cms`, { method: 'POST', body: sql });
  expect(res.status, `cms sql: ${sql.slice(0, 80)}`).toBe(200);
  return ((await res.json()) as { results?: Record<string, unknown>[] }).results ?? [];
}

const lit = (v: unknown) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const PAGE_COLUMNS = ['title', 'summary', 'body', 'blocks', 'status', 'published_at', 'publish_at', 'seo_title', 'seo_description', 'updated_at'] as const;

interface AboutRow { id: number; locale: 'en' | 'ar'; [k: string]: unknown }
let saved: AboutRow[] = [];
let firstRevision = 0;
let admin: WebUser | null = null;

test.afterAll(async () => {
  // Before the account goes (useOwnData's cleanup): the About pages as they were, then this run's rows
  for (const row of saved) {
    await cmsSql(`UPDATE pages SET ${PAGE_COLUMNS.map((c) => `${c} = ${lit(row[c])}`).join(', ')} WHERE id = ${Number(row.id)}`);
  }
  if (admin) {
    const email = lit(admin.email);
    await cmsSql(`DELETE FROM content_revisions WHERE id > ${firstRevision} AND actor_email = ${email}`);
    const users = await cmsSql(`SELECT id FROM users WHERE email = ${email} OR sso_sub = ${lit(admin.userId)}`);
    for (const u of users) await cmsSql(`DELETE FROM sso_sign_outs WHERE user_id = ${Number(u.id)}`);
    await cmsSql(`DELETE FROM users WHERE email = ${email} OR sso_sub = ${lit(admin.userId)}`);
  }
});

/** Signs in to the CMS through the local issuer (the browser already has the account's session there). */
async function signInToCms(page: Page) {
  await page.goto(`${CMS}/sso/login?return=%2F`);
  // The issuer may ask which account to continue with: the run account is the only one
  const chooser = page.getByRole('button', { name: admin!.email });
  await expect(async () => {
    if (new URL(page.url()).origin !== new URL(CMS).origin && (await chooser.count())) await chooser.first().click();
    expect(new URL(page.url()).origin).toBe(new URL(CMS).origin);
  }).toPass({ timeout: 60_000, intervals: [500, 1000, 2000] });
  await expect(page).not.toHaveURL(/\/sso\//);
}

/** Adds a block from the builder's picker and returns its card. */
async function addBlock(page: Page, preset: string) {
  await page.locator('[data-open-picker=end]').click();
  const picker = page.locator('#blk-picker');
  await expect(picker).toBeVisible();
  await picker.locator(`[data-preset=${preset}]`).click();
  await expect(picker).toBeHidden();
  return page.locator('ol[data-k=blocks] > li.blk').last();
}

const frame = (page: Page) => page.frameLocator('[data-pv-frame]');

/** The About page as the CMS serves it. */
async function served(locale: 'en' | 'ar') {
  const res = await fetch(`${CMS}/api/public/v1/pages/about?locale=${locale}`);
  return res.ok ? ((await res.json()) as { blocks?: { type: string; title?: string | null; items?: { q?: string }[] }[] }) : null;
}

/** The FAQ question shows on www's and this site's About pages (reloading while their caches go stale). */
async function showsOnBothSites(page: Page, locale: 'en' | 'ar', question: string, heroTitle: string) {
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  await expect(async () => {
    await page.goto(`${WWW}/${locale}/about/`);
    await expect(page.locator('[data-testid=page-blocks] .pb')).toHaveAttribute('dir', dir, { timeout: 2000 });
    await expect(page.locator('[data-block-type=faq] summary').filter({ hasText: question })).toHaveCount(1, { timeout: 2000 });
  }).toPass({ timeout: SHOW_MS, intervals: [2000, 5000] });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(heroTitle);

  await expect(async () => {
    await page.goto(`/${locale}/about`);
    const body = page.getByTestId('about-body');
    await expect(body.locator('.pb')).toHaveAttribute('dir', dir, { timeout: 2000 });
    await expect(body.locator('[data-block-type=faq] summary').filter({ hasText: question })).toHaveCount(1, { timeout: 2000 });
  }).toPass({ timeout: SHOW_MS, intervals: [2000, 5000] });
  await expect(page.getByTestId('about-page')).toHaveAttribute('data-source', 'cms');
  // The hero is the page's only h1 (no separate header), and the FAQ opens without JS
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(heroTitle);
  await expect(page.locator('.ab-head')).toHaveCount(0);
  const qa = page.locator('[data-block-type=faq] details').filter({ hasText: question });
  await qa.locator('summary').click();
  await expect(qa).toHaveAttribute('open', '');
  const axe = await new AxeBuilder({ page }).include('[data-testid=about-page]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test('a page built in the CMS shows on www and on the videos About page, in English and Arabic', async ({ page }) => {
  test.setTimeout(600_000);
  test.skip(!(await up(`${CMS}/healthz`)) || !(await up(`${WWW}/`)), 'needs the CMS and www on the local stack (fetch-auth.ts or sibling-build.ts --repo cms|www)');
  const about = (await cmsSql(`SELECT id, locale, ${PAGE_COLUMNS.join(', ')} FROM pages WHERE slug = 'about' AND translation_key = 'www-about' AND locale IN ('en', 'ar')`)) as AboutRow[];
  test.skip(about.length !== 2, 'the CMS has no seeded About page (AlUmmahNowCMS migration 0021)');
  const builderInCms = (await served('en'))?.blocks?.some((b) => b.type === 'hero');
  test.skip(!builderInCms, 'the CMS build predates the page builder (migration 0022): run it with sibling-build.ts --repo cms');
  const wwwHtml = await (await fetch(`${WWW}/en/about/`)).text();
  test.skip(!wwwHtml.includes('class="pb"'), 'the www build predates the shared page-builder renderer: run it with sibling-build.ts --repo www');

  saved = about;
  firstRevision = Number((await cmsSql('SELECT COALESCE(MAX(id), 0) AS n FROM content_revisions'))[0]?.n ?? 0);
  const id = (l: 'en' | 'ar') => Number(about.find((r) => r.locale === l)!.id);

  // A run account with the Admin role, signed in to the CMS through the local issuer
  admin = await data.createUser(page, 'page-builder');
  await promoteToAdmin(admin.email);
  await signInToCms(page);

  // ── English: a FAQ added from the picker, previewed live, published ──
  const question = 'Can I watch without an account?';
  await page.goto(`${CMS}/pages/${id('en')}?lang=en&mode=dark`);
  await page.locator('[data-builder-open]').click();
  await expect(page.locator('html')).toHaveClass(/bld-lock/);
  const faq = await addBlock(page, 'faq');
  await faq.locator('[data-k=heading]').first().fill('Questions');
  const qs = faq.locator('ol[data-k=items] > li');
  await qs.nth(0).locator('[data-k=q]').fill(question);
  await qs.nth(0).locator('[data-k=a]').fill('Yes. Every public video, Short and post is open to everyone.');
  await qs.nth(1).locator('[data-k=q]').fill('Who can upload?');
  await qs.nth(1).locator('[data-k=a]').fill('Creators the team has invited.');
  await expect(frame(page).locator('[data-block-type=faq] summary').first()).toHaveText(question);
  const enHero = (await served('en'))!.blocks!.find((b) => b.type === 'hero')!.title || String(about.find((r) => r.locale === 'en')!.title);
  await page.locator('[data-builder-save]').click();
  await expect.poll(async () => (await served('en'))?.blocks?.find((b) => b.type === 'faq')?.items?.[0]?.q, { timeout: 30_000 }).toBe(question);
  await showsOnBothSites(page, 'en', question, enHero);

  // ── Arabic: Copy from English, translate, publish ──
  const arQuestion = 'هل يمكنني المشاهدة دون حساب؟';
  const arHero = 'الأمة الآن: مرئيات ومنشورات من المجتمع';
  await page.goto(`${CMS}/pages/${id('ar')}?lang=ar&mode=dark`);
  await page.locator('[data-builder-open]').click();
  await page.locator('[data-copy-from]').click();
  // The Arabic About page already has blocks: the editor asks before replacing them
  await page.locator('#confirm [data-confirm-ok]').click();
  const blocks = page.locator('ol[data-k=blocks] > li.blk');
  await expect(page.locator('[data-undo]')).toBeVisible();
  const open = async (i: number) => {
    const b = blocks.nth(i);
    if (await b.locator('[data-blk-fold][aria-expanded=false]').count()) await b.locator('[data-blk-fold]').first().click();
    return b;
  };
  const types = await blocks.evaluateAll((els) => els.map((e) => e.getAttribute('data-block-type') ?? ''));
  const heroIndex = Math.max(0, types.indexOf('hero'));
  await (await open(heroIndex)).locator('[data-k=title]').first().fill(arHero);
  const arFaq = await open((await blocks.count()) - 1);
  await arFaq.locator('[data-k=heading]').first().fill('أسئلة');
  const arQs = arFaq.locator('ol[data-k=items] > li');
  await arQs.nth(0).locator('[data-k=q]').fill(arQuestion);
  await arQs.nth(0).locator('[data-k=a]').fill('نعم. كل مرئي ومقطع قصير ومنشور عام متاح للجميع.');
  await arQs.nth(1).locator('[data-k=q]').fill('من يمكنه الرفع؟');
  await arQs.nth(1).locator('[data-k=a]').fill('صنّاع المحتوى الذين دعاهم الفريق.');
  await expect(frame(page).locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(frame(page).locator('[data-block-type=hero] h1')).toHaveText(arHero);
  await page.locator('[data-builder-save]').click();
  await expect.poll(async () => (await served('ar'))?.blocks?.find((b) => b.type === 'faq')?.items?.[0]?.q, { timeout: 30_000 }).toBe(arQuestion);
  await showsOnBothSites(page, 'ar', arQuestion, arHero);
});
