/**
 * Story 1.4 - keyboard shortcuts must not hijack native keyboard behaviour
 */
import { shouldHandlePlayerShortcut, isEditableElement } from '../keyboard-scope';

function setup() {
  document.body.innerHTML = `
    <button id="outside">Subscribe</button>
    <input id="search" />
    <div id="player" class="video-js" tabindex="-1">
      <video id="tech" tabindex="-1"></video>
      <div class="vjs-control-bar">
        <button id="play" class="vjs-play-control">Play</button>
        <div id="seek" class="vjs-progress-holder" role="slider" tabindex="0"></div>
        <div class="vjs-menu"><ul role="menu"><li id="item" role="menuitemradio" tabindex="-1">720p</li></ul></div>
      </div>
    </div>`;
  return {
    player: document.getElementById('player')!,
    get: (id: string) => document.getElementById(id)!,
  };
}

const key = (k: string, target: Element | null, mods: Partial<KeyboardEvent> = {}) => ({
  key: k,
  target,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...mods,
});

describe('shouldHandlePlayerShortcut', () => {
  it('handles shortcuts when the player root has focus', () => {
    const { player } = setup();
    expect(shouldHandlePlayerShortcut(key(' ', player), player, player)).toBe(true);
    expect(shouldHandlePlayerShortcut(key('ArrowLeft', player), player, player)).toBe(true);
    expect(shouldHandlePlayerShortcut(key('f', player), player, player)).toBe(true);
  });

  it('handles shortcuts when nothing in particular is focused (body)', () => {
    const { player } = setup();
    expect(shouldHandlePlayerShortcut(key('k', document.body), player, document.body)).toBe(true);
  });

  it('ignores keys while typing in form fields', () => {
    const { player, get } = setup();
    expect(shouldHandlePlayerShortcut(key('k', get('search')), player, get('search'))).toBe(false);
    expect(isEditableElement(get('search'))).toBe(true);
  });

  it('does not steal Space/arrows from focused elements outside the player', () => {
    const { player, get } = setup();
    expect(shouldHandlePlayerShortcut(key(' ', get('outside')), player, get('outside'))).toBe(false);
    expect(shouldHandlePlayerShortcut(key('ArrowDown', get('outside')), player, get('outside'))).toBe(false);
  });

  it('leaves browser shortcuts alone (Ctrl/Cmd/Alt)', () => {
    const { player } = setup();
    expect(shouldHandlePlayerShortcut(key('f', player, { ctrlKey: true }), player, player)).toBe(false);
    expect(shouldHandlePlayerShortcut(key('l', player, { metaKey: true }), player, player)).toBe(false);
    expect(shouldHandlePlayerShortcut(key('ArrowLeft', player, { altKey: true }), player, player)).toBe(false);
  });

  it('lets focused player buttons keep Space/Enter activation', () => {
    const { player, get } = setup();
    expect(shouldHandlePlayerShortcut(key(' ', get('play')), player, get('play'))).toBe(false);
    expect(shouldHandlePlayerShortcut(key('Enter', get('play')), player, get('play'))).toBe(false);
    // ...but other shortcuts still work from a focused button
    expect(shouldHandlePlayerShortcut(key('m', get('play')), player, get('play'))).toBe(true);
  });

  it('lets sliders and menus keep arrow/Home/End keys', () => {
    const { player, get } = setup();
    for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']) {
      expect(shouldHandlePlayerShortcut(key(k, get('seek')), player, get('seek'))).toBe(false);
      expect(shouldHandlePlayerShortcut(key(k, get('item')), player, get('item'))).toBe(false);
    }
    // Space on the seek slider still toggles playback (slider has no activation)
    expect(shouldHandlePlayerShortcut(key(' ', get('seek')), player, get('seek'))).toBe(true);
  });

  it('treats no key as a shortcut while focus is in a menu or dialog in the player', () => {
    const { player, get } = setup();
    for (const k of ['k', 'm', 'f', '5', 'Escape']) {
      expect(shouldHandlePlayerShortcut(key(k, get('item')), player, get('item'))).toBe(false);
    }
  });

  it('treats no key as a shortcut in a player layer, outside the player or inside it in fullscreen', () => {
    const { player } = setup();
    const outside = document.createElement('div');
    outside.setAttribute('data-player-layer', '');
    outside.innerHTML = '<button>Quality</button>';
    document.body.appendChild(outside);
    const inside = document.createElement('div');
    inside.setAttribute('data-player-layer', '');
    inside.innerHTML = '<button>Close</button>';
    player.appendChild(inside);
    for (const el of [outside.querySelector('button')!, inside.querySelector('button')!]) {
      for (const k of ['k', 'm', 'ArrowLeft']) expect(shouldHandlePlayerShortcut(key(k, el), player, el)).toBe(false);
    }
    outside.remove();
    inside.remove();
  });

  it('handles keys when the media element inside the player is focused', () => {
    const { player, get } = setup();
    expect(shouldHandlePlayerShortcut(key('ArrowRight', get('tech')), player, get('tech'))).toBe(true);
  });
});
