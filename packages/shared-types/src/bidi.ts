/**
 * Text direction in one line of plain text (emails, titles, anything without markup).
 */

/** Embeddings, overrides and isolates (U+202A–U+202E, U+2066–U+2069): they reorder what comes after them. */
const BIDI_CONTROLS = /[\u202a-\u202e\u2066-\u2069]/g;

/** A value without direction controls, for text a person typed. The marks (LRM, RLM, ALM) stay: they reorder nothing after them. */
export const stripBidiControls = (text: string): string => text.replace(BIDI_CONTROLS, '');

/**
 * A value with its own direction (FSI…PDI), so what is inside never reorders what is around it. Controls in
 * the value are dropped (a PDI would end the isolate early), and a paragraph break, which also ends it, is a space.
 */
export const isolateText = (text: string): string => `\u2068${stripBidiControls(text).replace(/[\n\r\u001c-\u001e\u0085\u2029]+/g, ' ')}\u2069`;
