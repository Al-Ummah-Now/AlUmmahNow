/**
 * Where the player's dialogs, menus and tooltips mount (lib/video/player-layer.ts): the body, or
 * the fullscreen element while the player is in it.
 */
import { isInPlayerLayer, layerHostFor, PLAYER_LAYER_ATTR } from '../player-layer';

function setFullscreen(el: Element | null, key: 'fullscreenElement' | 'webkitFullscreenElement' = 'fullscreenElement') {
  Object.defineProperty(document, key, { configurable: true, get: () => el });
}

afterEach(() => {
  setFullscreen(null);
  setFullscreen(null, 'webkitFullscreenElement');
  document.body.innerHTML = '';
});

describe('layerHostFor', () => {
  it('is the body when nothing is fullscreen', () => {
    const player = document.body.appendChild(document.createElement('div'));
    expect(layerHostFor(player)).toBe(document.body);
    expect(layerHostFor(null)).toBe(document.body);
  });

  it('is the fullscreen element when it is the player or contains it', () => {
    const wrapper = document.body.appendChild(document.createElement('div'));
    const player = wrapper.appendChild(document.createElement('div'));
    setFullscreen(player);
    expect(layerHostFor(player)).toBe(player);
    setFullscreen(wrapper);
    expect(layerHostFor(player)).toBe(wrapper);
  });

  it('ignores another element in fullscreen, and reads the WebKit-prefixed property', () => {
    const player = document.body.appendChild(document.createElement('div'));
    const other = document.body.appendChild(document.createElement('div'));
    setFullscreen(other);
    expect(layerHostFor(player)).toBe(document.body);
    setFullscreen(null);
    setFullscreen(player, 'webkitFullscreenElement');
    expect(layerHostFor(player)).toBe(player);
  });
});

describe('isInPlayerLayer', () => {
  it('is true inside a layer root and false elsewhere', () => {
    const layer = document.body.appendChild(document.createElement('div'));
    layer.setAttribute(PLAYER_LAYER_ATTR, '');
    const button = layer.appendChild(document.createElement('button'));
    expect(isInPlayerLayer(button)).toBe(true);
    expect(isInPlayerLayer(document.body)).toBe(false);
    expect(isInPlayerLayer(null)).toBe(false);
  });
});
