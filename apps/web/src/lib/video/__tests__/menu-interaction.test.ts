/**
 * Popup menus (quality, captions, speed) open on click/tap only.
 *
 * Runs against a real Video.js player and MenuButton in jsdom, so the
 * behaviour under test is Video.js's own press/unpress code plus
 * setupClickOnlyMenus, not a mock of it.
 */
jest.mock('@/lib/logger-client', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import videojs from 'video.js';
import { setupClickOnlyMenus, MENU_OPEN_CLASS } from '../menu-interaction';

type AnyComponent = {
  el(): HTMLElement;
  addChild(child: unknown, options?: unknown, index?: number): AnyComponent;
  buildCSSClass(): string;
};
type TestPlayer = AnyComponent & {
  controlBar: AnyComponent;
  userActive(active?: boolean): boolean;
  hasClass(name: string): boolean;
  trigger(event: string): void;
  reportUserActivity(event: unknown): void;
  dispose(): void;
};
type ComponentClass = new (player: unknown, options?: unknown) => AnyComponent;
// The app's video.js typings only describe the player factory
const vjs = videojs as unknown as {
  (el: Element, options: Record<string, unknown>): TestPlayer;
  getComponent(name: string): ComponentClass;
};

const MenuButton = vjs.getComponent('MenuButton');
const MenuItem = vjs.getComponent('MenuItem');

/** A minimal popup menu button like the quality selector: 3 selectable items */
class TestMenuButton extends MenuButton {
  createItems() {
    const player = (this as unknown as { player_: unknown }).player_;
    return ['240p', '360p', 'Auto'].map((label) => new MenuItem(player, { label, selectable: true, selected: label === 'Auto' }));
  }
  buildCSSClass() {
    return `vjs-test-menu ${super.buildCSSClass()}`;
  }
}

let player: TestPlayer;
let cleanup: () => void;
let wrapper: HTMLElement;
let button: HTMLElement;

const menuOpen = () => wrapper.querySelector('.vjs-menu')!.classList.contains('vjs-lock-showing');
const menuShownByHover = () => wrapper.classList.contains('vjs-hover');
const items = () => Array.from(wrapper.querySelectorAll<HTMLElement>('.vjs-menu-item'));

function fire(target: Element, type: string, init: EventInit = { bubbles: true, cancelable: true }) {
  const Ctor = type.startsWith('pointer') ? (window.PointerEvent ?? MouseEvent) : type.startsWith('key') ? KeyboardEvent : MouseEvent;
  const event = new Ctor(type, init);
  target.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  // Fake timers before the player exists, so Video.js's own activity loop runs on them
  jest.useFakeTimers();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  document.body.innerHTML = '<video id="v" class="video-js"></video><button id="outside">outside</button>';
  player = vjs(document.getElementById('v')!, { controls: true, inactivityTimeout: 2000 });
  player.controlBar.addChild(new TestMenuButton(player, { title: 'Quality' }));
  // MenuButton puts buildCSSClass() on the inner <button>; its parent is the wrapper
  button = player.el().querySelector('button.vjs-test-menu') as HTMLElement;
  wrapper = button.parentElement as HTMLElement;
  cleanup = setupClickOnlyMenus(player as unknown as Parameters<typeof setupClickOnlyMenus>[0]);
});

afterEach(() => {
  player.dispose();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('setupClickOnlyMenus', () => {
  it('does not open the menu on hover', () => {
    fire(button, 'mouseenter', { bubbles: false });
    expect(menuShownByHover()).toBe(false);
    expect(menuOpen()).toBe(false);
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens on click and closes on a second click', () => {
    fire(button, 'click');
    expect(menuOpen()).toBe(true);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    fire(button, 'click');
    expect(menuOpen()).toBe(false);
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('stays open when the pointer moves over the video', () => {
    fire(button, 'click');
    const tech = player.el().querySelector('.vjs-tech')!;
    fire(button, 'mouseleave', { bubbles: false });
    fire(wrapper, 'mouseleave', { bubbles: false });
    fire(tech, 'mousemove');
    expect(menuOpen()).toBe(true);
  });

  it('closes when an item is chosen', () => {
    fire(button, 'click');
    fire(items()[0], 'click');
    expect(menuOpen()).toBe(false);
    expect(items()[0]).toHaveAttribute('aria-checked', 'true');
  });

  it('closes on a click outside the player', () => {
    fire(button, 'click');
    fire(document.getElementById('outside')!, 'pointerdown');
    expect(menuOpen()).toBe(false);
  });

  it('closes on a press on the video without also toggling playback', () => {
    fire(button, 'click');
    const tech = player.el().querySelector('.vjs-tech')!;
    const onTechClick = jest.fn();
    tech.addEventListener('click', onTechClick);
    fire(tech, 'pointerdown');
    const click = fire(tech, 'click');
    expect(menuOpen()).toBe(false);
    expect(onTechClick).not.toHaveBeenCalled();
    expect(click.defaultPrevented).toBe(true);

    // The next press on the video behaves normally again
    fire(tech, 'click');
    expect(onTechClick).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape and returns focus to the button', () => {
    fire(button, 'click');
    const focused = items()[0];
    focused.focus();
    const esc = fire(focused, 'keydown', { bubbles: true, cancelable: true, key: 'Escape' } as KeyboardEventInit);
    expect(menuOpen()).toBe(false);
    expect(document.activeElement).toBe(button);
    expect(esc.defaultPrevented).toBe(true);
  });

  it('opens with ArrowDown on the button and moves between items with the arrow keys', () => {
    button.focus();
    fire(button, 'keydown', { bubbles: true, cancelable: true, key: 'ArrowDown' } as KeyboardEventInit);
    expect(menuOpen()).toBe(true);
    expect(document.activeElement).toBe(items()[0]);
    fire(items()[0], 'keydown', { bubbles: true, cancelable: true, key: 'ArrowDown' } as KeyboardEventInit);
    expect(document.activeElement).toBe(items()[1]);
  });

  it('marks up a menu button with radio items', () => {
    expect(button).toHaveAttribute('aria-haspopup', 'true');
    expect(items().every((li) => li.getAttribute('role') === 'menuitemradio')).toBe(true);
    expect(items()[2]).toHaveAttribute('aria-checked', 'true');
  });

  it('keeps the player active while a menu is open and lets it go inactive after closing', async () => {
    // Video.js starts tracking activity on the first play
    player.trigger('play');
    // Control: with no menu open the player goes inactive after the 2s timeout
    player.reportUserActivity(null);
    jest.advanceTimersByTime(3_000);
    expect(player.userActive()).toBe(false);

    fire(button, 'click');
    await Promise.resolve(); // MutationObserver callback
    expect(player.hasClass(MENU_OPEN_CLASS)).toBe(true);

    jest.advanceTimersByTime(10_000); // far past the 2s inactivity timeout
    expect(player.userActive()).toBe(true);
    expect(menuOpen()).toBe(true);

    fire(button, 'click');
    await Promise.resolve();
    expect(player.hasClass(MENU_OPEN_CLASS)).toBe(false);
    jest.advanceTimersByTime(3_000);
    expect(player.userActive()).toBe(false);
  });

  it('closes the menu if the player is made inactive anyway', () => {
    fire(button, 'click');
    player.userActive(false);
    expect(menuOpen()).toBe(false);
  });

  it('removes its listeners on cleanup (hover opens again with plain Video.js)', () => {
    cleanup();
    fire(button, 'mouseenter', { bubbles: false });
    expect(menuShownByHover()).toBe(true);
  });
});
