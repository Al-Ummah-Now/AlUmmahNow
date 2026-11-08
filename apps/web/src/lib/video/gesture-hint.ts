/**
 * First-run hint about the player's touch gestures (#87 item 10): shown once
 * per device, on touch devices only, and gone after a few seconds.
 */

import { getTranslations } from './i18n/utils/getTranslations';
import type { SupportedLanguage } from './i18n/types';

export const GESTURE_HINT_KEY = 'playerGestureHintSeen';
export const GESTURE_HINT_MS = 6000;

function alreadySeen(): boolean {
  try {
    if (localStorage.getItem(GESTURE_HINT_KEY)) return true;
    localStorage.setItem(GESTURE_HINT_KEY, '1');
    return false;
  } catch {
    // Without storage the hint would return on every video, so stay quiet
    return true;
  }
}

/** Shows the hint unless this device has seen it. */
export function showGestureHintOnce(playerElement: HTMLElement, lang: SupportedLanguage): void {
  if (alreadySeen()) return;

  const { hint, dismiss } = getTranslations(lang).gestures;
  const element = document.createElement('div');
  element.className = 'vjs-gesture-hint';
  element.setAttribute('role', 'status');
  element.dir = lang === 'ar' ? 'rtl' : 'ltr';

  const text = document.createElement('span');
  text.textContent = hint;

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'vjs-gesture-hint-close';
  close.setAttribute('aria-label', dismiss);
  close.textContent = '×';

  element.append(text, close);
  playerElement.appendChild(element);

  const timer = setTimeout(() => element.remove(), GESTURE_HINT_MS);
  close.addEventListener('click', () => {
    clearTimeout(timer);
    element.remove();
  });
}
