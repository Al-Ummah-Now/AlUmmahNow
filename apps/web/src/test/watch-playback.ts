/**
 * Test helper for useWatchProgress: drive a mock video.js player's
 * 'timeupdate' listener as real playback would (0.25 s steps, not paused,
 * not seeking), so the hook's "played long enough" gate is passed honestly.
 */
import { act } from '@testing-library/react';

interface MockPlayer {
  on: jest.Mock;
  currentTime: jest.Mock | ((...args: unknown[]) => unknown);
  paused?: unknown;
  seeking?: unknown;
}

export function simulatePlayback(player: unknown, seconds: number, from = 0): void {
  const p = player as MockPlayer;
  const handlers = p.on.mock.calls
    .filter(([event]: [string]) => event === 'timeupdate')
    .map(([, fn]: [string, () => void]) => fn);
  const original = p.currentTime;
  const originalPaused = p.paused;
  const originalSeeking = p.seeking;
  let time = from;
  p.currentTime = jest.fn(() => time);
  p.paused = jest.fn(() => false);
  p.seeking = jest.fn(() => false);
  act(() => {
    for (let elapsed = 0; elapsed <= seconds; elapsed += 0.25) {
      time = from + elapsed;
      handlers.forEach((fn) => fn());
    }
  });
  p.currentTime = original;
  p.paused = originalPaused;
  p.seeking = originalSeeking;
}
