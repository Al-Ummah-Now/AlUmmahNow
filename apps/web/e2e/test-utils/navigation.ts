import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Account menu trigger in the header (LTR and RTL variants). Signed in, its
 * accessible name is the visible name + channel followed by "Navigation menu"
 * (label-in-name); signed out it is just "Navigation menu". The drawer toggle
 * ("Open navigation menu" / "فتح قائمة التنقل") is excluded by the test id.
 */
export function menuTrigger(page: Page): Locator {
  return page.getByTestId('nav-menu-trigger').and(page.getByRole('button', { name: /(Navigation menu|قائمة التنقل)$/ }));
}

/** Opens the header account menu (no-op if already open) and returns it */
export async function openAccountMenu(page: Page): Promise<Locator> {
  const trigger = menuTrigger(page);
  const menu = page.getByRole('menu');
  await expect(trigger).toBeVisible();
  if (await menu.isVisible()) return menu;
  // Retried: a click that lands before hydration has no handler yet
  await expect(async () => {
    if (!(await menu.isVisible())) await trigger.click();
    await expect(menu).toBeVisible({ timeout: 3000 });
  }).toPass();
  await expect(menu).toBeVisible();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  return menu;
}

/** Opens the side drawer (theme / language / main links) and returns it */
export async function openSideDrawer(page: Page): Promise<Locator> {
  const drawer = page.getByTestId('side-nav');
  // Retried: a click that lands before hydration has no handler yet
  await expect(async () => {
    if (!(await drawer.isVisible())) await page.getByTestId('nav-drawer-toggle').click();
    await expect(drawer).toBeVisible({ timeout: 3000 });
  }).toPass();
  return drawer;
}
