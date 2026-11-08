/**
 * Story 1.5 - touch feedback (AC 3) and touch-target sizing rules (AC 1, 2)
 */
import fs from 'fs';
import path from 'path';
import { setupTouchFeedback, hapticPulse, TOUCH_ACTIVE_CLASS, MIN_FEEDBACK_MS } from '../touch-feedback';

function pointer(type: string, target: Element, pointerType = 'touch') {
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  target.dispatchEvent(event);
}

function mockMatchMedia(reducedMotion: boolean) {
  // jest.setup.js defines window.matchMedia as writable (not configurable)
  window.matchMedia = ((query: string) => ({
    matches: reducedMotion && query.includes('reduce'),
    media: query,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  })) as unknown as typeof window.matchMedia;
}

describe('setupTouchFeedback', () => {
  let vibrate: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    mockMatchMedia(false);
    vibrate = jest.fn(() => true);
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate });
    document.body.innerHTML = `
      <div id="player">
        <div class="vjs-control-bar">
          <button id="play" class="vjs-play-control vjs-control"><span id="icon"></span></button>
          <button id="off" disabled>x</button>
        </div>
      </div>`;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('marks the touched control as active and pulses haptics', () => {
    const cleanup = setupTouchFeedback(document.getElementById('player'));
    const play = document.getElementById('play')!;

    pointer('pointerdown', document.getElementById('icon')!);
    expect(play.classList.contains(TOUCH_ACTIVE_CLASS)).toBe(true);
    expect(vibrate).toHaveBeenCalledWith(10);

    pointer('pointerup', play);
    // Feedback stays visible for a minimum time so quick taps are still seen
    expect(play.classList.contains(TOUCH_ACTIVE_CLASS)).toBe(true);
    jest.advanceTimersByTime(MIN_FEEDBACK_MS);
    expect(play.classList.contains(TOUCH_ACTIVE_CLASS)).toBe(false);
    cleanup();
  });

  it('ignores mouse pointers and disabled controls', () => {
    const cleanup = setupTouchFeedback(document.getElementById('player'));
    pointer('pointerdown', document.getElementById('play')!, 'mouse');
    expect(document.getElementById('play')!.classList.contains(TOUCH_ACTIVE_CLASS)).toBe(false);
    pointer('pointerdown', document.getElementById('off')!);
    expect(document.getElementById('off')!.classList.contains(TOUCH_ACTIVE_CLASS)).toBe(false);
    expect(vibrate).not.toHaveBeenCalled();
    cleanup();
  });

  it('cleanup removes listeners and any active state', () => {
    const cleanup = setupTouchFeedback(document.getElementById('player'));
    pointer('pointerdown', document.getElementById('play')!);
    cleanup();
    expect(document.getElementById('play')!.classList.contains(TOUCH_ACTIVE_CLASS)).toBe(false);
    pointer('pointerdown', document.getElementById('play')!);
    expect(document.getElementById('play')!.classList.contains(TOUCH_ACTIVE_CLASS)).toBe(false);
  });

  it('is a no-op without a root element', () => {
    expect(() => setupTouchFeedback(null)()).not.toThrow();
  });
});

describe('hapticPulse', () => {
  it('respects prefers-reduced-motion', () => {
    mockMatchMedia(true);
    const vibrate = jest.fn(() => true);
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate });
    expect(hapticPulse()).toBe(false);
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('returns false when the Vibration API is unavailable', () => {
    mockMatchMedia(false);
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: undefined });
    expect(hapticPulse()).toBe(false);
  });
});

describe('player touch-target CSS (Story 1.5 AC 1)', () => {
  const css = fs.readFileSync(path.join(__dirname, '../../../styles/video-player.css'), 'utf8');

  function px(value: string): number {
    const v = value.trim();
    if (v.endsWith('rem')) return parseFloat(v) * 16;
    if (v.endsWith('px')) return parseFloat(v);
    throw new Error(`unexpected unit: ${v}`);
  }

  it('defines a 44px target token, raised to 48px for coarse pointers', () => {
    expect(css).toMatch(/\.video-js \{[^}]*--vp-touch-target: 44px;/);
    expect(css).toMatch(/@media \(pointer: coarse\) \{\s*\.video-js \{\s*--vp-touch-target: 48px;/);
  });

  it('never sizes control-bar buttons below 44px (all breakpoints)', () => {
    const rule = /\.video-js \.vjs-control-bar button \{([^}]*)\}/g;
    let match: RegExpExecArray | null;
    let checked = 0;
    while ((match = rule.exec(css))) {
      for (const prop of ['min-width', 'min-height', 'width', 'height']) {
        const decl = match[1].match(new RegExp(`(?:^|;|\\s)${prop}:\\s*([^;!]+)`));
        if (!decl) continue;
        const value = decl[1].trim();
        checked++;
        if (value.startsWith('var(--vp-touch-target')) continue;
        expect(px(value)).toBeGreaterThanOrEqual(44);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('gives the seek and volume sliders a full-height hit area', () => {
    expect(css).toMatch(/\.video-js \.vjs-progress-control \{\s*min-height: var\(--vp-touch-target\);/);
    expect(css).toMatch(/\.video-js \.vjs-volume-panel \.vjs-volume-control \{\s*min-height: var\(--vp-touch-target\);/);
  });

  it('provides a visible pressed state for touch', () => {
    expect(css).toContain('.video-js .vjs-control-bar .vjs-touch-active');
  });
});
