/**
 * The caption style dialog opens in the player layer and hands focus back to the player
 * (layerCaptionSettings, docs/specs/VIDEO-PLAYER.md section 5, Layers).
 */
import { layerCaptionSettings } from '../components';

function setup() {
  document.body.innerHTML = '<div dir="rtl"><div class="video-js"><button class="vjs-fanous-settings"></button><div class="vjs-text-track-settings" tabindex="-1"><button class="vjs-done-button"></button></div></div></div>';
  const playerEl = document.querySelector<HTMLElement>('.video-js')!;
  const dialog = document.querySelector<HTMLElement>('.vjs-text-track-settings')!;
  const handlers: Record<string, Array<() => void>> = {};
  const settings = { el: () => dialog, on: (e: string, fn: () => void) => { (handlers[e] ??= []).push(fn); } };
  const fire = (e: string) => handlers[e]?.forEach((fn) => fn());
  layerCaptionSettings({ el: () => playerEl, getChild: (n) => (n === 'textTrackSettings' ? settings : undefined), on: settings.on });
  return { playerEl, dialog, fire };
}

describe('layerCaptionSettings', () => {
  it('moves the dialog into a layer on the body, in the page direction', () => {
    const { playerEl, dialog, fire } = setup();
    fire('beforemodalopen');
    const layer = dialog.parentElement!;
    expect(layer.parentElement).toBe(document.body);
    expect(layer.hasAttribute('data-player-layer')).toBe(true);
    expect(layer.dir).toBe('rtl');
    expect(playerEl.contains(dialog)).toBe(false);
  });

  it('focuses the dialog when it opens from outside the player, so Escape reaches it', () => {
    const { dialog, fire } = setup();
    document.body.focus();
    fire('beforemodalopen');
    fire('modalopen');
    expect(document.activeElement).toBe(dialog);
  });

  it('keeps focus that Video.js already moved inside', () => {
    const { dialog, fire } = setup();
    fire('beforemodalopen');
    dialog.querySelector<HTMLElement>('.vjs-done-button')!.focus();
    fire('modalopen');
    expect(document.activeElement).toBe(dialog.querySelector('.vjs-done-button'));
  });

  it('returns the dialog to the player and focus to the settings button on close', () => {
    const { playerEl, dialog, fire } = setup();
    fire('beforemodalopen');
    fire('modalopen');
    fire('modalclose');
    expect(playerEl.contains(dialog)).toBe(true);
    expect(document.querySelector('[data-player-layer]')).toBeNull();
    expect(document.activeElement).toBe(playerEl.querySelector('.vjs-fanous-settings'));
  });
});
