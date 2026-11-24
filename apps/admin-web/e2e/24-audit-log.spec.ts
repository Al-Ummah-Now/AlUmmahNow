/**
 * Audit log page and names instead of ids (#711, #745) on the local stack.
 *
 * Data: a videos profile (the actor) and a video (the item) in R2, the video's admin index row
 * (content_ownership: item titles are read from the index, as its sync writes them), and two audit rows in the
 * reports DB (a content action on the video naming its channel, and a settings change), all
 * carrying this run's marker, written through the stack's control API: the rows are what admin
 * actions write, and the spec is about reading them. Everything is removed afterwards.
 */
import crypto from 'node:crypto';
import { test, expect } from './support/fixtures';
import { adminApi, readTokens } from './support/api';
import { E2E_ENTITY_PREFIX, LOCAL_STACK } from './support/env';
import { stackR2, stackSql } from './support/local-stack';
import { horizontalOverflow, setPreferences } from './support/ui';

const REPORTS = 'al-ummah-now-reports';
const SEARCH = 'al-ummah-now-search';
const hex = crypto.randomBytes(6).toString('hex');
const actorId = `${E2E_ENTITY_PREFIX}audit-actor-${hex}`;
const videoId = `${E2E_ENTITY_PREFIX}audit-v-${hex}`;
const channelId = `${E2E_ENTITY_PREFIX}audit-ch-${hex}`;
const actorName = `Audit Person ${hex}`;
const videoTitle = `Audit video ${hex}`;
// An actor with no videos profile and no stored email: "Unknown user", the id only in a copyable detail
const ghostId = `usr_${E2E_ENTITY_PREFIX}ghost-${hex}`;
const rows = [`${hex}-1`, `${hex}-2`, `${hex}-3`];
// Older than anything a parallel run writes now, so ours are found by filter, not position
const at = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

interface FeedPage {
  items: { id: string; action: string; area: string; actorId: string; target: { kind: string; id: string } | null }[];
  next: string | null;
  names: { users: Record<string, { name: string | null; email: string | null }>; items: Record<string, { title: string | null }> };
}

