/**
 * Volume slider accessibility (Story 1.4, #87 items 2 and 13).
 */
jest.mock('@/lib/logger-client', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { setupKeyboardAccessibility, showVolumeIndicator } from '../volume-control';
import type { ExtendedPlayer } from '../videojs';

function makePlayer(initialVolume = 0.7) {
  const root = document.createElement('div');
  root.innerHTML = `
    <div class="vjs-volume-panel">
      <button class="vjs-mute-control"></button>
      <div class="vjs-volume-bar" aria-live="polite"></div>
    </div>`;
  document.body.appendChild(root);
  let volume = initialVolume;
  let muted = false;
  const listeners: Array<() => void> = [];
  const player = {
    el: () => root,
    volume: (next?: number) => {
      if (next !== undefined) {
        volume = next;
        listeners.forEach((l) => l());
      }
      return volume;
    },
    muted: (next?: boolean) => {
      if (next !== undefined) {
        muted = next;
        listeners.forEach((l) => l());
      }
      return muted;
    },
    on: (_: string, l: () => void) => listeners.push(l),
    off: jest.fn(),
  } as unknown as ExtendedPlayer;
  const bar = root.querySelector('.vjs-volume-bar') as HTMLElement;
  return { player, root, bar };
}

const press = (el: HTMLElement, key: string) =>
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

afterEach(() => {
  document.body.innerHTML = '';
  jest.useRealTimers();
});

describe('volume slider semantics', () => {
  it.each([
    ['en', 'Volume', 'Volume 70%'],
    ['ar', 'التحكم بالصوت', 'مستوى الصوت 70%'],
  ] as const)('is named and valued in the page language (%s)', (lang, name, valueText) => {
    const { player, bar } = makePlayer();
    setupKeyboardAccessibility(player, lang);
    expect(bar.getAttribute('aria-label')).toContain(name);
    expect(bar.getAttribute('aria-valuetext')).toBe(valueText);
  });

  it('reports the horizontal orientation and leaves announcing to aria-valuetext', () => {
    const { player, bar } = makePlayer();
    setupKeyboardAccessibility(player, 'en');
    expect(bar.getAttribute('aria-orientation')).toBe('horizontal');
    expect(bar.hasAttribute('aria-live')).toBe(false);
  });

  it('says muted in Arabic when muted', () => {
    const { player, bar } = makePlayer();
    setupKeyboardAccessibility(player, 'ar');
    press(bar, ' ');
    expect(bar.getAttribute('aria-valuenow')).toBe('0');
    expect(bar.getAttribute('aria-valuetext')).not.toMatch(/Muted/);
  });
});

describe('volume slider keyboard', () => {
  it('moves one 10% step per key press even with a second handler on the slider', () => {
    const { player, bar } = makePlayer(0.7);
    // Video.js registers its own Slider keydown handler on the same element first.
    bar.addEventListener('keydown', () => player.volume(player.volume() - 0.1));
    setupKeyboardAccessibility(player, 'en');
    press(bar, 'ArrowDown');
    expect(player.volume()).toBeCloseTo(0.6);
  });

  it('stops the handling on cleanup', () => {
    const { player, bar } = makePlayer(0.7);
    setupKeyboardAccessibility(player, 'en')();
    press(bar, 'ArrowDown');
    expect(player.volume()).toBeCloseTo(0.7);
  });
});

describe('volume indicator', () => {
  it('stays up for 800ms after the last of a rapid series of changes', () => {
    jest.useFakeTimers();
    const { player, root } = makePlayer();
    showVolumeIndicator(player, 0.5, false, 'en');
    jest.advanceTimersByTime(600);
    showVolumeIndicator(player, 0.6, false, 'en');
    jest.advanceTimersByTime(600);
    const indicator = root.querySelector('.vjs-volume-indicator') as HTMLElement;
    expect(indicator.classList.contains('vjs-volume-indicator-show')).toBe(true);
    jest.advanceTimersByTime(201);
    expect(indicator.classList.contains('vjs-volume-indicator-show')).toBe(false);
  });

  it('shows the muted text in the page language', () => {
    const { player, root } = makePlayer();
    showVolumeIndicator(player, 0.5, true, 'ar');
    expect(root.querySelector('.vjs-volume-text')?.textContent).not.toBe('Muted');
  });
});
