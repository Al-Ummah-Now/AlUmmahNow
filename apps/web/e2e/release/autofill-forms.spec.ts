/**
 * Autofill in real browsers (owner 2026-11-16: 1Password, Bitwarden, iCloud Keychain and Chrome/Safari
 * autofill fill our forms). Runs in Chrome, Firefox and WebKit (ALL_BROWSERS in the release config).
 * The Request tier dialog: its name field is a named text input with autocomplete="name" and a
 * visible label inside a real form, prefilled from the profile and editable; nothing turns autofill
 * off; and no card field is ever on /upgrade (cards stay on the provider's hosted checkout).
 * Its own user, removed afterwards; changes no site-wide state.
 */
import { expect } from '@playwright/test';
import { test } from './builders';
import { target } from './targets';
import { gotoSettled } from './web-session';

// Signs in: no trace or video (they would record the session)
test.use({ trace: 'off', video: 'off' });

test.describe('Release: forms are ready for password managers and autofill', () => {
  test('Request tier dialog: named, labelled, autocomplete="name", in a form; no card fields on /upgrade', async ({ page, context, ownData }) => {
    test.setTimeout(3 * 60_000);
    await context.addCookies([{ name: 'aun_consent', value: `v1.a0.e0.p0.${Date.now()}`, url: target().web, sameSite: 'Lax' }]);
    await ownData.createUser(page, 'rel-autofill');
    await gotoSettled(page, `${target().web}/en/upgrade`);
    const mode = await page.getByTestId('upgrade-page').getAttribute('data-mode', { timeout: 30_000 });
    test.skip(mode !== 'request', `the Upgrade page is in ${mode} mode here (the dialog only shows in request mode)`);
    await page.getByTestId('tier-creator-request').click();
    const name = page.getByTestId('tier-request-name');
    await expect(name).toBeVisible();
    const facts = await name.evaluate((el: HTMLInputElement) => ({
      tag: el.tagName,
      type: el.type,
      name: el.name,
      autocomplete: el.getAttribute('autocomplete'),
      autocompleteProp: el.autocomplete,
      inForm: !!el.form,
      label: el.labels?.[0]?.textContent?.trim() ?? null,
      value: el.value,
    }));
    expect(facts).toMatchObject({ tag: 'INPUT', type: 'text', name: 'name', autocomplete: 'name', inForm: true, label: 'Your name' });
    // The engine understands the token (an unknown token reads back as '')
    expect(facts.autocompleteProp).toBe('name');
    expect(facts.value, 'prefilled from the profile').not.toBe('');
    await name.fill('Sh. Amina');
    await expect(name).toHaveValue('Sh. Amina');
    const about = page.getByTestId('tier-request-about');
    expect(await about.evaluate((el: HTMLTextAreaElement) => ({ name: el.name, inForm: !!el.form, labelled: (el.labels?.length ?? 0) > 0 }))).toEqual({ name: 'about', inForm: true, labelled: true });
    expect(await page.locator('[data-testid="tier-request-dialog"] [autocomplete="off"]').count()).toBe(0);
    // Card number, expiry and CVC never live on our pages
    expect(await page.locator('[autocomplete^="cc-"], input[name*="card" i], input[name*="cvc" i]').count()).toBe(0);
  });
});
