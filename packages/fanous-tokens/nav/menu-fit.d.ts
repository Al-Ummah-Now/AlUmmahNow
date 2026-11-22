/** Keeps an open popup inside the viewport (menu-fit.js; docs/design/NAV.md). */
export function fitToViewport(el: HTMLElement | null | undefined): void;
/** Stop re-fitting a popup that closed. */
export function releaseFit(el: HTMLElement | null | undefined): void;
/** Places the header search's phone sheet over its `.aun-header` (a banner above the bar stays visible); returns the release to call on close. */
export function coverBar(el: HTMLElement | null | undefined): () => void;
