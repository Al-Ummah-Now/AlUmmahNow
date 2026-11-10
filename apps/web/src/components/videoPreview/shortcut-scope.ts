/**
 * Whether the preview player's keyboard shortcuts (Space, M, F, arrows) should
 * act on this keydown.
 *
 * The preview sits inside forms (the video edit page). Its listener is on the
 * document so the keys work before anything is focused, but it acted on every
 * key: Space was swallowed in the title and description fields, "f" put the
 * page into fullscreen and "m" muted the preview while typing. It now acts
 * only when nothing is focused (the page body) or focus is inside the preview,
 * and never for keys that already did something or carry a modifier
 * (Ctrl/Cmd+F is the browser's Find).
 */
export function previewOwnsKey(event: KeyboardEvent, root: Element | null | undefined): boolean {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return false;
  const target = event.target;
  if (typeof document !== 'undefined' && (target === document.body || target === document.documentElement || target === document)) {
    return true;
  }
  if (!root || !(target instanceof Node) || !root.contains(target)) return false;
  // Inside the preview, a text field (none today) still keeps its keys
  return !(target instanceof Element && target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]'));
}
