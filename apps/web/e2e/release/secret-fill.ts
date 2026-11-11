import { expect, type Locator } from '@playwright/test';

/**
 * Types a secret (password, verification code) without it reaching the test
 * report. locator.fill(value) records the value in the step title
 * (`Fill "<value>"`), which the HTML report embeds even on passing runs and
 * with tracing off. This sets the value in the page instead, the way React and
 * plain forms see a typed value. The evaluate argument still lands in a trace
 * (and the form POST body in its network log), so every spec that calls this
 * sets test.use({ trace: 'off' }) at the top level of the file.
 *
 * #798: it used to evaluate straight away, so in Firefox it could act on the
 * previous page (the sign-in form, mid-navigation to the register form) and then
 * wait 15 s for a field that page never had. It now waits for the field to be
 * visible and editable (web-first, the caller's page has arrived), sets it, and
 * checks the field holds a value of the right length (never the value itself, so
 * nothing secret is in an error message). A field replaced while it was set (a
 * re-render) is set again.
 */
export async function fillSecret(locator: Locator, value: string, timeout = 30000): Promise<void> {
  await expect(locator).toBeVisible({ timeout });
  await expect(locator).toBeEditable({ timeout });
  await expect(async () => {
    const length = await locator.evaluate((el, v) => {
      const input = el as HTMLInputElement;
      if (input.value !== v) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, v);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return input.value.length;
    }, value, { timeout: 5000 });
    expect(length, 'the secret field did not keep its value').toBe(value.length);
  }).toPass({ timeout: 15000 });
}
