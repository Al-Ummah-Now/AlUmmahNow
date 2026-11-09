/**
 * Release regression: the Customize channel page edits the channel in place.
 * The owner opens the channel name and description from the header, changes
 * them, saves from the unsaved-changes bar, and the public channel shows the
 * new values.
 */
import { test, expect } from '@playwright/test';
import { target } from './targets';
import { apiFetch, createProfile, signUpOnWeb } from './web-session';

test.describe('Release: channel settings edit in place', () => {
  test('owner renames the channel and rewrites the description from the header', async ({ page }) => {
    const user = await signUpOnWeb(page, 'rel-inline');
    await createProfile(user);
    // Consent answered so the banner does not cover the account menu or the bar
    await page.context().addCookies([
      { name: 'aun_consent', value: `v1.a0.e0.p0.${Date.now()}`, url: target().web, sameSite: 'Lax' },
    ]);

    // Channel created the way users do, so it is in the web session
    const original = `Release inline ${Date.now().toString(36)}`;
    await page.goto(`${target().web}/en`);
    await page.getByTestId('nav-menu-trigger').click();
    await page.getByTestId('nav-create-channel').click();
    const nameInput = page.locator('[role="menu"] input[type="text"]').first();
    await nameInput.fill(original);
    await nameInput.press('Enter');
    await expect(nameInput).toBeHidden({ timeout: 30000 });

    let channelId = '';
    await expect
      .poll(async () => {
        const res = await apiFetch(user, '/api/channels?limit=100');
        const body = (await res.json().catch(() => ({}))) as { data?: Array<{ id: string; name: string }> };
        channelId = body.data?.find((c) => c.name === original)?.id ?? '';
        return channelId;
      }, { message: 'the new channel is not in GET /api/channels', timeout: 30000 })
      .not.toBe('');

    await page.goto(`${target().web}/en/settings/channel/${channelId}/edit`);
    // PR runs hit the already-deployed QA, which gets this page only after merge
    const deployed = await page
      .getByTestId('edit-mode-toggle')
      .waitFor({ timeout: 20000 })
      .then(() => true)
      .catch(() => false);
    test.skip(!deployed, 'target web app does not serve the in-place channel editor yet');

    const header = page.getByTestId('channel-header');
    await expect(header.getByRole('heading', { level: 1 })).toHaveText(original);
    await expect(page.getByTestId('edit-mode-toggle')).toHaveAttribute('aria-checked', 'true');

    // Name, in place
    const renamed = `${original} renamed`;
    await header.getByRole('button', { name: /^Edit Channel Name/i }).click();
    const nameField = page.getByTestId('channel-name-input');
    await expect(nameField).toBeFocused();
    await nameField.fill(renamed);
    await nameField.press('Enter');
    await expect(header.getByRole('heading', { level: 1 })).toHaveText(renamed);

    // Description, in place (multiline: Ctrl+Enter finishes)
    const description = 'Edited in place by the release suite.';
    await header.getByRole('button', { name: /^Edit Channel Description/i }).click();
    const descriptionField = page.getByTestId('channel-description-input');
    await descriptionField.fill(description);
    await descriptionField.press('Control+Enter');

    const bar = page.getByTestId('unsaved-changes-bar');
    await expect(bar).toHaveAttribute('data-state', 'dirty');
    await expect(page.getByTestId('unsaved-changes-message')).toHaveText('2 unsaved changes');

    const put = page.waitForResponse((r) => r.url().includes(`/api/channels/${channelId}`) && r.request().method() === 'PUT');
    await page.getByTestId('channel-edit-save').click();
    expect((await put).status(), 'PUT /api/channels/:id').toBeLessThan(300);
    await expect(bar).toHaveAttribute('data-state', 'saved');

    // Saved for everyone
    const res = await fetch(`${target().api}/api/channels/${channelId}`);
    const body = (await res.json()) as { result?: { name?: string; description?: string }; name?: string; description?: string };
    const saved = body.result ?? body;
    expect(saved.name).toBe(renamed);
    expect(saved.description).toBe(description);

    await page.goto(`${target().web}/en/channels/${channelId}`);
    await expect(page.getByTestId('channel-header').getByRole('heading', { level: 1 })).toHaveText(renamed);
  });
});
