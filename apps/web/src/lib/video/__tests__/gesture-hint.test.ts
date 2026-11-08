import { showGestureHintOnce, GESTURE_HINT_KEY, GESTURE_HINT_MS } from '../gesture-hint';

const hintIn = (el: HTMLElement) => el.querySelector('.vjs-gesture-hint');

beforeEach(() => localStorage.clear());
afterEach(() => jest.useRealTimers());

describe('showGestureHintOnce', () => {
  it('shows a localized hint the first time only', () => {
    const first = document.createElement('div');
    showGestureHintOnce(first, 'ar');
    expect(hintIn(first)?.textContent).toContain('انقر مرتين');
    expect(hintIn(first)?.getAttribute('dir')).toBe('rtl');
    expect(localStorage.getItem(GESTURE_HINT_KEY)).toBe('1');

    const second = document.createElement('div');
    showGestureHintOnce(second, 'ar');
    expect(hintIn(second)).toBeNull();
  });

  it('removes itself after the timeout', () => {
    jest.useFakeTimers();
    const el = document.createElement('div');
    showGestureHintOnce(el, 'en');
    jest.advanceTimersByTime(GESTURE_HINT_MS);
    expect(hintIn(el)).toBeNull();
  });

  it('can be dismissed with a named button', () => {
    const el = document.createElement('div');
    showGestureHintOnce(el, 'en');
    const close = el.querySelector('button') as HTMLButtonElement;
    expect(close.getAttribute('aria-label')).toBe('Dismiss');
    close.click();
    expect(hintIn(el)).toBeNull();
  });
});
