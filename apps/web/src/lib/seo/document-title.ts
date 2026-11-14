/**
 * A title as the browser stores it: document.title reads back with ASCII whitespace collapsed to
 * single spaces and trimmed. Comparing the raw title with document.title therefore never matches
 * for a title with a trailing, leading or double space (many Arabic titles end with one).
 */
export function asDocumentTitle(title: string): string {
  return title.replace(/[\t\n\f\r ]+/g, ' ').trim();
}

/**
 * Sets the tab title and puts it back whenever something else (the router applying a route's
 * metadata after its own commit) replaces it. Compares against the stored form, so writing the
 * title never triggers another write: the 2026-11-14 watch page freeze was an observer that set a
 * title with a trailing space forever. Returns a function that stops keeping it.
 */
export function keepDocumentTitle(doc: Document, title: string): () => void {
  const want = asDocumentTitle(title);
  if (doc.title !== want) doc.title = want;
  const keep = new MutationObserver(() => {
    if (doc.title !== want) doc.title = want;
  });
  keep.observe(doc.head, { childList: true, subtree: true, characterData: true });
  return () => keep.disconnect();
}
