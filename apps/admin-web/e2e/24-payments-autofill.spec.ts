/**
 * Autofill on the admin Payments forms in real browsers (owner 2026-11-16), Chromium and WebKit:
 * the seller details carry standard tokens (organization, street-address, country) in a seller
 * section, named and labelled inside a real form; the VAT number has a plain label; a provider's
 * API key is masked and kept out of password managers (no save, no generate). Read-only: changes
 * nothing, so it runs in the device projects.
 */
import { test, expect } from './support/fixtures';
import { LOCAL_STACK, storageStatePath } from './support/env';

test.describe('Payments forms: autofill', () => {
  test.use({ storageState: storageStatePath('superadmin') });

  test.beforeAll(() => {
    test.skip(!LOCAL_STACK, 'Payments keys can be saved (and so shown) on the local stack only');
  });

  test('PAY-AUTOFILL-01 seller details carry standard tokens; the VAT number a plain label', async ({ page }) => {
    await page.goto('/payments?tab=tax');
    const tax = page.getByTestId('payments-tax');
    await expect(tax).toBeVisible();
    // Visible fields only: a hidden input (NumberField submits its Latin value in one) is never filled or seen
    const fields = await tax.locator('input[name]:not([type="hidden"]), textarea[name]').evaluateAll((els) =>
      els.map((el) => {
        const f = el as HTMLInputElement;
        return { name: f.name, autocomplete: f.getAttribute('autocomplete'), inForm: !!f.form, label: f.labels?.[0]?.textContent?.trim() ?? null };
      }),
    );
    const by = (n: string) => fields.find((f) => f.name === n);
    expect(by('organization')).toMatchObject({ autocomplete: 'section-seller organization', inForm: true });
    expect(by('street-address')).toMatchObject({ autocomplete: 'section-seller street-address', inForm: true });
    expect(by('country')).toMatchObject({ autocomplete: 'section-seller country', inForm: true });
    expect(by('vat-number')).toMatchObject({ autocomplete: null, inForm: true, label: 'VAT number' });
    for (const f of fields) expect(f.label, `${f.name} has a visible label`).toBeTruthy();
    expect(fields.some((f) => f.autocomplete === 'off')).toBe(false);
  });

  test('PAY-AUTOFILL-02 a provider API key is not a password: masked, labelled, no save or generate', async ({ page }) => {
    await page.goto('/payments');
    const key = page.locator('input[name="paddle-apiKey-test"]');
    await expect(key).toBeVisible();
    const facts = await key.evaluate((el: HTMLInputElement) => ({
      type: el.type,
      autocomplete: el.getAttribute('autocomplete'),
      ignore1p: el.hasAttribute('data-1p-ignore'),
      bw: el.getAttribute('data-bwignore'),
      label: el.labels?.[0]?.textContent?.trim() ?? null,
      labelVisible: !!el.labels?.[0] && el.labels[0].getBoundingClientRect().height > 0,
    }));
    expect(facts).toMatchObject({ type: 'password', autocomplete: 'off', ignore1p: true, bw: 'true', labelVisible: true });
    expect(await page.locator('[autocomplete="new-password"], [autocomplete^="cc-"]').count()).toBe(0);
  });
});
