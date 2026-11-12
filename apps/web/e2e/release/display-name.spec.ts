/**
 * Display name fallback (owner rule 2026-11-12: "display name should be the
 * first and last as a fallback"). A new user whose profile has an empty
 * display name and only a first and last name is shown by those names, never
 * by the email: in the web header's account menu, as a comment author and in
 * admin-web's user list. (The owner's own profile is like this: www showed
 * their email.)
 *
 * Every user, channel, video and comment is created here and removed by the
 * data scope afterwards, pass or fail.
 */
import { expect } from '@playwright/test';
import { test, ns } from './builders';
import { signInAsAdmin } from './admin-session';
import { target } from './targets';
import { apiFetch, gotoSettled, openMenuUntil, type WebUser } from './web-session';
import { watchUrl } from './videos';

// Signs users in through the auth server: traces would hold the password and code
test.use({ trace: 'off' });

/** Empties the display name (both languages) and sets only a first and last name. */
async function namesOnly(user: WebUser, first: string, last: string): Promise<void> {
  const res = await apiFetch(user, '/api/profile', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName: '', displayNameLocalized: { en: '', ar: '' }, firstName: first, lastName: last }),
  });
  expect(res.status, `PUT /api/profile: ${await res.clone().text()}`).toBeLessThan(300);
}

test.describe('display name falls back to first + last', () => {
  test('header, comment author and admin user list show the first and last name, not the email', async ({ browser, page, ownData }) => {
    test.setTimeout(240000);
    const stamp = Date.now().toString(36);
    const first = `Firstname${stamp}`;
    const last = 'Lastname';
    const full = `${first} ${last}`;

    // A creator with a video to comment on
    const creator = await ownData.createCreator(browser, 'dn-creator');
    const video = await ownData.createVideo(creator.user, creator.channelIds[0], { title: `Display name ${ns()} ${stamp}` });

    // The names-only user (no channel): signed in on this page
    const user = await ownData.createUser(page, 'dn-names');
    await namesOnly(user, first, last);

    // The API: own profile keeps the typed (empty) display name and resolves the shown one
    const own = (await (await apiFetch(user, '/api/profile')).json()) as { result: { profile: { displayName?: string; resolvedDisplayName?: string } } };
    expect(own.result.profile.resolvedDisplayName).toBe(full);
    const pub = (await (await fetch(`${target().api}/api/profiles/${user.userId}`, { cache: 'no-store' })).json()) as { result: { profile: Record<string, unknown> } };
    expect(pub.result.profile.displayName).toBe(full);
    expect(pub.result.profile).not.toHaveProperty('firstName');
    expect(JSON.stringify(pub)).not.toContain(user.email);

    // Header: the account menu names the user
    await gotoSettled(page, `${target().web}/en`);
    const profileLink = page.getByTestId('nav-profile-link');
    await openMenuUntil(page, profileLink);
    await expect(profileLink).toContainText(full);

    // Comment author: commenting without a channel, the comment carries the profile's name
    const text = `Display name comment ${stamp}`;
    const res = await apiFetch(user, `/api/videos/${video.id}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', channelId: user.userId },
      body: JSON.stringify({ content: text }),
    });
    const body = await res.text();
    expect(res.status, `POST comment: ${body}`).toBeLessThan(300);
    const commentId = (JSON.parse(body) as { result?: { comment?: { id?: string } }; comment?: { id?: string } }).result?.comment?.id;
    if (commentId) ownData.onCleanup(`comment ${commentId}`, () => apiFetch(user, `/api/videos/${video.id}/comments/${commentId}`, { method: 'DELETE' }));

    await gotoSettled(page, watchUrl(video.id, 'en'));
    const comment = page.locator('#comments').getByTestId('comment').filter({ hasText: text });
    await expect(comment).toBeVisible({ timeout: 30000 });
    await expect(comment.getByRole('heading', { level: 4 })).toHaveText(full);

    // Admin user list: an admin in a browser of its own finds the user by email
    const adminContext = await browser.newContext();
    try {
      const admin = await adminContext.newPage();
      await signInAsAdmin(admin, 'dn-admin');
      await admin.goto(`${target().adminWeb}/users?q=${encodeURIComponent(user.email)}`);
      const row = admin.locator(`[data-testid="user-row"][data-user-id="${user.userId}"]`);
      await expect(row).toBeVisible({ timeout: 30000 });
      await expect(row.getByTestId('user-link')).toHaveText(full);
    } finally {
      await adminContext.close();
    }
  });
});
