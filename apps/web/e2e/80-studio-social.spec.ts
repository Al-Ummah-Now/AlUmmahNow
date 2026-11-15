import { test, expect } from './fixtures';
import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { ns, onLocalStack, useOwnData, type Creator } from './release/builders';
import { target } from './release/targets';

/**
 * Studio → Social (wiki AUN-SOCIAL, SOC-1; owner 2026-11-14: auto-post to X, Telegram, Bluesky and Mastodon, no
 * Meta; help people who use Hootsuite and similar tools). On the local stack only: every network is a fake
 * (scripts/local-stack/fake-social.ts), so no real account, token or paid API is touched.
 *
 * - Mastodon: connect through the instance's OAuth page, turn on "Community posts", publish a post: it goes out
 *   (queue → processor → api-videos → the fake instance) and shows under Recent posts as Sent.
 * - Telegram: the bot token is set the way the admin page sets it; Studio shows a code, the code "posted in the
 *   channel" connects it, and Disconnect (in-app dialog) removes it.
 * - Webhooks: add one, the secret shows once, Send test delivers a signed ping, Remove.
 * - Scheduler tools: the channel's RSS feed on the site's host is valid RSS 2.0 with the post; oEmbed knows the
 *   channel; the help page link works.
 * - en and ar (rtl), phone width, axe WCAG 2.2 AA.
 *
 * Own data: a creator with a channel (useOwnData), deleted afterwards with every social row (channel erasure).
 * Shared state: the Telegram bot token is platform-wide, so this file runs in the shared-state project.
 */
const CONTROL = process.env.LOCAL_STACK_CONTROL_URL || 'http://127.0.0.1:3190';
const INTERNAL_KEY = 'local-stack-internal-key';
const BOT_TOKEN = '7000001:LocalStackFakeBotTokenForE2EOnly_abcdefgh';

const data = useOwnData(test);
let owner: Creator;
let channelId: string;

test.describe.configure({ mode: 'serial' });
test.use({ storageState: async ({}, use) => use(owner.state) });

interface FakePost { network: string; text: string; account: string }
interface FakeHook { path: string; headers: Record<string, string>; body: string }

