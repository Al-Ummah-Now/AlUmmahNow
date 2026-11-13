/**
 * Light and dark (owner decision 2026-11-13: no "System" option). The saved choice is the
 * admin_theme cookie ("light" or "dark") and the data-color-mode attribute on <html>; with none saved
 * the page follows the device. The theme's dark tokens apply under html.dark, the same convention as
 * the videos site. The class is owned by MODE_SCRIPT, never by React, so a server refresh cannot
 * drop it: the script runs before first paint, follows the device live while nothing is saved, and
 * re-applies whenever data-color-mode changes. A "system" cookie from an older release is resolved
 * once to the device's mode and saved as that.
 */
import type { Theme } from '@/i18n/config';

/** True when the page shows the dark tokens: the saved choice, else the device. */
export function isDark(mode: Theme | null, systemPrefersDark: boolean): boolean {
  return mode === 'dark' || (mode !== 'light' && systemPrefersDark);
}

/** Inline in <head>. Plain ES5 with no imports: it runs before React and before any bundle. */
export const MODE_SCRIPT = `(function(){var d=document.documentElement,q=window.matchMedia('(prefers-color-scheme: dark)');if(/(?:^|; )admin_theme=system(?:;|$)/.test(document.cookie)){var r=q.matches?'dark':'light';document.cookie='admin_theme='+r+'; Path=/; Max-Age=31536000; SameSite=Lax'+(location.protocol==='https:'?'; Secure':'');d.setAttribute('data-color-mode',r)}function a(){var m=d.getAttribute('data-color-mode');d.classList.toggle('dark',m==='dark'||(m!=='light'&&q.matches))}a();q.addEventListener('change',a);new MutationObserver(a).observe(d,{attributes:true,attributeFilter:['data-color-mode']})})();`;

/** Client: switch the mode now; the script's observer updates the class. */
export function applyColorMode(mode: Theme) {
  document.documentElement.setAttribute('data-color-mode', mode);
}

/** Client: the mode on screen right now. */
export function currentColorMode(): Theme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}
