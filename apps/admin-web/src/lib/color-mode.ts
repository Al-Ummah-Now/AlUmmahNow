/**
 * Light and dark. The preference (system, light or dark) is the admin_theme cookie and the
 * data-color-mode attribute on <html>; the theme's dark tokens apply under html.dark, the same
 * convention as the videos site. The class is owned by MODE_SCRIPT, never by React, so a server
 * refresh cannot drop it: the script runs before first paint, follows the system setting live, and
 * re-applies whenever data-color-mode changes.
 */
import type { Theme } from '@/i18n/config';

/** True when this preference shows the dark tokens, given whether the system prefers dark. */
export function isDark(mode: Theme, systemPrefersDark: boolean): boolean {
  return mode === 'dark' || (mode === 'system' && systemPrefersDark);
}

/** Inline in <head>. Plain ES5 with no imports: it runs before React and before any bundle. */
export const MODE_SCRIPT = `(function(){var d=document.documentElement,q=window.matchMedia('(prefers-color-scheme: dark)');function a(){var m=d.getAttribute('data-color-mode');d.classList.toggle('dark',m==='dark'||(m!=='light'&&q.matches))}a();q.addEventListener('change',a);new MutationObserver(a).observe(d,{attributes:true,attributeFilter:['data-color-mode']})})();`;

/** Client: switch the preference now; the script's observer updates the class. */
export function applyColorMode(mode: Theme) {
  document.documentElement.setAttribute('data-color-mode', mode);
}
