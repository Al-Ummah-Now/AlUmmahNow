import { expect, type Locator } from '@playwright/test';

/**
 * Themed dropdowns (src/components/ui/ThemedSelectField.tsx) keep a native
 * <select class="tsf-native"> for the form value: it carries the select's
 * props (name, value, data-testid) but is aria-hidden and out of the tab
 * order. People use the trigger button next to it, which takes the select's
 * id, so <label for> and getByLabel() name the button.
 */

const TRIGGER = 'xpath=following-sibling::button[contains(concat(" ", normalize-space(@class), " "), " tsf-trigger ")]';
const NATIVE = 'xpath=preceding-sibling::select[contains(concat(" ", normalize-space(@class), " "), " tsf-native ")]';

/** The trigger button of a themed dropdown, from its native select (e.g. by test id). */
export function themedTrigger(native: Locator): Locator {
  return native.locator(TRIGGER);
}

/** The native select of a themed dropdown, from its trigger (e.g. by label). */
export function themedNative(trigger: Locator): Locator {
  return trigger.locator(NATIVE);
}

/**
 * Chooses `value` in a themed dropdown the way a person does: opens the
 * trigger and clicks the row with that option's label, then checks that the
 * form value changed. `control` is the native select or the trigger.
 */
export async function chooseThemedOption(control: Locator, value: string): Promise<void> {
  const isNative = await control.evaluate((el) => el.tagName === 'SELECT');
  const native = isNative ? control : themedNative(control);
  const trigger = isNative ? themedTrigger(control) : control;
  const label = ((await native.locator(`option[value="${value}"]`).textContent()) ?? '').trim();
  expect(label, `option ${value} has a label`).not.toBe('');

  const page = trigger.page();
  const row = page.getByRole('menuitemradio', { name: label, exact: true });
  // Retried: a click before hydration opens nothing
  await expect(async () => {
    if (!(await row.isVisible())) await trigger.click({ timeout: 3000 });
    await expect(row).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 20000 });
  await row.click();
  await expect(row).toBeHidden();
  await expect(native).toHaveValue(value);
  await expect(trigger).toContainText(label);
}