test.describe('audit log', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({}, testInfo) => {
    test.skip(!LOCAL_STACK, 'Seeds audit rows through the local stack');
    test.skip(testInfo.project.name !== 'chromium' && testInfo.project.name !== 'mobile', 'Desktop and phone layouts');
    const now = new Date().toISOString();
    expect((await stackR2('PUT', 'profiles', actorId, { id: actorId, displayName: actorName, email: `${hex}@e2e.example`, dateCreated: now })).ok).toBe(true);
    expect((await stackR2('PUT', 'videos', videoId, { id: videoId, title: videoTitle, userId: actorId, channelId, dateCreated: now, dateModified: now, comments: [], likes: [] })).ok).toBe(true);
    const ms = Date.now();
    // admin_cols = OWNERSHIP_ADMIN_COLS_VERSION (shared-types search/ownership.ts): an older value
    // would mark the whole admin index stale for every spec running beside this one
    await stackSql(
      SEARCH,
      `INSERT OR REPLACE INTO content_ownership (kind, id, owner_id, channel_id, title, admin_title, admin_cols, created_at, updated_at, indexed_at)
       VALUES ('video', '${videoId}', '${actorId}', '${channelId}', '${videoTitle}', '${videoTitle}', 1, ${ms}, ${ms}, ${ms})`,
    );
    await stackSql(
      REPORTS,
      `INSERT INTO site_settings_log (id, key, old_value, new_value, actor_id, created_at) VALUES
       ('${rows[0]}', 'content:video:${videoId}', NULL, '{"action":"transfer","details":{"newOwnerId":"${actorId}","reason":"e2e ${hex}"}}', '${actorId}', '${at(3)}'),
       ('${rows[1]}', 'notifications:menu-open', 'mark_read', 'keep_unread', '${actorId}', '${at(2)}'),
       ('${rows[2]}', 'notifications:menu-open', 'keep_unread', 'mark_read', '${ghostId}', '${at(1)}')`,
    );
  });

  test.afterAll(async () => {
    if (!LOCAL_STACK) return;
    await stackSql(REPORTS, `DELETE FROM site_settings_log WHERE id IN ('${rows.join("','")}')`);
    await stackSql(SEARCH, `DELETE FROM content_ownership WHERE kind = 'video' AND id = '${videoId}'`);
    await stackR2('DELETE', 'videos', videoId);
    await stackR2('DELETE', 'profiles', actorId);
  });

  test('AUDIT-01 the feed needs audit:read and names the people and items it mentions', async () => {
    const tokens = readTokens();
    expect((await adminApi(`/api/audit?actorId=${actorId}`, { token: tokens.moderator })).status).toBe(403);
    const res = await adminApi<FeedPage>(`/api/audit?actorId=${encodeURIComponent(actorId)}`, { token: tokens.admin });
    expect(res.status).toBe(200);
    const page = res.body.result!;
    expect(page.items.map((e) => e.id)).toEqual([`content:${rows[1]}`, `content:${rows[0]}`]);
    expect(page.names.users[actorId]?.name).toBe(actorName);
    expect(page.names.users[actorId]?.email).toBe(`${hex}@e2e.example`);
    expect(page.names.items[`video:${videoId}`]?.title).toBe(videoTitle);
    // Moderators get names without emails
    const names = await adminApi<FeedPage['names']>('/api/names', { token: tokens.moderator, method: 'POST', body: JSON.stringify({ users: [actorId] }) });
    expect(names.body.result!.users[actorId]).toMatchObject({ name: actorName, email: null });
  });

  test('AUDIT-02 the page shows names, words and filters, and the item filter narrows it', async ({ page }) => {
    await page.goto(`/audit?actorId=${encodeURIComponent(actorId)}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Audit log' })).toBeVisible();
    const rowsShown = page.getByTestId('audit-row');
    await expect(rowsShown).toHaveCount(2);
    const transfer = page.locator('[data-testid="audit-row"][data-action="transfer"]');
    await expect(transfer.getByTestId('audit-action-label')).toHaveText('Ownership transferred');
    await expect(transfer.getByTestId('audit-target')).toContainText(videoTitle);
    await expect(transfer.getByTestId('audit-actor')).toContainText(actorName);
    await expect(transfer.getByTestId('audit-actor').getByRole('link', { name: actorName })).toHaveAttribute('href', `/users/${encodeURIComponent(actorId)}`);
    // The new owner in the details is a name too, never the raw id
    await expect(transfer.getByTestId('audit-detail-ref')).toContainText(actorName);
    // The chosen person shows as the Autocomplete's chip
    await expect(page.getByTestId('audit-actor-filter')).toContainText(actorName);
    const setting = page.locator('[data-testid="audit-row"][data-area="settings"]');
    await expect(setting.getByTestId('audit-action-label')).toHaveText('Setting changed');

    await page.goto(`/audit?actorId=${encodeURIComponent(actorId)}&itemKind=video&itemId=${encodeURIComponent(videoId)}`);
    await expect(page.getByTestId('audit-row')).toHaveCount(1);
    await expect(page.getByTestId('audit-item-filter')).toContainText(videoTitle);
    await page.goto(`/audit?actorId=${encodeURIComponent(actorId)}&area=trash`);
    await expect(page.getByTestId('audit-empty')).toBeVisible();
  });

  test('AUDIT-03 the video page history shows names, not ids', async ({ page }) => {
    await page.goto(`/videos/${encodeURIComponent(videoId)}`);
    const entry = page.getByTestId('content-audit').locator('[data-testid="audit-entry"][data-action="transfer"]');
    await expect(entry.getByTestId('audit-action-label')).toHaveText('Ownership transferred');
    await expect(entry.getByTestId('audit-actor')).toContainText(actorName);
    await expect(entry).not.toContainText(`by ${actorId}`);
  });

  test('AUDIT-05 an actor nothing is known about reads "Unknown user", the id only in a copyable detail', async ({ page }) => {
    await page.goto(`/audit?actorId=${encodeURIComponent(ghostId)}`);
    const row = page.getByTestId('audit-row');
    await expect(row).toHaveCount(1);
    const actor = row.getByTestId('audit-actor');
    await expect(actor).toContainText('Unknown user');
    // No raw id anywhere in the row's visible text (the detail is closed)
    expect(await row.innerText()).not.toContain('usr_');
    const detail = actor.getByTestId('unknown-user-id');
    await detail.getByTestId('unknown-user-id-toggle').click();
    await expect(detail.getByTestId('unknown-user-id-value')).toHaveText(ghostId);
    await expect(detail.getByTestId('unknown-user-id-copy')).toHaveAccessibleName('Copy the user id');
  });

  test('AUDIT-04 Arabic: right to left, actions in Arabic, no sideways scroll', async ({ page }) => {
    await setPreferences(page, { locale: 'ar' });
    await page.goto(`/audit?actorId=${encodeURIComponent(actorId)}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1, name: 'سجل التدقيق' })).toBeVisible();
    await expect(page.locator('[data-testid="audit-row"][data-action="transfer"]').getByTestId('audit-action-label')).toHaveText('نُقلت الملكية');
    // The table scrolls inside its own box; the page never scrolls sideways
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  });
});
