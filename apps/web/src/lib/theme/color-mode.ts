/**
 * Light / Dark for the videos site (owner decision 2026-11-13: no "System" option anywhere).
 *
 * next-themes owns the mode (localStorage `theme`, class `dark` on <html>, its own script before
 * paint). It runs with defaultTheme "system" + enableSystem only so that a first visit, with
 * nothing saved, follows the device; no control offers "System": the drawer's Light / Dark buttons
 * (ThemeDemo/NavPrefs) and the header toggle (ThemeDemo/AppShell) always save "light" or "dark".
 *
 * A "system" saved by an older release is resolved here once, in <head> before next-themes reads
 * it, to the device's mode and saved as that: from then on it is an explicit choice.
 */
export const MODE_STORAGE_KEY = 'theme';

/** Inline in <head>, before next-themes' script. Plain ES5, never throws. */
export const MODE_MIGRATE_SCRIPT = `(function(){try{if(localStorage.getItem("${MODE_STORAGE_KEY}")==="system")localStorage.setItem("${MODE_STORAGE_KEY}",window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light")}catch(e){}})();`;
