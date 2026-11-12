/**
 * The header's account menu names the user by their first and last name when
 * the display name is empty (owner report 2026-11-12: the videos site showed
 * the owner's email; their profile has displayName "" and only first and last
 * names). en and ar.
 *
 * Each test creates its own user and profile; the data scope erases them
 * afterwards, pass or fail.
 */
import { expect } from '@playwright/test';
import { test } from './builders';
import { target } from './targets';
import { apiFetch, gotoSettled, openMenuUntil, type WebUser } from './web-session';

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

for (const locale of ['en', 'ar'] as const) {
  test(`header shows "First Last" for a profile with only first and last names (${locale})`, async ({ page, ownData }) => {
    const first = `First${Date.now().toString(36)}`;
    const last = 'Last';
    const user = await ownData.createUser(page, `hdr-name-${locale}`, locale);
    await namesOnly(user, first, last);

    await gotoSettled(page, `${target().web}/${locale}`);
    const name = page.getByTestId('nav-user-name');
    await openMenuUntil(page, name);
    await expect(name).toHaveText(`${first} ${last}`);
    await expect(name).not.toHaveText(user.email);
  });
}