async function control<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${CONTROL}${path}`, init);
  expect(res.status, `${path}: ${res.status}`).toBeLessThan(300);
  return (await res.json()) as T;
}

/** What the admin page does (admin-api → api-videos internal); the local stack's fixed internal key. */
async function setTelegramBot(): Promise<void> {
  const res = await fetch(`${target().api}/internal/social/admin/credentials/telegram`, {
    method: 'PUT',
    headers: { 'X-API-Key': INTERNAL_KEY, 'X-Admin-Actor': 'e2e', 'Content-Type': 'application/json' },
    body: JSON.stringify({ botToken: BOT_TOKEN }),
  });
  expect(res.status, await res.text()).toBe(200);
}

async function openSocial(page: Page, locale: 'en' | 'ar' = 'en') {
  await page.goto(`/${locale}/studio/${channelId}/social`);
  await expect(page.getByTestId('studio-social')).toBeVisible({ timeout: 30_000 });
}

async function axe(page: Page, label: string) {
  const scan = await new AxeBuilder({ page }).include('[data-testid="studio-social"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(scan.violations.map((v) => `${label}: ${v.id} (${v.nodes.length})`)).toEqual([]);
}

test.beforeAll(async ({ browser }) => {
  test.skip(!onLocalStack(), 'the social networks are faked on the local stack only');
  owner = await data.createCreator(browser, 'social');
  channelId = owner.channelIds[0];
  await setTelegramBot();
});

test('SOC-01 connect Mastodon, turn on community posts, a new post goes out and shows as Sent', async ({ page }) => {
  const instance = `c${Date.now().toString(36)}.mastodon.local-stack.test`;
  await openSocial(page);
  await page.getByTestId('social-connect-mastodon').click();
  const form = page.getByTestId('social-connect-form-mastodon');
  await form.getByRole('textbox').fill(instance);
  await form.getByRole('button', { name: 'Continue' }).click();
  // The instance's OAuth page approves at once and api-videos sends us back to Studio
  await expect(page).toHaveURL(new RegExp(`/en/studio/${channelId}/social\\?connected=mastodon`), { timeout: 30_000 });
  await expect(page.getByRole('status').filter({ hasText: 'Mastodon connected.' })).toBeVisible();
  const account = page.getByTestId('social-account-mastodon');
  await expect(account).toBeVisible();

  const rule = account.getByTestId('social-rule-post');
  const save = page.waitForResponse((r) => r.url().includes('/api/social/channel/') && r.request().method() !== 'GET' && r.ok());
  await rule.getByRole('checkbox').check();
  await save;

  const text = `E2E social ${ns()} ${Date.now().toString(36)}`;
  await data.createPost(owner.user, channelId, { text });
  await expect
    .poll(async () => (await control<FakePost[]>('/__fake/social/posts?network=mastodon')).find((p) => p.account === instance && p.text.includes(text)), { timeout: 90_000, message: 'the post reached the fake instance' })
    .toBeTruthy();

  await page.reload();
  const sent = page.getByTestId('social-delivery').filter({ hasText: text.slice(0, 30) });
  await expect(sent).toHaveAttribute('data-status', 'sent', { timeout: 30_000 });
});

test('SOC-02 connect a Telegram channel with the code, then disconnect it in the in-app dialog', async ({ page }) => {
  await openSocial(page);
  await page.getByTestId('social-connect-telegram').click();
  const code = (await page.getByTestId('social-telegram-code-value').innerText()).trim();
  expect(code).toMatch(/^AUN-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  // The creator posts the code in a channel where the bot is an admin
  await control('/__fake/social/telegram/post', { method: 'POST', body: JSON.stringify({ text: code, chatId: -1_000_000_000_000 - Math.floor(Math.random() * 1e6), title: 'قناة نور', username: `noor${Date.now().toString(36)}` }) });
  const account = page.getByTestId('social-account-telegram');
  await expect(account).toBeVisible({ timeout: 30_000 });

  await account.getByTestId('social-disconnect-open').click();
  const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'));
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Disconnect' }).click();
  await expect(account).toHaveCount(0);
});

test('SOC-03 a webhook gets its secret once, a signed test ping, and is removed', async ({ page }) => {
  const path = `/e2e/${Date.now().toString(36)}`;
  await openSocial(page);
  await page.getByTestId('social-webhook-add').click();
  const form = page.getByTestId('social-webhook-form');
  await form.getByLabel('URL').fill(`https://hooks.local-stack.test${path}`);
  await page.getByTestId('social-webhook-create').click();
  const secret = (await page.getByTestId('social-webhook-secret-value').innerText()).trim();
  expect(secret.length).toBeGreaterThan(20);

  const hook = page.getByTestId('social-webhook');
  await hook.getByTestId('social-webhook-test').click();
  await expect(page.getByRole('status').filter({ hasText: /test/i })).toBeVisible({ timeout: 30_000 });
  const calls = await control<FakeHook[]>('/__fake/social/webhooks');
  const ping = calls.find((c) => c.path === path);
  expect(ping, 'the test ping reached the receiver').toBeTruthy();
  expect(JSON.parse(ping!.body)).toMatchObject({ event: 'ping', channel: { id: channelId } });
  expect(Object.keys(ping!.headers).some((h) => /signature/i.test(h))).toBe(true);
  // The secret is never shown again
  await page.reload();
  await expect(page.getByTestId('social-webhook-secret-value')).toHaveCount(0);

  await page.getByTestId('social-webhook-remove-open').click();
  const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'));
  await dialog.getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByTestId('social-webhook')).toHaveCount(0);
});

test('SOC-04 scheduler tools: a valid RSS feed with the post, channel oEmbed and the help page', async ({ page, request }) => {
  await openSocial(page);
  const feedUrl = await page.getByTestId('social-feed-all').locator('p[dir="ltr"]').innerText();
  expect(feedUrl).toContain(`/feeds/${channelId}/all.xml`);
  const res = await request.get(new URL(feedUrl).pathname);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('application/rss+xml');
  const xml = await res.text();
  expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\s*<rss version="2.0"/);
  expect(xml).toContain('<atom:link');
  expect(xml).toMatch(/<item>[\s\S]*E2E social[\s\S]*<\/item>/);
  const ar = await (await request.get(`${new URL(feedUrl).pathname}?lang=ar`)).text();
  expect(ar).toContain('<language>ar</language>');

  const oembed = await request.get(`/oembed?url=${encodeURIComponent(`${target().web}/en/channels/${channelId}`)}`);
  expect(oembed.status()).toBe(200);
  expect(await oembed.json()).toMatchObject({ type: 'link', aun_channel_id: channelId });

  await page.getByTestId('social-feeds-help').click();
  await expect(page).toHaveURL(/\/en\/help\/social/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('SOC-05 Arabic, right to left, on a phone, and no axe violations', async ({ page }) => {
  await openSocial(page);
  await axe(page, 'en desktop');
  await page.setViewportSize({ width: 390, height: 844 });
  await openSocial(page, 'ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { level: 1, name: 'التواصل الاجتماعي' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, 'no sideways scroll on a phone').toBeLessThanOrEqual(1);
  await axe(page, 'ar phone');
});
