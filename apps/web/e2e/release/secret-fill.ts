import type { Locator } from '@playwright/test';

/**
 * Types a secret (password, verification code) without it reaching the test
 * report. locator.fill(value) records the value in the step title
 * (`Fill "<value>"`), which the HTML report embeds even on passing runs and
 * with tracing off. This sets the value in the page instead, the way React and
 * plain forms see a typed value. The evaluate argument still lands in a trace
 * (and the form POST body in its network log), so every spec that calls this
 * sets test.use({ trace: 'off' }) at the top level of the file.
 */
export async function fillSecret(locator: Locator, value: string): Promise<void> {
  await locator.evaluate((el, v) => {
    const input = el as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}
