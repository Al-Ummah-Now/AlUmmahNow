/**
 * Regression: with native HLS (Safari / iOS) the stream exposes no quality
 * levels and the quality button opened an empty "Quality" menu. The player
 * gets `vjs-no-quality-levels` (which hides the button) until levels exist.
 */
jest.mock('video.js', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('@videojs/http-streaming', () => ({}));
jest.mock('videojs-contrib-quality-levels', () => ({}));
jest.mock('videojs-hls-quality-selector', () => ({}));
jest.mock('video.js/dist/lang/ar.json', () => ({}));
jest.mock('@/lib/logger-client', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import type { Player } from 'video.js';
import { NO_QUALITY_LEVELS_CLASS, trackQualityLevelAvailability } from '../videojs-setup';

function fakePlayer(initialLevels: number) {
  const handlers: Record<string, Array<() => void>> = {};
  const levels = {
    length: initialLevels,
    selectedIndex: -1,
    on: (event: string, cb: () => void) => { (handlers[event] ||= []).push(cb); },
    off: jest.fn(),
  };
  const el = document.createElement('div');
  const player = {
    qualityLevels: () => levels,
    el: () => el,
  } as unknown as Player;
  return { player, levels, classes: { has: (name: string) => el.classList.contains(name) }, emit: (event: string) => (handlers[event] || []).forEach((cb) => cb()) };
}

describe('trackQualityLevelAvailability', () => {
  it('hides the quality menu while there are no levels and shows it once levels arrive', () => {
    const { player, levels, classes, emit } = fakePlayer(0);
    trackQualityLevelAvailability(player);
    expect(classes.has(NO_QUALITY_LEVELS_CLASS)).toBe(true);

    levels.length = 2;
    emit('addqualitylevel');
    expect(classes.has(NO_QUALITY_LEVELS_CLASS)).toBe(false);

    levels.length = 0;
    emit('removequalitylevel');
    expect(classes.has(NO_QUALITY_LEVELS_CLASS)).toBe(true);
  });

  it('keeps the menu for streams that expose renditions', () => {
    const { player, classes } = fakePlayer(3);
    trackQualityLevelAvailability(player);
    expect(classes.has(NO_QUALITY_LEVELS_CLASS)).toBe(false);
  });
});
