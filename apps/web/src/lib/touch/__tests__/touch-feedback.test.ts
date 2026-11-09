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
  // The production skin (docs/specs/VIDEO-PLAYER.md section 5) sizes every target in player-skin.css
  const css = fs.readFileSync(path.join(__dirname, '../../../styles/player-skin.css'), 'utf8');
  const rule = (selector: string) => {
    const at = css.indexOf(`${selector} {`);
    return at < 0 ? '' : css.slice(at, css.indexOf('}', at));
  };

  it('gives every control-bar button a 44px target on every device, the hover shape inside it', () => {
    expect(css).toMatch(/--vjs-fanous-hit:\s*44px/);
    const button = rule('.video-js.vjs-fanous .vjs-control-bar .vjs-control.vjs-button');
    expect(button).toContain('width: var(--vjs-fanous-hit)');
    expect(button).toContain('height: var(--vjs-fanous-hit)');
    // Neighbouring targets never overlap: buttons sit edge to edge with no negative margins
    expect(button).toMatch(/margin:\s*2px 0/);
  });

  it('gives the seek bar a 44px touch height and the volume slider a full-height hit area', () => {
    expect(css).toMatch(/@media \(pointer: coarse\) \{\s*\.video-js\.vjs-fanous \.vjs-progress-control \{\s*height: 44px;/);
    expect(css).toMatch(/\.vjs-volume-control\.vjs-volume-horizontal:hover,[\s\S]*?height: var\(--vjs-fanous-hit\);/);
  });

  it('provides a visible pressed state for touch', () => {
    expect(css).toContain('.vjs-button.vjs-touch-active::before');
  });
});
