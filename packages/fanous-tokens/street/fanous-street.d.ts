/** Whether the active theme and mode switch the lantern street on (--fanous-street-on: 1). */
export function streetEnabled(doc?: Document): boolean;
/** Measures the page and draws the garlands once. */
export function renderStreet(doc?: Document): { placed: number; gaps?: number; reason?: string };
/** Starts the street and keeps it in step with the layout, theme and mode; returns a stop function. */
export function startStreet(doc?: Document): () => void;
