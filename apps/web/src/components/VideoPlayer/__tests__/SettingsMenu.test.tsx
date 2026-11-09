/**
 * The settings panel against a small fake of the Video.js API it uses: opening from the gear,
 * the root rows and their values, submenus, applying a choice, and keyboard use in both directions.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { Player } from 'video.js';
import { SettingsMenu } from '../SettingsMenu';
import { SETTINGS_TOGGLE_EVENT } from '@/lib/video/components';

function fakePlayer({ live = false, tracked }: { live?: boolean; tracked?: boolean } = {}) {
  const el = document.createElement('div');
  el.innerHTML = '<div class="vjs-control-bar"><button class="vjs-fanous-settings" aria-expanded="false"></button></div>';
  document.body.appendChild(el);
  const handlers = new Map<string, Set<() => void>>();
  let rate = 1;
  const levels = Object.assign(
    [
      { height: 360, enabled: true },
      { height: 720, enabled: true },
    ],
    { selectedIndex: 1, on: jest.fn(), off: jest.fn() },
  );
  const text = [
    { kind: 'subtitles', label: 'English', mode: 'disabled' },
    { kind: 'subtitles', label: 'العربية', mode: 'disabled' },
  ];
  const classes = new Set<string>();
  const styleOpen = jest.fn();
  const player = {
    el: () => el,
    on: (e: string, f: () => void) => { if (!handlers.has(e)) handlers.set(e, new Set()); handlers.get(e)!.add(f); },
    off: (e: string, f: () => void) => handlers.get(e)?.delete(f),
    trigger: (e: string) => handlers.get(e)?.forEach((f) => f()),
    addClass: (c: string) => classes.add(c),
    removeClass: (c: string) => classes.delete(c),
    userActive: jest.fn(() => true),
    options_: { inactivityTimeout: 4000, playbackRates: [0.5, 1, 1.5, 2] },
    qualityLevels: () => levels,
    textTracks: () => text,
    audioTracks: () => [],
    playbackRate: (r?: number) => { if (r !== undefined) rate = r; return rate; },
    getChild: (n: string) => (n === 'textTrackSettings' ? { open: styleOpen } : undefined),
    // A live window shorter than the tracker's threshold leaves the tracker off
    liveTracker: { isLive: () => live && (tracked ?? true) },
    duration: () => (live ? Infinity : 90),
  };
  return { player, el, levels, text, classes, styleOpen, rate: () => rate };
}

function openMenu(f: ReturnType<typeof fakePlayer>) {
  act(() => f.player.trigger(SETTINGS_TOGGLE_EVENT));
  return screen.getByTestId('player-settings-menu');
}

const rowIds = () => Array.from(document.querySelectorAll('[data-testid="player-settings-menu"] [role^="menuitem"]')).map((el) => (el as HTMLElement).dataset.row);

afterEach(() => { document.body.innerHTML = ''; });

describe('SettingsMenu', () => {
  it('opens from the gear in the player layer outside the frame, keeps the controls up, and focuses the first row', () => {
    const f = fakePlayer();
    render(<SettingsMenu player={f.player as unknown as Player} lang="en" onShowShortcuts={jest.fn()} />);
    expect(screen.queryByTestId('player-settings-menu')).toBeNull();
    const menu = openMenu(f);
    // Portalled out of the clipped frame, so the page never draws over it
    expect(f.el.contains(menu)).toBe(false);
    expect(menu.parentElement).toBe(document.body);
    expect(menu).toHaveAttribute('data-player-layer');
    expect(menu.style.right).not.toBe('');
    expect(menu.style.bottom).not.toBe('');
    expect(menu).toHaveAttribute('role', 'menu');
    expect(f.classes.has('vjs-menu-open')).toBe(true);
    expect(f.player.options_.inactivityTimeout).toBe(0);
    expect(f.el.querySelector('.vjs-fanous-settings')).toHaveAttribute('aria-expanded', 'true');
    expect(rowIds()).toEqual(['quality', 'speed', 'captions', 'shortcuts']);
    expect(document.activeElement).toHaveAttribute('data-row', 'quality');
    // Current values on the end side
    expect(screen.getByText('Auto (720p)')).toBeInTheDocument();
    expect(screen.getByText('Normal')).toBeInTheDocument();
  });

  it('opens a submenu with a back row and check marks, applies the choice and returns', () => {
    const f = fakePlayer();
    render(<SettingsMenu player={f.player as unknown as Player} lang="en" onShowShortcuts={jest.fn()} />);
    openMenu(f);
    fireEvent.click(document.querySelector('[data-row="quality"]')!);
    expect(rowIds()).toEqual(['back', 'auto', '720', '360']);
    expect(document.querySelector('[data-row="auto"]')).toHaveAttribute('aria-checked', 'true');
    expect(document.activeElement).toHaveAttribute('data-row', 'auto');
    fireEvent.click(document.querySelector('[data-row="360"]')!);
    expect(f.levels.map((l) => l.enabled)).toEqual([true, false]);
    // Back on the root, focus on the row we came from, value updated
    expect(rowIds()[0]).toBe('quality');
    expect(document.activeElement).toHaveAttribute('data-row', 'quality');
    expect(screen.getByText('360p')).toBeInTheDocument();
  });

  it('changes speed and captions, and opens caption style from the captions submenu', () => {
    const f = fakePlayer();
    render(<SettingsMenu player={f.player as unknown as Player} lang="en" onShowShortcuts={jest.fn()} />);
    openMenu(f);
    fireEvent.click(document.querySelector('[data-row="speed"]')!);
    fireEvent.click(document.querySelector('[data-row="1.5"]')!);
    expect(f.rate()).toBe(1.5);
    fireEvent.click(document.querySelector('[data-row="captions"]')!);
    expect(rowIds()).toEqual(['back', 'off', '0', '1', 'extra']);
    fireEvent.click(document.querySelector('[data-row="1"]')!);
    expect(f.text.map((t) => t.mode)).toEqual(['disabled', 'showing']);
    fireEvent.click(document.querySelector('[data-row="captions"]')!);
    fireEvent.click(document.querySelector('[data-row="extra"]')!);
    expect(f.styleOpen).toHaveBeenCalled();
    expect(screen.queryByTestId('player-settings-menu')).toBeNull();
  });

  it('hides speed for live streams', () => {
    const f = fakePlayer({ live: true });
    render(<SettingsMenu player={f.player as unknown as Player} lang="en" onShowShortcuts={jest.fn()} />);
    openMenu(f);
    expect(rowIds()).toEqual(['quality', 'captions', 'shortcuts']);
  });

  it('hides speed for a live stream whose window is too short for the live tracker', () => {
    const f = fakePlayer({ live: true, tracked: false });
    render(<SettingsMenu player={f.player as unknown as Player} lang="en" onShowShortcuts={jest.fn()} />);
    openMenu(f);
    expect(rowIds()).toEqual(['quality', 'captions', 'shortcuts']);
  });

  it('is keyboard navigable: arrows move and wrap, the end arrow opens, Escape goes back then closes', () => {
    const f = fakePlayer();
    render(<SettingsMenu player={f.player as unknown as Player} lang="en" onShowShortcuts={jest.fn()} />);
    const menu = openMenu(f);
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(document.activeElement).toHaveAttribute('data-row', 'shortcuts');
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toHaveAttribute('data-row', 'speed');
    fireEvent.keyDown(menu, { key: 'ArrowRight' });
    expect(rowIds()[0]).toBe('back');
    expect(document.activeElement).toHaveAttribute('data-row', '1');
    fireEvent.keyDown(screen.getByTestId('player-settings-menu'), { key: 'Escape' });
    expect(document.activeElement).toHaveAttribute('data-row', 'speed');
    fireEvent.keyDown(screen.getByTestId('player-settings-menu'), { key: 'Escape' });
    expect(screen.queryByTestId('player-settings-menu')).toBeNull();
    expect(document.activeElement).toBe(f.el.querySelector('.vjs-fanous-settings'));
    expect(f.classes.has('vjs-menu-open')).toBe(false);
    expect(f.player.options_.inactivityTimeout).toBe(4000);
  });

  it('mirrors in Arabic: the left arrow opens and the right arrow goes back', () => {
    const f = fakePlayer();
    render(<SettingsMenu player={f.player as unknown as Player} lang="ar" onShowShortcuts={jest.fn()} />);
    const menu = openMenu(f);
    expect(menu).toHaveAttribute('dir', 'rtl');
    fireEvent.keyDown(menu, { key: 'ArrowLeft' });
    expect(rowIds()[0]).toBe('back');
    fireEvent.keyDown(screen.getByTestId('player-settings-menu'), { key: 'ArrowRight' });
    expect(rowIds()[0]).toBe('quality');
  });

  it('stops keys at the menu so page-level shortcuts do not see them, and closes on an outside press', () => {
    const f = fakePlayer();
    const onKey = jest.fn();
    document.addEventListener('keydown', onKey);
    render(<SettingsMenu player={f.player as unknown as Player} lang="en" onShowShortcuts={jest.fn()} />);
    const menu = openMenu(f);
    fireEvent.keyDown(menu, { key: 'k' });
    document.removeEventListener('keydown', onKey);
    expect(onKey).not.toHaveBeenCalled();
    // Player-element shortcuts are kept out by keyboard-scope (focus inside role=menu)
    expect(menu.closest('[role="menu"]')).toBe(menu);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId('player-settings-menu')).toBeNull();
  });

  it('opens the shortcuts dialog from its row', () => {
    const f = fakePlayer();
    const onShow = jest.fn();
    render(<SettingsMenu player={f.player as unknown as Player} lang="en" onShowShortcuts={onShow} />);
    openMenu(f);
    fireEvent.click(document.querySelector('[data-row="shortcuts"]')!);
    expect(onShow).toHaveBeenCalled();
    expect(screen.queryByTestId('player-settings-menu')).toBeNull();
  });
});
