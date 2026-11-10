import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Account menu trigger in the header. It shows the avatar and chevron only, so
 * signed in or out its accessible name ends in "Navigation menu". The side
 * navigation's menu button ("Menu" / "القائمة") is excluded by the test id.
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

/**
 * The side navigation (main links, theme and language). From 1024px it is a
 * rail that is always on screen and the menu button widens it (html
 * data-rail="open"); below that it is an off-canvas drawer with a scrim and a
 * close button, and the phone tab bar holds the main destinations.
 */
export function sideNav(page: Page): Locator {
  return page.getByTestId('side-nav');
}

/** True below 1024px, where the side navigation is an off-canvas drawer */
export function isDrawerLayout(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1280) < 1024;
}

/** Opens the side navigation (expands the rail or slides the drawer in) and returns it */
export async function openSideDrawer(page: Page): Promise<Locator> {
  const drawer = sideNav(page);
  const toggle = page.getByTestId('nav-drawer-toggle');
  // Retried: a click that lands before hydration has no handler yet
  await expect(async () => {
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true', { timeout: 3000 });
  }).toPass();
  await expect(drawer).toHaveAttribute('data-open', 'true');
  // Wholly on screen: the drawer slides in (240 ms), the rail widens (220 ms)
  await expect(drawer).toBeInViewport({ ratio: 1 });
  if (!isDrawerLayout(page)) await expect(page.locator('html')).toHaveAttribute('data-rail', 'open');
  return drawer;
}

/** Closes it the way a visitor would: the drawer's close button, or the menu button for the rail */
export async function closeSideDrawer(page: Page): Promise<void> {
  if (isDrawerLayout(page)) await sideNav(page).getByRole('button', { name: /^(Close menu|إغلاق القائمة)$/ }).click();
  else await page.getByTestId('nav-drawer-toggle').click();
  await expectSideDrawerClosed(page);
}

/** Closed: the menu button says so, the drawer is off screen, the rail is narrow again */
export async function expectSideDrawerClosed(page: Page): Promise<void> {
  await expect(page.getByTestId('nav-drawer-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(sideNav(page)).toHaveAttribute('data-open', 'false');
  if (isDrawerLayout(page)) await expect(sideNav(page)).not.toBeInViewport();
  else await expect(page.locator('html')).toHaveAttribute('data-rail', 'closed');
}

/** Moves the open account menu to its main list, or its channel or account switcher. */
export async function showMenuView(menu: Locator, view: 'main' | 'channel' | 'account'): Promise<void> {
  const back = menu.getByTestId('nav-menu-back');
  // The main list is the one without a Back row (signed out it holds only Sign In)
  const shown = async () =>
    view === 'main'
      ? (await menu.isVisible()) && !(await back.isVisible())
      : menu.getByTestId(view === 'channel' ? 'nav-channel-option-none' : 'nav-account').first().isVisible();
  // Retried: a switch (channel or account) reloads the session, which remounts
  // the menu closed, sometimes twice while the page refresh lands
  await expect(async () => {
    if (!(await menu.isVisible())) await openAccountMenu(menu.page());
    if (await shown()) return;
    if (await back.isVisible()) await back.click({ timeout: 3000 });
    if (view !== 'main') await menu.getByTestId(`nav-switch-${view}`).click({ timeout: 3000 });
    await expect.poll(shown, { timeout: 3000 }).toBe(true);
  }).toPass({ timeout: 30000 });
}

/** The active user and channel in this page's session cookie (null when signed out) */
async function activeSession(page: Page): Promise<{ userId: string; channelId: string | null } | null> {
  // Two accounts no longer fit one cookie: al_ummah_session, then .1, .2, ...
  const jar = new Map((await page.context().cookies()).map((c) => [c.name, c.value]));
  const first = jar.get('al_ummah_session');
  if (!first) return null;
  let raw = first;
  for (let i = 1; jar.has(`al_ummah_session.${i}`); i++) raw += jar.get(`al_ummah_session.${i}`);
  try {
    raw = decodeURIComponent(raw);
  } catch {
    // not URI-encoded
  }
  const data = JSON.parse(raw) as { activeUserId: string; activeChannelId: string | null };
  return { userId: data.activeUserId, channelId: data.activeChannelId ?? null };
}

function matches(active: { userId: string; channelId: string | null } | null, expected: { userId?: string; channelId?: string | null }): boolean {
  if (!active) return false;
  if (expected.userId !== undefined && active.userId !== expected.userId) return false;
  return expected.channelId === undefined || active.channelId === expected.channelId;
}

/**
 * Waits until a channel or account switch has finished: the session cookie
 * names the expected active user/channel, then the page refresh that follows
 * (and the menu remount with it) has settled. Assertions on the reopened menu
 * then read the final state, not the one before the switch.
 */
export async function waitForSessionSwitch(
  page: Page,
  expected: { userId?: string; channelId?: string | null },
  timeout = 20000,
): Promise<void> {
  await expect.poll(async () => matches(await activeSession(page), expected), { timeout }).toBe(true);
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await expect(menuTrigger(page)).toBeVisible();
}

/**
 * Switches to another signed-in account from the account menu and waits for
 * the switch to land. Retried as a whole: the menu remounts while the previous
 * switch settles and a click on the old menu is lost. A retry first checks
 * whether the earlier click did switch.
 */
export async function switchAccountTo(page: Page, target: { userId: string; email: string }): Promise<Locator> {
  const menu = page.getByRole('menu');
  await expect(async () => {
    if (matches(await activeSession(page), { userId: target.userId })) return;
    await showMenuView(menu, 'account');
    await menu.getByTestId('nav-account').filter({ hasText: target.email }).getByRole('menuitem').click({ timeout: 5000 });
    await expect.poll(async () => matches(await activeSession(page), { userId: target.userId }), { timeout: 10000 }).toBe(true);
  }).toPass({ timeout: 60000 });
  await waitForSessionSwitch(page, { userId: target.userId });
  return menu;
}
