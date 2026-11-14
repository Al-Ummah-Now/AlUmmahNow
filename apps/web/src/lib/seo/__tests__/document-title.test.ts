/**
 * @jest-environment jsdom
 */
import { asDocumentTitle, keepDocumentTitle } from '../document-title';

describe('document title', () => {
  afterEach(() => { document.head.innerHTML = ''; });

  it('reads back as the browser stores it (whitespace collapsed and trimmed)', () => {
    const raw = '  مَّا كَانَ ٱللَّهُ\n لِيَذَرَ  ٱلْمُؤْمِنِينَ ';
    document.title = raw;
    expect(asDocumentTitle(raw)).toBe(document.title);
    expect(asDocumentTitle(raw)).toBe('مَّا كَانَ ٱللَّهُ لِيَذَرَ ٱلْمُؤْمِنِينَ');
  });

  it('keeps a title with stray spaces without re-setting it forever (the 2026-11-14 /ar watch freeze)', async () => {
    const title = 'مَّا كَانَ ٱللَّهُ لِيَذَرَ ٱلْمُؤْمِنِينَ ';
    let writes = 0;
    const desc = Object.getOwnPropertyDescriptor(Document.prototype, 'title')!;
    Object.defineProperty(document, 'title', { configurable: true, get: () => desc.get!.call(document), set: (v: string) => { writes++; desc.set!.call(document, v); } });
    const stop = keepDocumentTitle(document, title);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(writes).toBe(1);
    expect(document.title).toBe(title.trim());
    // The router later puts another title in: it is put back once
    desc.set!.call(document, 'Default');
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(document.title).toBe(title.trim());
    expect(writes).toBe(2);
    stop();
    delete (document as { title?: string }).title;
  });
});
