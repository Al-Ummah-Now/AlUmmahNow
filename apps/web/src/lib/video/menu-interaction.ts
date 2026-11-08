/**
 * Click-only popup menus for the Video.js control bar (quality, captions,
 * playback speed).
 *
 * Why not hover: Video.js opens a popup menu on `mouseenter` of its button.
 * The menu sits above the button with a gap over the video, so moving the
 * mouse up to the menu leaves the button and the menu closes. Hover menus
 * also never work on touch screens and open by accident while the pointer
 * crosses the bar. YouTube, Vimeo and Netflix open these menus on click.
 *
 * Video.js 8 registers that `mouseenter` listener as an inline closure in the
 * MenuButton constructor, so there is no option to turn it off and no method
 * to override in a subclass. Instead this module stops `mouseenter` in the
 * capture phase on the player element before it reaches any popup menu
 * button, which covers buttons added later (the quality plugin adds its button
 * after the player is ready).
 *
 * A menu then stays open until: an item is chosen or the button is clicked
 * again (both Video.js behaviour), a click/tap outside the menu, Escape (focus
 * returns to the button), or the player goes inactive. While a menu is open
 * the player is kept in the user-active state so the control bar never fades
 * out from under it.
 */
import { logger } from '@/lib/logger-client';

export const MENU_OPEN_CLASS = 'vjs-menu-open';

/** The popup menu button element (the wrapper is `.vjs-menu-button-popup`). */
const POPUP_BUTTON_SELECTOR = '.vjs-menu-button-popup > .vjs-menu-button';

/** How often activity is reported while a menu is open (Video.js hides after 2s). */
const KEEP_ACTIVE_INTERVAL_MS = 1000;

/**
 * After a pointerdown that only dismissed a menu, the rest of that gesture
 * (touchstart, click) is swallowed so it does not also play/pause the video
 * or toggle the controls.
 */
const DISMISS_GESTURE_WINDOW_MS = 800;

interface MenuButtonComponent {
  el(): HTMLElement;
  unpressButton(): void;
  pressButton(): void;
  focus(): void;
}

interface ControlBarComponent {
  el(): HTMLElement;
  children(): unknown[];
}

interface InteractivePlayer {
  el(): Element;
  on(event: string, callback: () => void): void;
  off(event: string, callback: () => void): void;
  getChild(name: string): unknown;
  userActive(active?: boolean): boolean | undefined | void;
  reportUserActivity(event?: unknown): void;
  setInterval(fn: () => void, ms: number): number;
  clearInterval(id: number): void;
}

function isMenuButton(component: unknown): component is MenuButtonComponent {
  if (!component || typeof component !== 'object') return false;
  const candidate = component as Partial<MenuButtonComponent>;
  if (typeof candidate.el !== 'function' || typeof candidate.unpressButton !== 'function') return false;
  return candidate.el().classList.contains('vjs-menu-button-popup');
}

/**
 * Makes every popup menu in the player's control bar open on click/tap only.
 * Cleans itself up when the player is disposed; the returned function does the
 * same earlier.
 */
