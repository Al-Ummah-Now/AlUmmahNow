/**
 * Picks an option in a select on any of our apps. The videos admin has no native <select> since
 * #1642: its Select is a button (role combobox) with a listbox, so Playwright's selectOption does
 * not apply there. A native <select> (web, Studio) still gets selectOption.
 */
import { expect, type Locator } from '@playwright/test';

export async function chooseOption(select: Locator, value: string): Promise<void> {
  if (await select.evaluate((el) => el.tagName === 'SELECT')) {
    await select.selectOption(value);
    return;
  }
  const list = select.page().locator(`[id="${await select.getAttribute('aria-controls')}"]`);
  await select.click();
  await list.locator(`[role="option"][data-value="${value}"]`).click();
  await expect(select).toHaveAttribute('data-value', value);
}