export function setupClickOnlyMenus(player: InteractivePlayer): () => void {
  const playerEl = player.el() as HTMLElement;
  const doc = playerEl.ownerDocument;
  let keepActiveTimer: number | null = null;
  let dismissGestureUntil = 0;
  let disposed = false;

  const controlBar = () => player.getChild('ControlBar') as ControlBarComponent | undefined;
  const popupMenuButtons = (): MenuButtonComponent[] => controlBar()?.children().filter(isMenuButton) ?? [];
  const isOpen = (button: MenuButtonComponent) =>
    button.el().querySelector(':scope > .vjs-menu-button')?.getAttribute('aria-expanded') === 'true';
  const openMenuButtons = () => popupMenuButtons().filter(isOpen);
  const insideControlBar = (target: Node) => !!controlBar()?.el().contains(target);

  const closeAll = (except?: Node) => {
    for (const button of openMenuButtons()) {
      if (except && button.el().contains(except)) continue;
      button.unpressButton();
    }
  };

  // --- No hover: stop mouseenter before it reaches a popup menu button ------
  const blockHoverOpen = (event: Event) => {
    const target = event.target as Element | null;
    if (target?.matches?.(POPUP_BUTTON_SELECTOR)) {
      event.stopPropagation();
    }
  };

  // --- Click/tap outside closes ----------------------------------------------
  const handlePointerDown = (event: Event) => {
    const target = event.target as Node | null;
    if (!target || openMenuButtons().length === 0) return;
    if (openMenuButtons().some((button) => button.el().contains(target))) return;
    closeAll(target);
    // A press on the video only dismisses the menu: it must not also
    // play/pause or hide the controls. Presses on other controls still act.
    if (playerEl.contains(target) && !insideControlBar(target)) {
      dismissGestureUntil = Date.now() + DISMISS_GESTURE_WINDOW_MS;
    }
  };

  const swallowDismissGesture = (event: Event) => {
    if (Date.now() > dismissGestureUntil) return;
    const target = event.target as Node | null;
    if (target && insideControlBar(target)) return;
    event.stopPropagation();
    if (event.type === 'click') {
      event.preventDefault();
      dismissGestureUntil = 0;
    }
  };

  // --- Keyboard: Escape closes and returns focus; ArrowUp/Down open ----------
  const handleKeyDown = (event: Event) => {
    const keyEvent = event as KeyboardEvent;
    const target = keyEvent.target as Element | null;

    if (keyEvent.key === 'Escape') {
      const open = openMenuButtons();
      if (open.length === 0) return;
      const focusWasInPlayer = !!target && playerEl.contains(target);
      open.forEach((button) => button.unpressButton());
      if (focusWasInPlayer) {
        keyEvent.preventDefault();
        keyEvent.stopPropagation();
        open[0].focus();
      }
      return;
    }

    // WAI-ARIA menu button pattern. Video.js only checks the legacy "Up"/"Down"
    // key names, so arrow keys on a closed menu button did nothing.
    if ((keyEvent.key === 'ArrowDown' || keyEvent.key === 'ArrowUp') && target?.matches?.(POPUP_BUTTON_SELECTOR)) {
      const button = popupMenuButtons().find((candidate) => candidate.el().contains(target));
      if (button && !isOpen(button)) {
        keyEvent.preventDefault();
        keyEvent.stopPropagation();
        button.pressButton();
      }
    }
  };

  // --- Keep the controls up while a menu is open -----------------------------
  const syncOpenState = () => {
    if (disposed) return;
    const anyOpen = openMenuButtons().length > 0;
    playerEl.classList.toggle(MENU_OPEN_CLASS, anyOpen);
    if (anyOpen && keepActiveTimer === null) {
      player.userActive(true);
      keepActiveTimer = player.setInterval(() => player.reportUserActivity(), KEEP_ACTIVE_INTERVAL_MS);
    } else if (!anyOpen && keepActiveTimer !== null) {
      player.clearInterval(keepActiveTimer);
      keepActiveTimer = null;
      // Restart the normal inactivity countdown from the moment the menu closed
      player.reportUserActivity();
    }
  };

  // Video.js keeps aria-expanded in sync on press, unpress and menu rebuilds
  const observer = new MutationObserver(syncOpenState);
  observer.observe(playerEl, { subtree: true, attributes: true, attributeFilter: ['aria-expanded'] });

  const handleUserInactive = () => closeAll();

  playerEl.addEventListener('mouseenter', blockHoverOpen, true);
  doc.addEventListener('pointerdown', handlePointerDown, true);
  playerEl.addEventListener('touchstart', swallowDismissGesture, true);
  playerEl.addEventListener('click', swallowDismissGesture, true);
  doc.addEventListener('keydown', handleKeyDown, true);
  player.on('userinactive', handleUserInactive);

  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    observer.disconnect();
    playerEl.removeEventListener('mouseenter', blockHoverOpen, true);
    doc.removeEventListener('pointerdown', handlePointerDown, true);
    playerEl.removeEventListener('touchstart', swallowDismissGesture, true);
    playerEl.removeEventListener('click', swallowDismissGesture, true);
    doc.removeEventListener('keydown', handleKeyDown, true);
    player.off('userinactive', handleUserInactive);
    if (keepActiveTimer !== null) player.clearInterval(keepActiveTimer);
    keepActiveTimer = null;
    playerEl.classList.remove(MENU_OPEN_CLASS);
  };
  player.on('dispose', cleanup);

  logger.debug('[setupClickOnlyMenus] Popup menus open on click/tap only');
  return cleanup;
}
